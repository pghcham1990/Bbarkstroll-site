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
