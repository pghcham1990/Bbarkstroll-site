const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { generateICS, generateBatchICS } = require('./ics');
const db = require('./db');

// --- Per-recipient send idempotency (see migrate-email-sends.js) ---
// Each appointment/batch can email up to 3 recipients. Recording each success
// lets a retry re-send ONLY the recipients that failed last time, instead of
// re-blasting everyone because one recipient's send threw.
function alreadySent(scopeType, scopeId, role) {
  return !!db.prepare(
    'SELECT 1 FROM email_sends WHERE scope_type=? AND scope_id=? AND recipient_role=? LIMIT 1'
  ).get(scopeType, String(scopeId), role);
}
function recordSent(scopeType, scopeId, role, email) {
  db.prepare(
    'INSERT OR IGNORE INTO email_sends (scope_type, scope_id, recipient_role, recipient_email) VALUES (?,?,?,?)'
  ).run(scopeType, String(scopeId), role, email || null);
}
// Send a set of {role,email,run} tasks (caller already filtered already-sent
// ones). Records each success individually; throws if any failed so the queue
// leaves the row unsent and retries ONLY the missing recipients next tick.
async function runSendTasks(scopeType, scopeId, tasks) {
  const results = await Promise.allSettled(tasks.map(x => x.run()));
  const failures = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') recordSent(scopeType, scopeId, tasks[i].role, tasks[i].email);
    else failures.push(tasks[i].role + ': ' + ((res.reason && res.reason.message) || res.reason));
  });
  if (failures.length) throw new Error('Email send failed for ' + failures.join('; '));
}

// HTML-escape user-controlled strings before embedding in emails. Customer
// notes, addresses, dog names, and service names all flow from admin input
// straight into rendered HTML. Without this an admin who creates an
// appointment with notes "<img src=x onerror=alert(1)>" gets script execution
// in any HTML-rendering webmail client that opens the message.
function escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HMAC token for public .ics URLs. Without this, sequential integer IDs let
// anyone enumerate every customer's appointment (name, email, address, walker).
function calToken(prefix, id) {
  const secret = process.env.BARKSTROLL_CAL_SECRET || process.env.SESSION_SECRET || '';
  if (!secret) throw new Error('calToken: SESSION_SECRET / BARKSTROLL_CAL_SECRET missing');
  return crypto.createHmac('sha256', secret).update(prefix + ':' + String(id)).digest('hex').slice(0, 16);
}

let transporter = null;

// Test hook: inject a fake transporter so send logic can be unit-tested
// without real SMTP. No effect in production (never called there).
function __setTransporter(t) { transporter = t; }

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_APP_PASSWORD === 'REPLACE_ME') {
    return null;
  }
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD
    }
  });
  return transporter;
}

function gcalUrl(appt) {
  const start = new Date(appt.start_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const end = new Date(appt.end_time).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: 'BBS: ' + firstName(appt.employee_name) + ' & ' + appt.dog_names,
    dates: start + '/' + end,
    details: 'Service: ' + appt.service_name + '\n' + (appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog') + ': ' + appt.dog_names_with_breed + (appt.notes ? '\nNotes: ' + appt.notes : ''),
    location: appt.customer_address || '',
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function icalUrl(appt) {
  return 'https://barkstroll.com/admin/cal/' + appt.id + '.ics?t=' + calToken('appt', appt.id);
}

function buildHtml(rows, calLink, icalLink) {
  return `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px;font-weight:600">Bark &amp; Stroll</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.85">Appointment Confirmation</p>
      </div>
      <div style="background:#ffffff;padding:24px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 12px 12px">
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          ${rows.map(r => `<tr><td style="padding:8px 0;color:#888;width:100px">${escHtml(r[0])}</td><td style="padding:8px 0;${r[2] || ''}">${escHtml(r[1])}</td></tr>`).join('\n          ')}
        </table>
        <div style="text-align:center;margin-top:20px">
          <a href="${calLink}" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:60px;font-weight:600;font-size:14px">Add to Google Calendar</a>
        </div>
        <div style="text-align:center;margin-top:10px">
          <a href="${icalLink}" style="display:inline-block;background:#ffffff;color:#14613a;text-decoration:none;padding:10px 24px;border-radius:60px;font-weight:600;font-size:14px;border:2px solid #14613a">Add to iCal / Outlook</a>
        </div>
      </div>
      <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">Bark &amp; Stroll LLC · Bridgeville, PA · (412) 992-1480</p>
    </div>
  `;
}

function firstName(fullName) {
  return (fullName || '').split(' ')[0];
}

function sendOne(t, to, from, subject, rows, appt, attendeeEmails) {
  const calLink = gcalUrl(appt);
  const icalLink = icalUrl(appt);
  const icsContent = generateICS(appt, attendeeEmails);
  return t.sendMail({
    from, to, subject,
    html: buildHtml(rows, calLink, icalLink),
    icalEvent: { method: 'REQUEST', content: icsContent },
    attachments: [{ filename: 'appointment.ics', content: icsContent, contentType: 'text/calendar' }]
  });
}

async function sendAppointmentEmail(appt) {
  const t = getTransporter();
  if (!t) throw new Error('Email not configured (set GMAIL_APP_PASSWORD in .env)');

  const tz = 'America/New_York';
  const startDate = new Date(appt.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = startDate.toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const endStr = new Date(appt.end_time).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  const subject = `BBS: ${firstName(appt.employee_name)} & ${appt.dog_names}, ${dateStr} at ${timeStr}`;
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;

  const tasks = [];

  // --- Customer email: only THEY are listed as attendee (no walker email visible) ---
  if (appt.customer_email && !alreadySent('appt', appt.id, 'customer')) {
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog', appt.dog_names_with_breed],
      ['Walker', firstName(appt.employee_name)],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    tasks.push({ role: 'customer', email: appt.customer_email, run: () => sendOne(t, appt.customer_email, from, subject, rows, appt, [appt.customer_email]) });
  }

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

  // --- Owner email: BOTH attendees listed so you can see RSVP status from each ---
  const ownerEmail = process.env.GMAIL_USER;
  if (ownerEmail && !alreadySent('appt', appt.id, 'owner')) {
    const allAttendees = [appt.customer_email, appt.employee_email].filter(Boolean);
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} to ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      [appt.dogs && appt.dogs.length > 1 ? 'Dogs' : 'Dog', appt.dog_names_with_breed],
      ['Client', appt.customer_name],
      ['Walker', appt.employee_name],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    tasks.push({ role: 'owner', email: ownerEmail, run: () => sendOne(t, ownerEmail, from, subject, rows, appt, allAttendees) });
  }

  const hadRecipient = appt.customer_email || appt.employee_email || ownerEmail;
  if (!hadRecipient) throw new Error('No email recipients (customer and employee have no email addresses)');
  if (!tasks.length) return; // every recipient already sent — nothing to do

  await runSendTasks('appt', appt.id, tasks);
}

function gcalUrlFor(appt) {
  return gcalUrl(appt);
}

function batchIcalUrl(batchId) {
  return 'https://barkstroll.com/admin/cal/batch/' + batchId + '.ics?t=' + calToken('batch', batchId);
}

function groupByDate(appts) {
  const tz = 'America/New_York';
  const groups = new Map();
  for (const a of appts) {
    const d = new Date(a.start_time);
    const key = d.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    if (!groups.has(key)) groups.set(key, { date: d, label: '', visits: [] });
    groups.get(key).visits.push(a);
  }
  const out = [];
  for (const g of groups.values()) {
    g.label = g.date.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short', month: 'numeric', day: 'numeric' });
    g.visits.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    out.push(g);
  }
  out.sort((a, b) => a.date - b.date);
  return out;
}

function fmtTimeET(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
}

function buildBatchHtml({ greetingName, intro, groups, totalCount, icsLink, closingLine }) {
  const tableRows = groups.map(g => {
    const chips = g.visits.map(v =>
      `${fmtTimeET(v.start_time).replace(' ', '&nbsp;')} <a href="${gcalUrlFor(v)}" style="color:#8b6914;font-size:12px;text-decoration:underline;margin-right:14px;">add</a>`
    ).join('\n          ');
    return `      <tr style="border-bottom:1px solid #e8e5e0;">
        <td style="padding:12px 0;font-weight:600;color:#14613a;width:110px;">${g.label}</td>
        <td style="padding:12px 0;color:#2a2a28;">
          ${chips}
        </td>
      </tr>`;
  }).join('\n');

  return `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#faf8f4;border-radius:12px;overflow:hidden;border:1px solid #e8e5e0;">
  <div style="background:#14613a;padding:24px 32px;text-align:center;">
    <img src="https://barkstroll.com/bridgeville-bark-stroll-logo.png" alt="Bridgeville Bark & Stroll" style="max-height:60px;margin-bottom:8px;" />
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Bridgeville Bark &amp; Stroll</div>
  </div>
  <div style="padding:32px;color:#2a2a28;font-size:15px;line-height:1.7;">
    <p>Hi ${greetingName},</p>
    <p>${intro}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:20px 0;border-collapse:collapse;">
${tableRows}
    </table>
    <p style="text-align:center;margin:28px 0 8px;">
      <a href="${icsLink}" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:500;font-size:13px;">Add all ${totalCount} visit${totalCount === 1 ? '' : 's'} to calendar</a>
    </p>
    <p style="text-align:center;font-size:12px;color:#7a7a78;margin-top:0;">Opens a .ics file that works with Apple Calendar, Google Calendar, and Outlook.</p>
    <p style="margin-top:24px;">${closingLine}</p>
    <p style="margin-top:24px;"><strong>Scott</strong><br/><span style="color:#c4a44e;">Bridgeville Bark &amp; Stroll</span></p>
  </div>
  <div style="background:#0d4428;padding:16px 32px;text-align:center;">
    <span style="color:rgba(255,255,255,0.6);font-size:12px;">Bridgeville Bark &amp; Stroll &middot; Bridgeville, PA</span>
  </div>
</div>`;
}

async function sendBatchAppointmentEmail(appts) {
  if (!appts || !appts.length) throw new Error('sendBatchAppointmentEmail: no appointments');
  const t = getTransporter();
  if (!t) throw new Error('Email not configured (set GMAIL_APP_PASSWORD in .env)');

  const first = appts[0];
  const batchId = first.batch_id;
  if (!batchId) throw new Error('sendBatchAppointmentEmail: missing batch_id');

  const tz = 'America/New_York';
  const groups = groupByDate(appts);
  const total = appts.length;

  const startDate = new Date(first.start_time);
  const endAppt = appts[appts.length - 1];
  const endDate = new Date(endAppt.start_time);
  const sameDay = startDate.toDateString() === endDate.toDateString();
  const dateRange = sameDay
    ? startDate.toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' })
    : startDate.toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' }) +
      '\u2013' +
      endDate.toLocaleDateString('en-US', { timeZone: tz, month: 'long', day: 'numeric' });

  const subject = `BBS: ${firstName(first.employee_name)} & ${first.dog_names}, ${total} visit${total === 1 ? '' : 's'} (${dateRange})`;
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;
  const icsContent = generateBatchICS(appts, [first.customer_email, first.employee_email].filter(Boolean));
  const icsLink = batchIcalUrl(batchId);

  const tasks = [];

  // --- Client email: no walker contact, attendee = client only ---
  if (first.customer_email && !alreadySent('batch', batchId, 'client')) {
    const clientIcs = generateBatchICS(appts, [first.customer_email]);
    const html = buildBatchHtml({
      greetingName: firstName(first.customer_name),
      intro: `${first.dog_names}'s visits are confirmed for <strong>${dateRange}</strong> with ${firstName(first.employee_name)}. Tap <em>add</em> next to any time to drop it on your calendar, or grab them all at once below.`,
      groups,
      totalCount: total,
      icsLink,
      closingLine: `Let me know if anything needs tweaking. Otherwise we&rsquo;re all set.`,
    });
    tasks.push({ role: 'client', email: first.customer_email, run: () => t.sendMail({
      from, to: first.customer_email, subject,
      html,
      icalEvent: { method: 'REQUEST', content: clientIcs },
      attachments: [{ filename: 'visits.ics', content: clientIcs, contentType: 'text/calendar' }],
    }) });
  }

  // --- Walker email: dog names + address only (no client identity), attendee = walker only ---
  if (first.employee_email && !alreadySent('batch', batchId, 'walker')) {
    const walkerIcs = generateBatchICS(appts, [first.employee_email]);
    const addrLine = first.customer_address ? ` at ${first.customer_address}` : '';
    const html = buildBatchHtml({
      greetingName: firstName(first.employee_name),
      intro: `You&rsquo;re on the schedule for <strong>${first.dog_names}</strong>${addrLine}. <strong>${total} visit${total === 1 ? '' : 's'}</strong> across ${dateRange}. Tap <em>add</em> to drop any single visit on your calendar, or use the button below for the whole run.`,
      groups,
      totalCount: total,
      icsLink,
      closingLine: `Text or call me if anything changes on your end.`,
    });
    tasks.push({ role: 'walker', email: first.employee_email, run: () => t.sendMail({
      from, to: first.employee_email, subject,
      html,
      icalEvent: { method: 'REQUEST', content: walkerIcs },
      attachments: [{ filename: 'visits.ics', content: walkerIcs, contentType: 'text/calendar' }],
    }) });
  }

  // --- Owner copy: both attendees listed so RSVP status syncs ---
  const ownerEmail = process.env.GMAIL_USER;
  if (ownerEmail && !alreadySent('batch', batchId, 'owner')) {
    const bothAttendees = [first.customer_email, first.employee_email].filter(Boolean);
    const ownerIcs = generateBatchICS(appts, bothAttendees);
    const html = buildBatchHtml({
      greetingName: 'Scott',
      intro: `<strong>${first.customer_name}</strong> &rarr; <strong>${first.employee_name}</strong> &middot; ${first.dog_names} &middot; ${first.service_name}. <strong>${total} visit${total === 1 ? '' : 's'}</strong> across ${dateRange}.`,
      groups,
      totalCount: total,
      icsLink,
      closingLine: `Owner copy. Client and walker have their own emails.`,
    });
    tasks.push({ role: 'owner', email: ownerEmail, run: () => t.sendMail({
      from, to: ownerEmail, subject,
      html,
      icalEvent: { method: 'REQUEST', content: ownerIcs },
      attachments: [{ filename: 'visits.ics', content: ownerIcs, contentType: 'text/calendar' }],
    }) });
  }

  const hadRecipient = first.customer_email || first.employee_email || ownerEmail;
  if (!hadRecipient) throw new Error('No email recipients (customer and employee have no email addresses)');
  if (!tasks.length) return; // every recipient already sent — nothing to do
  await runSendTasks('batch', batchId, tasks);
}

async function sendRequestNotification(request) {
  const t = getTransporter();
  if (!t) throw new Error('Email not configured (set GMAIL_APP_PASSWORD in .env)');

  const tz = 'America/New_York';
  const dateObj = new Date(request.preferred_date + 'T12:00:00');
  const dateStr = dateObj.toLocaleDateString('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = request.preferred_time;
  // Convert 24h time to display time
  const [hh, mm] = timeStr.split(':');
  const h = parseInt(hh);
  const displayTime = (h === 0 ? '12' : h > 12 ? String(h - 12) : String(h)) + ':' + mm + ' ' + (h >= 12 ? 'PM' : 'AM');

  const subject = `New Walk Request: ${request.dog_names}, ${dateStr} at ${displayTime}`;
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:500px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
        <h1 style="margin:0;font-size:22px;font-weight:600">Bark &amp; Stroll</h1>
        <p style="margin:4px 0 0;font-size:13px;opacity:.85">New Walk Request</p>
      </div>
      <div style="background:#ffffff;padding:24px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 12px 12px">
        <table style="width:100%;font-size:14px;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#888;width:100px">Client</td><td style="padding:8px 0;font-weight:600">${request.customer_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Dog${request.dogs && request.dogs.length > 1 ? 's' : ''}</td><td style="padding:8px 0">${request.dog_names}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Service</td><td style="padding:8px 0">${request.service_name}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Date</td><td style="padding:8px 0;font-weight:600">${dateStr}</td></tr>
          <tr><td style="padding:8px 0;color:#888">Time</td><td style="padding:8px 0;font-weight:600">${displayTime}</td></tr>
          ${request.notes ? `<tr><td style="padding:8px 0;color:#888">Notes</td><td style="padding:8px 0">${request.notes}</td></tr>` : ''}
        </table>
        <div style="text-align:center;margin-top:20px">
          <a href="https://barkstroll.com/portal" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:60px;font-weight:600;font-size:14px">View in Portal</a>
        </div>
      </div>
      <p style="text-align:center;font-size:11px;color:#aaa;margin-top:16px">Bark &amp; Stroll LLC · Bridgeville, PA · (412) 992-1480</p>
    </div>
  `;

  const sends = [];
  // Email all recipients
  for (const email of request.notify_emails) {
    sends.push(t.sendMail({ from, to: email, subject, html }));
  }
  if (sends.length) await Promise.all(sends);
}

async function sendContactFormNotification({ name, email, phone, dog_names, city, out_of_area, submitted_at }) {
  const t = getTransporter();
  if (!t) throw new Error('Email not configured (set GMAIL_APP_PASSWORD in .env)');

  const ownerEmail = process.env.GMAIL_USER;
  if (!ownerEmail) throw new Error('GMAIL_USER not set');

  const tz = 'America/New_York';
  const when = (submitted_at ? new Date(submitted_at) : new Date()).toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  const flag = out_of_area ? '[OUT OF AREA] ' : '';
  const subject = `${flag}New lead: ${name} (${dog_names || 'no dogs listed'})`;
  const from = `"Bark & Stroll" <${ownerEmail}>`;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const mailtoSubject = encodeURIComponent(`Re: Bark & Stroll inquiry`);
  const phoneClean = phone ? String(phone).replace(/[^\d+]/g, '') : '';

  const rows = [
    ['Name', esc(name)],
    ['Email', `<a href="mailto:${esc(email)}" style="color:#14613a;text-decoration:none;">${esc(email)}</a>`],
    ['Phone', phoneClean ? `<a href="tel:${esc(phoneClean)}" style="color:#14613a;text-decoration:none;">${esc(phone)}</a>` : esc(phone || 'n/a')],
    ['Dogs', esc(dog_names || 'n/a')],
    ['City', esc(city || 'n/a') + (out_of_area ? ' <span style="color:#b04848;font-weight:600;">(outside service area)</span>' : '')],
    ['Submitted', esc(when) + ' ET'],
  ];

  const tableRows = rows.map(r => `
      <tr style="border-bottom:1px solid #e8e5e0;">
        <td style="padding:10px 0;color:#7a7a78;width:100px;font-size:13px;">${r[0]}</td>
        <td style="padding:10px 0;color:#2a2a28;font-size:15px;">${r[1]}</td>
      </tr>`).join('');

  const html = `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#faf8f4;border-radius:12px;overflow:hidden;border:1px solid #e8e5e0;">
  <div style="background:#14613a;padding:24px 32px;text-align:center;">
    <img src="https://barkstroll.com/bridgeville-bark-stroll-logo.png" alt="Bridgeville Bark & Stroll" style="max-height:60px;margin-bottom:8px;" />
    <div style="font-family:'DM Serif Display',Georgia,serif;font-size:22px;color:#ffffff;letter-spacing:0.02em;">Bridgeville Bark &amp; Stroll</div>
  </div>
  <div style="padding:32px;color:#2a2a28;font-size:15px;line-height:1.7;">
    <p style="margin:0 0 18px;font-weight:600;color:#14613a;">New contact form submission</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border-collapse:collapse;">
      ${tableRows}
    </table>
    <p style="text-align:center;margin:24px 0 4px;">
      <a href="https://barkstroll.com/admin/app" style="display:inline-block;background:#14613a;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:6px;font-weight:500;font-size:13px;">Open in admin portal</a>
    </p>
    <p style="margin-top:24px;font-size:13px;color:#7a7a78;">Auto-reply has already been sent to the prospect.</p>
  </div>
  <div style="background:#0d4428;padding:16px 32px;text-align:center;">
    <span style="color:rgba(255,255,255,0.6);font-size:12px;">Bridgeville Bark &amp; Stroll &middot; Bridgeville, PA</span>
  </div>
</div>`;

  await t.sendMail({ from, to: ownerEmail, subject, html, replyTo: email });
}

async function sendApplicantNotification(applicant) {
  const t = getTransporter();
  if (!t) {
    console.warn('[applicant-notify] no transporter configured, skipping email to Scott');
    return;
  }

  const portalUrl = 'https://barkstroll.com/admin#/applicants/' + applicant.id;
  const days = JSON.parse(applicant.days_available || '[]').join(', ');
  const times = JSON.parse(applicant.time_windows || '[]').join(', ');
  const sizes = JSON.parse(applicant.sizes_ok || '[]').join(', ');

  const rows = [
    ['Name', applicant.full_name + (applicant.preferred_name ? ' (' + applicant.preferred_name + ')' : '')],
    ['Email', applicant.email],
    ['Phone', applicant.phone],
    ['ZIP', applicant.zip],
    ['Area', applicant.closest_area],
    ['Days', days],
    ['Times', times],
    ['Hours hoping', applicant.hours_hoping],
    ['Transport', applicant.has_transport ? 'Yes' : 'No'],
    ['Owned dogs', applicant.owned_dogs ? 'Yes' : 'No'],
    ['Sizes OK', sizes],
    ['Not comfortable with', applicant.uncomfortable || '(none listed)'],
    ['Allergies', applicant.allergies || '(none listed)'],
    ['Why interested', applicant.why_interested],
    ['Tricky situation', applicant.tricky_situation],
  ];

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">New walker application</h2>
        <p style="margin:4px 0 0;font-size:13px;opacity:.85">${escHtml(applicant.full_name)}</p>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 10px 10px">
        <table style="width:100%;font-size:13px;border-collapse:collapse">
          ${rows.map(r => `<tr><td style="padding:6px 8px 6px 0;color:#888;width:140px;vertical-align:top">${escHtml(r[0])}</td><td style="padding:6px 0;color:#222">${escHtml(r[1])}</td></tr>`).join('\n')}
        </table>
        <div style="text-align:center;margin-top:18px">
          <a href="${portalUrl}" style="display:inline-block;background:#14613a;color:#fff;text-decoration:none;padding:10px 22px;border-radius:60px;font-weight:600;font-size:14px">Review in portal</a>
        </div>
      </div>
    </div>
  `;

  await t.sendMail({
    from: '"Bark & Stroll" <' + process.env.GMAIL_USER + '>',
    to: 'scott@barkstroll.com',
    subject: 'New walker application: ' + applicant.full_name,
    html
  });
}

async function sendApplicantFinalistDisclosure(applicant) {
  const t = getTransporter();
  if (!t) throw new Error('[finalist-disclosure] no transporter configured');

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">Bark &amp; Stroll: next step</h2>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 10px 10px;color:#222;font-size:14px;line-height:1.55">
        <p>Hi ${escHtml(applicant.preferred_name || applicant.full_name.split(' ')[0])},</p>
        <p>Thanks for applying. You're a finalist. Before we move forward I want to run a quick background check, paid for by Bark &amp; Stroll. This is a federal-law requirement, so the rest of this email reads a little formal. Take a minute with it and just reply <strong>YES I agree</strong> if you're good.</p>
        <hr style="border:none;border-top:1px solid #e8e8e5;margin:18px 0">
        <h3 style="font-size:14px;color:#14613a;margin:0 0 8px">Disclosure Regarding Background Investigation</h3>
        <p>Bark &amp; Stroll LLC ("we") may obtain a consumer report and/or investigative consumer report ("background report") about you from a consumer reporting agency (currently Checkr, Inc.) in connection with your application for an independent contractor role with us. The background report may include information about your criminal history, driving record, identity, and similar matters.</p>
        <p>You have rights under the federal Fair Credit Reporting Act (FCRA). A summary of those rights is attached and also viewable at <a href="https://barkstroll.com/legal/fcra-summary-of-rights.pdf" style="color:#14613a;font-weight:600">barkstroll.com/legal/fcra-summary-of-rights.pdf</a>.</p>
        <p style="text-align:center;margin:18px 0">
          <a href="https://barkstroll.com/legal/fcra-summary-of-rights.pdf" style="display:inline-block;background:#14613a;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;font-size:13px">Open Summary of Your Rights (PDF)</a>
        </p>
        <h3 style="font-size:14px;color:#14613a;margin:18px 0 8px">Authorization</h3>
        <p>By replying "YES I agree" to this email, you authorize Bark &amp; Stroll LLC to obtain a background report about you. This authorization remains in effect for the duration of any contractor relationship with us.</p>
        <p>If you have questions before agreeing, just reply to this email and ask.</p>
        <p style="margin-top:22px">Scott<br>Bark &amp; Stroll</p>
      </div>
    </div>
  `;

  await t.sendMail({
    from: '"Bark & Stroll" <' + process.env.GMAIL_USER + '>',
    to: applicant.email,
    subject: 'Bark & Stroll: next step (background check authorization)',
    html,
    attachments: [{
      filename: 'Summary-of-Your-Rights-FCRA.pdf',
      path: '/var/www/barkstroll.com/legal/fcra-summary-of-rights.pdf',
      contentType: 'application/pdf'
    }]
  });
}

async function sendApplicantCheckrHeadsUp(applicant) {
  const t = getTransporter();
  if (!t) throw new Error('[checkr-headsup] no transporter configured');

  const firstName = applicant.preferred_name || applicant.full_name.split(' ')[0];

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">Bark &amp; Stroll: an invite from Checkr is coming</h2>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 10px 10px;color:#222;font-size:14px;line-height:1.55">
        <p>Hi ${escHtml(firstName)},</p>
        <p>Quick heads-up. I just placed the order for your background check, so in the next day or so you'll get an invite email from <strong>Checkr</strong> asking you to finish your side of it. The invite comes from a <code style="background:#fafaf6;padding:1px 5px;border-radius:3px;font-size:13px">checkr.com</code> address. Watch your inbox AND your spam folder, sometimes it lands there.</p>
        <p>When you open it, here's what you'll need handy:</p>
        <ul style="padding-left:20px;margin:10px 0">
          <li>Your SSN (used for identity verification only, Checkr doesn't share it)</li>
          <li>Date of birth</li>
          <li>Address history for the last 7 years</li>
          <li>A photo of your government ID (driver's license or passport)</li>
        </ul>
        <p>The whole thing takes about 10 to 15 minutes. Bark &amp; Stroll is covering the cost.</p>
        <p>If you don't see the invite within 48 hours, just reply to this email and let me know. I can resend it from the Checkr side.</p>
        <p style="margin-top:22px">Scott<br>Bark &amp; Stroll</p>
      </div>
    </div>
  `;

  await t.sendMail({
    from: '"Bark & Stroll" <' + process.env.GMAIL_USER + '>',
    to: applicant.email,
    subject: 'Bark & Stroll: an invite from Checkr is coming',
    html
  });
}

async function sendApplicantContractorAgreement(applicant) {
  const t = getTransporter();
  if (!t) throw new Error('[contractor-agreement] no transporter configured');

  const firstName = applicant.preferred_name || applicant.full_name.split(' ')[0];

  const html = `
    <div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:560px;margin:0 auto">
      <div style="background:#14613a;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
        <h2 style="margin:0;font-size:18px">Bark &amp; Stroll: contractor agreement</h2>
      </div>
      <div style="background:#fff;padding:20px;border:1px solid #e8e8e5;border-top:none;border-radius:0 0 10px 10px;color:#222;font-size:14px;line-height:1.55">
        <p>Hi ${escHtml(firstName)},</p>
        <p>Great news. Your background check came back clean, and the last step before your first walk is signing the contractor agreement. I've attached the full PDF to this email.</p>
        <p>Quick rundown of what's in it (the PDF is the binding version, this is just so you know what you're signing):</p>
        <ul style="padding-left:20px;margin:10px 0">
          <li><strong>1099 independent contractor.</strong> You set your own taxes aside, no W-2 withholding</li>
          <li><strong>$20 per completed 30-minute visit</strong>, paid regularly via Zelle/Venmo/direct deposit</li>
          <li>You accept or decline each assignment individually, with no obligation to take any specific job</li>
          <li>Standard conduct rules (humane handling, follow client instructions, secure keys)</li>
          <li><strong>You text Scott at 412-992-1480 at the start and end of every visit.</strong> You don't talk to clients directly, Scott handles all client communication</li>
          <li>Client info stays confidential, and a 12-month non-solicit on Bark &amp; Stroll clients</li>
          <li>You maintain your own auto insurance if you drive to assignments</li>
          <li>Pennsylvania law, either party can end the agreement with notice</li>
        </ul>
        <p>Please <strong>read the attached PDF in full</strong>. When you're ready to accept, just reply to this email with the exact phrase:</p>
        <p style="text-align:center;font-size:16px;font-weight:700;color:#14613a;background:#fafaf6;padding:12px;border-radius:6px;margin:14px 0">YES I AGREE</p>
        <p>That reply is your electronic signature under federal and Pennsylvania e-signature law. Once it's in, I'll get you added to the assignment system and we can start sending you jobs.</p>
        <p>If you have any questions before you reply, just respond to this email and ask. No pressure to rush.</p>
        <p style="margin-top:22px">Scott<br>Bridgeville Bark &amp; Stroll LLC</p>
      </div>
    </div>
  `;

  await t.sendMail({
    from: '"Bark & Stroll" <' + process.env.GMAIL_USER + '>',
    to: applicant.email,
    subject: 'Bark & Stroll: contractor agreement (please review and reply YES I AGREE)',
    html,
    attachments: [{
      filename: 'Bark-and-Stroll-Independent-Contractor-Agreement.pdf',
      path: '/var/www/barkstroll.com/legal/independent-contractor-agreement.pdf',
      contentType: 'application/pdf'
    }]
  });
}

module.exports = { sendAppointmentEmail, sendBatchAppointmentEmail, sendRequestNotification, sendContactFormNotification, sendApplicantNotification, sendApplicantFinalistDisclosure, sendApplicantCheckrHeadsUp, sendApplicantContractorAgreement, __setTransporter };
