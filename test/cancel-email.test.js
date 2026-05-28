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

// ---------------------------------------------------------------------------
// Endpoint tests: POST /appointments/:id/cancel
// ---------------------------------------------------------------------------

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
