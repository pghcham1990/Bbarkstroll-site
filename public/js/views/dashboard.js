/* === Dashboard View === */

// Weather condition codes → emoji + label
const WMO_CODES = {
  0:'☀️ Clear',1:'🌤 Mostly Clear',2:'⛅ Partly Cloudy',3:'☁️ Overcast',
  45:'🌫 Foggy',48:'🌫 Rime Fog',51:'🌦 Light Drizzle',53:'🌦 Drizzle',55:'🌧 Heavy Drizzle',
  61:'🌧 Light Rain',63:'🌧 Rain',65:'🌧 Heavy Rain',66:'🌨 Freezing Rain',67:'🌨 Heavy Freezing Rain',
  71:'🌨 Light Snow',73:'🌨 Snow',75:'❄️ Heavy Snow',77:'❄️ Snow Grains',
  80:'🌦 Light Showers',81:'🌧 Showers',82:'🌧 Heavy Showers',
  85:'🌨 Snow Showers',86:'❄️ Heavy Snow Showers',95:'⛈ Thunderstorm',96:'⛈ Hail Storm',99:'⛈ Heavy Hail'
};

async function fetchWeather() {
  try {
    // Bridgeville PA (15017): lat 40.3562, lon -80.1106
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.3562&longitude=-80.1106&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America/New_York&forecast_days=1');
    return await r.json();
  } catch { return null; }
}

function renderWeatherWidget(weather) {
  if (!weather || !weather.current) {
    return '<div class="weather-widget"><div class="weather-unavailable">Weather unavailable</div></div>';
  }
  const c = weather.current;
  const d = weather.daily;
  const desc = WMO_CODES[c.weather_code] || 'Unknown';
  const emoji = desc.split(' ')[0];
  const label = desc.split(' ').slice(1).join(' ');
  const hi = d ? Math.round(d.temperature_2m_max[0]) : '';
  const lo = d ? Math.round(d.temperature_2m_min[0]) : '';
  const rain = d ? d.precipitation_probability_max[0] : 0;

  return `
    <div class="weather-widget">
      <div class="weather-main">
        <div class="weather-emoji">${emoji}</div>
        <div class="weather-temp">${Math.round(c.temperature_2m)}°F</div>
      </div>
      <div class="weather-details">
        <div class="weather-condition">${label}</div>
        <div class="weather-location">Bridgeville, PA</div>
        <div class="weather-meta">
          <span>Feels ${Math.round(c.apparent_temperature)}°</span>
          <span>💧 ${c.relative_humidity_2m}%</span>
          <span>💨 ${Math.round(c.wind_speed_10m)} mph</span>
        </div>
        <div class="weather-hilo">
          <span class="weather-hi">H: ${hi}°</span>
          <span class="weather-lo">L: ${lo}°</span>
          ${rain > 0 ? `<span class="weather-rain">🌧 ${rain}%</span>` : ''}
        </div>
      </div>
    </div>`;
}

function renderEarningsWidget(data) {
  if (!data) return '';
  const walkers = data.walkers || [];

  let rows = walkers.map(w => {
    const label = w.isScott ? `${w.name} <span class="earnings-you">(you)</span>` : w.name;
    const avgHrs = (w.avg_hours_per_week || 0);
    const hrsLabel = avgHrs > 0 ? ` <span class="earnings-hours">· ~${avgHrs.toFixed(1)} hr/wk</span>` : '';
    return `
      <div class="earnings-row">
        <div class="earnings-bar" data-amt="${w.earned_completed.toFixed(0)}"></div>
        <div class="earnings-name">${label}</div>
        <div class="earnings-walks">${w.walks_completed} walk${w.walks_completed !== 1 ? 's' : ''}${hrsLabel}</div>
        <div class="earnings-amount">$${w.earned_completed.toFixed(0)}</div>
      </div>`;
  }).join('');

  // House row
  rows += `
    <div class="earnings-row earnings-house">
      <div class="earnings-bar" data-amt="${data.house_total_completed.toFixed(0)}"></div>
      <div class="earnings-name">🏠 Bark & Stroll</div>
      <div class="earnings-walks">${data.total_walks_completed} walk${data.total_walks_completed !== 1 ? 's' : ''}</div>
      <div class="earnings-amount">$${data.house_total_completed.toFixed(0)}</div>
    </div>`;

  // Projected section if there are scheduled walks beyond completed
  const hasProjected = data.total_walks_all > data.total_walks_completed;

  return `
    <div class="glass-panel">
      <div class="glass-panel-header">
        <h2 class="glass-panel-title">${data.year} Earnings</h2>
      </div>
      <div class="glass-panel-body">
        <div class="earnings-section-label">Completed</div>
        <div class="earnings-table">${rows}</div>
        ${hasProjected ? `
          <div class="earnings-divider"></div>
          <div class="earnings-section-label">Projected (incl. scheduled)</div>
          <div class="earnings-table">
            ${walkers.map(w => `
              <div class="earnings-row earnings-projected">
                <div class="earnings-bar" data-amt="${w.earned_all.toFixed(0)}"></div>
                <div class="earnings-name">${w.name}</div>
                <div class="earnings-walks">${w.walks_scheduled} walk${w.walks_scheduled !== 1 ? 's' : ''}</div>
                <div class="earnings-amount">$${w.earned_all.toFixed(0)}</div>
              </div>`).join('')}
            <div class="earnings-row earnings-house earnings-projected">
              <div class="earnings-bar" data-amt="${data.house_total_projected.toFixed(0)}"></div>
              <div class="earnings-name">🏠 Bark & Stroll</div>
              <div class="earnings-walks">${data.total_walks_all} walks</div>
              <div class="earnings-amount">$${data.house_total_projected.toFixed(0)}</div>
            </div>
          </div>
        ` : ''}
      </div>
    </div>`;
}

// Count-up animation for the dashboard's stat numbers + earnings amounts —
// tweens each from 0 to its rendered value (cubic ease-out). Honors reduced-motion.
function animateDashNumbers(scope) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const root = scope || document;
  const tween = (el, to, dur, fmt) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(to * e);
      if (t < 1) requestAnimationFrame(step); else el.textContent = fmt(to);
    };
    requestAnimationFrame(step);
  };
  root.querySelectorAll('.dash-stat-num').forEach((el, i) => {
    const to = parseInt((el.textContent || '0').replace(/[^\d-]/g, ''), 10) || 0;
    if (to <= 0) return;
    el.textContent = '0';
    setTimeout(() => tween(el, to, 1100, v => String(Math.round(v))), 260 + i * 90);
  });
  // Earnings: for each table, count the amount up AND fill the bar (scaled to the
  // table's largest amount), in sync — the signature move from the design.
  const amtOf = (r) => {
    const bar = r.querySelector('.earnings-bar');
    if (bar && bar.dataset.amt) return parseFloat(bar.dataset.amt) || 0;
    const a = r.querySelector('.earnings-amount');
    return a ? (parseFloat(a.textContent.replace(/[^\d.]/g, '')) || 0) : 0;
  };
  root.querySelectorAll('.earnings-table').forEach((table) => {
    const rows = [...table.querySelectorAll('.earnings-row')];
    const max = Math.max(1, ...rows.map(amtOf));
    rows.forEach((r, i) => {
      const amtEl = r.querySelector('.earnings-amount');
      const barEl = r.querySelector('.earnings-bar');
      const to = amtOf(r);
      if (amtEl) amtEl.textContent = '$0';
      if (barEl) barEl.style.width = '0%';
      if (to <= 0) return;
      setTimeout(() => {
        const start = performance.now(), dur = 800;
        const step = (now) => {
          const t = Math.min(1, (now - start) / dur);
          const e = 1 - Math.pow(1 - t, 3);
          if (amtEl) amtEl.textContent = '$' + Math.round(to * e);
          if (barEl) barEl.style.width = (100 * (to * e) / max).toFixed(1) + '%';
          if (t < 1) requestAnimationFrame(step);
          else { if (amtEl) amtEl.textContent = '$' + Math.round(to); if (barEl) barEl.style.width = (100 * to / max).toFixed(1) + '%'; }
        };
        requestAnimationFrame(step);
      }, 520 + i * 70);
    });
  });
}

async function render_dashboard(el) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();

  let todayAppts = [], weekAppts = [], customers = [], earnings = null, weather = null;
  try {
    [todayAppts, weekAppts, customers, earnings, weather] = await Promise.all([
      api('/appointments?start=' + todayStart + '&end=' + todayEnd),
      api('/appointments?start=' + todayStart + '&end=' + weekEnd),
      api('/customers'),
      api('/earnings?year=' + now.getFullYear()),
      fetchWeather()
    ]);
  } catch (e) { el.innerHTML = '<div class="empty"><div class="empty-text">Error loading data</div></div>'; return; }

  const scheduled = todayAppts.filter(a => a.status === 'scheduled');
  const weekScheduled = weekAppts.filter(a => a.status === 'scheduled');
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = App.user ? App.user.display_name : '';

  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dateStr = days[now.getDay()] + ', ' + months[now.getMonth()] + ' ' + now.getDate();

  el.innerHTML = `
    <div class="dash-view">
    <div class="dash-welcome">
      <p class="dash-date">${dateStr}</p>
      <h1 class="dash-greeting">${greeting}, ${esc(name)}</h1>
    </div>

    ${renderWeatherWidget(weather)}

    <div class="dash-stats">
      <div class="dash-stat">
        <div class="dash-stat-icon gold">📅</div>
        <div>
          <div class="dash-stat-num">${scheduled.length}</div>
          <div class="dash-stat-label">Today's Walks</div>
        </div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-icon green">📊</div>
        <div>
          <div class="dash-stat-num">${weekScheduled.length}</div>
          <div class="dash-stat-label">This Week</div>
        </div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-icon blue">👥</div>
        <div>
          <div class="dash-stat-num">${customers.length}</div>
          <div class="dash-stat-label">Active Clients</div>
        </div>
      </div>
    </div>

    <div class="glass-panel">
      <div class="glass-panel-header">
        <h2 class="glass-panel-title">Today's Schedule</h2>
        <button class="btn btn-primary btn-sm" onclick="navigate('calendar')">+ New Walk</button>
      </div>
      <div class="glass-panel-body" id="dashAppts"></div>
    </div>

    ${renderEarningsWidget(earnings)}
    </div>
  `;

  const container = document.getElementById('dashAppts');
  if (scheduled.length === 0) {
    container.innerHTML = '<div class="empty" style="padding:2rem 1rem"><div class="empty-icon">☀️</div><div class="empty-text">No walks scheduled today</div></div>';
  } else {
    container.innerHTML = scheduled.sort((a,b) => a.start_time.localeCompare(b.start_time)).map(a => `
      <div class="appt-card" style="cursor:pointer" onclick="navigate('calendar')">
        <div class="appt-time">${fmtTime(a.start_time)}</div>
        <div class="appt-body">
          <div class="appt-title">${esc(a.dog_name || a.dog_names)} — ${esc(a.service_name)}</div>
          <div class="appt-sub">${esc(a.customer_name)} · ${esc(a.employee_name)}</div>
        </div>
      </div>
    `).join('');
  }

  animateDashNumbers(el);
}
