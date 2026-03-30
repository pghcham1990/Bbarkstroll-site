/* === Bark & Stroll Client Portal SPA === */
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
  const first = m.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 100);
}
function closeModal() {
  const m = document.getElementById('modal');
  m.classList.remove('open');
  m.innerHTML = '';
}

/* --- Format helpers --- */
function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
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
  else if (view === 'walks') renderWalks(App.content);
  else App.content.innerHTML = '<div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Page not found</div></div>';
}

/* ============================================================
   CALENDAR VIEW
   ============================================================ */
let _calYear, _calMonth, _calDay, _myAppts = [], _busyBlocks = [];

async function renderCalendar(el) {
  const now = new Date();
  _calYear = now.getFullYear();
  _calMonth = now.getMonth();
  _calDay = now.getDate();

  el.innerHTML = `
    <p class="section-label">Your Schedule</p>
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
  fab.title = 'Request a Walk';
  fab.onclick = () => openRequestForm();
  document.body.appendChild(fab);

  document.getElementById('calPrev').onclick = () => { _calMonth--; if (_calMonth < 0) { _calMonth = 11; _calYear--; } loadCalData(); };
  document.getElementById('calNext').onclick = () => { _calMonth++; if (_calMonth > 11) { _calMonth = 0; _calYear++; } loadCalData(); };
  loadCalData();
}

async function loadCalData() {
  const start = new Date(_calYear, _calMonth, 1).toISOString();
  const end = new Date(_calYear, _calMonth + 1, 1).toISOString();
  try {
    [_myAppts, _busyBlocks] = await Promise.all([
      api('/my-appointments'),
      api('/availability?start=' + start + '&end=' + end)
    ]);
  } catch { _myAppts = []; _busyBlocks = []; }
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

  // Merge my appts + busy blocks for dot indicators
  const allTimes = [..._busyBlocks.map(b => b.start_time), ..._myAppts.map(a => a.start_time)];

  for (let i = firstDay - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month">${prevDays - i}</div>`;
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const hasActivity = allTimes.some(t => t && t.startsWith(dateStr));
    const isToday = isCurrentMonth && d === today.getDate();
    const isSelected = d === _calDay;
    html += `<div class="cal-day${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}" data-day="${d}" onclick="selectDay(${d})">${d}${hasActivity ? '<div class="cal-dot"></div>' : ''}</div>`;
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
  const container = document.getElementById('dayAppts');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const label = months[_calMonth] + ' ' + _calDay + ', ' + _calYear;

  // My appointments on this day
  const mine = _myAppts.filter(a => a.start_time && a.start_time.startsWith(dateStr) && a.status !== 'cancelled').sort((a, b) => a.start_time.localeCompare(b.start_time));

  // Busy blocks that are NOT my appointments
  const myStartTimes = new Set(mine.map(a => a.start_time));
  const busy = _busyBlocks.filter(b => b.start_time && b.start_time.startsWith(dateStr) && !myStartTimes.has(b.start_time)).sort((a, b) => a.start_time.localeCompare(b.start_time));

  if (!mine.length && !busy.length) {
    container.innerHTML = `<p style="font-size:.85rem;color:var(--text-soft);text-align:center;padding:1.5rem 0">No activity on ${label}</p>`;
    return;
  }

  let html = `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin-bottom:.5rem">${label}</p>`;

  // Show my appointments with full details
  for (const a of mine) {
    html += `
      <div class="appt-card">
        <div class="appt-time">${fmtTime(a.start_time)}</div>
        <div class="appt-body">
          <div class="appt-title">🐾 ${esc(a.dog_names)} — ${esc(a.service_name)}</div>
          <div class="appt-sub">${esc(a.employee_name)}</div>
          <span class="appt-status ${a.status}">${a.status}</span>
        </div>
      </div>`;
  }

  // Show other appointments as busy blocks
  for (const b of busy) {
    html += `<div class="busy-block">${fmtTime(b.start_time)} — ${fmtTime(b.end_time)} · Busy</div>`;
  }

  container.innerHTML = html;
}

/* --- Request a Walk Form --- */
async function openRequestForm() {
  let dogs;
  try {
    dogs = await api('/my-dogs');
  } catch (e) { toast('Failed to load data', 'err'); return; }

  if (!dogs.length) { toast('No dogs on your account. Contact Bark & Stroll to add your dogs.', 'err'); return; }

  const dateStr = `${_calYear}-${String(_calMonth+1).padStart(2,'0')}-${String(_calDay).padStart(2,'0')}`;

  openModal(`
    <div class="modal-header"><h2>Request a Walk</h2><button class="modal-close">&times;</button></div>
    <form id="requestForm">
      <div class="form-group">
        <label>Dogs *</label>
        <div id="reqDogs">
          ${dogs.map(d => `<label style="display:block;padding:4px 0;cursor:pointer"><input type="checkbox" name="dog_ids" value="${d.id}" checked style="margin-right:6px">${esc(d.name)}${d.breed ? ' (' + esc(d.breed) + ')' : ''}</label>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Date *</label>
        <input type="date" name="date" value="${dateStr}" required>
      </div>
      <div class="form-group"><label>Notes</label><textarea name="notes" placeholder="Preferred time, special instructions, etc..."></textarea></div>
      <p style="font-size:.75rem;color:var(--text-soft);margin-bottom:.5rem">Dog Walking · 30 minutes</p>
      <div class="form-actions">
        <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit Request</button>
      </div>
    </form>
  `);

  document.getElementById('requestForm').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    const dog_ids = [...document.querySelectorAll('#reqDogs input[name="dog_ids"]:checked')].map(cb => parseInt(cb.value));
    if (!dog_ids.length) { toast('Select at least one dog', 'err'); return; }

    try {
      await api('/request', { method: 'POST', body: {
        dog_ids,
        service_id: 1,
        date: data.date,
        time: '09:00',
        notes: data.notes || null
      }});
      closeModal();
      toast('Walk request submitted! The team has been notified.');
      loadCalData();
    } catch (err) { toast(err.message, 'err'); }
  };
}

/* ============================================================
   MY WALKS VIEW
   ============================================================ */
async function renderWalks(el) {
  el.innerHTML = `
    <p class="section-label">History</p>
    <h1 class="section-title">My Walks</h1>
    <div id="walksList"><div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Loading...</div></div></div>
  `;

  try {
    const [appointments, requests] = await Promise.all([
      api('/my-appointments'),
      api('/my-requests')
    ]);

    const container = document.getElementById('walksList');

    // Pending requests
    const pending = requests.filter(r => r.status === 'pending');

    let html = '';

    if (pending.length) {
      html += `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin-bottom:.5rem">Pending Requests</p>`;
      for (const r of pending) {
        html += `
          <div class="appt-card" style="border-left-color:var(--gold)">
            <div class="appt-time">${displayTime24(r.preferred_time)}</div>
            <div class="appt-body">
              <div class="appt-title">🐾 ${esc(r.dog_names)} — ${esc(r.service_name)}</div>
              <div class="appt-sub">${fmtDate(r.preferred_date + 'T12:00:00')}</div>
              <span class="request-badge">Pending</span>
            </div>
          </div>`;
      }
    }

    // Upcoming appointments
    const now = new Date().toISOString();
    const upcoming = appointments.filter(a => a.start_time >= now && a.status === 'scheduled').sort((a, b) => a.start_time.localeCompare(b.start_time));
    const past = appointments.filter(a => a.start_time < now || a.status === 'completed' || a.status === 'cancelled').sort((a, b) => b.start_time.localeCompare(a.start_time));

    if (upcoming.length) {
      html += `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin:1rem 0 .5rem">Upcoming</p>`;
      for (const a of upcoming) {
        html += `
          <div class="appt-card">
            <div class="appt-time">${fmtTime(a.start_time)}</div>
            <div class="appt-body">
              <div class="appt-title">🐾 ${esc(a.dog_names)} — ${esc(a.service_name)}</div>
              <div class="appt-sub">${fmtDate(a.start_time)} · ${esc(a.employee_name)}</div>
              <span class="appt-status scheduled">Scheduled</span>
            </div>
          </div>`;
      }
    }

    if (past.length) {
      html += `<p style="font-size:.8rem;font-weight:600;color:var(--text-soft);margin:1rem 0 .5rem">Past</p>`;
      for (const a of past) {
        html += `
          <div class="appt-card" style="opacity:.7">
            <div class="appt-time">${fmtTime(a.start_time)}</div>
            <div class="appt-body">
              <div class="appt-title">🐾 ${esc(a.dog_names)} — ${esc(a.service_name)}</div>
              <div class="appt-sub">${fmtDate(a.start_time)} · ${esc(a.employee_name)}</div>
              <span class="appt-status ${a.status}">${a.status === 'completed' ? 'Completed' : a.status}</span>
            </div>
          </div>`;
      }
    }

    if (!html) {
      html = '<div class="empty"><div class="empty-icon">🐕</div><div class="empty-text">No walks yet. Request one from the Calendar tab!</div></div>';
    }

    container.innerHTML = html;
  } catch (e) {
    document.getElementById('walksList').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">Failed to load walks</div></div>';
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
});
