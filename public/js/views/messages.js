/* === Messages View === */

async function render_messages(el) {
  // Check if we should show a specific thread
  const hash = window.location.hash;
  const threadMatch = hash.match(/#\/messages\/(.+)/);
  if (threadMatch) {
    const email = decodeURIComponent(threadMatch[1]);
    return renderThread(el, email);
  }

  // Otherwise show contacts list
  el.innerHTML = `
    <p class="section-label">Communicate</p>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem;">
      <h1 class="section-title" style="margin:0">Messages</h1>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline btn-sm" onclick="refreshInbox()">🔄 Refresh</button>
        <button class="btn btn-primary btn-sm" onclick="openEmailCompose(null, '', '', '')">✉️ New Email</button>
      </div>
    </div>
    <div id="contactsList"><div class="empty" style="padding:2rem;text-align:center;color:var(--text-soft);">Loading...</div></div>
  `;

  loadContacts();
}

async function loadContacts() {
  const container = document.getElementById('contactsList');
  if (!container) return;
  try {
    const result = await api('/email/contacts');
    const contacts = result.contacts || [];

    if (!contacts.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">✉️</div><div class="empty-text">No messages yet</div></div>';
      return;
    }

    container.innerHTML = contacts.map(c => {
      const name = c.name || c.email;
      const initial = (name || '?').charAt(0).toUpperCase();
      const total = (c.sent || 0) + (c.received || 0);
      return `
        <div class="list-item" onclick="window.location.hash='#/messages/${encodeURIComponent(c.email)}'" style="cursor:pointer;">
          <div class="list-icon" style="background:rgba(66,133,244,0.12);color:#4285f4;border:1.5px solid rgba(66,133,244,0.25)">${initial}</div>
          <div class="list-body">
            <div class="list-title">${esc(name)}</div>
            <div class="list-sub">${esc(c.email)}</div>
            <div class="list-meta">
              <span class="list-badge">↑ ${c.sent || 0} sent</span>
              <span class="list-badge">↓ ${c.received || 0} received</span>
            </div>
          </div>
          <div style="font-size:.72rem;color:var(--text-soft);">${fmtDate(c.last_date)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">' + esc(err.message) + '</div></div>';
  }
}

async function renderThread(el, email) {
  el.innerHTML = `
    <p class="section-label">
      <a href="#/messages" style="color:var(--gold);text-decoration:none;">← Messages</a>
    </p>
    <h1 class="section-title">${esc(email)}</h1>
    <div id="threadView"><div class="empty" style="padding:2rem;text-align:center;color:var(--text-soft);">Loading conversation...</div></div>
    <div style="margin-top:16px;">
      <button class="btn btn-primary btn-sm" onclick="openThreadReply('${esc(email)}')">↩️ Reply</button>
    </div>
  `;

  try {
    const result = await api('/email/threads/' + encodeURIComponent(email));
    const thread = result.thread || [];
    const container = document.getElementById('threadView');

    if (!thread.length) {
      container.innerHTML = '<div class="empty"><div class="empty-icon">✉️</div><div class="empty-text">No messages in this thread</div></div>';
      return;
    }

    // Store last message_id for threading
    const lastMsg = [...thread].reverse().find(m => m.message_id);
    window._lastThreadMessageId = lastMsg ? lastMsg.message_id : null;
    window._threadEmail = email;
    window._threadSubject = thread[0] ? thread[0].subject : '';

    container.innerHTML = thread.map(msg => {
      const isSent = msg.direction === 'sent';
      const body = esc(msg.body || msg.body_preview || '').replace(/\n/g, '<br>');
      return `
        <div class="thread-msg ${isSent ? 'thread-sent' : 'thread-received'}">
          <div class="thread-msg-header">
            <span class="thread-msg-from">${isSent ? 'You' : esc(msg.from_name || msg.email)}</span>
            <span class="thread-msg-date">${fmtDate(msg.date)}</span>
          </div>
          <div class="thread-msg-subject">${esc(msg.subject || '')}</div>
          <div class="thread-msg-body">${body}</div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    document.getElementById('threadView').innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><div class="empty-text">' + esc(err.message) + '</div></div>';
  }
}

function openThreadReply(email) {
  const subject = window._threadSubject || '';
  const reSubject = subject.startsWith('Re:') ? subject : 'Re: ' + subject;
  const inReplyTo = window._lastThreadMessageId || null;

  openModal(`
    <div class="compose-window">
      <div class="compose-header">
        <span class="compose-title">Reply</span>
        <button class="modal-close compose-close">&times;</button>
      </div>
      <form id="replyForm">
        <div class="compose-field">
          <span class="compose-label">To</span>
          <input name="to" type="email" class="compose-input" value="${esc(email)}" required>
        </div>
        <div class="compose-divider"></div>
        <div class="compose-field">
          <span class="compose-label">Subject</span>
          <input name="subject" id="replySubject" class="compose-input" value="${esc(reSubject)}" required>
        </div>
        <div class="compose-divider"></div>
        <textarea name="body" id="replyBody" class="compose-body" placeholder=""></textarea>
        <div class="compose-toolbar">
          <div class="compose-toolbar-left">
            <button type="submit" class="compose-send-btn" id="replySendBtn">Send</button>
            <button type="button" class="compose-tool-btn" onclick="toggleReplyAiDraft()" title="AI Draft">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a4 4 0 0 1 4 4v1a3 3 0 0 1 3 3v1a2 2 0 0 1-2 2h-1l-2 5H10l-2-5H7a2 2 0 0 1-2-2v-1a3 3 0 0 1 3-3V6a4 4 0 0 1 4-4z"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/></svg>
            </button>
          </div>
          <button type="button" class="compose-tool-btn compose-discard" onclick="closeModal()" title="Discard">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M5 6v14a2 2 0 002 2h10a2 2 0 002-2V6"/></svg>
          </button>
        </div>
        <div id="replyAiDraftInput" class="compose-ai-bar" style="display:none;">
          <input id="replyAiPrompt" class="compose-ai-input" placeholder="Describe your reply...">
          <button type="button" class="compose-ai-btn" onclick="generateReplyDraft()">Generate</button>
          <span id="replyAiDraftStatus" class="compose-ai-status"></span>
        </div>
      </form>
    </div>
  `);

  document.getElementById('replyForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('replySendBtn');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd);
    data.in_reply_to = inReplyTo;
    try {
      await api('/email/reply', { method: 'POST', body: data });
      closeModal();
      toast('Reply sent');
      // Reload thread
      renderThread(document.getElementById('content') || document.querySelector('.content'), email);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Send';
      toast(err.message, 'err');
    }
  };
}

function toggleReplyAiDraft() {
  const input = document.getElementById('replyAiDraftInput');
  if (input.style.display === 'none') {
    input.style.display = '';
    document.getElementById('replyAiPrompt').focus();
  } else {
    input.style.display = 'none';
  }
}

async function generateReplyDraft() {
  const promptEl = document.getElementById('replyAiPrompt');
  const statusEl = document.getElementById('replyAiDraftStatus');
  const btn = document.querySelector('#replyAiDraftInput .compose-ai-btn');
  const prompt = promptEl.value.trim();
  if (!prompt) { toast('Type what you want to say first', 'err'); return; }
  btn.disabled = true;
  statusEl.textContent = 'Generating draft...';
  try {
    const result = await api('/email/draft', {
      method: 'POST',
      body: { prompt, context: { business: 'Bridgeville Bark & Stroll', type: 'reply to client email' } }
    });
    document.getElementById('replyBody').value = result.body;
    if (result.subject && !document.getElementById('replySubject').value.startsWith('Re:')) {
      document.getElementById('replySubject').value = result.subject;
    }
    statusEl.textContent = 'Draft loaded — edit as needed';
    btn.disabled = false;
  } catch (err) {
    statusEl.textContent = '';
    btn.disabled = false;
    toast(err.message, 'err');
  }
}

async function refreshInbox() {
  toast('Refreshing inbox...');
  try {
    const result = await api('/email/refresh', { method: 'POST' });
    toast('Fetched ' + (result.fetched || 0) + ' new emails');
    loadContacts();
  } catch (err) {
    toast(err.message, 'err');
  }
}
