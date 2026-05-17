/* === Calendar View === */
let _calYear, _calMonth, _calDay, _calAppts = [];

async function render_calendar(el) {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  _calDay = now.getDate();

  el.innerHTML = `
    <div class="glass-panel" style="margin-bottom:1.25rem">
      <div style="padding:1rem 1.25rem">
        <div class="cal-nav">
          <button id="calPrev">&larr;</button>
          <h2 id="calLabel"></h2>
          <button id="calNext">&rarr;</button>
        </div>
        <div class="cal-grid" id="calGrid"></div>
      </div>
    </div>
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

  const start = new Date(_calYear, _calMonth, 1).toISOString();
  const end = new Date(_calYear, _calMonth + 1, 1).toISOString();
  try { _calAppts = await api('/appointments?start=' + start + '&end=' + end); } catch { _calAppts = []; }

  const grid = document.getElementById('calGrid');
  const dows = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = dows.map(d => `<div class="cal-dow">${d}</div>`).join('');

  const firstDay = new Date(_calYear, _calMonth, 1).getDay();
  const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
  const prevDays = new Date(_calYear, _calMonth, 0).getDate();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === _calYear && today.getMonth() === _calMonth;

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${prevDays - i}</div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasAppts = _calAppts.some(a => a.start_time && a.start_time.startsWith(dateStr) && a.status !== 'cancelled');
    const isToday = isCurrentMonth && d === today.getDate();
    const isSelected = d === _calDay;
    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-day="${d}" onclick="selectDay(${d})">${d}${hasAppts ? '<div class="cal-dot"></div>' : ''}</div>`;
  }

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
  const dayAppts = _calAppts.filter(a => a.start_time && a.start_time.startsWith(dateStr) && a.status !== 'cancelled' && a.status !== 'deleted').sort((a, b) => a.start_time.localeCompare(b.start_time));
  const container = document.getElementById('dayAppts');

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const selDate = new Date(_calYear, _calMonth, _calDay);
  const dayLabel = dayNames[selDate.getDay()] + ', ' + monthNames[_calMonth] + ' ' + _calDay;

  let html = `<div class="cal-day-header"><span class="cal-day-label">${dayLabel}</span></div>`;

  if (!dayAppts.length) {
    html += `<p class="cal-no-appts">No walks scheduled</p>`;
  } else {
    html += dayAppts.map(a => `
      <div class="appt-card" onclick="viewAppt(${a.id})" style="cursor:pointer">
        <div class="appt-time">${fmtTime(a.start_time)}</div>
        <div class="appt-body">
          <div class="appt-title">${esc(a.dog_names)}</div>
          <div class="appt-sub">${esc(a.service_name)} &middot; ${esc(a.employee_name)}</div>
        </div>
      </div>
    `).join('');
  }

  // Coming Up
  const upcoming = _calAppts.filter(a => {
    if (!a.start_time || a.status === 'cancelled' || a.status === 'deleted') return false;
    return a.start_time.substring(0, 10) > dateStr;
  }).sort((a, b) => a.start_time.localeCompare(b.start_time)).slice(0, 8);

  if (upcoming.length) {
    html += `<p class="cal-upcoming-label">Coming Up</p>`;
    let lastDate = '';
    for (const a of upcoming) {
      const apptDate = a.start_time.substring(0, 10);
      if (apptDate !== lastDate) {
        const [y, m, d] = apptDate.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        html += `<p class="cal-upcoming-date">${dayNames[dt.getDay()].substring(0, 3)}, ${monthNames[m - 1]} ${d}</p>`;
        lastDate = apptDate;
      }
      html += `
        <div class="appt-card appt-card-upcoming" onclick="viewAppt(${a.id})" style="cursor:pointer">
          <div class="appt-time">${fmtTime(a.start_time)}</div>
          <div class="appt-body">
            <div class="appt-title">${esc(a.dog_names)}</div>
            <div class="appt-sub">${esc(a.service_name)} &middot; ${esc(a.employee_name)}</div>
          </div>
        </div>
      `;
    }
  }

  container.innerHTML = html;
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
      <div class="detail-row"><span class="detail-label">${a.dogs && a.dogs.length > 1 ? 'Dogs' : 'Dog'}</span><span>${esc(a.dog_names_with_breed)}</span></div>
      <div class="detail-row"><span class="detail-label">Team Member</span><span>${esc(a.employee_name)}</span></div>
      ${a.customer_address ? `<div class="detail-row"><span class="detail-label">Address</span><span>${esc(a.customer_address)}</span></div>` : ''}
      ${a.notes ? `<div class="detail-row detail-block"><span class="detail-label">Notes</span><span class="detail-value">${esc(a.notes)}</span></div>` : ''}
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
    const dog_ids = a.dogs ? a.dogs.map(d => d.id) : (a.dog_id ? [a.dog_id] : []);
    await api('/appointments/' + id, { method: 'PUT', body: { ...a, dog_ids, status: 'completed' } });
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

  customers = customers.filter(function(c) { return c.status !== 'prospect'; });
  if (!customers.length) { toast('Add a client first', 'err'); return; }
  if (!employees.length) { toast('Add a team member first', 'err'); return; }

  // Build week chips centered on selected day
  const selDate = new Date(_calYear, _calMonth, _calDay);
  const dow = selDate.getDay();
  const weekStart = new Date(selDate);
  weekStart.setDate(selDate.getDate() - dow);

  const dayAbbr = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const monthAbbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function buildChips(ws, selIso) {
    let h = '';
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws);
      d.setDate(ws.getDate() + i);
      const iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      const sel = iso === selIso ? ' selected' : '';
      h += '<button type="button" class="day-chip' + sel + '" data-date="' + iso + '">'
        + '<span class="day-name">' + dayAbbr[i] + '</span>'
        + '<span class="day-date">' + monthAbbr[d.getMonth()] + ' ' + d.getDate() + '</span>'
        + '</button>';
    }
    return h;
  }

  function weekLabel(ws) {
    const we = new Date(ws);
    we.setDate(ws.getDate() + 6);
    return monthAbbr[ws.getMonth()] + ' ' + ws.getDate() + ' \u2014 ' + monthAbbr[we.getMonth()] + ' ' + we.getDate();
  }

  const selIso = _calYear + '-' + String(_calMonth+1).padStart(2,'0') + '-' + String(_calDay).padStart(2,'0');

  openModal(
    '<div class="modal-header"><h2>New Appointment</h2><button class="modal-close">&times;</button></div>'
    + '<form id="apptForm">'
    + '<div class="form-group"><label>Client *</label>'
    + '<select name="customer_id" id="apptCustomer" required><option value="">Select client...</option>'
    + customers.map(function(c) { return '<option value="' + c.id + '">' + esc(c.last_name) + ', ' + esc(c.first_name) + '</option>'; }).join('')
    + '</select></div>'
    + '<div class="form-group"><label>Dogs *</label><div id="apptDogs" style="padding:4px 0"><span style="color:var(--g-text-sec);font-size:.85rem">Select client first...</span></div></div>'
    + '<div class="form-group"><label>Team Member *</label><select name="employee_id" required>'
    + employees.map(function(e) { return '<option value="' + e.id + '">' + esc(e.first_name) + ' ' + esc(e.last_name) + '</option>'; }).join('')
    + '</select></div>'
    + '<div class="form-group"><label>Service *</label><select name="service_id" id="apptService" required>'
    + services.map(function(s) { return '<option value="' + s.id + '" data-dur="' + s.duration_min + '">' + esc(s.name) + ' (' + s.duration_min + ' min)</option>'; }).join('')
    + '</select></div>'
    + '<div class="form-group"><label>Days * <span style="font-weight:400;text-transform:none;font-size:.7rem;color:var(--text-soft)">(tap multiple)</span></label>'
    + '<div class="day-chips-nav"><button type="button" id="weekPrev" title="Previous week">&larr;</button>'
    + '<span class="day-chips-label" id="weekLabel">' + weekLabel(weekStart) + '</span>'
    + '<button type="button" id="weekNext" title="Next week">&rarr;</button></div>'
    + '<div class="day-chips" id="dayChips">' + buildChips(weekStart, selIso) + '</div></div>'
    + '<div class="form-group"><label>Time *</label><input type="time" name="time" value="09:00" required></div>'
    + '<div class="form-group"><label>Notes</label><textarea name="notes" placeholder="Optional notes..."></textarea></div>'
    + '<div class="form-actions"><button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>'
    + '<button type="submit" class="btn btn-primary" id="apptSubmitBtn">Create Appointment</button></div>'
    + '</form>'
  );

  // Week navigation state
  var _weekOffset = 0;
  var _baseWeekStart = new Date(weekStart);

  function currentWeekStart() {
    var ws = new Date(_baseWeekStart);
    ws.setDate(_baseWeekStart.getDate() + _weekOffset * 7);
    return ws;
  }

  function rebuildChips() {
    var ws = currentWeekStart();
    document.getElementById('weekLabel').textContent = weekLabel(ws);
    var container = document.getElementById('dayChips');
    container.textContent = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 7; i++) {
      var d = new Date(ws);
      d.setDate(ws.getDate() + i);
      var iso = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'day-chip';
      btn.dataset.date = iso;
      var nameSpan = document.createElement('span');
      nameSpan.className = 'day-name';
      nameSpan.textContent = dayAbbr[i];
      var dateSpan = document.createElement('span');
      dateSpan.className = 'day-date';
      dateSpan.textContent = monthAbbr[d.getMonth()] + ' ' + d.getDate();
      btn.appendChild(nameSpan);
      btn.appendChild(dateSpan);
      btn.onclick = function() { this.classList.toggle('selected'); updateSubmitLabel(); };
      frag.appendChild(btn);
    }
    container.appendChild(frag);
    updateSubmitLabel();
  }

  function bindChipClicks() {
    document.querySelectorAll('#dayChips .day-chip').forEach(function(chip) {
      chip.onclick = function() { chip.classList.toggle('selected'); updateSubmitLabel(); };
    });
  }

  function updateSubmitLabel() {
    var count = document.querySelectorAll('#dayChips .day-chip.selected').length;
    var btn = document.getElementById('apptSubmitBtn');
    btn.textContent = count > 1 ? 'Create ' + count + ' Appointments' : 'Create Appointment';
  }

  bindChipClicks();
  document.getElementById('weekPrev').onclick = function() { _weekOffset--; rebuildChips(); };
  document.getElementById('weekNext').onclick = function() { _weekOffset++; rebuildChips(); };

  document.getElementById('apptCustomer').onchange = async function() {
    var dogContainer = document.getElementById('apptDogs');
    dogContainer.textContent = '';
    var loadMsg = document.createElement('span');
    loadMsg.style.cssText = 'color:var(--g-text-sec);font-size:.85rem';
    loadMsg.textContent = 'Loading...';
    dogContainer.appendChild(loadMsg);
    if (!this.value) { loadMsg.textContent = 'Select client first...'; return; }
    try {
      var dogs = await api('/customers/' + this.value + '/dogs');
      dogContainer.textContent = '';
      if (!dogs.length) {
        var noMsg = document.createElement('span');
        noMsg.style.cssText = 'color:var(--g-text-sec);font-size:.85rem';
        noMsg.textContent = 'No dogs \u2014 add one in Clients tab';
        dogContainer.appendChild(noMsg);
        return;
      }
      dogs.forEach(function(d) {
        var label = document.createElement('label');
        label.style.cssText = 'display:block;padding:4px 0;cursor:pointer;color:var(--g-text)';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'dog_ids';
        cb.value = d.id;
        cb.checked = true;
        cb.style.marginRight = '6px';
        label.appendChild(cb);
        label.appendChild(document.createTextNode(d.name + (d.breed ? ' (' + d.breed + ')' : '')));
        dogContainer.appendChild(label);
      });
    } catch(ex) {
      dogContainer.textContent = '';
      var errMsg = document.createElement('span');
      errMsg.style.cssText = 'color:var(--g-text-sec);font-size:.85rem';
      errMsg.textContent = 'Error loading dogs';
      dogContainer.appendChild(errMsg);
    }
  };

  document.getElementById('apptForm').onsubmit = async function(e) {
    e.preventDefault();
    var fd = new FormData(e.target);
    var data = Object.fromEntries(fd);
    var dog_ids = Array.from(document.querySelectorAll('#apptDogs input[name="dog_ids"]:checked')).map(function(cb) { return parseInt(cb.value); });
    if (!data.customer_id || !dog_ids.length) { toast('Select a client and at least one dog', 'err'); return; }

    var selectedDates = Array.from(document.querySelectorAll('#dayChips .day-chip.selected')).map(function(c) { return c.dataset.date; }).sort();
    if (!selectedDates.length) { toast('Select at least one day', 'err'); return; }

    var svc = document.getElementById('apptService');
    var dur = parseInt(svc.selectedOptions[0] && svc.selectedOptions[0].dataset.dur || '30');
    var submitBtn = document.getElementById('apptSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    var visits = selectedDates.map(function(dateStr) {
      var startDt = new Date(dateStr + 'T' + data.time);
      var endDt = new Date(startDt.getTime() + dur * 60000);
      return { start_time: startDt.toISOString(), end_time: endDt.toISOString() };
    });

    var created = 0, emailed = 0, queued = 0, failed = 0;

    if (visits.length > 1) {
      // Multi-visit booking → one batched POST → one email per recipient
      try {
        var result = await api('/appointments/batch', { method: 'POST', body: {
          customer_id: parseInt(data.customer_id),
          dog_ids: dog_ids,
          employee_id: parseInt(data.employee_id),
          service_id: parseInt(data.service_id),
          notes: data.notes || null,
          visits: visits
        }});
        created = (result.ids || []).length;
        if (result.email_sent) emailed = 1;
        else if (result.email_queued) queued = 1;
      } catch (err) {
        failed = visits.length;
      }
    } else {
      // Single visit → keep existing single-email path
      var body = {
        customer_id: parseInt(data.customer_id),
        dog_ids: dog_ids,
        employee_id: parseInt(data.employee_id),
        service_id: parseInt(data.service_id),
        start_time: visits[0].start_time,
        end_time: visits[0].end_time,
        notes: data.notes || null
      };
      try {
        var singleResult = await api('/appointments', { method: 'POST', body: body });
        created = 1;
        if (singleResult.email_sent) emailed = 1;
        else if (singleResult.email_queued) queued = 1;
      } catch (err) {
        failed = 1;
      }
    }

    closeModal();

    var msg = created + ' appointment' + (created === 1 ? '' : 's') + ' created';
    if (emailed) msg += ' \u00b7 1 batched email sent';
    else if (queued) msg += ' \u00b7 email queued for 8am';
    if (failed) msg += ' \u00b7 ' + failed + ' failed';
    toast(msg, failed ? 'err' : undefined);

    var firstDate = new Date(selectedDates[0] + 'T12:00:00');
    _calYear = firstDate.getFullYear();
    _calMonth = firstDate.getMonth();
    _calDay = firstDate.getDate();
    renderCal();
  };
}
