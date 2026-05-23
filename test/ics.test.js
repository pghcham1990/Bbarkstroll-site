const { test } = require('node:test');
const assert = require('node:assert');
const { generateICS, generateBatchICS, icsEscape } = require('../lib/ics');

const appt = {
  id: 42,
  employee_name: 'Walker Person',
  customer_name: 'Jane Client',
  dog_names: 'Rex',
  dog_names_with_breed: 'Rex (Lab)',
  dogs: [{ name: 'Rex' }],
  service_name: 'Dog Walking',
  start_time: '2026-06-01T15:00:00.000Z',
  end_time: '2026-06-01T15:30:00.000Z',
  customer_address: '123 Main St, Bridgeville, PA',
  notes: 'Gate code is 1,2,3. Leash by door.',
};

test('icsEscape escapes commas, semicolons, backslashes, newlines per RFC 5545', () => {
  assert.strictEqual(icsEscape('a, b; c\\d\ne'), 'a\\, b\\; c\\\\d\\ne');
});

test('generateICS escapes the comma-containing address in LOCATION', () => {
  const ics = generateICS(appt, ['client@example.com']);
  assert.ok(ics.includes('LOCATION:123 Main St\\, Bridgeville\\, PA'), ics);
  // raw unescaped comma form must NOT appear in the LOCATION line
  assert.ok(!ics.includes('LOCATION:123 Main St, Bridgeville, PA'));
});

test('generateICS produces one well-formed VEVENT with CRLF line breaks', () => {
  const ics = generateICS(appt, ['client@example.com']);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.trim().endsWith('END:VCALENDAR'));
});

test('generateBatchICS emits one VEVENT per appointment', () => {
  const ics = generateBatchICS([appt, { ...appt, id: 43 }], ['client@example.com']);
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
});
