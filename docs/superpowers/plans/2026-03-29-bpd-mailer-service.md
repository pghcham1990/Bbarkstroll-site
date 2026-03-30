# BPD Mailer Service + Bark & Stroll Email Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone BPD Mailer Service that handles branded email sending and AI drafting, then wire Bark & Stroll's admin portal as client #1 with a compose modal and email history.

**Architecture:** Standalone Express microservice at `/opt/bpd-mailer/` (port 8090) with SQLite database, Nodemailer for Gmail SMTP, and Anthropic SDK for AI drafting. Bark & Stroll's admin portal proxies requests through its own backend (no API key exposure to browser). The mailer service is client-agnostic — each client registers Gmail creds and a branded template.

**Tech Stack:** Node.js, Express, better-sqlite3, nodemailer, @anthropic-ai/sdk, dotenv

**Spec:** `docs/superpowers/specs/2026-03-29-bpd-mailer-service-design.md`

---

## File Structure

**New files (BPD Mailer Service):**
```
/opt/bpd-mailer/
├── package.json
├── .env
├── server.js              # Express app — middleware, route mounting, listener
├── init-db.js             # Schema creation + seed Bark & Stroll client
├── lib/
│   ├── db.js              # better-sqlite3 connection
│   ├── auth.js            # X-API-Key middleware
│   ├── sender.js          # Nodemailer send + template injection
│   └── drafter.js         # Anthropic API draft generation
└── routes/
    ├── send.js            # POST /api/send
    ├── draft.js           # POST /api/draft
    └── log.js             # GET /api/log, GET /api/log/:recipient
```

**Modified files (Bark & Stroll):**
```
/opt/barkstroll/.env                          # Add BPD_MAILER_URL, BPD_MAILER_API_KEY
/opt/barkstroll/server.js:77                  # Mount new email route
/opt/barkstroll/routes/email.js               # New — proxy endpoints to mailer service
/opt/barkstroll/public/js/views/customers.js  # Add Email button, compose modal, email history
/opt/barkstroll/public/css/style.css          # Add compose modal + email history styles
```

**Systemd service:**
```
/etc/systemd/system/bpd-mailer.service
```

---

### Task 1: BPD Mailer — Project scaffold and database

**Files:**
- Create: `/opt/bpd-mailer/package.json`
- Create: `/opt/bpd-mailer/.env`
- Create: `/opt/bpd-mailer/lib/db.js`
- Create: `/opt/bpd-mailer/init-db.js`

- [ ] **Step 1: Create project directory and package.json**

```bash
mkdir -p /opt/bpd-mailer/lib /opt/bpd-mailer/routes /opt/bpd-mailer/data
```

```json
{
  "name": "bpd-mailer",
  "version": "1.0.0",
  "description": "Bright Presence Digital — shared mailer & AI drafting service",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "init-db": "node init-db.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.79.0",
    "better-sqlite3": "^11.0.0",
    "dotenv": "^16.4.0",
    "express": "^4.21.0",
    "nodemailer": "^6.9.0"
  }
}
```

- [ ] **Step 2: Create .env file**

```
PORT=8090
ANTHROPIC_API_KEY=sk-ant-api03-REDACTED-WAS-HERE
```

- [ ] **Step 3: Create lib/db.js**

```javascript
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'mailer.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
```

- [ ] **Step 4: Create init-db.js with schema and Bark & Stroll seed data**

```javascript
require('dotenv').config();
const crypto = require('crypto');
const db = require('./lib/db');

// --- Schema ---
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    gmail_user TEXT NOT NULL,
    gmail_pass TEXT NOT NULL,
    display_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    ai_enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    html TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_preview TEXT,
    sent_by TEXT,
    sent_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_email_log_client ON email_log(client_id);
  CREATE INDEX IF NOT EXISTS idx_email_log_recipient ON email_log(recipient);
`);

// --- Seed Bark & Stroll as client #1 ---
const existing = db.prepare('SELECT id FROM clients WHERE slug = ?').get('barkstroll');
if (!existing) {
  const apiKey = crypto.randomBytes(32).toString('hex');

  const result = db.prepare(`
    INSERT INTO clients (slug, name, gmail_user, gmail_pass, display_name, api_key, ai_enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'barkstroll',
    'Bridgeville Bark & Stroll',
    'scott.rocca.pa@gmail.com',
    'mzovvicvzfcrsdrj',
    'Bridgeville Bark & Stroll',
    apiKey,
    1
  );

  const clientId = result.lastInsertRowid;

  // Insert locked branded email template
  const template = `<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#faf8f4;border-radius:12px;overflow:hidden;border:1px solid #e8e5e0;">
  <div style="background:#14613a;padding:24px 32px;text-align:center;">
    <img src="https://barkstroll.com/bridgeville-bark-stroll-logo.png" alt="Bridgeville Bark & Stroll" style="max-height:60px;margin-bottom:8px;" />
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Bridgeville Bark &amp; Stroll</div>
  </div>
  <div style="padding:32px;color:#2a2a28;font-size:15px;line-height:1.7;">
    {{BODY}}
  </div>
  <div style="background:#0d4428;padding:16px 32px;text-align:center;">
    <span style="color:rgba(255,255,255,0.6);font-size:12px;">Bridgeville Bark &amp; Stroll · Bridgeville, PA</span>
  </div>
</div>`;

  db.prepare('INSERT INTO templates (client_id, html) VALUES (?, ?)').run(clientId, template);

  console.log('Seeded Bark & Stroll client');
  console.log('API Key:', apiKey);
  console.log('Save this key to /opt/barkstroll/.env as BPD_MAILER_API_KEY');
} else {
  console.log('Bark & Stroll client already exists, skipping seed');
}

console.log('Database initialized');
```

- [ ] **Step 5: Install dependencies and initialize database**

```bash
cd /opt/bpd-mailer && npm install
node init-db.js
```

Expected: prints "Seeded Bark & Stroll client", "API Key: <hex>", "Database initialized"

- [ ] **Step 6: Save the generated API key to Bark & Stroll's .env**

Copy the API key from the init-db output and add to `/opt/barkstroll/.env`:

```
BPD_MAILER_URL=http://127.0.0.1:8090
BPD_MAILER_API_KEY=<the generated key>
```

---

### Task 2: BPD Mailer — Auth middleware

**Files:**
- Create: `/opt/bpd-mailer/lib/auth.js`

- [ ] **Step 1: Create API key auth middleware**

```javascript
const db = require('./db');

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'Missing X-API-Key header' });

  const client = db.prepare('SELECT * FROM clients WHERE api_key = ?').get(key);
  if (!client) return res.status(401).json({ error: 'Invalid API key' });

  req.client = client;
  next();
}

module.exports = { requireApiKey };
```

---

### Task 3: BPD Mailer — Email sender with template injection

**Files:**
- Create: `/opt/bpd-mailer/lib/sender.js`

- [ ] **Step 1: Create sender module**

```javascript
const nodemailer = require('nodemailer');
const db = require('./db');

// Cache transporters per client to avoid recreating
const transporters = {};

function getTransporter(client) {
  if (transporters[client.slug]) return transporters[client.slug];
  const t = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: client.gmail_user, pass: client.gmail_pass }
  });
  transporters[client.slug] = t;
  return t;
}

function getTemplate(clientId) {
  const row = db.prepare('SELECT html FROM templates WHERE client_id = ? ORDER BY updated_at DESC LIMIT 1').get(clientId);
  if (!row) throw new Error('No email template found for this client');
  return row.html;
}

function injectBody(templateHtml, body) {
  // Convert plain text line breaks to HTML paragraphs
  const htmlBody = body
    .split('\n\n')
    .map(p => '<p style="margin:0 0 12px 0;">' + p.replace(/\n/g, '<br>') + '</p>')
    .join('');
  return templateHtml.replace('{{BODY}}', htmlBody);
}

function checkSpam(clientId, recipient) {
  const recent = db.prepare(
    "SELECT id, sent_at FROM email_log WHERE client_id = ? AND recipient = ? AND sent_at > datetime('now', '-10 minutes') ORDER BY sent_at DESC LIMIT 1"
  ).get(clientId, recipient);
  return recent || null;
}

async function sendEmail(client, { to, subject, body, sent_by }) {
  const t = getTransporter(client);
  const template = getTemplate(client.id);
  const html = injectBody(template, body);
  const from = `"${client.display_name}" <${client.gmail_user}>`;

  await t.sendMail({ from, to, subject, html });

  const preview = body.substring(0, 200);
  const result = db.prepare(
    'INSERT INTO email_log (client_id, recipient, subject, body_preview, sent_by) VALUES (?, ?, ?, ?, ?)'
  ).run(client.id, to, subject, preview, sent_by || null);

  return { log_id: result.lastInsertRowid };
}

module.exports = { sendEmail, checkSpam };
```

---

### Task 4: BPD Mailer — AI drafter

**Files:**
- Create: `/opt/bpd-mailer/lib/drafter.js`

- [ ] **Step 1: Create drafter module**

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateDraft(prompt, context) {
  const systemPrompt = `You are a professional email writer. Write a concise, warm, professional email body based on the user's instructions. Do NOT include a subject line — only the body text. Do NOT include email headers (To, From, etc.). Use a friendly but professional tone. Keep it brief — 2-4 short paragraphs max. Sign off with just the first name from the context if available.

Client context:
${JSON.stringify(context, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6-20250514',
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }]
  });

  return response.content[0].text;
}

module.exports = { generateDraft };
```

---

### Task 5: BPD Mailer — API routes

**Files:**
- Create: `/opt/bpd-mailer/routes/send.js`
- Create: `/opt/bpd-mailer/routes/draft.js`
- Create: `/opt/bpd-mailer/routes/log.js`

- [ ] **Step 1: Create send route**

```javascript
const express = require('express');
const router = express.Router();
const { sendEmail, checkSpam } = require('../lib/sender');

router.post('/send', async (req, res) => {
  try {
    const { to, subject, body, sent_by } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }

    // Anti-spam check
    const recent = checkSpam(req.client.id, to);
    if (recent) {
      return res.status(429).json({
        error: 'An email was sent to this address within the last 10 minutes',
        last_sent: recent.sent_at
      });
    }

    const result = await sendEmail(req.client, { to, subject, body, sent_by });
    res.json({ success: true, log_id: result.log_id });
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: 'Failed to send email: ' + err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Create draft route**

```javascript
const express = require('express');
const router = express.Router();
const { generateDraft } = require('../lib/drafter');

router.post('/draft', async (req, res) => {
  if (!req.client.ai_enabled) {
    return res.status(403).json({ error: 'AI drafting is not enabled for this account' });
  }

  try {
    const { prompt, context } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const draft = await generateDraft(prompt, context || {});
    res.json({ draft });
  } catch (err) {
    console.error('Draft error:', err.message);
    res.status(500).json({ error: 'Failed to generate draft: ' + err.message });
  }
});

module.exports = router;
```

- [ ] **Step 3: Create log route**

```javascript
const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// Get all email logs for this client
router.get('/log', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const emails = db.prepare(
    'SELECT id, recipient, subject, body_preview, sent_by, sent_at FROM email_log WHERE client_id = ? ORDER BY sent_at DESC LIMIT ? OFFSET ?'
  ).all(req.client.id, limit, offset);
  res.json({ emails });
});

// Get email logs filtered by recipient
router.get('/log/:recipient', (req, res) => {
  const emails = db.prepare(
    'SELECT id, recipient, subject, body_preview, sent_by, sent_at FROM email_log WHERE client_id = ? AND recipient = ? ORDER BY sent_at DESC'
  ).all(req.client.id, req.params.recipient);
  res.json({ emails });
});

module.exports = router;
```

---

### Task 6: BPD Mailer — Express server and systemd service

**Files:**
- Create: `/opt/bpd-mailer/server.js`
- Create: `/etc/systemd/system/bpd-mailer.service`

- [ ] **Step 1: Create server.js**

```javascript
require('dotenv').config();
const express = require('express');
const { requireApiKey } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 8090;

app.use(express.json());

// Health check (no auth)
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'bpd-mailer' });
});

// All API routes require API key
app.use('/api', requireApiKey);
app.use('/api', require('./routes/send'));
app.use('/api', require('./routes/draft'));
app.use('/api', require('./routes/log'));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`BPD Mailer Service running on http://127.0.0.1:${PORT}`);
});
```

- [ ] **Step 2: Start the service and verify health check**

```bash
cd /opt/bpd-mailer && node server.js &
curl http://127.0.0.1:8090/api/health
```

Expected: `{"status":"ok","service":"bpd-mailer"}`

Then kill the background process.

- [ ] **Step 3: Create systemd service file**

Create `/etc/systemd/system/bpd-mailer.service`:

```ini
[Unit]
Description=BPD Mailer Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/bpd-mailer
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 4: Enable and start the service**

```bash
systemctl daemon-reload
systemctl enable bpd-mailer
systemctl start bpd-mailer
systemctl status bpd-mailer
```

Expected: active (running)

- [ ] **Step 5: Verify the service is accessible**

```bash
curl http://127.0.0.1:8090/api/health
```

Expected: `{"status":"ok","service":"bpd-mailer"}`

- [ ] **Step 6: Commit BPD Mailer Service**

```bash
cd /opt/bpd-mailer
git init
git add -A
git commit -m "feat: BPD Mailer Service — standalone email + AI drafting microservice"
```

---

### Task 7: Bark & Stroll — Backend proxy routes to mailer service

**Files:**
- Create: `/opt/barkstroll/routes/email.js`
- Modify: `/opt/barkstroll/server.js:77` — mount new route
- Modify: `/opt/barkstroll/.env` — add mailer config (done in Task 1 Step 6)

- [ ] **Step 1: Create routes/email.js**

```javascript
const express = require('express');
const router = express.Router();

const MAILER_URL = process.env.BPD_MAILER_URL;
const MAILER_KEY = process.env.BPD_MAILER_API_KEY;

async function mailerFetch(path, opts = {}) {
  const res = await fetch(MAILER_URL + path, {
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': MAILER_KEY,
      ...opts.headers
    },
    ...opts
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Mailer service error');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Send email
router.post('/email/send', async (req, res) => {
  try {
    const { to, subject, body } = req.body;
    if (!to || !subject || !body) {
      return res.status(400).json({ error: 'to, subject, and body are required' });
    }
    const sent_by = req.session.user.display_name || req.session.user.username;
    const result = await mailerFetch('/api/send', {
      method: 'POST',
      body: JSON.stringify({ to, subject, body, sent_by })
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// AI draft
router.post('/email/draft', async (req, res) => {
  try {
    const { prompt, context } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }
    const result = await mailerFetch('/api/draft', {
      method: 'POST',
      body: JSON.stringify({ prompt, context })
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Email log for a recipient
router.get('/email/log/:email', async (req, res) => {
  try {
    const result = await mailerFetch('/api/log/' + encodeURIComponent(req.params.email));
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Mount email route in server.js**

In `/opt/barkstroll/server.js`, add after line 77 (the documents route):

```javascript
app.use('/admin/api', requireAuth, require('./routes/email'));
```

- [ ] **Step 3: Restart Bark & Stroll and verify**

```bash
systemctl restart barkstroll
```

Verify no startup errors:

```bash
systemctl status barkstroll
```

- [ ] **Step 4: Commit**

```bash
cd /opt/barkstroll
git add routes/email.js server.js .env
git commit -m "feat: add email proxy routes to BPD Mailer Service"
```

---

### Task 8: Bark & Stroll — Email compose modal and email history UI

**Files:**
- Modify: `/opt/barkstroll/public/js/views/customers.js:123-127` — add Email button, compose modal function, email history
- Modify: `/opt/barkstroll/public/css/style.css` — add compose + history styles

- [ ] **Step 1: Add Email button to client detail actions**

In `/opt/barkstroll/public/js/views/customers.js`, replace the detail-actions div (lines 123-127):

```javascript
        <div class="detail-actions">
          <button class="btn btn-primary btn-sm" onclick="openEmailCompose(${c.id}, '${esc(c.first_name)}', '${esc(c.last_name)}', '${esc(c.email || '')}')">✉️ Email</button>
          <button class="btn btn-primary btn-sm" onclick="openDocGenerator(${c.id},'invoice')">📄 Invoice</button>
          <button class="btn btn-outline btn-sm" onclick="openDocGenerator(${c.id},'proposal')">📋 Proposal</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCustomer(${c.id})">Delete Client</button>
        </div>
```

- [ ] **Step 2: Add email history section to detail panel**

In the detail panel HTML (after `<div id="custDocs-${c.id}"></div>` on line 128), add:

```javascript
        <div id="custEmails-${c.id}"></div>
```

And after the `loadCustomerDocs(c.id)` call on line 131, add:

```javascript
    if (c.email) loadEmailHistory(c.id, c.email);
```

- [ ] **Step 3: Add openEmailCompose function**

Add this function to `customers.js` after the `deleteCustomer` function (after line 261):

```javascript
function openEmailCompose(customerId, firstName, lastName, email) {
  if (!email) {
    toast('This client has no email address', 'err');
    return;
  }
  // Fetch full customer data for AI context
  api('/customers/' + customerId).then(c => {
    const dogNames = c.dogs.map(d => d.name + (d.breed ? ' (' + d.breed + ')' : '')).join(', ');

    openModal(`
      <div class="modal-header"><h2>Email ${esc(firstName)}</h2><button class="modal-close">&times;</button></div>
      <form id="emailForm">
        <div class="form-group">
          <label>To</label>
          <input name="to" type="email" value="${esc(email)}" required>
        </div>
        <div class="form-group">
          <label>Subject</label>
          <input name="subject" id="emailSubject" required>
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea name="body" id="emailBody" rows="8" placeholder="Type your message..."></textarea>
        </div>
        <div id="aiDraftSection">
          <button type="button" class="btn btn-outline btn-sm" id="aiDraftToggle" onclick="toggleAiDraft()">🤖 Help me write this</button>
          <div id="aiDraftInput" style="display:none;margin-top:8px;">
            <div class="form-group" style="margin-bottom:8px;">
              <input id="aiPrompt" placeholder="e.g. welcome email, mention their dogs, excited to work together" style="width:100%;">
            </div>
            <button type="button" class="btn btn-primary btn-sm" id="aiDraftBtn" onclick="generateDraft(${customerId})">Generate Draft</button>
            <span id="aiDraftStatus" style="font-size:.75rem;color:var(--text-soft);margin-left:8px;"></span>
          </div>
        </div>
        <div class="form-actions" style="margin-top:16px;">
          <button type="button" class="btn btn-outline" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="emailSendBtn">Send Email</button>
        </div>
      </form>
    `);

    // Store context for AI draft
    window._emailContext = {
      client_name: firstName + ' ' + lastName,
      first_name: firstName,
      dogs: dogNames,
      notes: c.notes || '',
      business: 'Bridgeville Bark & Stroll'
    };

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
    document.getElementById('emailBody').value = result.draft;
    statusEl.textContent = 'Draft loaded — edit as needed';
    btn.disabled = false;
  } catch (err) {
    statusEl.textContent = '';
    btn.disabled = false;
    toast(err.message, 'err');
  }
}
```

- [ ] **Step 4: Add loadEmailHistory function**

Add this function after `generateDraft`:

```javascript
async function loadEmailHistory(customerId, email) {
  const container = document.getElementById('custEmails-' + customerId);
  if (!container) return;
  try {
    const result = await api('/email/log/' + encodeURIComponent(email));
    if (!result.emails || !result.emails.length) return;
    container.innerHTML = `
      <div class="detail-section">
        <div class="detail-section-header" onclick="this.parentElement.classList.toggle('collapsed')" style="cursor:pointer;">
          <span class="detail-section-title">Email History (${result.emails.length})</span>
          <span class="collapse-icon">▾</span>
        </div>
        <div class="collapsible-content">
          ${result.emails.map(e => `
            <div class="email-log-row">
              <div class="email-log-info">
                <div class="email-log-subject">${esc(e.subject)}</div>
                <div class="email-log-meta">
                  ${fmtDate(e.sent_at)} · Sent by ${esc(e.sent_by || 'System')}
                </div>
                ${e.body_preview ? '<div class="email-log-preview">' + esc(e.body_preview) + '</div>' : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } catch (e) { /* silent */ }
}
```

- [ ] **Step 5: Add CSS styles for email compose and history**

Append to `/opt/barkstroll/public/css/style.css`:

```css
/* --- Email Compose Modal --- */
#aiDraftSection {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--sage);
}
#emailBody {
  font-family: 'DM Sans', sans-serif;
  font-size: .85rem;
  line-height: 1.6;
  resize: vertical;
  min-height: 140px;
}
#aiPrompt {
  font-size: .85rem;
  padding: .5rem .75rem;
  border: 1px solid #ddd;
  border-radius: var(--radius-sm);
}

/* --- Email History --- */
.email-log-row {
  padding: 10px 0;
  border-bottom: 1px solid var(--sage);
}
.email-log-row:last-child { border-bottom: none; }
.email-log-subject {
  font-size: .85rem;
  font-weight: 600;
  color: var(--text);
}
.email-log-meta {
  font-size: .7rem;
  color: var(--text-soft);
  margin-top: 2px;
}
.email-log-preview {
  font-size: .75rem;
  color: var(--text-soft);
  margin-top: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* Collapsible sections */
.collapse-icon {
  font-size: .75rem;
  color: var(--text-soft);
  transition: transform .2s;
}
.detail-section.collapsed .collapsible-content { display: none; }
.detail-section.collapsed .collapse-icon { transform: rotate(-90deg); }
```

- [ ] **Step 6: Restart Bark & Stroll and test**

```bash
systemctl restart barkstroll
```

Open the admin portal, go to Clients, expand a client, verify:
1. "Email" button appears in the action buttons
2. Clicking it opens the compose modal with their email pre-filled
3. "Help me write this" button expands the AI prompt input
4. Sending an email works and shows a toast confirmation
5. Email history appears on the client detail after sending

- [ ] **Step 7: Commit**

```bash
cd /opt/barkstroll
git add public/js/views/customers.js public/css/style.css
git commit -m "feat: email compose modal with AI drafting + email history on client detail"
```

---

### Task 9: End-to-end verification

- [ ] **Step 1: Verify both services are running**

```bash
systemctl status bpd-mailer
systemctl status barkstroll
curl http://127.0.0.1:8090/api/health
```

- [ ] **Step 2: Test the full flow in the admin portal**

1. Log into Bark & Stroll admin at https://barkstroll.com/admin
2. Navigate to Clients
3. Expand Natasha Greene's record
4. Click "Email" button
5. Verify her email `nzueck@hotmail.com` is pre-filled
6. Click "Help me write this"
7. Type: "welcome email, we loved meeting her and the dogs, excited to work together"
8. Click "Generate Draft" — verify Claude generates a draft in the body field
9. Edit the draft as needed
10. **DO NOT SEND YET** — get Scott's approval on the recipient and content first

- [ ] **Step 3: Test anti-spam protection**

After sending one email, try sending another to the same address immediately. Should get a toast error about the 10-minute cooldown.

- [ ] **Step 4: Verify email history**

After sending, collapse and re-expand the client. The "Email History" section should show the sent email with date, subject, and preview.
