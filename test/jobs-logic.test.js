// test/jobs-logic.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  uniqueDates, fillStatus, hasConflict, buildWalkerSummary,
} = require('../lib/jobs-logic');

const CRIS_VISITS = [
  { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
  { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
  ...['17','18','19','20','21'].flatMap(d => [
    { date: `2026-07-${d}`, time: '8:00 AM', label: 'Morning Visit' },
    { date: `2026-07-${d}`, time: '3:00 PM', label: 'Afternoon Visit' },
    { date: `2026-07-${d}`, time: '9:00 PM', label: 'Evening Visit' },
  ]),
];

test('uniqueDates: distinct sorted dates from visits', () => {
  const dates = uniqueDates(CRIS_VISITS);
  assert.deepStrictEqual(dates, ['2026-07-16','2026-07-17','2026-07-18','2026-07-19','2026-07-20','2026-07-21']);
});

test('fillStatus: counts assigned vs total days', () => {
  const assignments = [
    { date: '2026-07-16', employee_id: 6 },
    { date: '2026-07-17', employee_id: null },
    { date: '2026-07-18', employee_id: 2 },
    { date: '2026-07-19', employee_id: 2 },
    { date: '2026-07-20', employee_id: null },
    { date: '2026-07-21', employee_id: null },
  ];
  const s = fillStatus(assignments);
  assert.strictEqual(s.total, 6);
  assert.strictEqual(s.filled, 3);
  assert.strictEqual(s.open, 3);
  assert.strictEqual(s.percent, 50);
  assert.strictEqual(s.complete, false);
});

test('fillStatus: 100% when all assigned', () => {
  const s = fillStatus([{ date: 'a', employee_id: 1 }, { date: 'b', employee_id: 2 }]);
  assert.strictEqual(s.percent, 100);
  assert.strictEqual(s.complete, true);
});

test('hasConflict: true when an existing appt falls on the same date', () => {
  // existing appts for the employee, as ISO start_times
  const existing = ['2026-07-17T19:00:00.000Z'];
  assert.strictEqual(hasConflict(existing, '2026-07-17'), true);
  assert.strictEqual(hasConflict(existing, '2026-07-18'), false);
  assert.strictEqual(hasConflict([], '2026-07-17'), false);
});

test('buildWalkerSummary: groups days by walker with their visit times', () => {
  const assignments = [
    { date: '2026-07-16', employee_id: 6, employee_name: 'Tiffany Condupa' },
    { date: '2026-07-18', employee_id: 2, employee_name: 'Scott Rocca' },
    { date: '2026-07-19', employee_id: 2, employee_name: 'Scott Rocca' },
  ];
  const summary = buildWalkerSummary(assignments, CRIS_VISITS, { customerName: "Cris O'Connor", dogNames: 'Maggie' });
  // one block per walker
  assert.strictEqual(summary.length, 2);
  const tiff = summary.find(w => w.employee_id === 6);
  assert.strictEqual(tiff.days.length, 1);
  assert.deepStrictEqual(tiff.days[0].times, ['3:00 PM', '9:00 PM']);
  const scott = summary.find(w => w.employee_id === 2);
  assert.strictEqual(scott.days.length, 2);
  assert.deepStrictEqual(scott.days[0].times, ['8:00 AM', '3:00 PM', '9:00 PM']);
});
