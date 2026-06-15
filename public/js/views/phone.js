/* === Bark & Stroll Admin — Phone view === */
// The SPA replaces App.content.innerHTML on every navigation, so a cached mount's
// DOM is always detached on revisit. Re-mount fresh each time; the previous mount's
// refresh timer self-clears once it detects its container left the document.
async function render_phone(el) {
  el.innerHTML = '<div id="phoneToolMount"></div>';
  mountPhoneTool(document.getElementById('phoneToolMount'), {
    listCalls:    () => api('/phone/calls').catch(() => []),
    listNeedsYou: () => api('/phone/needs-you').catch(() => []),
    dial:         (to, name) => api('/phone/dial', { method: 'POST', body: { to, name } }),
    setOutcome:   (id, patch) => api('/phone/calls/' + id + '/outcome', { method: 'POST', body: { outcome: patch.outcome, note: patch.note } }),
  });
}
window.render_phone = render_phone;
