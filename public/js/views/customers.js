/* === Customers View === */
let _expandedCustomer = null;

async function render_customers(el) {
  el.innerHTML = `
    <p class="section-label">Manage</p>
    <h1 class="section-title">Clients</h1>
    <div class="search-box"><input type="text" id="custSearch" placeholder="Search clients..."></div>
    <div id="custList"></div>
  `;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.textContent = '+';
  fab.title = 'Add Client';
  fab.onclick = () => openCustomerForm();
  document.body.appendChild(fab);

  document.getElementById('custSearch').oninput = debounce(loadCustomers, 300);
  loadCustomers();
}

async function loadCustomers() {
  const q = document.getElementById('custSearch')?.value || '';
  const url = q ? '/customers?q=' + encodeURIComponent(q) : '/customers';
  try {
    const customers = await api(url);
    const container = document.getElementById('custList');
    if (!customers.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">👥</div><div class="empty-text">No clients found</div></div>';
      return;
    }
    container.innerHTML = customers.map(c => `
      <div class="list-item" onclick="toggleCustomer(${c.id})">
        <div class="list-icon">👤</div>
        <div class="list-body">
          <div class="list-title">${esc(c.last_name)}, ${esc(c.first_name)}</div>
          <div class="list-sub">${fmtPhone(c.phone) || c.email || 'No contact info'}</div>
          ${c.dog_count ? `<div class="dog-list">${'🐾'.repeat(Math.min(c.dog_count, 5))} <span style="font-size:.7rem;color:var(--text-soft)">${c.dog_count} dog${c.dog_count > 1 ? 's' : ''}</span></div>` : ''}
        </div>
        <div class="list-actions">
          <button class="btn btn-outline btn-sm btn-icon" onclick="event.stopPropagation();openCustomerForm(${c.id})" title="Edit">✏️</button>
        </div>
      </div>
      <div id="detail-${c.id}" style="display:none"></div>
    `).join('');
    if (_expandedCustomer) toggleCustomer(_expandedCustomer, true);
  } catch (e) { toast(e.message, 'err'); }
}

async function toggleCustomer(id, forceOpen) {
  const panel = document.getElementById('detail-' + id);
  if (!panel) return;
  if (panel.style.display !== 'none' && !forceOpen) {
    panel.style.display = 'none';
    _expandedCustomer = null;
    return;
  }
  _expandedCustomer = id;
  try {
    const c = await api('/customers/' + id);
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="detail-panel">
        ${c.email ? `<div class="detail-row"><span class="detail-label">Email</span><span>${esc(c.email)}</span></div>` : ''}
        ${c.phone ? `<div class="detail-row"><span class="detail-label">Phone</span><span>${fmtPhone(c.phone)}</span></div>` : ''}
        ${c.address ? `<div class="detail-row"><span class="detail-label">Address</span><span>${esc(c.address)}</span></div>` : ''}
        ${c.notes ? `<div class="detail-row"><span class="detail-label">Notes</span><span>${esc(c.notes)}</span></div>` : ''}
        <div style="margin-top:.5rem;display:flex;align-items:center;justify-content:space-between">
          <strong style="font-size:.8rem">Dogs</strong>
          <button class="btn btn-outline btn-sm" onclick="openDogForm(${c.id})">+ Add Dog</button>
        </div>
        ${c.dogs.length ? c.dogs.map(d => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:.4rem 0;border-bottom:1px solid #eee">
            <div>
              <span style="font-weight:600;font-size:.85rem">🐕 ${esc(d.name)}</span>
              ${d.breed ? `<span style="color:var(--text-soft);font-size:.75rem"> — ${esc(d.breed)}</span>` : ''}
              ${d.notes ? `<div style="font-size:.7rem;color:var(--text-soft)">${esc(d.notes)}</div>` : ''}
            </div>
            <div style="display:flex;gap:.25rem">
              <button class="btn btn-outline btn-sm" style="padding:.25rem .5rem;font-size:.7rem" onclick="openDogForm(${c.id},${d.id})">Edit</button>
              <button class="btn btn-danger btn-sm" style="padding:.25rem .5rem;font-size:.7rem" onclick="deleteDog(${d.id})">Del</button>
            </div>
          </div>
        `).join('') : '<p style="font-size:.8rem;color:var(--text-soft);padding:.5rem 0">No dogs yet</p>'}
        <div style="margin-top:.75rem">
          <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id})">Delete Client</button>
        </div>
      </div>
    `;
  } catch (e) { toast(e.message, 'err'); }
}

function openCustomerForm(id) {
  const isEdit = !!id;
  const load = isEdit ? api('/customers/' + id) : Promise.resolve({});
  load.then(c => {
    openModal(`
      <div class="modal-header"><h2>${isEdit ? 'Edit' : 'New'} Client</h2><button class="modal-close">&times;</button></div>
      <form id="custForm">
        <div class="form-row">
          <div class="form-group"><label>First Name *</label><input name="first_name" value="${esc(c.first_name || '')}" required></div>
          <div class="form-group"><label>Last Name *</label><input name="last_name" value="${esc(c.last_name || '')}" required></div>
        </div>
        <div class="form-group"><label>Email</label><input name="email" type="email" value="${esc(c.email || '')}"></div>
        <div class="form-group"><label>Phone</label><input name="phone" type="tel" value="${esc(c.phone || '')}"></div>
        <div class="form-group"><label>Address</label><input name="address" value="${esc(c.address || '')}"></div>
        <div class="form-group"><label>Notes</label><textarea name="notes">${esc(c.notes || '')}</textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Client'}</button>
        </div>
      </form>
    `);
    document.getElementById('custForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      try {
        if (isEdit) await api('/customers/' + id, { method: 'PUT', body });
        else await api('/customers', { method: 'POST', body });
        closeModal();
        toast(isEdit ? 'Client updated' : 'Client added');
        loadCustomers();
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

function openDogForm(customerId, dogId) {
  const isEdit = !!dogId;
  const load = isEdit ? api('/customers/' + customerId).then(c => c.dogs.find(d => d.id === dogId) || {}) : Promise.resolve({});
  load.then(d => {
    openModal(`
      <div class="modal-header"><h2>${isEdit ? 'Edit' : 'Add'} Dog</h2><button class="modal-close">&times;</button></div>
      <form id="dogForm">
        <div class="form-group"><label>Name *</label><input name="name" value="${esc(d.name || '')}" required></div>
        <div class="form-group"><label>Breed</label><input name="breed" value="${esc(d.breed || '')}"></div>
        <div class="form-group"><label>Notes</label><textarea name="notes">${esc(d.notes || '')}</textarea></div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Save' : 'Add Dog'}</button>
        </div>
      </form>
    `);
    document.getElementById('dogForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      try {
        if (isEdit) await api('/dogs/' + dogId, { method: 'PUT', body });
        else await api('/customers/' + customerId + '/dogs', { method: 'POST', body });
        closeModal();
        toast(isEdit ? 'Dog updated' : 'Dog added');
        toggleCustomer(customerId, true);
      } catch (err) { toast(err.message, 'err'); }
    };
  });
}

async function deleteDog(dogId) {
  if (!await confirmDialog('Delete this dog? This cannot be undone.')) return;
  try {
    await api('/dogs/' + dogId, { method: 'DELETE' });
    toast('Dog removed');
    if (_expandedCustomer) toggleCustomer(_expandedCustomer, true);
  } catch (e) { toast(e.message, 'err'); }
}

async function deleteCustomer(id) {
  if (!await confirmDialog('Delete this client and all their dogs? This cannot be undone.')) return;
  try {
    await api('/customers/' + id, { method: 'DELETE' });
    toast('Client deleted');
    _expandedCustomer = null;
    loadCustomers();
  } catch (e) { toast(e.message, 'err'); }
}

function debounce(fn, ms) {
  let t;
  return function() { clearTimeout(t); t = setTimeout(fn, ms); };
}
