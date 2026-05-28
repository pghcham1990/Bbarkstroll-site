function firstName(fullName) {
  return (fullName || '').split(' ')[0];
}

function icsDate(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

// Escape a value for an ICS TEXT property per RFC 5545 §3.3.11:
// backslash, semicolon, and comma are escaped; real newlines become \n.
// Without this, an address like "123 Main St, Bridgeville, PA" splits the
// LOCATION into bogus structured values in strict parsers.
function icsEscape(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Build the VEVENT lines for a single appointment. Shared by both the single
// and batch generators so the event shape only lives in one place.
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
  const desc = descParts.join('\n'); // real newlines; icsEscape turns them into \n
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

  // List ALL attendees so RSVP replies update the organizer's calendar
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

module.exports = { generateICS, generateBatchICS, icsEscape };
