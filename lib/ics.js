function firstName(fullName) {
  return (fullName || '').split(' ')[0];
}

function generateICS(appt, attendeeEmails) {
  const uid = 'appt-' + appt.id + '@barkstroll.com';
  const now = icsDate(new Date());
  const start = icsDate(new Date(appt.start_time));
  const end = icsDate(new Date(appt.end_time));
  const summary = 'BBS: ' + firstName(appt.employee_name) + ' & ' + appt.dog_name;
  const desc = [
    'Service: ' + appt.service_name,
    'Dog: ' + appt.dog_name + (appt.dog_breed ? ' (' + appt.dog_breed + ')' : ''),
    appt.notes ? 'Notes: ' + appt.notes : ''
  ].filter(Boolean).join('\\n');
  const location = appt.customer_address || '';
  const organizer = process.env.GMAIL_USER || 'scott.rocca.pa@gmail.com';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bark & Stroll//Appointments//EN',
    'METHOD:REQUEST',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    'UID:' + uid,
    'DTSTAMP:' + now,
    'DTSTART:' + start,
    'DTEND:' + end,
    'SUMMARY:' + summary,
    'DESCRIPTION:' + desc,
    location ? 'LOCATION:' + location : '',
    'ORGANIZER;CN=Bark & Stroll:mailto:' + organizer,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
  ];

  // List ALL attendees so RSVP replies update the organizer's calendar
  const emails = Array.isArray(attendeeEmails) ? attendeeEmails : [attendeeEmails];
  for (const email of emails) {
    if (email) {
      lines.push('ATTENDEE;RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:' + email);
    }
  }

  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.filter(Boolean).join('\r\n');
}

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

module.exports = { generateICS };
