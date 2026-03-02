/* === Employees View === */
async function render_employees(el) {
  el.innerHTML = `
    <p class="section-label">Manage</p>
    <h1 class="section-title">Team</h1>
    <div id="empList"></div>
  `;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+';
  fab.title = 'Add Team Member';
  fab.onclick = () => openEmployeeForm();
  document.body.appendChild(fab);

  loadEmployees();
}

async function loadEmployees() {
  try {
    const employees = await api('/employees');
    const container = document.getElementById('empList');
    if (!employees.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">🐕</div><div class="empty-text">No team members yet</div></div>';
      return;
    }
    container.innerHTML = employees.map(e => `
      <div class="list-item" style="${!e.active ? 'opacity:.5' : ''}">
        <div class="list-icon">${e.active ? '🟢' : '⚪'}</div>
        <div class="list-body">
          <div class="list-title">${esc(e.first_name)} ${esc(e.last_name)}</div>
          <div class="list-sub">${fmtPhone(e.phone) || e.email || 'No contact info'}${!e.active ? ' · Inactive' : ''}</div>
        </div>
        <div class="list-actions">
          <button class="btn btn-outline btn-sm btn-icon" onclick="openEmployeeForm(${e.id})" title="Edit">✏️</button>
          ${e.active ? `<button class="btn btn-danger btn-sm btn-icon" onclick="deactivateEmployee(${e.id})" title="Deactivate">✕</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) { toast(e.message, 'err'); }
}

function openEmployeeForm(id) {
  const isEdit = !!id;
  const load = isEdit ? api('/employees/' + id) : Promise.resolve({});
  load.then(e => {
    openModal(`
      <div class="modal-header"><h2>${isEdit ? 'Edit' : 'New'} Team Member</h2><button class="modal-close">&times;</button></div>
      <form id="empForm">
        <div class="form-row">
          <div class="form-group"><label>First Name *</label><input name="first_name" value="${esc(e.first_name || '')}" required></div>
          <div class="form-group"><label>Last Name *</label><input name="last_name" value="${esc(e.last_name || '')}" required></div>
        </div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(e.email || '')}"></div>
        <div class="form-group"><label>Phone</label><input name="phone" type="tel" value="${esc(e.phone || '')}"></div>
        ${isEdit ? `<div class="form-group"><label>Status</label><select name="active"><option value="1" ${e.active ? 'selected' : ''}>Active</option><option value="0" ${!e.active ? 'selected' : ''}>Inactive</option></select></div>` : ''}
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Member'}</button>
        </div>
      </form>
    `);
    document.getElementById('empForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd);
      try {
        if (isEdit) await api('/employees/' + id, { method: 'PUT', body });
        else await api('/employees', { method: 'POST', body });
        closeModal();
        toast(isEdit ? 'Team member updated' : 'Team member added');
        loadEmployees();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function deactivateEmployee(id) {
  if (!await confirmDialog('Deactivate this team member?')) return;
  try {
    await api('/employees/' + id, { method: 'DELETE' });
    toast('Team member deactivated');
    loadEmployees();
  } catch (e) { toast(e.message, 'err'); }
}
