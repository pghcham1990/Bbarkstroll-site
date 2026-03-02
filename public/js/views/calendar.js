/* === Calendar View === */
let _calYear, _calMonth, _calDay, _calAppts = [];

async function render_calendar(el) {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  _calDay = now.getDate();

  el.innerHTML = `
    <p class="section-label">Schedule</p>
    <h1 class="section-title">Calendar</h1>
    <div class="cal-nav">
      <button id="calPrev">&larr;</button>
      <h2 id="calLabel"></h2>
      <button id="calNext">&rarr;</button>
    </div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="dayAppts"></div>
  `;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+';
  fab.title = 'New Appointment';
  fab.onclick = () => openApptForm();
  document.body.appendChild(fab);

  document.getElementById('calPrev').onclick = () => { _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; } renderCal(); };
  document.getElementById('calNext').onclick = () => { _calMonth++; if (_calMonth > 11) { _calMonth = 0; _calYear++; } renderCal(); };

  renderCal();
}

async function renderCal() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calLabel').textContent = months[_calMonth] + ' ' + _calYear;

  // Fetch month's appointments
  const start = new Date(_calYear, _calMonth, 1).toISOString();
  const end = new Date(_calYear, _calMonth + 1, 1).toISOString();
  try { _calAppts = await api('/appointments?start=' + start + '&end=' + end); } catch { _calAppts = []; }

  // Build grid
  const grid = document.getElementById('calGrid');
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const firstDay = new Date(_calYear, _calMonth, 1).getDay();
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const prevDays = new Date(_calYear, _calMonth, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === _calYear && today.getMonth() === _calMonth;

  // Previous month filler
  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${prevDays - i}</div>`;
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasAppts = _calAppts.some(a => a.start_time && a.start_time.startsWith(dateStr) && a.status !== 'cancelled');
    const isToday = isCurrentMonth && d === today.getDate();
    const isSelected = d === _calDay;
    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-day="${d}" onclick="selectDay(${d})">${d}${hasAppts ? '<div class="cal-dot"></div>' : ''}</div>`;
  }

  // Next month filler
  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - totalCells % 7) % 7;
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="cal-day other-month">${i}</div>`;
  }

  grid.innerHTML = html;
  renderDayAppts();
}

function selectDay(d) {
  _calDay = d;
  document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
  const dayEl = document.querySelector(`.cal-day[data-day="${d}"]`);
  if (dayEl) dayEl.classList.add('selected');
  renderDayAppts();
}

function renderDayAppts() {
  const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(_calDay).padStart(2,'0')}`;
  const dayAppts = _calAppts.filter(a => a.start_time && a.start_time.startsWith(dateStr)).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const container = document.getElementById('dayAppts');

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = months[_calMonth] + ' ' + _calDay + ', ' + _calYear;

  if (!dayAppts.length) {
    container.innerHTML = `<p style="font-size:.85rem;color:var(--text-soft);text-align:center;padding:1.5rem 0">No appointments on ${label}</p>`;
    return;
  }

  container.innerHTML = `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin-bottom:.5rem">${label} — ${dayAppts.length} appointment${dayAppts.length > 1 ? 's' : ''}</p>` +
    dayAppts.map(a => `
      <div class="appt-card" onclick="viewAppt(${a.id})" style="cursor:pointer">
        <div class="appt-time">${fmtTime(a.start_time)}</div>
        <div class="appt-body">
          <div class="appt-title">🐾 ${esc(a.dog_name)} — ${esc(a.service_name)}</div>
          <div class="appt-sub">${esc(a.customer_name)} · ${esc(a.employee_name)}</div>
          <span class="appt-status ${a.status}">${a.status}</span>
        </div>
      </div>
    `).join('');
}

async function viewAppt(id) {
  try {
    const a = await api('/appointments/' + id);
    openModal(`
      <div class="modal-header"><h2>Appointment</h2><button class="modal-close">&times;</button></div>
      <div class="detail-row"><span class="detail-label">Date</span><span>${fmtDate(a.start_time)}</span></div>
      <div class="detail-row"><span class="detail-label">Time</span><span>${fmtTime(a.start_time)} — ${fmtTime(a.end_time)}</span></div>
      <div class="detail-row"><span class="detail-label">Service</span><span>${esc(a.service_name)}</span></div>
      <div class="detail-row"><span class="detail-label">Client</span><span>${esc(a.customer_name)}</span></div>
      <div class="detail-row"><span class="detail-label">Dog</span><span>${esc(a.dog_name)}${a.dog_breed ? ' (' + esc(a.dog_breed) + ')' : ''}</span></div>
      <div class="detail-row"><span class="detail-label">Team Member</span><span>${esc(a.employee_name)}</span></div>
      ${a.customer_address ? `<div class="detail-row"><span class="detail-label">Address</span><span>${esc(a.customer_address)}</span></div>` : ''}
      ${a.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span>${esc(a.notes)}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Status</span><span class="appt-status ${a.status}">${a.status}</span></div>
      <div class="detail-row"><span class="detail-label">Email Sent</span><span>${a.email_sent ? '✅ Yes' : '❌ No'}</span></div>
      <div class="form-actions" style="margin-top:1rem">
        ${a.status === 'scheduled' ? `<button class="btn btn-danger btn-sm" onclick="cancelAppt(${a.id})">Cancel Appointment</button>` : ''}
        ${a.status === 'scheduled' ? `<button class="btn btn-primary btn-sm" onclick="completeAppt(${a.id})">Mark Complete</button>` : ''}
      </div>
    `);
  } catch (e) { toast(e.message, 'err'); }
}

async function cancelAppt(id) {
  if (!await confirmDialog('Cancel this appointment?')) return;
  try {
    await api('/appointments/' + id, { method: 'DELETE' });
    closeModal();
    toast('Appointment cancelled');
    renderCal();
  } catch (e) { toast(e.message, 'err'); }
}

async function completeAppt(id) {
  try {
    const a = await api('/appointments/' + id);
    await api('/appointments/' + id, { method: 'PUT', body: { ...a, status: 'completed' } });
    closeModal();
    toast('Marked as complete');
    renderCal();
  } catch (e) { toast(e.message, 'err'); }
}

async function openApptForm() {
  let customers, employees, services;
  try {
    [customers, employees, services] = await Promise.all([
      api('/customers'),
      api('/employees?active=1'),
      api('/services')
    ]);
  } catch (e) { toast('Failed to load data', 'err'); return; }

  if (!customers.length) { toast('Add a client first', 'err'); return; }
  if (!employees.length) { toast('Add a team member first', 'err'); return; }

  const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(_calDay).padStart(2,'0')}`;

  openModal(`
    <div class="modal-header"><h2>New Appointment</h2><button class="modal-close">&times;</button></div>
    <form id="apptForm">
      <div class="form-group">
        <label>Client *</label>
        <select name="customer_id" id="apptCustomer" required>
          <option value="">Select client...</option>
          ${customers.map(c => `<option value="${c.id}">${esc(c.last_name)}, ${esc(c.first_name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Dog *</label>
        <select name="dog_id" id="apptDog" required>
          <option value="">Select client first...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Team Member *</label>
        <select name="employee_id" required>
          ${employees.map(e => `<option value="${e.id}">${esc(e.first_name)} ${esc(e.last_name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Service *</label>
        <select name="service_id" id="apptService" required>
          ${services.map(s => `<option value="${s.id}" data-dur="${s.duration_min}">${esc(s.name)} (${s.duration_min} min)</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Date *</label><input type="date" name="date" value="${dateStr}" required></div>
        <div class="form-group"><label>Time *</label><input type="time" name="time" value="09:00" required></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes" placeholder="Optional notes..."></textarea></div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Appointment</button>
      </div>
    </form>
  `);

  // Load dogs when customer changes
  document.getElementById('apptCustomer').onchange = async function() {
    const dogSelect = document.getElementById('apptDog');
    dogSelect.innerHTML = '<option value="">Loading...</option>';
    if (!this.value) { dogSelect.innerHTML = '<option value="">Select client first...</option>'; return; }
    try {
      const dogs = await api('/customers/' + this.value + '/dogs');
      if (!dogs.length) {
        dogSelect.innerHTML = '<option value="">No dogs — add one in Clients tab</option>';
        return;
      }
      dogSelect.innerHTML = dogs.map(d => `<option value="${d.id}">${esc(d.name)}${d.breed ? ' (' + esc(d.breed) + ')' : ''}</option>`).join('');
    } catch { dogSelect.innerHTML = '<option value="">Error loading dogs</option>'; }
  };

  document.getElementById('apptForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    if (!data.customer_id || !data.dog_id) { toast('Select a client and dog', 'err'); return; }

    // Build start/end times
    const svc = document.getElementById('apptService');
    const dur = parseInt(svc.selectedOptions[0]?.dataset.dur || '30');
    const startDt = new Date(data.date + 'T' + data.time);
    const endDt = new Date(startDt.getTime() + dur * 60000);

    const body = {
      customer_id: parseInt(data.customer_id),
      dog_id: parseInt(data.dog_id),
      employee_id: parseInt(data.employee_id),
      service_id: parseInt(data.service_id),
      start_time: startDt.toISOString(),
      end_time: endDt.toISOString(),
      notes: data.notes || null
    };

    try {
      const result = await api('/appointments', { method: 'POST', body });
      closeModal();
      toast(result.email_sent ? 'Appointment created & email sent!' : 'Appointment created (email not configured yet)');
      // Jump to the appointment date
      _calYear = startDt.getFullYear();
      _calMonth = startDt.getMonth();
      _calDay = startDt.getDate();
      renderCal();
    } catch (err) { toast(err.message, 'err'); }
  };
}
