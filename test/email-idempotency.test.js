const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Temp DB + required env, set BEFORE requiring app modules.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsmail-'));
process.env.BARKSTROLL_DB_PATH = path.join(tmp, 'test.db');
process.env.GMAIL_USER = 'owner@example.com';
process.env.GMAIL_APP_PASSWORD = 'test-pass';
process.env.BARKSTROLL_CAL_SECRET = 'test-secret';

const db = require('../lib/db');
const { migrate } = require('../migrate-email-sends');
const email = require('../lib/email');

before(() => { migrate(db); });
after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

function makeFakeTransport(failForEmail) {
  const calls = [];
  return {
    calls,
    sendMail: async (opts) => {
      calls.push(opts.to);
      if (failForEmail && opts.to === failForEmail) throw new Error('simulated SMTP failure');
      return { messageId: 'fake' };
    },
  };
}

const appt = {
  id: 9001,
  customer_email: 'client@example.com',
  employee_email: 'walker@example.com',
  customer_name: 'Jane Client',
  employee_name: 'Walker Person',
  dog_names: 'Rex',
  dog_names_with_breed: 'Rex (Lab)',
  dogs: [{ name: 'Rex' }],
  service_name: 'Dog Walking',
  start_time: '2026-06-01T15:00:00.000Z',
  end_time: '2026-06-01T15:30:00.000Z',
  customer_address: '123 Main St, Bridgeville, PA',
  notes: null,
};

function rolesSent() {
  return db.prepare('SELECT recipient_role FROM email_sends WHERE scope_type=? AND scope_id=?')
    .all('appt', '9001').map(r => r.recipient_role).sort();
}

test('partial failure records only the recipients that succeeded', async () => {
  const fake = makeFakeTransport('walker@example.com'); // employee send fails
  email.__setTransporter(fake);
  await assert.rejects(() => email.sendAppointmentEmail(appt), /Email send failed/);
  // all three were attempted, but only customer + owner recorded
  assert.strictEqual(fake.calls.length, 3);
  assert.deepStrictEqual(rolesSent(), ['customer', 'owner']);
});

test('retry re-sends ONLY the recipient that failed (no duplicates)', async () => {
  const fake = makeFakeTransport(null); // everything succeeds now
  email.__setTransporter(fake);
  await email.sendAppointmentEmail(appt); // must NOT throw
  // only the previously-failed employee is retried
  assert.strictEqual(fake.calls.length, 1);
  assert.strictEqual(fake.calls[0], 'walker@example.com');
  assert.deepStrictEqual(rolesSent(), ['customer', 'employee', 'owner']);
});

test('a fully-sent appointment does nothing on a third call', async () => {
  const fake = makeFakeTransport(null);
  email.__setTransporter(fake);
  await email.sendAppointmentEmail(appt);
  assert.strictEqual(fake.calls.length, 0); // all recipients already recorded
});

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
