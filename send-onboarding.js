require('dotenv').config();
const nodemailer = require('nodemailer');
const db = require('./lib/db');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});

const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;

async function sendEmail(to, subject, html) {
  await transporter.sendMail({ from, to, subject, html });
  console.log('  SENT to ' + to);
}

function buildEmail(heading, bodyRows) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:540px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:24px;font-weight:600">Bark &amp; Stroll</h1>
        <p style="margin:6px 0 0;font-size:14px;opacity:.85">${heading}</p>
      </div>
      <div style="background:#ffffff;padding:28px 24px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 12px 12px;font-size:15px;line-height:1.6;color:#2a2a28">
        ${bodyRows}
      </div>
      <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">Bark &amp; Stroll LLC &middot; Bridgeville, PA &middot; (412) 992-1480</p>
    </div>
  `;
}

async function main() {
  console.log('\n=== Bark & Stroll Portal Onboarding Emails ===\n');

  // --- CUSTOMERS ---
  const customers = db.prepare(`
    SELECT c.first_name, c.last_name, c.email, u.username, u.role
    FROM customers c
    JOIN users u ON u.id = c.user_id
    WHERE u.role = 'customer'
  `).all();

  console.log('CUSTOMERS:');
  for (const c of customers) {
    if (!c.email) {
      console.log('  SKIPPED ' + c.first_name + ' ' + c.last_name + ' — no email on file');
      continue;
    }

    const html = buildEmail('Your New Client Portal', `
      <p>Hi ${c.first_name}! 👋</p>
      <p>Great news — Bark &amp; Stroll just launched a <strong>Client Portal</strong> to make scheduling walks even easier for you!</p>

      <div style="background:#f8f7f4;border-radius:10px;padding:16px 20px;margin:20px 0;border:1px solid #e8e8e5">
        <p style="margin:0 0 8px;font-weight:600;color:#14613a">Your Login Credentials</p>
        <table style="font-size:14px;border-collapse:collapse;width:100%">
          <tr><td style="padding:4px 0;color:#888;width:90px">Website</td><td style="padding:4px 0"><a href="https://barkstroll.com/portal" style="color:#14613a;font-weight:600">barkstroll.com/portal</a></td></tr>
          <tr><td style="padding:4px 0;color:#888">Username</td><td style="padding:4px 0;font-weight:600">${c.username}</td></tr>
          <tr><td style="padding:4px 0;color:#888">Password</td><td style="padding:4px 0;font-weight:600">BarkStroll1</td></tr>
        </table>
      </div>

      <p style="font-weight:600;color:#14613a;margin-bottom:8px">Here's what you can do:</p>
      <ul style="margin:0 0 16px;padding-left:20px">
        <li><strong>View the Calendar</strong> — See your upcoming walks and check when the team is available</li>
        <li><strong>Request a Walk</strong> — Pick a date and time that works for you, select your dogs, and submit a request</li>
        <li><strong>Get Notified</strong> — When you submit a request, the entire team is notified. The first walker to respond gets the job!</li>
        <li><strong>Track Your Walks</strong> — See all your upcoming and past walks in one place</li>
      </ul>

      <p>The goal is to make scheduling as smooth as possible so you and your pups get the best care with zero hassle. No more back-and-forth texting to find a time!</p>

      <p>If you run into any issues, there's a <strong>"Report Issue"</strong> button right in the portal that sends a message directly to Scott.</p>

      <div style="text-align:center;margin:24px 0 8px">
        <a href="https://barkstroll.com/portal" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:60px;font-weight:600;font-size:15px">Log In to Your Portal</a>
      </div>
    `);

    try {
      await sendEmail(c.email, 'Your Bark & Stroll Client Portal is Live!', html);
    } catch (err) {
      console.log('  ERROR sending to ' + c.email + ': ' + err.message);
    }
  }

  // --- WALKERS ---
  const walkers = db.prepare(`
    SELECT e.first_name, e.last_name, e.email, u.username, u.role
    FROM employees e
    JOIN users u ON u.id = e.user_id
    WHERE u.role = 'walker' AND e.active = 1
  `).all();

  console.log('\nWALKERS:');
  for (const w of walkers) {
    if (!w.email) {
      console.log('  SKIPPED ' + w.first_name + ' ' + w.last_name + ' — no email on file');
      continue;
    }

    const html = buildEmail('Your New Walker Portal', `
      <p>Hi ${w.first_name}! 👋</p>
      <p>Bark &amp; Stroll just launched a <strong>Walker Portal</strong> to streamline how you get and manage walk assignments!</p>

      <div style="background:#f8f7f4;border-radius:10px;padding:16px 20px;margin:20px 0;border:1px solid #e8e8e5">
        <p style="margin:0 0 8px;font-weight:600;color:#14613a">Your Login Credentials</p>
        <table style="font-size:14px;border-collapse:collapse;width:100%">
          <tr><td style="padding:4px 0;color:#888;width:90px">Website</td><td style="padding:4px 0"><a href="https://barkstroll.com/portal" style="color:#14613a;font-weight:600">barkstroll.com/portal</a></td></tr>
          <tr><td style="padding:4px 0;color:#888">Username</td><td style="padding:4px 0;font-weight:600">${w.username}</td></tr>
          <tr><td style="padding:4px 0;color:#888">Password</td><td style="padding:4px 0;font-weight:600">BarkStroll1</td></tr>
        </table>
      </div>

      <p style="font-weight:600;color:#14613a;margin-bottom:8px">Here's how it works:</p>
      <ol style="margin:0 0 16px;padding-left:20px">
        <li><strong>Client Books a Walk</strong> — When a client requests a walk through their portal, you'll get an email notification with the details (dog, date, time, notes)</li>
        <li><strong>Accept or Pass</strong> — Log in to your portal and check the <strong>Requests</strong> tab. If the walk works for your schedule, hit <strong>"Accept"</strong> — first come, first served! If it doesn't work, hit <strong>"Pass"</strong></li>
        <li><strong>Confirmation Sent</strong> — Once you accept, the client automatically gets a confirmation email with your info. Done!</li>
        <li><strong>View Your Schedule</strong> — Check the <strong>Calendar</strong> and <strong>My Schedule</strong> tabs to see all your upcoming walks with client contact info and addresses</li>
      </ol>

      <p>The reason for this portal is to <strong>automate the scheduling process</strong> so that clients and the Bark &amp; Stroll team can have the most fluid relationship possible. No more group texts or missed messages — everything is organized in one place, and the most efficient workflow wins.</p>

      <p>If you run into any glitches, there's a <strong>"Report Issue"</strong> button in the portal that goes straight to Scott.</p>

      <div style="text-align:center;margin:24px 0 8px">
        <a href="https://barkstroll.com/portal" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:60px;font-weight:600;font-size:15px">Log In to Your Portal</a>
      </div>
    `);

    try {
      await sendEmail(w.email, 'Your Bark & Stroll Walker Portal is Live!', html);
    } catch (err) {
      console.log('  ERROR sending to ' + w.email + ': ' + err.message);
    }
  }

  console.log('\nDone!\n');
  db.close();
}

main().catch(err => { console.error('Fatal error:', err); process.exit(1); });
