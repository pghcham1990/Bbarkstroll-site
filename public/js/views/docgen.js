/* === Document Generator View (Invoice / Proposal) === */

let _docGenState = {
  customerId: null,
  customer: null,
  docType: 'invoice',
  conversation: [],
  currentHtml: null,
  docNumber: null,
  saving: false,
  generating: false
};

function openDocGenerator(customerId, docType) {
  _docGenState = {
    customerId,
    customer: null,
    docType: docType || 'invoice',
    conversation: [],
    currentHtml: null,
    docNumber: null,
    saving: false,
    generating: false
  };
  navigate('docgen/' + customerId + '/' + (docType || 'invoice'));
}

async function render_docgen(el) {
  const parts = window.location.hash.slice(2).split('/');
  const customerId = parseInt(parts[1]);
  const docType = parts[2] || 'invoice';

  if (!customerId) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">📄</div><div class="empty-text">No client selected</div></div>';
    return;
  }

  _docGenState.customerId = customerId;
  _docGenState.docType = docType;

  // Load customer
  try {
    _docGenState.customer = await api('/customers/' + customerId);
  } catch (e) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">❌</div><div class="empty-text">Client not found</div></div>';
    return;
  }

  const c = _docGenState.customer;
  const typeLabel = 'Invoice';
  const dogNames = c.dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ') || 'No dogs on file';

  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.25rem">
      <button class="btn btn-outline btn-sm" onclick="navigate('customers')" style="padding:.3rem .6rem">← Back</button>
      <p class="section-label" style="margin:0">${typeLabel} Generator</p>
    </div>
    <h1 class="section-title" style="margin-bottom:.5rem">New ${typeLabel}</h1>

    <div class="card" style="margin-bottom:.75rem">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div style="font-weight:700;font-size:.95rem">${esc(c.first_name)} ${esc(c.last_name)}</div>
          <div style="font-size:.8rem;color:var(--text-soft)">${esc(c.address || 'No address')}</div>
          <div style="font-size:.78rem;color:var(--text-soft);margin-top:.15rem">🐾 ${esc(dogNames)}</div>
        </div>
      </div>
    </div>

    <div id="docChat" class="doc-chat"></div>

    <div class="card" style="margin-bottom:.75rem">
      <div style="display:flex;gap:.5rem;align-items:flex-end">
        <div style="flex:1">
          <label style="font-size:.7rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--text-soft);display:block;margin-bottom:.3rem">
            Describe services in plain English
          </label>
          <textarea id="docPrompt" rows="3" placeholder='e.g. "two overnight stays friday 7pm to saturday 6am and saturday 7pm to sunday 6am, afternoon visit saturday 1-2pm, total $349.99"'
            style="width:100%;padding:.6rem .8rem;border:1.5px solid #ddd;border-radius:var(--radius-sm);font-family:inherit;font-size:.85rem;color:var(--text);outline:none;resize:vertical;min-height:50px"
            onkeydown="if(event.key==='Enter'&&event.metaKey)generateDoc()"></textarea>
        </div>
        <button class="btn btn-primary" id="docGenBtn" onclick="generateDoc()" style="height:42px;white-space:nowrap">
          Generate
        </button>
      </div>
    </div>

    <div id="docPreview" style="display:none">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
        <p class="section-label" style="margin:0">Preview</p>
        <div style="display:flex;gap:.35rem">
          <button class="btn btn-outline btn-sm" onclick="openPreviewFullscreen()">🔍 Fullscreen</button>
          <button class="btn btn-primary btn-sm" id="docSaveBtn" onclick="saveDoc()">💾 Save & Generate PDF</button>
        </div>
      </div>
      <div id="docPreviewFrame" style="background:#fff;border-radius:var(--radius-sm);border:1px solid #eee;overflow:hidden;max-height:500px;overflow-y:auto"></div>
    </div>

    <div id="docHistory" style="margin-top:1rem"></div>
  `;

  // Load existing documents
  loadDocHistory(customerId);
}

function switchDocType(type) {
  _docGenState.docType = type;
  _docGenState.conversation = [];
  _docGenState.currentHtml = null;
  navigate('docgen/' + _docGenState.customerId + '/' + type);
}

async function generateDoc() {
  if (_docGenState.generating) return;
  const promptEl = document.getElementById('docPrompt');
  const prompt = promptEl.value.trim();
  if (!prompt) { toast('Enter a description', 'err'); return; }

  _docGenState.generating = true;
  const btn = document.getElementById('docGenBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  // Show user message in chat
  addChatMessage('user', prompt);
  promptEl.value = '';

  try {
    const result = await api('/documents/generate', {
      method: 'POST',
      body: {
        customer_id: _docGenState.customerId,
        doc_type: _docGenState.docType,
        prompt,
        conversation: _docGenState.conversation
      }
    });

    _docGenState.conversation = result.conversation;
    _docGenState.currentHtml = result.html;
    _docGenState.docNumber = result.doc_number;

    // Show AI response in chat
    addChatMessage('assistant', 'Document generated — see preview below. Type changes if needed (e.g. "change the Friday overnight to start at 6pm").');

    // Show preview
    const previewDiv = document.getElementById('docPreview');
    previewDiv.style.display = 'block';
    const frame = document.getElementById('docPreviewFrame');

    // Use an iframe for isolated rendering
    frame.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;border:none;min-height:700px';
    frame.appendChild(iframe);
    iframe.onload = () => {
      iframe.contentDocument.open();
      iframe.contentDocument.write(result.html);
      iframe.contentDocument.close();
      // Auto-resize iframe to content
      setTimeout(() => {
        const h = iframe.contentDocument.body.scrollHeight;
        iframe.style.height = Math.min(h + 20, 900) + 'px';
      }, 300);
    };
    // Trigger load
    iframe.contentDocument.open();
    iframe.contentDocument.write(result.html);
    iframe.contentDocument.close();
    setTimeout(() => {
      const h = iframe.contentDocument.body.scrollHeight;
      iframe.style.height = Math.min(h + 20, 900) + 'px';
    }, 500);

  } catch (e) {
    addChatMessage('error', 'Generation failed: ' + e.message);
    toast('Generation failed', 'err');
  } finally {
    _docGenState.generating = false;
    btn.disabled = false;
    btn.textContent = 'Generate';
  }
}

async function saveDoc() {
  if (_docGenState.saving || !_docGenState.currentHtml) return;
  _docGenState.saving = true;
  const btn = document.getElementById('docSaveBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';

  try {
    const result = await api('/documents/save', {
      method: 'POST',
      body: {
        customer_id: _docGenState.customerId,
        doc_type: _docGenState.docType,
        html_content: _docGenState.currentHtml,
        conversation: _docGenState.conversation,
        doc_number: _docGenState.docNumber
      }
    });

    toast('Document saved! PDF generated.');
    addChatMessage('assistant', `✅ Saved as <strong>${esc(result.filename)}.pdf</strong>`);

    // Reload history
    loadDocHistory(_docGenState.customerId);

    // Reset for next document
    _docGenState.conversation = [];
    _docGenState.currentHtml = null;

  } catch (e) {
    toast('Save failed: ' + e.message, 'err');
    addChatMessage('error', 'Save failed: ' + e.message);
  } finally {
    _docGenState.saving = false;
    btn.disabled = false;
    btn.textContent = '💾 Save & Generate PDF';
  }
}

function addChatMessage(role, text) {
  const chat = document.getElementById('docChat');
  const div = document.createElement('div');
  div.style.cssText = `
    padding:.6rem .85rem;margin-bottom:.4rem;border-radius:var(--radius-sm);font-size:.83rem;line-height:1.5;
    ${role === 'user'
      ? 'background:var(--forest);color:white;margin-left:2rem;text-align:right;border-bottom-right-radius:3px;'
      : role === 'error'
        ? 'background:var(--danger-bg);color:var(--danger);margin-right:2rem;border-bottom-left-radius:3px;'
        : 'background:var(--sage);color:var(--text);margin-right:2rem;border-bottom-left-radius:3px;'
    }
  `;
  div.innerHTML = role === 'user' ? esc(text) : text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function openPreviewFullscreen() {
  if (!_docGenState.currentHtml) return;
  const w = window.open('', '_blank');
  w.document.write(_docGenState.currentHtml);
  w.document.close();
}

async function loadDocHistory(customerId) {
  const container = document.getElementById('docHistory');
  if (!container) return;

  try {
    const docs = await api('/documents/' + customerId);
    if (!docs.length) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <p class="section-label">Saved Documents</p>
      ${docs.map(d => `
        <div class="list-item" style="cursor:default">
          <div class="list-icon">${d.type === 'proposal' ? '📋' : '📄'}</div>
          <div class="list-body">
            <div class="list-title">${esc(d.filename)}</div>
            <div class="list-sub">${d.type.charAt(0).toUpperCase() + d.type.slice(1)} · ${d.doc_number} · ${fmtDate(d.created_at)}</div>
          </div>
          <div class="list-actions">
            <a href="/invoices/${encodeURIComponent(d.filename)}.pdf" target="_blank" class="btn btn-outline btn-sm" title="Download PDF">📥 PDF</a>
            <a href="/invoices/${encodeURIComponent(d.filename)}.html" target="_blank" class="btn btn-outline btn-sm" title="View HTML">🔗</a>
            <button class="btn btn-outline btn-sm" style="color:#e74c3c;border-color:#e74c3c" onclick="deleteDocFromHistory(${d.id}, ${customerId})" title="Delete">🗑</button>
          </div>
        </div>
      `).join('')}
    `;
  } catch (e) {
    container.innerHTML = '';
  }
}

async function deleteDocFromHistory(docId, customerId) {
  if (!confirm('Delete this document? This will remove the PDF and HTML files permanently.')) return;
  try {
    await api('/documents/' + docId, { method: 'DELETE' });
    toast('Document deleted');
    loadDocHistory(customerId);
  } catch (e) { toast(e.message, 'err'); }
}
