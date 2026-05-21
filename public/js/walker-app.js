/* === Bark & Stroll Walker Portal SPA === */
const App = { content: null, currentView: null, user: null };

/* --- API helper --- */
async function api(path, opts = {}) {
  const r = await fetch('/api/portal' + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401) { window.location.href = '/portal'; return; }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}

/* --- Toast --- */
function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

/* --- Modal --- */
function openModal(html) {
  const m = document.getElementById('modal');
  m.innerHTML = '<div class="modal-sheet">' + html + '</div>';
  m.classList.add('open');
  m.onclick = function(e) { if (e.target === m) closeModal(); };
  const close = m.querySelector('.modal-close');
  if (close) close.onclick = closeModal;
}
function closeModal() {
  const m = document.getElementById('modal');
  m.classList.remove('open');
  m.innerHTML = '';
}

/* --- Confirm --- */
function confirmDialog(msg, actionLabel) {
  return new Promise(resolve => {
    openModal(`
      <div class="modal-header"><h2>Confirm</h2><button class="modal-close">&times;</button></div>
      <p style="font-size:.9rem;margin-bottom:1.25rem">${msg}</p>
      <div class="form-actions">
        <button class="btn btn-outline" id="cCancel">Cancel</button>
        <button class="btn btn-primary" id="cOk">${actionLabel || 'Confirm'}</button>
      </div>
    `);
    document.getElementById('cCancel').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('cOk').onclick = () => { closeModal(); resolve(true); };
  });
}

/* --- Format helpers --- */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateLong(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}
// Eastern wall-date bucket key ("YYYY-MM-DD"). Use instead of ISO substring/startsWith
// for grouping appointments by day, otherwise visits between 8 PM and midnight ET
// fall on the wrong day because their UTC date is the next calendar day.
function easternDateKey(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
function fmtPhone(p) {
  if (!p) return '';
  const d = p.replace(/\D/g, '');
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return p;
}
function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function displayTime24(t) {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = parseInt(hh);
  return (h === 0 ? '12' : h > 12 ? String(h - 12) : String(h)) + ':' + mm + ' ' + (h >= 12 ? 'PM' : 'AM');
}

/* --- Router --- */
function navigate(view) { window.location.hash = '/' + view; }

function route() {
  const hash = window.location.hash.slice(2) || 'calendar';
  const view = hash.split('/')[0];
  App.currentView = view;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  const oldFab = document.querySelector('.fab');
  if (oldFab) oldFab.remove();
  if (view === 'calendar') renderCalendar(App.content);
  else if (view === 'requests') renderRequests(App.content);
  else if (view === 'schedule') renderSchedule(App.content);
  else App.content.innerHTML = '<div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Page not found</div></div>';
}

/* --- Update request badge --- */
async function updateBadge() {
  try {
    const requests = await api('/walker/requests');
    const badge = document.getElementById('reqBadge');
    if (requests.length > 0) {
      badge.textContent = requests.length;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch { /* ignore */ }
}

/* ============================================================
   CALENDAR VIEW
   ============================================================ */
let _calYear, _calMonth, _calDay, _walkerAppts = [];

async function renderCalendar(el) {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  _calDay = now.getDate();

  el.innerHTML = `
    <p class="section-label">Your Calendar</p>
    <h1 class="section-title">Calendar</h1>
    <div class="cal-nav">
      <button id="calPrev">&larr;</button>
      <h2 id="calLabel"></h2>
      <button id="calNext">&rarr;</button>
    </div>
    <div class="cal-grid" id="calGrid"></div>
    <div id="dayAppts"></div>
  `;

  document.getElementById('calPrev').onclick = () => { _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; } loadCalData(); };
  document.getElementById('calNext').onclick = () => { _calMonth++; if (_calMonth > 11) { _calMonth = 0; _calYear++; } loadCalData(); };
  loadCalData();
}

async function loadCalData() {
  const start = new Date(_calYear, _calMonth, 1).toISOString();
  const end = new Date(_calYear, _calMonth + 1, 1).toISOString();
  try { _walkerAppts = await api('/walker/appointments?start=' + start + '&end=' + end); } catch { _walkerAppts = []; }
  renderCalGrid();
}

function renderCalGrid() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calLabel').textContent = months[_calMonth] + ' ' + _calYear;

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
    const hasAppts = _walkerAppts.some(a => a.start_time && easternDateKey(a.start_time) === dateStr && a.status !== 'cancelled');
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
  renderDayView();
}

function selectDay(d) {
  _calDay = d;
  document.querySelectorAll('.cal-day').forEach(el => el.classList.remove('selected'));
  const dayEl = document.querySelector(`.cal-day[data-day="${d}"]`);
  if (dayEl) dayEl.classList.add('selected');
  renderDayView();
}

function renderDayView() {
  const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(_calDay).padStart(2,'0')}`;
  const dayAppts = _walkerAppts.filter(a => a.start_time && easternDateKey(a.start_time) === dateStr && a.status !== 'cancelled').sort((a, b) => a.start_time.localeCompare(b.start_time));
  const container = document.getElementById('dayAppts');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = months[_calMonth] + ' ' + _calDay + ', ' + _calYear;

  if (!dayAppts.length) {
    container.innerHTML = `<p style="font-size:.85rem;color:var(--text-soft);text-align:center;padding:1.5rem 0">No appointments on ${label}</p>`;
    return;
  }

  container.innerHTML = `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin-bottom:.5rem">${label} — ${dayAppts.length} appointment${dayAppts.length > 1 ? 's' : ''}</p>` +
    dayAppts.map(a => `
      <div class="appt-card" onclick="viewApptDetail(${a.id})" style="cursor:pointer">
        <div class="appt-time">${fmtTime(a.start_time)}</div>
        <div class="appt-body">
          <div class="appt-title">🐾 ${esc(a.dog_names)} — ${esc(a.service_name)}</div>
          <div class="appt-sub">${esc(a.customer_name)}${a.customer_address ? ' · ' + esc(a.customer_address) : ''}</div>
          <span class="appt-status ${a.status}">${a.status}</span>
        </div>
      </div>
    `).join('');
}

function viewApptDetail(id) {
  const a = _walkerAppts.find(x => x.id === id);
  if (!a) return;
  openModal(`
    <div class="modal-header"><h2>Appointment Details</h2><button class="modal-close">&times;</button></div>
    <div class="detail-row"><span class="detail-label">Date</span><span>${fmtDate(a.start_time)}</span></div>
    <div class="detail-row"><span class="detail-label">Time</span><span>${fmtTime(a.start_time)} — ${fmtTime(a.end_time)}</span></div>
    <div class="detail-row"><span class="detail-label">Service</span><span>${esc(a.service_name)}</span></div>
    <div class="detail-row"><span class="detail-label">Client</span><span>${esc(a.customer_name)}</span></div>
    <div class="detail-row"><span class="detail-label">${a.dogs && a.dogs.length > 1 ? 'Dogs' : 'Dog'}</span><span>${esc(a.dog_names)}</span></div>
    ${a.customer_address ? `<div class="detail-row"><span class="detail-label">Address</span><span>${esc(a.customer_address)}</span></div>` : ''}
    ${a.notes ? `<div class="detail-row detail-block"><span class="detail-label">Notes</span><span class="detail-value">${esc(a.notes)}</span></div>` : ''}
    <div class="detail-row"><span class="detail-label">Status</span><span class="appt-status ${a.status}">${a.status}</span></div>
  `);
}

/* ============================================================
   REQUESTS VIEW
   ============================================================ */
async function renderRequests(el) {
  el.innerHTML = `
    <p class="section-label">Incoming</p>
    <h1 class="section-title">Walk Requests</h1>
    <div id="requestsList"><div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Loading...</div></div></div>
  `;

  try {
    const requests = await api('/walker/requests');
    const container = document.getElementById('requestsList');

    if (!requests.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No pending requests</div></div>';
      return;
    }

    container.innerHTML = requests.map(r => `
      <div class="request-card" id="req-${r.id}">
        <div class="req-header">
          <div class="req-title">🐾 ${esc(r.dog_names)}</div>
        </div>
        <div class="req-meta">
          <strong>${esc(r.customer_name)}</strong> · ${esc(r.service_name)}<br>
          ${fmtDate(r.preferred_date + 'T12:00:00')} at ${displayTime24(r.preferred_time)}
        </div>
        ${r.notes ? `<div class="req-notes">"${esc(r.notes)}"</div>` : ''}
        <div class="req-actions">
          <button class="btn btn-primary btn-sm" onclick="acceptRequest(${r.id})">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="passRequest(${r.id})">Pass</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    document.getElementById('requestsList').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load requests</div></div>';
  }
}

async function acceptRequest(id) {
  if (!await confirmDialog('Accept this walk request? A confirmation email will be sent to the client.', 'Accept')) return;
  try {
    await api('/walker/accept/' + id, { method: 'POST' });
    toast('Walk accepted! Confirmation email sent.');
    const card = document.getElementById('req-' + id);
    if (card) card.remove();
    updateBadge();
    // Check if list is now empty
    const remaining = document.querySelectorAll('.request-card');
    if (!remaining.length) {
      document.getElementById('requestsList').innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No pending requests</div></div>';
    }
  } catch (err) { toast(err.message, 'err'); }
}

async function passRequest(id) {
  if (!await confirmDialog('Pass on this request?', 'Pass')) return;
  try {
    await api('/walker/decline/' + id, { method: 'POST' });
    toast('Passed on this request');
    const card = document.getElementById('req-' + id);
    if (card) card.remove();
    updateBadge();
    const remaining = document.querySelectorAll('.request-card');
    if (!remaining.length) {
      document.getElementById('requestsList').innerHTML = '<div class="empty"><div class="empty-icon">✅</div><div class="empty-text">No pending requests</div></div>';
    }
  } catch (err) { toast(err.message, 'err'); }
}

/* ============================================================
   MY SCHEDULE VIEW
   ============================================================ */
async function renderSchedule(el) {
  el.innerHTML = `
    <p class="section-label">Upcoming</p>
    <h1 class="section-title">My Schedule</h1>
    <div id="scheduleList"><div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Loading...</div></div></div>
  `;

  try {
    const now = new Date().toISOString();
    const appts = await api('/walker/appointments?start=' + now);
    const container = document.getElementById('scheduleList');
    const upcoming = appts.filter(a => a.status === 'scheduled').sort((a, b) => a.start_time.localeCompare(b.start_time));

    if (!upcoming.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">📅</div><div class="empty-text">No upcoming appointments</div></div>';
      return;
    }

    // Group by date
    const byDate = {};
    for (const a of upcoming) {
      const dateKey = a.start_time.split('T')[0];
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push(a);
    }

    let html = '';
    for (const [date, appts] of Object.entries(byDate)) {
      html += `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin:1rem 0 .5rem">${fmtDateLong(date + 'T12:00:00')}</p>`;
      for (const a of appts) {
        html += `
          <div class="schedule-card" onclick="viewApptDetail(${a.id})" style="cursor:pointer">
            <div class="sch-time">${fmtTime(a.start_time)} — ${fmtTime(a.end_time)}</div>
            <div class="sch-title">${esc(a.customer_name)} · ${esc(a.dog_names)}</div>
            <div class="sch-sub">
              ${esc(a.service_name)}
              ${a.customer_address ? ' · ' + esc(a.customer_address) : ''}
            </div>
          </div>`;
      }
    }
    container.innerHTML = html;
  } catch (e) {
    document.getElementById('scheduleList').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load schedule</div></div>';
  }
}

/* --- Report Issue --- */
function openReportForm() {
  openModal(`
    <div class="modal-header"><h2>Report an Issue</h2><button class="modal-close">&times;</button></div>
    <form id="reportForm">
      <div class="form-group">
        <label>What's the problem?</label>
        <textarea name="message" placeholder="Describe the issue you're experiencing..." required style="min-height:100px"></textarea>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Send Report</button>
      </div>
    </form>
  `);
  document.getElementById('reportForm').onsubmit = async (e) => {
    e.preventDefault();
    const msg = e.target.message.value.trim();
    if (!msg) return;
    try {
      await api('/report-issue', { method: 'POST', body: { message: msg } });
      closeModal();
      toast('Issue reported — thanks! We\'ll look into it.');
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* --- Init --- */
document.addEventListener('DOMContentLoaded', async () => {
  App.content = document.getElementById('content');

  // Auth check
  try {
    const r = await fetch('/admin/api/me');
    if (!r.ok) throw new Error();
    const data = await r.json();
    App.user = data.user;
  } catch {
    window.location.href = '/portal';
    return;
  }

  // Logout
  document.getElementById('logoutBtn').onclick = async () => {
    await fetch('/admin/api/logout', { method: 'POST' });
    window.location.href = '/portal';
  };

  // Report issue
  document.getElementById('reportBtn').onclick = openReportForm;

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.onclick = () => navigate(tab.dataset.view);
  });

  window.addEventListener('hashchange', route);
  route();

  // Load badge count
  updateBadge();
});
