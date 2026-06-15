/* === Bark & Stroll Admin — Phone view === */
let _bsPhone = null;

async function render_phone(el) {
  el.innerHTML = '<div id="phoneToolMount"></div>';
  const mount = document.getElementById('phoneToolMount');
  if (_bsPhone) { _bsPhone.refresh(); return; }
  _bsPhone = mountPhoneTool(mount, {
    listCalls:    () => api('/phone/calls').catch(() => []),
    listNeedsYou: () => api('/phone/needs-you').catch(() => []),
    dial:         (to, name) => api('/phone/dial', { method: 'POST', body: { to, name } }),
    setOutcome:   (id, patch) => api('/phone/calls/' + id + '/outcome', { method: 'POST', body: { outcome: patch.outcome, note: patch.note } }),
  });
}
window.render_phone = render_phone;
