/* === Customers View === */
let _expandedCustomer = null;

const _avatarColors = [
  { bg: 'rgba(196,164,78,0.15)', text: '#c4a44e', border: 'rgba(196,164,78,0.3)' },
  { bg: 'rgba(46,204,113,0.15)', text: '#2ecc71', border: 'rgba(46,204,113,0.3)' },
  { bg: 'rgba(52,152,219,0.15)', text: '#3498db', border: 'rgba(52,152,219,0.3)' },
  { bg: 'rgba(155,89,182,0.15)', text: '#9b59b6', border: 'rgba(155,89,182,0.3)' },
  { bg: 'rgba(230,126,34,0.15)', text: '#e67e22', border: 'rgba(230,126,34,0.3)' },
  { bg: 'rgba(231,76,60,0.12)', text: '#e74c3c', border: 'rgba(231,76,60,0.25)' },
];

function getAvatarColor(name) {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return _avatarColors[Math.abs(hash) % _avatarColors.length];
}

async function render_customers(el) {
  el.innerHTML = `
    <p class="section-label">Manage</p>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
      <h1 class="section-title" style="margin:0">Clients</h1>
      <button class="btn btn-primary btn-sm" onclick="openMassEmail()">✉️ Mass Email</button>
    </div>
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
    const active = customers.filter(c => c.status !== 'prospect');
    const prospects = customers.filter(c => c.status === 'prospect');

    function renderCustomerItem(c) {
      const isProspect = c.status === 'prospect';
      const dogText = c.dog_count ? c.dog_count + ' dog' + (c.dog_count > 1 ? 's' : '') : '';
      const initial = c.first_name ? esc(c.first_name.charAt(0).toUpperCase()) : '?';
      const color = getAvatarColor(c.first_name + c.last_name);
      return `
        <div class="list-item" onclick="toggleCustomer(${c.id})">
          <div class="list-icon${isProspect ? ' prospect' : ''}" style="background:${isProspect ? '' : color.bg};color:${isProspect ? '' : color.text};border:1.5px solid ${isProspect ? 'transparent' : color.border}">${isProspect ? '○' : initial}</div>
          <div class="list-body">
            <div class="list-title">${esc(c.last_name)}, ${esc(c.first_name)}</div>
            <div class="list-sub">${fmtPhone(c.phone) || c.email || 'No contact info'}</div>
            <div class="list-meta">
              ${c.rate ? '<span class="list-rate">$' + Number(c.rate).toFixed(0) + '</span>' : ''}
              ${dogText ? '<span class="list-badge">🐾 ' + dogText + '</span>' : ''}
            </div>
          </div>
          <button class="list-edit-btn" onclick="event.stopPropagation();openCustomerForm(${c.id})" title="Edit">✏️</button>
        </div>
        <div id="detail-${c.id}" style="display:none"></div>
      `;
    }

    let html = '';
    if (active.length) html += active.map(renderCustomerItem).join('');
    if (prospects.length) {
      html += '<div class="prospects-label">Prospects</div>';
      html += prospects.map(renderCustomerItem).join('');
    }
    container.innerHTML = html;
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
        <div class="detail-grid">
          ${c.email ? '<div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">' + esc(c.email) + '</span></div>' : ''}
          ${c.phone ? '<div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">' + fmtPhone(c.phone) + '</span></div>' : ''}
          ${c.address ? '<div class="detail-row full-width"><span class="detail-label">Address</span><span class="detail-value">' + esc(c.address) + '</span></div>' : ''}
          ${c.rate != null ? '<div class="detail-row"><span class="detail-label">Rate</span><span class="detail-value" style="color:var(--gold);font-weight:700">$' + Number(c.rate).toFixed(2) + '</span></div>' : ''}
        </div>
        <div class="detail-section">
          <div class="detail-section-header">
            <span class="detail-section-title">Notes</span>
          </div>
          <div id="notesList-${c.id}"></div>
          <div class="note-add-form">
            <textarea id="noteInput-${c.id}" class="note-input" placeholder="Add a note..." rows="2"></textarea>
            <div class="note-add-actions">
              <label class="btn btn-outline btn-sm note-file-label" title="Attach file">
                📎 <input type="file" id="noteFile-${c.id}" style="display:none" onchange="updateFileLabel(${c.id})">
                <span id="noteFileName-${c.id}"></span>
              </label>
              <button class="btn btn-primary btn-sm" onclick="addNote(${c.id})">+ Add Note</button>
            </div>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section-header">
            <span class="detail-section-title">Dogs</span>
            <button class="btn btn-outline btn-sm" onclick="openDogForm(${c.id})">+ Add</button>
          </div>
          ${c.dogs.length ? c.dogs.map(d => `
            <div class="dog-row">
              <div>
                <div class="dog-info"><span class="dog-name">🐕 ${esc(d.name)}</span>${d.breed ? '<span class="dog-breed">' + esc(d.breed) + '</span>' : ''}</div>
                ${d.notes ? '<div class="dog-notes">' + esc(d.notes) + '</div>' : ''}
              </div>
              <div class="dog-actions">
                <button class="btn btn-outline btn-sm" onclick="openDogForm(${c.id},${d.id})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteDog(${d.id})">Del</button>
              </div>
            </div>
          `).join('') : '<div style="font-size:.75rem;color:var(--g-text-sec);padding:.3rem 0">No dogs yet</div>'}
        </div>
        <div class="detail-actions">
          <button class="btn btn-primary btn-sm" onclick="openEmailCompose(${c.id}, '${esc(c.first_name)}', '${esc(c.last_name)}', '${esc(c.email || '')}')">✉️ Email</button>
          <button class="btn btn-primary btn-sm" onclick="openDocGenerator(${c.id},'invoice')">📄 Invoice</button>
          <button class="btn btn-outline btn-sm" onclick="openDocGenerator(${c.id},'proposal')">📋 Proposal</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id})">Delete Client</button>
        </div>
        <div id="custDocs-${c.id}"></div>
        <div id="custEmails-${c.id}"></div>
      </div>
    `;
    loadCustomerDocs(c.id);
    if (c.email) loadEmailHistory(c.id, c.email);
    loadNotes(c.id);
  } catch (e) { toast(e.message, 'err'); }
}

async function loadCustomerDocs(customerId) {
  const container = document.getElementById('custDocs-' + customerId);
  if (!container) return;
  try {
    const docs = await api('/documents/' + customerId);
    if (!docs.length) return;
    container.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-header"><span class="detail-section-title">Documents</span></div>
        ${docs.map(d => `
          <div class="doc-row">
            <div class="doc-info">
              <div class="doc-name">${d.type === 'proposal' ? '📋' : '📄'} ${esc(d.filename)}</div>
              <div class="doc-meta">${d.type.charAt(0).toUpperCase() + d.type.slice(1)} · ${d.doc_number} · ${fmtDate(d.created_at)}</div>
            </div>
            <div class="doc-links">
              <a href="/invoices/${encodeURIComponent(d.filename)}.pdf" target="_blank" class="btn btn-primary btn-sm">PDF</a>
              <a href="/invoices/${encodeURIComponent(d.filename)}.html" target="_blank" class="btn btn-outline btn-sm">View</a>
              <button class="btn btn-danger btn-sm" onclick="deleteDocument(${d.id}, ${customerId})" title="Delete">🗑</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) { /* silent */ }
}

async function deleteDocument(docId, customerId) {
  if (!confirm('Delete this document? This will remove the PDF and HTML files permanently.')) return;
  try {
    await api('/documents/' + docId, { method: 'DELETE' });
    toast('Document deleted');
    loadCustomerDocs(customerId);
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
        <div class="form-group"><label>Rate ($)</label><input name="rate" type="number" step="0.01" min="0" placeholder="e.g. 25.00" value="${c.rate != null ? c.rate : ''}"></div>
        <div class="form-group"><label>Status</label><select name="status">
          <option value="active"${(c.status||'active')==='active'?' selected':''}>Active Client</option>
          <option value="prospect"${c.status==='prospect'?' selected':''}>Prospect</option>
          <option value="inactive"${c.status==='inactive'?' selected':''}>Inactive</option>
        </select></div>
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

function openEmailCompose(customerId, firstName, lastName, email) {
  if (!email) {
    toast('This client has no email address', 'err');
    return;
  }
  // Fetch full customer data for AI context
  api('/customers/' + customerId).then(c => {
    const dogNames = c.dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');

    openModal(`
      <div class="compose-window">
        <div class="compose-header">
          <span class="compose-title">New Message</span>
          <button class="modal-close compose-close">&times;</button>
        </div>
        <form id="emailForm">
          <div class="compose-field">
            <span class="compose-label">To</span>
            <input name="to" type="email" class="compose-input" value="${esc(email)}" required>
          </div>
          <div class="compose-divider"></div>
          <div class="compose-field">
            <span class="compose-label">Subject</span>
            <input name="subject" id="emailSubject" class="compose-input" required>
          </div>
          <div class="compose-divider"></div>
          <textarea name="body" id="emailBody" class="compose-body" placeholder=""></textarea>
          <div class="compose-toolbar">
            <div class="compose-toolbar-left">
              <button type="submit" class="compose-send-btn" id="emailSendBtn">Send</button>
              <button type="button" class="compose-tool-btn" id="aiDraftToggle" onclick="toggleAiDraft()" title="AI Draft">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a2 2 0 0 1-2 2h-1l-2 5H10l-2-5H7a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
              </button>
            </div>
            <button type="button" class="compose-tool-btn compose-discard" onclick="closeModal()" title="Discard">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
            </button>
          </div>
          <div id="aiDraftInput" class="compose-ai-bar" style="display:none;">
            <input id="aiPrompt" class="compose-ai-input" placeholder="Describe the email you want to write...">
            <button type="button" class="compose-ai-btn" id="aiDraftBtn" onclick="generateDraft(${customerId})">Generate</button>
            <span id="aiDraftStatus" class="compose-ai-status"></span>
          </div>
        </form>
      </div>
    `);

    // Fetch notes from timeline for AI context
    api('/customers/' + customerId + '/notes').then(notes => {
      const notesText = notes.map(n => fmtDate(n.created_at) + ': ' + n.text).join('\n\n');
      window._emailContext = {
        client_name: firstName + ' ' + lastName,
        first_name: firstName,
        dogs: dogNames,
        notes: notesText,
        business: 'Bridgeville Bark & Stroll'
      };
    }).catch(() => {
      window._emailContext = {
        client_name: firstName + ' ' + lastName,
        first_name: firstName,
        dogs: dogNames,
        notes: '',
        business: 'Bridgeville Bark & Stroll'
      };
    });

    document.getElementById('emailForm').onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('emailSendBtn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      try {
        await api('/email/send', { method: 'POST', body });
        closeModal();
        toast('Email sent to ' + body.to);
        if (_expandedCustomer) toggleCustomer(_expandedCustomer, true);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send Email';
        toast(err.message, 'err');
      }
    };
  });
}

function toggleAiDraft() {
  const input = document.getElementById('aiDraftInput');
  const toggle = document.getElementById('aiDraftToggle');
  if (input.style.display === 'none') {
    input.style.display = 'block';
    toggle.style.display = 'none';
    document.getElementById('aiPrompt').focus();
  }
}

async function generateDraft(customerId) {
  const promptEl = document.getElementById('aiPrompt');
  const statusEl = document.getElementById('aiDraftStatus');
  const btn = document.getElementById('aiDraftBtn');
  const prompt = promptEl.value.trim();
  if (!prompt) {
    toast('Type what you want to say first', 'err');
    return;
  }
  btn.disabled = true;
  statusEl.textContent = 'Generating draft...';
  try {
    const result = await api('/email/draft', {
      method: 'POST',
      body: { prompt, context: window._emailContext || {} }
    });
    document.getElementById('emailBody').value = result.body;
    if (result.subject) document.getElementById('emailSubject').value = result.subject;
    statusEl.textContent = 'Draft loaded — edit as needed';
    btn.disabled = false;
  } catch (err) {
    statusEl.textContent = '';
    btn.disabled = false;
    toast(err.message, 'err');
  }
}

async function loadEmailHistory(customerId, email) {
  const container = document.getElementById('custEmails-' + customerId);
  if (!container) return;
  try {
    const result = await api('/email/log/' + encodeURIComponent(email));
    if (!result.emails || !result.emails.length) return;
    window._emailCache = window._emailCache || {};
    window._emailCache[customerId] = result.emails;
    container.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-header" onclick="this.parentElement.classList.toggle('collapsed')" style="cursor:pointer;">
          <span class="detail-section-title">Email History (${result.emails.length})</span>
          <span class="collapse-icon">▾</span>
        </div>
        <div class="collapsible-content">
          ${result.emails.map((e, i) => `
            <div class="email-log-row" onclick="viewEmail(${customerId}, ${i})" style="cursor:pointer;">
              <div class="email-log-info">
                <div class="email-log-subject">${esc(e.subject)}</div>
                <div class="email-log-meta">
                  ${fmtDate(e.sent_at)} · Sent by ${esc(e.sent_by || 'System')}
                </div>
                ${e.body_preview ? '<div class="email-log-preview">' + esc(e.body_preview) + '</div>' : ''}
              </div>
              <span class="email-log-arrow">›</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) { /* silent */ }
}

async function loadNotes(customerId) {
  const container = document.getElementById('notesList-' + customerId);
  if (!container) return;
  try {
    const notes = await api('/customers/' + customerId + '/notes');
    if (!notes.length) {
      container.innerHTML = '<div style="font-size:.75rem;color:var(--text-soft);padding:.3rem 0">No notes yet</div>';
      return;
    }
    container.innerHTML = notes.map(n => {
      let attachHtml = '';
      if (n.attachment_file) {
        const url = '/admin/api/attachments/' + encodeURIComponent(n.attachment_file);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(n.attachment_name || '');
        if (isImage) {
          attachHtml = '<div class="note-attachment"><img src="' + url + '" alt="' + esc(n.attachment_name) + '" class="note-image" onclick="window.open(this.src)"></div>';
        } else {
          attachHtml = '<div class="note-attachment"><a href="' + url + '" target="_blank" class="note-file-link">📎 ' + esc(n.attachment_name) + '</a></div>';
        }
      }
      return `
        <div class="note-entry">
          <div class="note-header">
            <span class="note-date">${fmtDate(n.created_at)}</span>
            <button class="note-delete" onclick="deleteNote(${n.id}, ${customerId})" title="Delete note">&times;</button>
          </div>
          ${n.text ? '<div class="note-text">' + esc(n.text) + '</div>' : ''}
          ${attachHtml}
        </div>
      `;
    }).join('');
  } catch (e) { /* silent */ }
}

async function addNote(customerId) {
  const input = document.getElementById('noteInput-' + customerId);
  const fileInput = document.getElementById('noteFile-' + customerId);
  const text = input.value.trim();
  const file = fileInput && fileInput.files[0];
  if (!text && !file) { toast('Type a note or attach a file', 'err'); return; }

  const fd = new FormData();
  if (text) fd.append('text', text);
  if (file) fd.append('attachment', file);

  try {
    const r = await fetch('/admin/api/customers/' + customerId + '/notes', { method: 'POST', body: fd });
    if (r.status === 401) { window.location.href = '/portal'; return; }
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Request failed');
    input.value = '';
    if (fileInput) { fileInput.value = ''; updateFileLabel(customerId); }
    toast('Note added');
    loadNotes(customerId);
  } catch (err) { toast(err.message, 'err'); }
}

function updateFileLabel(customerId) {
  const fileInput = document.getElementById('noteFile-' + customerId);
  const label = document.getElementById('noteFileName-' + customerId);
  if (fileInput && label) {
    label.textContent = fileInput.files[0] ? fileInput.files[0].name : '';
  }
}

async function deleteNote(noteId, customerId) {
  if (!await confirmDialog('Delete this note?')) return;
  try {
    await api('/notes/' + noteId, { method: 'DELETE' });
    toast('Note deleted');
    loadNotes(customerId);
  } catch (err) { toast(err.message, 'err'); }
}

function viewEmail(customerId, index) {
  const emails = (window._emailCache || {})[customerId];
  if (!emails || !emails[index]) return;
  const e = emails[index];
  const body = e.body_full || e.body_preview || '';
  const bodyHtml = esc(body).replace(/\n/g, '<br>');

  openModal(`
    <div class="email-viewer">
      <div class="email-viewer-header">
        <button class="modal-close compose-close">&times;</button>
        <div class="email-viewer-subject">${esc(e.subject)}</div>
        <div class="email-viewer-meta">
          <span class="email-viewer-from">Sent by ${esc(e.sent_by || 'System')}</span>
          <span class="email-viewer-date">${fmtDate(e.sent_at)}</span>
        </div>
        <div class="email-viewer-to">To: ${esc(e.recipient)}</div>
      </div>
      <div class="email-viewer-body">${bodyHtml}</div>
    </div>
  `);
}

// ===== MASS EMAIL =====

async function openMassEmail() {
  try {
    const customers = await api('/customers');
    if (!customers || !customers.length) { toast('No clients to email', 'err'); return; }

    const withEmail = customers.filter(c => c.email);
    if (!withEmail.length) { toast('No clients have email addresses', 'err'); return; }

    const active = withEmail.filter(c => c.status === 'active');
    const prospects = withEmail.filter(c => c.status === 'prospect');
    const inactive = withEmail.filter(c => c.status === 'inactive');

    openModal(`
      <div class="compose-window">
        <div class="compose-header">
          <span class="compose-title">Mass Email</span>
          <button class="modal-close compose-close">&times;</button>
        </div>
        <div style="padding:12px 16px;border-bottom:1px solid #e8eaed;">
          <div style="margin-bottom:8px;font-size:.82rem;font-weight:600;color:#5f6368;">Select Recipients</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;" id="massFilterBtns">
            <button class="mass-filter-btn active" data-filter="all" onclick="massFilterClick(this)">All (${withEmail.length})</button>
            ${active.length ? '<button class="mass-filter-btn" data-filter="active" onclick="massFilterClick(this)">Active (' + active.length + ')</button>' : ''}
            ${prospects.length ? '<button class="mass-filter-btn" data-filter="prospect" onclick="massFilterClick(this)">Prospects (' + prospects.length + ')</button>' : ''}
            ${inactive.length ? '<button class="mass-filter-btn" data-filter="inactive" onclick="massFilterClick(this)">Inactive (' + inactive.length + ')</button>' : ''}
          </div>
          <div style="max-height:120px;overflow-y:auto;border:1px solid #e8eaed;border-radius:8px;padding:6px;" id="massRecipientList">
            ${withEmail.map(c => `
              <label style="display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:.82rem;cursor:pointer;border-radius:4px;" class="mass-recipient" data-status="${c.status}" data-email="${esc(c.email)}">
                <input type="checkbox" checked class="mass-check" value="${esc(c.email)}" onchange="updateMassCount()">
                <span>${esc(c.first_name)} ${esc(c.last_name)}</span>
                <span style="color:#5f6368;font-size:.72rem;margin-left:auto;">${esc(c.email)}</span>
              </label>
            `).join('')}
          </div>
          <div style="margin-top:6px;font-size:.75rem;color:#5f6368;" id="massCount">Sending to ${withEmail.length} recipients</div>
        </div>
        <form id="massEmailForm">
          <div class="compose-field">
            <span class="compose-label">Subject</span>
            <input name="subject" id="massSubject" class="compose-input" required>
          </div>
          <div class="compose-divider"></div>
          <textarea name="body" id="massBody" class="compose-body" placeholder=""></textarea>
          <div class="compose-toolbar">
            <div class="compose-toolbar-left">
              <button type="submit" class="compose-send-btn" id="massSendBtn">Send</button>
              <button type="button" class="compose-tool-btn" onclick="toggleMassAiDraft()" title="AI Draft">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a2 2 0 0 1-2 2h-1l-2 5H10l-2-5H7a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
              </button>
            </div>
            <button type="button" class="compose-tool-btn compose-discard" onclick="closeModal()" title="Discard">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
            </button>
          </div>
          <div id="massAiDraftInput" class="compose-ai-bar" style="display:none;">
            <input id="massAiPrompt" class="compose-ai-input" placeholder="Describe the email you want to write...">
            <button type="button" class="compose-ai-btn" id="massAiDraftBtn" onclick="generateMassDraft()">Generate</button>
            <span id="massAiDraftStatus" class="compose-ai-status"></span>
          </div>
        </form>
      </div>
    `);

    document.getElementById('massEmailForm').onsubmit = async (e) => {
      e.preventDefault();
      const checked = document.querySelectorAll('.mass-check:checked');
      const emails = Array.from(checked).map(c => c.value);
      if (!emails.length) { toast('No recipients selected', 'err'); return; }

      const subject = document.getElementById('massSubject').value.trim();
      const body = document.getElementById('massBody').value.trim();
      if (!subject || !body) { toast('Subject and message are required', 'err'); return; }

      const btn = document.getElementById('massSendBtn');
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const result = await api('/email/bulk', { method: 'POST', body: { emails, subject, body } });
        closeModal();
        toast('Sent ' + result.sent + ' of ' + result.total + ' emails');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Send';
        toast(err.message, 'err');
      }
    };
  } catch (err) { toast(err.message, 'err'); }
}

function massFilterClick(btn) {
  document.querySelectorAll('.mass-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filter = btn.dataset.filter;
  document.querySelectorAll('.mass-recipient').forEach(r => {
    const checkbox = r.querySelector('.mass-check');
    if (filter === 'all') {
      r.style.display = '';
      checkbox.checked = true;
    } else {
      const match = r.dataset.status === filter;
      r.style.display = match ? '' : 'none';
      checkbox.checked = match;
    }
  });
  updateMassCount();
}

function updateMassCount() {
  const count = document.querySelectorAll('.mass-check:checked').length;
  const el = document.getElementById('massCount');
  if (el) el.textContent = 'Sending to ' + count + ' recipient' + (count !== 1 ? 's' : '');
}

function toggleMassAiDraft() {
  const input = document.getElementById('massAiDraftInput');
  if (input.style.display === 'none') {
    input.style.display = '';
    document.getElementById('massAiPrompt').focus();
  } else {
    input.style.display = 'none';
  }
}

async function generateMassDraft() {
  const promptEl = document.getElementById('massAiPrompt');
  const statusEl = document.getElementById('massAiDraftStatus');
  const btn = document.getElementById('massAiDraftBtn');
  const prompt = promptEl.value.trim();
  if (!prompt) { toast('Type what you want to say first', 'err'); return; }
  btn.disabled = true;
  statusEl.textContent = 'Generating draft...';
  try {
    const result = await api('/email/draft', {
      method: 'POST',
      body: { prompt, context: { business: 'Bridgeville Bark & Stroll', type: 'mass email to clients' } }
    });
    document.getElementById('massBody').value = result.body;
    if (result.subject) document.getElementById('massSubject').value = result.subject;
    statusEl.textContent = 'Draft loaded — edit as needed';
    btn.disabled = false;
  } catch (err) {
    statusEl.textContent = '';
    btn.disabled = false;
    toast(err.message, 'err');
  }
}
