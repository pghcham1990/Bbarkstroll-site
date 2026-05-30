const { test } = require('node:test');
const assert = require('node:assert');
const { computeTotals, groupByDay } = require('../lib/docgen-render');

test('computeTotals: rate x visit count', () => {
  const visits = [
    { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
    { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
    { date: '2026-07-17', time: '8:00 AM', label: 'Morning Visit' },
  ];
  const t = computeTotals(visits, 25);
  assert.strictEqual(t.subtotal, 75);
  assert.strictEqual(t.tax, 0);
  assert.strictEqual(t.total, 75);
});

test('groupByDay: groups visits per date, ordered, with day subtotal', () => {
  const visits = [
    { date: '2026-07-17', time: '9:00 PM', label: 'Evening Visit' },
    { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
    { date: '2026-07-17', time: '8:00 AM', label: 'Morning Visit' },
  ];
  const days = groupByDay(visits, 25);
  assert.strictEqual(days.length, 2);
  assert.strictEqual(days[0].date, '2026-07-16');
  assert.strictEqual(days[0].visits.length, 1);
  assert.strictEqual(days[0].dayTotal, 25);
  assert.strictEqual(days[1].date, '2026-07-17');
  assert.strictEqual(days[1].visits.length, 2);
  assert.strictEqual(days[1].dayTotal, 50);
  assert.strictEqual(days[1].visits[0].time, '8:00 AM');
});
