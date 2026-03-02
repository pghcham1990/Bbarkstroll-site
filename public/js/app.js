/* === Bark & Stroll Admin — SPA Core === */
const App = {
  content: null,
  currentView: null,
  user: null,
  cache: {}
};

/* --- API helper --- */
async function api(path, opts = {}) {
  const r = await fetch('/admin/api' + path, {
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

/* --- Confirm --- */
function confirmDialog(msg) {
  return new Promise(resolve => {
    openModal(`
      <div class="modal-header"><h2>Confirm</h2><button class="modal-close">&times;</button></div>
      <p style="font-size:.9rem;margin-bottom:1.25rem">${msg}</p>
      <div class="form-actions">
        <button class="btn btn-outline" id="cCancel">Cancel</button>
        <button class="btn btn-danger" id="cOk">Delete</button>
      </div>
    `);
    document.getElementById('cCancel').onclick = () => { closeModal(); resolve(false); };
    document.getElementById('cOk').onclick = () => { closeModal(); resolve(true); };
  });
}

/* --- Format helpers --- */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

/* --- Router --- */
function navigate(view) {
  window.location.hash = '/' + view;
}

function route() {
  const hash = window.location.hash.slice(2) || 'dashboard';
  const view = hash.split('/')[0];
  App.currentView = view;

  // Update nav
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === view);
  });

  // Remove FAB
  const oldFab = document.querySelector('.fab');
  if (oldFab) oldFab.remove();

  // Render view
  const renderer = window['render_' + view];
  if (renderer) {
    renderer(App.content);
  } else {
    App.content.innerHTML = '<div class="empty"><div class="empty-icon">🐾</div><div class="empty-text">Page not found</div></div>';
  }
}

/* --- Init --- */
document.addEventListener('DOMContentLoaded', async () => {
  App.content = document.getElementById('content');

  // Auth check
  try {
    const data = await api('/me');
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

  // Nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.onclick = () => navigate(tab.dataset.view);
  });

  // Router
  window.addEventListener('hashchange', route);
  route();
});
