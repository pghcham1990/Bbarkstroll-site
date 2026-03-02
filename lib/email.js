const nodemailer = require('nodemailer');
const { generateICS } = require('./ics');

let transporter = null;

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
    text: 'BBS: ' + firstName(appt.employee_name) + ' & ' + appt.dog_name,
    dates: start + '/' + end,
    details: 'Service: ' + appt.service_name + '\nDog: ' + appt.dog_name + (appt.dog_breed ? ' (' + appt.dog_breed + ')' : '') + (appt.notes ? '\nNotes: ' + appt.notes : ''),
    location: appt.customer_address || '',
  });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}

function icalUrl(appt) {
  return 'https://barkstroll.com/admin/cal/' + appt.id + '.ics';
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
          ${rows.map(r => `<tr><td style="padding:8px 0;color:#888;width:100px">${r[0]}</td><td style="padding:8px 0;${r[2] || ''}">${r[1]}</td></tr>`).join('\n          ')}
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
  if (!t) throw new Error('Email not configured — set GMAIL_APP_PASSWORD in .env');

  const startDate = new Date(appt.start_time);
  const dateStr = startDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const timeStr = startDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const endStr = new Date(appt.end_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const subject = `BBS: ${firstName(appt.employee_name)} & ${appt.dog_name} — ${dateStr} at ${timeStr}`;
  const from = `"Bark & Stroll" <${process.env.GMAIL_USER}>`;

  const sends = [];

  // --- Customer email: only THEY are listed as attendee (no walker email visible) ---
  if (appt.customer_email) {
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} — ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      ['Dog', `${appt.dog_name}${appt.dog_breed ? ' (' + appt.dog_breed + ')' : ''}`],
      ['Walker', firstName(appt.employee_name)],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    sends.push(sendOne(t, appt.customer_email, from, subject, rows, appt, [appt.customer_email]));
  }

  // --- Employee email: only THEY are listed as attendee (no customer email visible) ---
  if (appt.employee_email) {
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} — ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      ['Dog', `${appt.dog_name}${appt.dog_breed ? ' (' + appt.dog_breed + ')' : ''}`],
      ['Client', firstName(appt.customer_name)],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    sends.push(sendOne(t, appt.employee_email, from, subject, rows, appt, [appt.employee_email]));
  }

  // --- Owner email: BOTH attendees listed so you can see RSVP status from each ---
  const ownerEmail = process.env.GMAIL_USER;
  if (ownerEmail) {
    const allAttendees = [appt.customer_email, appt.employee_email].filter(Boolean);
    const rows = [
      ['Date', dateStr, 'font-weight:600'],
      ['Time', `${timeStr} — ${endStr}`, 'font-weight:600'],
      ['Service', appt.service_name],
      ['Dog', `${appt.dog_name}${appt.dog_breed ? ' (' + appt.dog_breed + ')' : ''}`],
      ['Client', appt.customer_name],
      ['Walker', appt.employee_name],
    ];
    if (appt.customer_address) rows.push(['Address', appt.customer_address]);
    if (appt.notes) rows.push(['Notes', appt.notes]);
    sends.push(sendOne(t, ownerEmail, from, subject, rows, appt, allAttendees));
  }

  if (!sends.length) throw new Error('No email recipients — customer and employee have no email addresses');

  await Promise.all(sends);
}

module.exports = { sendAppointmentEmail };
