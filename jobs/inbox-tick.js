#!/usr/bin/env node
// Bark & Stroll inbox tick — runs every 15 minutes via barkstroll-inbox-tick.timer.
// Reads scott@barkstroll.com. B&S is a customer-service business (no cold-outreach
// suppression list), so this reader only logs to inbox_events plus, on a hard
// bounce, drops a customer_notes timeline entry on the matching customer record
// so a bad email surfaces on the prospect/client card.

require('dotenv').config({ path: '/opt/barkstroll/.env' });
require('dotenv').config({ path: '/opt/mailer/.env' });

const path = require('path');
const Database = require('better-sqlite3');
const db = new Database(path.join('/opt/barkstroll/data/barkstroll.db'));
db.pragma('journal_mode = WAL');

const { scan, getMaxUid, archiveMessages, close } = require('/opt/shared/inbox-reader');
const { runInboxMigration } = require('/opt/shared/inbox-migrate');

const ACCOUNT = process.env.BARKSTROLL_USER;
const PASS = process.env.BARKSTROLL_PASS;
const FIRST_RUN_LOOKBACK = 500;
// B&S is customer-facing, not cold outreach. A client OOO ("I'm on vacation,
// please don't walk the dog this week") is something Scott needs to see, so
// auto_reply stays in inbox. Only DSN bounces get archived.
const ARCHIVE_CLASSIFICATIONS = new Set(['bounce_hard', 'bounce_soft']);

(async () => {
  let client = null;
  const stats = {
    fetched: 0, logged: 0,
    bounce_hard: 0, bounce_soft: 0,
    auto_reply: 0, human_reply: 0, other: 0,
    customer_notes_added: 0,
  };

  try {
    if (!ACCOUNT || !PASS) throw new Error('BARKSTROLL_USER / BARKSTROLL_PASS missing');
    runInboxMigration(db);

    let state = db.prepare('SELECT last_uid FROM mailer_state WHERE account_user = ?').get(ACCOUNT);
    if (!state) {
      const maxUid = await getMaxUid({ user: ACCOUNT, pass: PASS });
      const seedUid = Math.max(0, maxUid - FIRST_RUN_LOOKBACK);
      db.prepare('INSERT INTO mailer_state (account_user, last_uid) VALUES (?, ?)').run(ACCOUNT, seedUid);
      state = { last_uid: seedUid };
      console.log(`[barkstroll-inbox-tick] first run: seeded last_uid=${seedUid} (max=${maxUid})`);
    }

    const result = await scan({ user: ACCOUNT, pass: PASS, sinceUid: state.last_uid, maxMessages: 500 });
    client = result.client;
    stats.fetched = result.events.length;

    const insEvent = db.prepare(`
      INSERT OR IGNORE INTO inbox_events
        (account_user, uid, message_id, from_email, subject, snippet,
         classification, bounce_email, bounce_status, bounce_reason,
         auto_reply_hint, received_at, acted_on, action_notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const findCustomerByEmail = db.prepare(
      `SELECT id, first_name, last_name FROM customers WHERE email = ? COLLATE NOCASE LIMIT 1`
    );
    const insCustomerNote = db.prepare(
      `INSERT INTO customer_notes (customer_id, text, created_at) VALUES (?, ?, datetime('now'))`
    );
    const updState = db.prepare(
      `UPDATE mailer_state SET last_uid = ?, last_run_at = datetime('now') WHERE account_user = ?`
    );

    const archiveUids = [];
    const tx = db.transaction(() => {
      for (const ev of result.events) {
        if (ARCHIVE_CLASSIFICATIONS.has(ev.classification)) archiveUids.push(ev.uid);
        stats[ev.classification] = (stats[ev.classification] || 0) + 1;
        let acted = 0;
        let actionNotes = null;

        if (ev.classification === 'bounce_hard' && ev.bounceEmail) {
          const cust = findCustomerByEmail.get(ev.bounceEmail);
          if (cust) {
            const text =
              `⚠ Email to ${ev.bounceEmail} bounced (${ev.bounceStatus}). ` +
              `Reason: ${ev.bounceReason || 'no diagnostic available'}. ` +
              `Update the email on file or reach out by phone.`;
            insCustomerNote.run(cust.id, text);
            stats.customer_notes_added++;
            acted = 1;
            actionNotes = `flagged customer #${cust.id} (${cust.first_name} ${cust.last_name})`;
          } else {
            actionNotes = `no matching customer for ${ev.bounceEmail}`;
          }
        }

        const r = insEvent.run(
          ACCOUNT, ev.uid, ev.messageId, ev.fromEmail, ev.subject, ev.snippet,
          ev.classification, ev.bounceEmail, ev.bounceStatus, ev.bounceReason,
          ev.autoReplyHint, ev.receivedAt, acted, actionNotes
        );
        if (r.changes > 0) stats.logged++;
      }
      if (result.highestUid > state.last_uid) {
        updState.run(result.highestUid, ACCOUNT);
      }
    });
    tx();

    let archived = 0;
    if (archiveUids.length > 0 && client) {
      archived = await archiveMessages(client, archiveUids);
    }

    console.log(
      `[barkstroll-inbox-tick] fetched=${stats.fetched} logged=${stats.logged} ` +
      `bounce_hard=${stats.bounce_hard || 0} bounce_soft=${stats.bounce_soft || 0} ` +
      `auto_reply=${stats.auto_reply || 0} human_reply=${stats.human_reply || 0} ` +
      `other=${stats.other || 0} customer_notes_added=${stats.customer_notes_added} ` +
      `archived=${archived} last_uid=${result.highestUid}`
    );
  } catch (e) {
    console.error(`[barkstroll-inbox-tick:error] ${e.stack || e.message}`);
  } finally {
    if (client) await close(client);
    process.exit(0);
  }
})();
