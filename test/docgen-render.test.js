const { test } = require('node:test');
const assert = require('node:assert');
const { computeTotals, groupByDay, layoutRows } = require('../lib/docgen-render');

function mkVisits() {
  const v = [
    { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
    { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
  ];
  for (const d of ['17','18','19','20','21']) {
    v.push({ date: `2026-07-${d}`, time: '8:00 AM', label: 'Morning Visit' });
    v.push({ date: `2026-07-${d}`, time: '3:00 PM', label: 'Afternoon Visit' });
    v.push({ date: `2026-07-${d}`, time: '9:00 PM', label: 'Evening Visit' });
  }
  return v;
}

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

test('layoutRows: short job stays per-day (one row per day)', () => {
  const rows = layoutRows(groupByDay(mkVisits(), 25), 25);
  assert.strictEqual(rows.length, 6);
  assert.strictEqual(rows[0].kind, 'day');
  assert.strictEqual(rows[0].amount, 50);
  assert.strictEqual(rows[1].amount, 75);
});

test('layoutRows: long job collapses identical consecutive days', () => {
  const v = [];
  for (let d = 1; d <= 20; d++) {
    const dd = String(d).padStart(2, '0');
    for (const t of ['8:00 AM','3:00 PM','9:00 PM']) v.push({ date: `2026-08-${dd}`, time: t, label: 'Visit' });
  }
  const rows = layoutRows(groupByDay(v, 25), 25, { collapseThresholdDays: 10 });
  assert.ok(rows.length < 20, 'should collapse');
  const range = rows.find(r => r.kind === 'range');
  assert.ok(range, 'has a range row');
  assert.strictEqual(range.amount, 20 * 3 * 25);
});
