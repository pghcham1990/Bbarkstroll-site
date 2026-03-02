/* === Dashboard View === */
async function render_dashboard(el) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();

  let todayAppts = [], weekAppts = [], customers = [];
  try {
    [todayAppts, weekAppts, customers] = await Promise.all([
      api('/appointments?start=' + todayStart + '&end=' + todayEnd),
      api('/appointments?start=' + todayStart + '&end=' + weekEnd),
      api('/customers')
    ]);
  } catch (e) { el.innerHTML = '<div class="empty"><div class="empty-text">Error loading data</div></div>'; return; }

  const scheduled = todayAppts.filter(a => a.status === 'scheduled');
  const weekScheduled = weekAppts.filter(a => a.status === 'scheduled');
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = App.user ? App.user.display_name : '';

  el.innerHTML = `
    <p class="section-label">Dashboard</p>
    <h1 class="section-title">${greeting}, ${esc(name)}</h1>
    <div class="stats-row">
      <div class="stat-card"><div class="stat-num">${scheduled.length}</div><div class="stat-label">Today</div></div>
      <div class="stat-card"><div class="stat-num">${weekScheduled.length}</div><div class="stat-label">This Week</div></div>
      <div class="stat-card"><div class="stat-num">${customers.length}</div><div class="stat-label">Clients</div></div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
      <h2 style="font-family:'DM Serif Display',serif;font-size:1.05rem">Today's Appointments</h2>
      <button class="btn btn-primary btn-sm" onclick="navigate('calendar')">+ New</button>
    </div>
    <div id="dashAppts"></div>
  `;

  const container = document.getElementById('dashAppts');
  if (scheduled.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:2rem"><div class="empty-icon">☀️</div><div class="empty-text">No appointments today</div></div>';
    return;
  }
  container.innerHTML = scheduled.map(a => `
    <div class="appt-card">
      <div class="appt-time">${fmtTime(a.start_time)}</div>
      <div class="appt-body">
        <div class="appt-title">🐾 ${esc(a.dog_name)} — ${esc(a.service_name)}</div>
        <div class="appt-sub">${esc(a.customer_name)} · ${esc(a.employee_name)}</div>
      </div>
    </div>
  `).join('');
}
