# Bark & Stroll — Cancel Emails + Walker-Email Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop leaking the client's first name into the walker's booking email, and replace the silent hard-delete cancellation with a soft-cancel that emails client/walker/owner with a `METHOD:CANCEL` ICS.

**Architecture:** Backend Node/Express + SQLite (better-sqlite3). Email via nodemailer. Tests via `node:test`. Three-recipient send pattern + per-recipient idempotency already exists in `lib/email.js` — reuse it for the cancel flow under `kind='appt_cancel'`. Parameterize the existing ICS generator to emit `METHOD:CANCEL` + `SEQUENCE:1` with the same UID so recipients' calendar apps auto-remove the event.

**Tech Stack:** Node.js, Express, better-sqlite3, nodemailer, `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-05-28-barkstroll-cancel-emails-and-walker-privacy-design.md`

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `init-db.js` | Source-of-truth schema for fresh DBs | modify (add 2 nullable cols to `appointments`) |
| `migrate-cancel-columns.js` | Idempotent migration adding `cancelled_at`/`cancelled_by` to existing DBs | create |
| `server.js` | Run migrations on boot | modify (wire new migration in) |
| `lib/ics.js` | ICS generation | modify (parameterize `method` + `sequence`) |
| `lib/email.js` | Email send + idempotency + walker-privacy fix + new `sendCancellationEmail` | modify |
| `routes/appointments.js` | New `POST /appointments/:id/cancel` endpoint | modify |
| `public/js/views/calendar.js` | Wire UI Cancel button to new endpoint | modify |
| `test/email-idempotency.test.js` | Add walker-privacy assertions | modify |
| `test/cancel-email.test.js` | All cancellation-flow tests (email lib + endpoint) | create |

---

## Task 1: DB migration — `cancelled_at` and `cancelled_by` columns

**Files:**
- Create: `migrate-cancel-columns.js`
- Modify: `init-db.js` (CREATE TABLE appointments definition)
- Modify: `server.js` (run migration on boot)

- [ ] **Step 1.1: Create the migration script**

Create `migrate-cancel-columns.js`:

```javascript
'use strict';

// Adds cancelled_at and cancelled_by columns to appointments. Both nullable,
// no default, no backfill. Safe to run repeatedly — checks pragma first.
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(appointments)').all().map(c => c.name);
  if (!cols.includes('cancelled_at')) {
    db.exec('ALTER TABLE appointments ADD COLUMN cancelled_at TEXT');
  }
  if (!cols.includes('cancelled_by')) {
    db.exec('ALTER TABLE appointments ADD COLUMN cancelled_by TEXT');
  }
}

module.exports = { migrate };

if (require.main === module) {
  const db = require('./lib/db');
  migrate(db);
  console.log('migrate-cancel-columns: done');
  db.close();
}
```

- [ ] **Step 1.2: Update `init-db.js` to include the columns in fresh schema**

Modify the `CREATE TABLE IF NOT EXISTS appointments` block (around line 59–73 in `init-db.js`) — add the two columns above `created_at`:

```sql
CREATE TABLE IF NOT EXISTS appointments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  dog_id      INTEGER NOT NULL REFERENCES dogs(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  service_id  INTEGER NOT NULL REFERENCES services(id),
  start_time  TEXT    NOT NULL,
  end_time    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'scheduled',
  notes       TEXT,
  email_sent  INTEGER NOT NULL DEFAULT 0,
  batch_id    TEXT,
  cancelled_at TEXT,
  cancelled_by TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 1.3: Wire migration into `server.js` boot**

Find where other migrations are required at the top of `server.js` (search for `migrate-email-sends` or `migrate-employee-documents`). Add right next to them:

```javascript
require('./migrate-cancel-columns').migrate(db);
```

If migrations are run in a single block elsewhere in `server.js`, add it inside that block instead. Match the existing pattern exactly.

- [ ] **Step 1.4: Smoke-test the migration on a temp DB**

Run:

```bash
cd /opt/barkstroll && node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const tmp = fs.mkdtempSync('/tmp/bsmig-');
const db = new Database(path.join(tmp, 't.db'));
db.exec(\`CREATE TABLE appointments (
  id INTEGER PRIMARY KEY, customer_id INTEGER, dog_id INTEGER, employee_id INTEGER,
  service_id INTEGER, start_time TEXT, end_time TEXT, status TEXT, notes TEXT,
  email_sent INTEGER, batch_id TEXT, created_at TEXT, updated_at TEXT
)\`);
require('./migrate-cancel-columns').migrate(db);
const cols = db.prepare('PRAGMA table_info(appointments)').all().map(c => c.name);
console.log(cols.includes('cancelled_at') && cols.includes('cancelled_by') ? 'OK' : 'FAIL: ' + cols.join(','));
require('./migrate-cancel-columns').migrate(db); // second run must be no-op
console.log('idempotent run OK');
db.close();
fs.rmSync(tmp, { recursive: true, force: true });
"
```

Expected output:
```
OK
idempotent run OK
```

- [ ] **Step 1.5: Commit**

```bash
cd /opt/barkstroll && git add migrate-cancel-columns.js init-db.js server.js && git commit -m "db: add cancelled_at/cancelled_by to appointments

Idempotent ALTER TABLE migration plus matching fresh-DB schema in
init-db.js. Wired into server boot.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Parameterize `lib/ics.js` to support `METHOD:CANCEL` + `SEQUENCE`

**Files:**
- Modify: `lib/ics.js`
- Modify: `test/ics.test.js` (add cancel-shape tests)

- [ ] **Step 2.1: Write the failing test**

Append to `test/ics.test.js`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { generateICS } = require('../lib/ics');

const apptForIcsTest = {
  id: 9101,
  customer_address: '1 Main St',
  start_time: '2026-06-01T15:00:00.000Z',
  end_time: '2026-06-01T15:30:00.000Z',
  employee_name: 'Walker Person',
  service_name: 'Dog Walking',
  dog_names: 'Rex',
  dog_names_with_breed: 'Rex (Lab)',
  dogs: [{ name: 'Rex' }],
  notes: null,
};

test('generateICS defaults to METHOD:REQUEST + SEQUENCE:0', () => {
  process.env.GMAIL_USER = 'owner@example.com';
  const ics = generateICS(apptForIcsTest, ['client@example.com']);
  assert.match(ics, /METHOD:REQUEST/);
  assert.match(ics, /SEQUENCE:0/);
  assert.match(ics, /UID:appt-9101@barkstroll\.com/);
});

test('generateICS with method=CANCEL emits METHOD:CANCEL + SEQUENCE:1 + same UID', () => {
  process.env.GMAIL_USER = 'owner@example.com';
  const original = generateICS(apptForIcsTest, ['client@example.com']);
  const cancel = generateICS(apptForIcsTest, ['client@example.com'], { method: 'CANCEL', sequence: 1 });
  assert.match(cancel, /METHOD:CANCEL/);
  assert.match(cancel, /SEQUENCE:1/);
  // Same UID as the original REQUEST so calendar apps reconcile the cancellation
  const uidLine = cancel.split('\r\n').find(l => l.startsWith('UID:'));
  assert.ok(original.includes(uidLine), 'UID must match the original REQUEST');
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

Run: `cd /opt/barkstroll && node --test test/ics.test.js`
Expected: the two new tests FAIL (current `generateICS` doesn't accept an options arg, so the cancel test should still emit `METHOD:REQUEST`/`SEQUENCE:0`).

- [ ] **Step 2.3: Implement — parameterize `buildVEvent`, `calendarWrap`, `generateICS`, `generateBatchICS`**

Replace `lib/ics.js` lines 23–93 with:

```javascript
function buildVEvent(appt, organizer, attendeeEmails, opts) {
  const sequence = (opts && Number.isInteger(opts.sequence)) ? opts.sequence : 0;
  const status = (opts && opts.method === 'CANCEL') ? 'CANCELLED' : 'CONFIRMED';
  const uid = 'appt-' + appt.id + '@barkstroll.com';
  const now = icsDate(new Date());
  const start = icsDate(new Date(appt.start_time));
  const end = icsDate(new Date(appt.end_time));
  const summary = 'BBS: ' + firstName(appt.employee_name) + ' & ' + appt.dog_names;
  const dogLabel = appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog';
  const descParts = [
    'Service: ' + appt.service_name,
    dogLabel + ': ' + appt.dog_names_with_breed,
  ];
  if (appt.notes) {
    descParts.push('');
    descParts.push('Notes:');
    const sentences = appt.notes.split(/\.\s*/).filter(Boolean);
    sentences.forEach(s => descParts.push('• ' + s.trim()));
  }
  const desc = descParts.join('\n');
  const location = appt.customer_address || '';

  const lines = [
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART:' + start,
    'DTEND:' + end,
    'SUMMARY:' + icsEscape(summary),
    'DESCRIPTION:' + icsEscape(desc),
  ];
  if (location) lines.push('LOCATION:' + icsEscape(location));
  lines.push(
    'ORGANIZER;CN=Bark & Stroll:mailto:' + organizer,
    'STATUS:' + status,
    'SEQUENCE:' + sequence,
  );

  const emails = Array.isArray(attendeeEmails) ? attendeeEmails : [attendeeEmails];
  for (const email of emails) {
    if (email) {
      lines.push('ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:' + email);
    }
  }
  lines.push('END:VEVENT');
  return lines;
}

function calendarWrap(eventLines, opts) {
  const method = (opts && opts.method) || 'REQUEST';
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bark & Stroll//Appointments//EN',
    'METHOD:' + method,
    'CALSCALE:GREGORIAN',
    ...eventLines,
    'END:VCALENDAR',
  ].join('\r\n');
}

function generateICS(appt, attendeeEmails, opts) {
  const organizer = process.env.GMAIL_USER || 'scott@barkstroll.com';
  return calendarWrap(buildVEvent(appt, organizer, attendeeEmails, opts), opts);
}

function generateBatchICS(appts, attendeeEmails, opts) {
  if (!appts || !appts.length) throw new Error('generateBatchICS: no appointments');
  const organizer = process.env.GMAIL_USER || 'scott@barkstroll.com';
  const events = [];
  for (const appt of appts) events.push(...buildVEvent(appt, organizer, attendeeEmails, opts));
  return calendarWrap(events, opts);
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

Run: `cd /opt/barkstroll && node --test test/ics.test.js`
Expected: all tests PASS, including any pre-existing tests in the file (the default behavior is unchanged).

- [ ] **Step 2.5: Commit**

```bash
cd /opt/barkstroll && git add lib/ics.js test/ics.test.js && git commit -m "ics: parameterize METHOD + SEQUENCE + STATUS

Optional opts arg ({ method, sequence }). Defaults unchanged
(REQUEST / 0 / CONFIRMED). CANCEL flips STATUS to CANCELLED. UID
derivation stays deterministic so a cancel reconciles the original
event on recipients' calendars.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Walker email privacy fix — single appointment

**Files:**
- Modify: `lib/email.js` (around line 162–173, `sendAppointmentEmail` employee block)
- Modify: `test/email-idempotency.test.js` (add privacy assertion)

- [ ] **Step 3.1: Write the failing test**

Append to `test/email-idempotency.test.js`:

```javascript
test('walker single-booking email body does NOT contain client first name', async () => {
  // Capture the rendered HTML by inspecting sendMail opts.
  const captured = { walker: null };
  const fake = {
    sendMail: async (opts) => {
      if (opts.to === 'privwalker@example.com') captured.walker = opts;
      return { messageId: 'fake' };
    },
  };
  email.__setTransporter(fake);
  await email.sendAppointmentEmail({
    ...appt,
    id: 9002,
    customer_email: 'privclient@example.com',
    employee_email: 'privwalker@example.com',
    customer_name: 'Jane Client',
    employee_name: 'Walker Person',
    dog_names: 'Rex',
    dog_names_with_breed: 'Rex (Lab)',
  });
  assert.ok(captured.walker, 'walker email should have been sent');
  // 'Jane' must not appear in the walker's email body or subject.
  assert.doesNotMatch(captured.walker.html, /Jane/, 'walker HTML leaked client first name');
  assert.doesNotMatch(captured.walker.subject, /Jane/, 'walker subject leaked client first name');
  // Sanity: the dog name should still be there.
  assert.match(captured.walker.html, /Rex/);
});
```

- [ ] **Step 3.2: Run the test to confirm it fails**

Run: `cd /opt/barkstroll && node --test test/email-idempotency.test.js`
Expected: the new test FAILS — current walker HTML contains `Client: Jane`.

- [ ] **Step 3.3: Implement — drop the Client row from the walker block**

In `lib/email.js`, find the walker block in `sendAppointmentEmail` (currently lines 161–173). Change:

```javascript
  // --- Employee email: only THEY are listed as attendee (no customer email visible) ---
  if (appt.employee_email && !alreadySent('appt', appt.id, 'employee')) {
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog', appt.dog_names_with_breed],
      ['Client', firstName(appt.customer_name)],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    tasks.push({ role: 'employee', email: appt.employee_email, run: () => sendOne(t, appt.employee_email, from, subject, rows, appt, [appt.employee_email]) });
  }
```

To:

```javascript
  // --- Employee email: only THEY are listed as attendee. No client identity
  // (per privacy rule: walkers route through Scott, not clients). Walker sees
  // dogs + address; the dog names are enough to identify the visit.
  if (appt.employee_email && !alreadySent('appt', appt.id, 'employee')) {
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog', appt.dog_names_with_breed],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    tasks.push({ role: 'employee', email: appt.employee_email, run: () => sendOne(t, appt.employee_email, from, subject, rows, appt, [appt.employee_email]) });
  }
```

- [ ] **Step 3.4: Run the test to confirm it passes**

Run: `cd /opt/barkstroll && node --test test/email-idempotency.test.js`
Expected: all tests PASS (the existing tests should be unaffected — they don't assert on Client row presence).

- [ ] **Step 3.5: Commit**

```bash
cd /opt/barkstroll && git add lib/email.js test/email-idempotency.test.js && git commit -m "email: drop client first name from walker single-booking email

Walker now sees Date/Time/Service/Dogs/Address/Notes. Privacy rule:
walkers route through Scott, not clients. Dogs already in the body
plus subject are enough to identify the visit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Walker email privacy fix — batch appointment

**Files:**
- Modify: `lib/email.js` (around line 317–335, `sendBatchAppointmentEmail` walker block)
- Modify: `test/email-idempotency.test.js` (add batch privacy assertion)

- [ ] **Step 4.1: Write the failing test**

Append to `test/email-idempotency.test.js`:

```javascript
test('walker batch email intro does NOT contain client first name', async () => {
  const captured = { walker: null };
  const fake = {
    sendMail: async (opts) => {
      if (opts.to === 'batchwalker@example.com') captured.walker = opts;
      return { messageId: 'fake' };
    },
  };
  email.__setTransporter(fake);
  const a1 = {
    id: 9003, batch_id: 'btest-1',
    customer_email: 'batchclient@example.com',
    employee_email: 'batchwalker@example.com',
    customer_name: 'Maria Client',
    employee_name: 'Walker Person',
    customer_address: '1 Main St',
    dog_names: 'Bella',
    dog_names_with_breed: 'Bella (Poodle)',
    dogs: [{ name: 'Bella' }],
    service_name: 'Dog Walking',
    start_time: '2026-06-02T15:00:00.000Z',
    end_time: '2026-06-02T15:30:00.000Z',
    notes: null,
  };
  const a2 = { ...a1, id: 9004, start_time: '2026-06-04T15:00:00.000Z', end_time: '2026-06-04T15:30:00.000Z' };
  await email.sendBatchAppointmentEmail([a1, a2]);
  assert.ok(captured.walker);
  assert.doesNotMatch(captured.walker.html, /Maria/, 'walker batch HTML leaked client first name');
  assert.doesNotMatch(captured.walker.subject, /Maria/, 'walker batch subject leaked client first name');
  assert.match(captured.walker.html, /Bella/);
});
```

- [ ] **Step 4.2: Run the test to confirm it fails**

Run: `cd /opt/barkstroll && node --test test/email-idempotency.test.js`
Expected: the new batch test FAILS — current intro says "You're on the schedule for Maria's Bella…".

- [ ] **Step 4.3: Implement — rephrase walker batch intro**

In `lib/email.js`, find the walker block in `sendBatchAppointmentEmail` (currently lines 317–335). Change the `intro` line:

```javascript
      intro: `You&rsquo;re on the schedule for ${firstName(first.customer_name)}&rsquo;s ${first.dog_names}${addrLine}. <strong>${total} visit${total === 1 ? '' : 's'}</strong> across ${dateRange}. Tap <em>add</em> to drop any single visit on your calendar, or use the button below for the whole run.`,
```

To:

```javascript
      intro: `You&rsquo;re on the schedule for <strong>${first.dog_names}</strong>${addrLine}. <strong>${total} visit${total === 1 ? '' : 's'}</strong> across ${dateRange}. Tap <em>add</em> to drop any single visit on your calendar, or use the button below for the whole run.`,
```

And update the comment above the block from:

```javascript
  // --- Walker email: client first name + address only, attendee = walker only ---
```

To:

```javascript
  // --- Walker email: dog names + address only (no client identity), attendee = walker only ---
```

- [ ] **Step 4.4: Run the test to confirm it passes**

Run: `cd /opt/barkstroll && node --test test/email-idempotency.test.js`
Expected: all tests PASS.

- [ ] **Step 4.5: Commit**

```bash
cd /opt/barkstroll && git add lib/email.js test/email-idempotency.test.js && git commit -m "email: drop client first name from walker batch email intro

Batch walker email now leads with dog names + address. Matches the
privacy rule already enforced on single-booking emails.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `sendCancellationEmail` in `lib/email.js`

**Files:**
- Modify: `lib/email.js` (add new function + helper near existing sends)
- Create: `test/cancel-email.test.js` (lib-level tests)

- [ ] **Step 5.1: Write the failing test**

Create `test/cancel-email.test.js`:

```javascript
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bscancel-'));
process.env.BARKSTROLL_DB_PATH = path.join(tmp, 'test.db');
process.env.GMAIL_USER = 'owner@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.BARKSTROLL_CAL_SECRET = 'test-secret';

const db = require('../lib/db');
const { migrate } = require('../migrate-email-sends');
const email = require('../lib/email');

before(() => { migrate(db); });
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const cancelAppt = {
  id: 9201,
  customer_email: 'cclient@example.com',
  employee_email: 'cwalker@example.com',
  customer_name: 'Pat Client',
  employee_name: 'Wendy Walker',
  customer_address: '99 Oak Ln',
  dog_names: 'Cooper',
  dog_names_with_breed: 'Cooper (Golden)',
  dogs: [{ name: 'Cooper' }],
  service_name: 'Dog Walking',
  start_time: '2026-06-10T15:00:00.000Z',
  end_time: '2026-06-10T15:30:00.000Z',
  notes: null,
  cancelled_by: 'Scott',
};

function makeCapturingTransport() {
  const calls = [];
  return {
    calls,
    sendMail: async (opts) => { calls.push(opts); return { messageId: 'fake' }; },
  };
}

test('sendCancellationEmail sends to client, walker, owner with METHOD:CANCEL ICS', async () => {
  const fake = makeCapturingTransport();
  email.__setTransporter(fake);
  await email.sendCancellationEmail(cancelAppt);

  assert.strictEqual(fake.calls.length, 3);
  const tos = fake.calls.map(c => c.to).sort();
  assert.deepStrictEqual(tos, ['cclient@example.com', 'cwalker@example.com', 'owner@example.com']);

  // Every send has a METHOD:CANCEL ICS with SEQUENCE:1 and the same UID
  // the original REQUEST would have produced.
  const expectedUid = 'UID:appt-9201@barkstroll.com';
  for (const opts of fake.calls) {
    const ics = opts.attachments[0].content;
    assert.match(ics, /METHOD:CANCEL/, 'expected METHOD:CANCEL: ' + opts.to);
    assert.match(ics, /SEQUENCE:1/, 'expected SEQUENCE:1: ' + opts.to);
    assert.ok(ics.includes(expectedUid), 'expected matching UID: ' + opts.to);
    assert.strictEqual(opts.icalEvent.method, 'CANCEL');
  }

  // Walker copy explicitly tells the walker not to go.
  const walker = fake.calls.find(c => c.to === 'cwalker@example.com');
  assert.match(walker.html, /do not need to go/i);
  // Walker copy still does NOT contain the client's first name.
  assert.doesNotMatch(walker.html, /Pat/);

  // Client copy contains Scott's exact phrasing.
  const client = fake.calls.find(c => c.to === 'cclient@example.com');
  assert.match(client.html, /removed from the Bark &amp; Stroll calendar/);
  assert.match(client.html, /Please reach out if this was a mistake/);

  // Owner copy contains both names (audit trail).
  const owner = fake.calls.find(c => c.to === 'owner@example.com');
  assert.match(owner.html, /Pat Client/);
  assert.match(owner.html, /Wendy Walker/);
  assert.match(owner.html, /Cancelled by Scott/);
});

test('sendCancellationEmail second call is a no-op (per-recipient idempotency)', async () => {
  const fake = makeCapturingTransport();
  email.__setTransporter(fake);
  await email.sendCancellationEmail(cancelAppt);
  assert.strictEqual(fake.calls.length, 0, 'second call must not re-send any recipient');
});

test('sendCancellationEmail records kind="appt_cancel" rows per recipient', () => {
  const rows = db.prepare(
    "SELECT recipient_role FROM email_sends WHERE scope_type='appt_cancel' AND scope_id='9201'"
  ).all().map(r => r.recipient_role).sort();
  assert.deepStrictEqual(rows, ['customer', 'employee', 'owner']);
});
```

- [ ] **Step 5.2: Run the test to confirm it fails**

Run: `cd /opt/barkstroll && node --test test/cancel-email.test.js`
Expected: tests FAIL — `email.sendCancellationEmail is not a function`.

- [ ] **Step 5.3: Implement — add `sendCancellationEmail` + a cancel HTML builder**

In `lib/email.js`, add a new builder helper right above `sendAppointmentEmail` (so it sits near the other HTML builders):

```javascript
// Build the HTML body for a cancellation email. `lead` is the bold opening
// line (varies by recipient role). `rows` is the same [label, value, style?]
// shape used by buildHtml.
function buildCancelHtml(lead, rows) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#7a1f1f;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px;font-weight:600">Bark &amp; Stroll</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.85">Appointment Cancelled</p>
      </div>
      <div style="background:#ffffff;padding:24px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 12px 12px">
        <p style="font-size:15px;margin:0 0 16px;line-height:1.5">${lead}</p>
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          ${rows.map(r => `<tr><td style="padding:8px 0;color:#888;width:100px">${escHtml(r[0])}</td><td style="padding:8px 0;${r[2] || ''}">${escHtml(r[1])}</td></tr>`).join('\n          ')}
        </table>
      </div>
      <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">Bark &amp; Stroll LLC · Bridgeville, PA · (412) 992-1480</p>
    </div>
  `;
}

async function sendCancellationEmail(appt) {
  const t = getTransporter();
  if (!t) throw new Error('Email not configured (set GMAIL_APP_PASSWORD in .env)');

  const tz = 'America/New_York';
  const startDate = new Date(appt.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = startDate.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const endStr = new Date(appt.end_time).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const subject = `BBS: CANCELLED — ${firstName(appt.employee_name)} & ${appt.dog_names}, ${dateStr} at ${timeStr}`;
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;
  const cancelledBy = appt.cancelled_by || 'admin';
  const dogLabel = appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog';

  // Same UID as the original REQUEST; bumped SEQUENCE; method=CANCEL.
  const icsOpts = { method: 'CANCEL', sequence: 1 };

  const tasks = [];

  // --- Client: Scott's exact copy ---
  if (appt.customer_email && !alreadySent('appt_cancel', appt.id, 'customer')) {
    const lead = `Hi ${firstName(appt.customer_name)}, your scheduled appointment has been <strong>removed from the Bark &amp; Stroll calendar</strong>. Please reach out if this was a mistake and you need to re-add your pup to our calendar.`;
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [dogLabel, appt.dog_names_with_breed],
      ['Walker', firstName(appt.employee_name)],
    ];
    const html = buildCancelHtml(lead, rows);
    const ics = generateICS(appt, [appt.customer_email], icsOpts);
    tasks.push({
      role: 'customer',
      email: appt.customer_email,
      run: () => t.sendMail({
        from, to: appt.customer_email, subject, html,
        icalEvent: { method: 'CANCEL', content: ics },
        attachments: [{ filename: 'cancellation.ics', content: ics, contentType: 'text/calendar; method=CANCEL' }],
      }),
    });
  }

  // --- Walker: clear "do not go" lead; no client identity. ---
  if (appt.employee_email && !alreadySent('appt_cancel', appt.id, 'employee')) {
    const lead = `Hi ${firstName(appt.employee_name)}, <strong>this visit has been cancelled — you do not need to go.</strong>`;
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [dogLabel, appt.dog_names_with_breed],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    const html = buildCancelHtml(lead, rows);
    const ics = generateICS(appt, [appt.employee_email], icsOpts);
    tasks.push({
      role: 'employee',
      email: appt.employee_email,
      run: () => t.sendMail({
        from, to: appt.employee_email, subject, html,
        icalEvent: { method: 'CANCEL', content: ics },
        attachments: [{ filename: 'cancellation.ics', content: ics, contentType: 'text/calendar; method=CANCEL' }],
      }),
    });
  }

  // --- Owner: audit copy, both attendees ---
  const ownerEmail = process.env.GMAIL_USER;
  if (ownerEmail && !alreadySent('appt_cancel', appt.id, 'owner')) {
    const lead = `Hi Scott, this appointment has been cancelled. Cancelled by ${escHtml(cancelledBy)}. Both attendees have been emailed.`;
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [dogLabel, appt.dog_names_with_breed],
      ['Client', appt.customer_name],
      ['Walker', appt.employee_name],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    const html = buildCancelHtml(lead, rows);
    const bothAttendees = [appt.customer_email, appt.employee_email].filter(Boolean);
    const ics = generateICS(appt, bothAttendees, icsOpts);
    tasks.push({
      role: 'owner',
      email: ownerEmail,
      run: () => t.sendMail({
        from, to: ownerEmail, subject, html,
        icalEvent: { method: 'CANCEL', content: ics },
        attachments: [{ filename: 'cancellation.ics', content: ics, contentType: 'text/calendar; method=CANCEL' }],
      }),
    });
  }

  const hadRecipient = appt.customer_email || appt.employee_email || ownerEmail;
  if (!hadRecipient) throw new Error('No email recipients (customer and employee have no email addresses)');
  if (!tasks.length) return;
  await runSendTasks('appt_cancel', appt.id, tasks);
}
```

Export the new function — find the existing `module.exports = { ... }` at the bottom of `lib/email.js` and add `sendCancellationEmail`:

```javascript
module.exports = { sendAppointmentEmail, sendBatchAppointmentEmail, sendCancellationEmail, sendRequestNotification, __setTransporter };
```

(The exact shape of the exports object may differ — keep all existing keys and add `sendCancellationEmail`.)

- [ ] **Step 5.4: Run the test to confirm it passes**

Run: `cd /opt/barkstroll && node --test test/cancel-email.test.js`
Expected: all 3 tests PASS.

- [ ] **Step 5.5: Run the full test suite — nothing regresses**

Run: `cd /opt/barkstroll && node --test`
Expected: all tests across all files PASS.

- [ ] **Step 5.6: Commit**

```bash
cd /opt/barkstroll && git add lib/email.js test/cancel-email.test.js && git commit -m "email: sendCancellationEmail (client/walker/owner, METHOD:CANCEL)

Three-recipient send mirroring the booking pattern, with per-recipient
idempotency under kind='appt_cancel'. METHOD:CANCEL ICS reuses the
original UID and bumps SEQUENCE to 1 so recipients' calendar apps
auto-remove the event. Walker copy leads with 'do not need to go'
and keeps the no-client-identity rule.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `POST /appointments/:id/cancel` endpoint

**Files:**
- Modify: `routes/appointments.js` (new endpoint + comment on DELETE)
- Modify: `test/cancel-email.test.js` (add endpoint tests)

- [ ] **Step 6.1: Write the failing endpoint test**

Append to `test/cancel-email.test.js`:

```javascript
const express = require('express');
const router = require('../routes/appointments');

// Minimal app — mount the appointments router and fake a session admin user
// so the handler can read req.session.user.display_name.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 1, username: 'scott', display_name: 'Scott', role: 'admin' } };
    next();
  });
  app.use(router);
  return app;
}

function seedApptInDb(opts) {
  // Build a minimal schema if missing. (cancel-email.test.js uses its own
  // BARKSTROLL_DB_PATH, so the appointments table won't exist by default.)
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT, address TEXT);
    CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY, first_name TEXT, last_name TEXT, email TEXT);
    CREATE TABLE IF NOT EXISTS dogs (id INTEGER PRIMARY KEY, customer_id INTEGER, name TEXT, breed TEXT);
    CREATE TABLE IF NOT EXISTS services (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER, dog_id INTEGER,
      employee_id INTEGER, service_id INTEGER, start_time TEXT, end_time TEXT,
      status TEXT NOT NULL DEFAULT 'scheduled', notes TEXT,
      email_sent INTEGER NOT NULL DEFAULT 0, batch_id TEXT,
      cancelled_at TEXT, cancelled_by TEXT,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS appointment_dogs (
      appointment_id INTEGER, dog_id INTEGER, PRIMARY KEY (appointment_id, dog_id)
    );
  `);
  db.prepare('INSERT OR REPLACE INTO customers VALUES (?,?,?,?,?)').run(101, 'Pat', 'Client', 'cclient2@example.com', '99 Oak Ln');
  db.prepare('INSERT OR REPLACE INTO employees VALUES (?,?,?,?)').run(201, 'Wendy', 'Walker', 'cwalker2@example.com');
  db.prepare('INSERT OR REPLACE INTO dogs VALUES (?,?,?,?)').run(301, 101, 'Cooper', 'Golden');
  db.prepare('INSERT OR REPLACE INTO services VALUES (?,?)').run(401, 'Dog Walking');
  const info = db.prepare(`INSERT INTO appointments
    (customer_id, dog_id, employee_id, service_id, start_time, end_time, status, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'),datetime('now'))`).run(
      101, 301, 201, 401,
      '2026-06-15T15:00:00.000Z', '2026-06-15T15:30:00.000Z',
      opts && opts.status || 'scheduled');
  db.prepare('INSERT OR REPLACE INTO appointment_dogs VALUES (?,?)').run(info.lastInsertRowid, 301);
  return info.lastInsertRowid;
}

let server, port;
before(async () => {
  await new Promise(r => { server = makeApp().listen(0, r); });
  port = server.address().port;
});
after(() => { server && server.close(); });

test('POST /appointments/:id/cancel marks cancelled + sends 3 emails', async () => {
  const id = seedApptInDb();
  const fake = makeCapturingTransport();
  email.__setTransporter(fake);
  const res = await fetch(`http://127.0.0.1:${port}/appointments/${id}/cancel`, { method: 'POST' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);
  // DB row updated
  const row = db.prepare('SELECT status, cancelled_at, cancelled_by FROM appointments WHERE id=?').get(id);
  assert.strictEqual(row.status, 'cancelled');
  assert.ok(row.cancelled_at, 'cancelled_at should be set');
  assert.strictEqual(row.cancelled_by, 'Scott');
  // Three emails fired
  assert.strictEqual(fake.calls.length, 3);
});

test('POST /appointments/:id/cancel on already-cancelled is a no-op', async () => {
  const id = seedApptInDb({ status: 'cancelled' });
  const fake = makeCapturingTransport();
  email.__setTransporter(fake);
  const res = await fetch(`http://127.0.0.1:${port}/appointments/${id}/cancel`, { method: 'POST' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.already_cancelled, true);
  assert.strictEqual(fake.calls.length, 0);
});

test('POST /appointments/:id/cancel on completed returns 400', async () => {
  const id = seedApptInDb({ status: 'completed' });
  const res = await fetch(`http://127.0.0.1:${port}/appointments/${id}/cancel`, { method: 'POST' });
  assert.strictEqual(res.status, 400);
});

test('POST /appointments/:id/cancel on missing id returns 404', async () => {
  const res = await fetch(`http://127.0.0.1:${port}/appointments/999999/cancel`, { method: 'POST' });
  assert.strictEqual(res.status, 404);
});
```

- [ ] **Step 6.2: Run the test to confirm it fails**

Run: `cd /opt/barkstroll && node --test test/cancel-email.test.js`
Expected: the 4 new endpoint tests FAIL with 404 (the route doesn't exist yet).

- [ ] **Step 6.3: Implement the endpoint**

In `routes/appointments.js`, find the existing `router.delete('/appointments/:id', ...)` (around line 222) and:

(a) Add a comment above it:

```javascript
// Hard delete — admin tooling only. The calendar UI's "Cancel Appointment"
// button uses POST /appointments/:id/cancel (below), which soft-cancels and
// emails all three parties. Don't wire this DELETE to user-facing UI.
```

(b) Add the new endpoint immediately after the DELETE handler:

```javascript
// Soft-cancel: flip status to 'cancelled', stamp cancelled_at/_by, and email
// client + walker + owner with a METHOD:CANCEL ICS so their calendars
// auto-remove the event. Bypasses quiet hours — missing a cancel is worse
// than waking someone up.
router.post('/appointments/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const existing = db.prepare('SELECT id, status FROM appointments WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (existing.status === 'completed') return res.status(400).json({ error: 'Cannot cancel a completed visit' });
  if (existing.status === 'cancelled') return res.json({ ok: true, already_cancelled: true });

  const cancelledBy = (req.session && req.session.user && (req.session.user.display_name || req.session.user.username)) || 'admin';
  db.prepare(`
    UPDATE appointments
       SET status = 'cancelled',
           cancelled_at = datetime('now'),
           cancelled_by = ?,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(cancelledBy, id);

  // Lazily-loaded email lib (mirrors the create flow's try/require pattern).
  let sendCancellationEmail = null;
  try { sendCancellationEmail = require('../lib/email').sendCancellationEmail; } catch {}

  let emailSent = false;
  let emailError = null;
  if (sendCancellationEmail) {
    try {
      const appt = fetchApptWithJoins(id);
      // Inject cancelled_by so the email body can render it.
      appt.cancelled_by = cancelledBy;
      await sendCancellationEmail(appt);
      emailSent = true;
    } catch (err) {
      console.error('Cancellation email failed for appt ' + id + ':', err.message);
      emailError = err.message;
    }
  }

  res.json({ ok: true, email_sent: emailSent, email_error: emailError });
});
```

- [ ] **Step 6.4: Run the test to confirm it passes**

Run: `cd /opt/barkstroll && node --test test/cancel-email.test.js`
Expected: all 7 tests in the file PASS.

- [ ] **Step 6.5: Run the full suite — no regressions**

Run: `cd /opt/barkstroll && node --test`
Expected: all tests across all files PASS.

- [ ] **Step 6.6: Commit**

```bash
cd /opt/barkstroll && git add routes/appointments.js test/cancel-email.test.js && git commit -m "appointments: POST /appointments/:id/cancel endpoint

Soft-cancel (status='cancelled', cancelled_at/_by stamped) + fire
three-recipient cancellation emails synchronously. Bypasses quiet
hours. Idempotent: re-cancelling returns already_cancelled=true and
sends nothing. Completed visits return 400. DELETE handler stays
as hard-delete admin tooling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Wire UI Cancel button to the new endpoint

**Files:**
- Modify: `public/js/views/calendar.js` (`cancelAppt` function)

- [ ] **Step 7.1: Update `cancelAppt`**

In `public/js/views/calendar.js`, find the existing `cancelAppt` function (around line 175):

```javascript
async function cancelAppt(id) {
  if (!await confirmDialog('Cancel this appointment?')) return;
  try {
    await api('/appointments/' + id, { method: 'DELETE' });
    closeModal();
    toast('Appointment cancelled');
    renderCal();
  } catch (e) { toast(e.message, 'err'); }
}
```

Replace with:

```javascript
async function cancelAppt(id) {
  if (!await confirmDialog('Cancel this appointment? Client and walker will be emailed.')) return;
  try {
    const r = await api('/appointments/' + id + '/cancel', { method: 'POST' });
    closeModal();
    if (r && r.already_cancelled) toast('Already cancelled — no emails sent');
    else if (r && r.email_sent === false) toast('Cancelled, but email send failed: ' + (r.email_error || 'unknown'), 'err');
    else toast('Appointment cancelled — emails sent');
    renderCal();
  } catch (e) { toast(e.message, 'err'); }
}
```

- [ ] **Step 7.2: Verify endpoint round-trip on the running service**

If the service is running, restart it so the new route is picked up:

```bash
sudo systemctl restart barkstroll
sudo systemctl status barkstroll --no-pager | head -10
```

Expected: service `active (running)`, no errors.

Smoke check from the host (cancel endpoint should reject without auth):

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:8083/admin/api/appointments/999999/cancel
```

Expected: `401` (Not authenticated — the `adminOnly` middleware blocks unauthenticated calls). If the port is different in your env, check `server.js` for `app.listen` to confirm.

- [ ] **Step 7.3: Commit**

```bash
cd /opt/barkstroll && git add public/js/views/calendar.js && git commit -m "calendar UI: switch Cancel to POST /appointments/:id/cancel

Hits the new soft-cancel endpoint instead of the silent DELETE.
Confirm dialog now warns that emails will fire. Toast surfaces
already_cancelled and email-send failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: End-to-end manual verification

**Files:** none.

- [ ] **Step 8.1: Confirm the migration ran on the live DB**

```bash
sqlite3 /opt/barkstroll/data/barkstroll.db "PRAGMA table_info(appointments)" | grep -E "cancelled_at|cancelled_by"
```

Expected: two rows, one each for `cancelled_at` and `cancelled_by`. If missing, run `node /opt/barkstroll/migrate-cancel-columns.js` directly.

- [ ] **Step 8.2: Open the admin calendar in a browser**

Open `https://barkstroll.com/admin/app#/calendar`. Pick a real upcoming appointment with both a customer email and a walker email on file.

**STOP** — before clicking Cancel, confirm with Scott which appointment to use as the live test, or use a throwaway test appointment created via the "+" FAB. Do NOT cancel a real client's visit without confirming.

- [ ] **Step 8.3: Cancel the test appointment and verify**

After Scott confirms which appointment to cancel:

- Click Cancel.
- Confirm the dialog ("Client and walker will be emailed").
- Wait for the toast: "Appointment cancelled — emails sent".

Then check:

- The day in the calendar grid no longer shows the dot for this visit.
- The appointment row in the day list disappears (status='cancelled' is filtered).
- In `scott@barkstroll.com` inbox: an owner-copy email arrives titled `BBS: CANCELLED — …` with both attendees in the ICS.
- Confirm the client and walker received their copies (Scott can verify with the test recipients).

- [ ] **Step 8.4: Verify the DB state**

```bash
sqlite3 /opt/barkstroll/data/barkstroll.db "SELECT id, status, cancelled_at, cancelled_by FROM appointments WHERE id = <test-appt-id>"
```

Expected: `status=cancelled`, `cancelled_at` set to a recent timestamp, `cancelled_by=Scott` (or whatever admin display_name).

- [ ] **Step 8.5: Re-cancel the same appointment to verify idempotency**

Click Cancel again on the same appointment (it'll still appear in admin if you navigate to its detail via another route, or call the endpoint directly):

```bash
curl -s -X POST -b cookies.txt https://barkstroll.com/admin/api/appointments/<id>/cancel
```

Expected response: `{"ok":true,"already_cancelled":true}` — and no second email arrives in any inbox.

- [ ] **Step 8.6: No commit for this task** (verification only).

---

## Final checklist before declaring done

- [ ] `cd /opt/barkstroll && node --test` — all green.
- [ ] `git log --oneline -8` shows the 7 expected commits (Task 1, 2, 3, 4, 5, 6, 7).
- [ ] `systemctl status barkstroll` is `active (running)` with no error lines in `journalctl -u barkstroll --since "5 minutes ago"`.
- [ ] Live cancel on a test appointment fires three emails and persists `status='cancelled'`.
- [ ] Tell Scott it's deployed and what to test from his side.
