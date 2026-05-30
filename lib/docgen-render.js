'use strict';

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function money(n) { return '$' + (Number(n) || 0).toFixed(2); }

function computeTotals(visits, rate) {
  const subtotal = (visits || []).length * Number(rate || 0);
  return { subtotal, tax: 0, total: subtotal };
}

function timeRank(t) {
  const m = String(t || '').match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 9999;
  let h = parseInt(m[1], 10) % 12;
  if (/PM/i.test(m[3])) h += 12;
  return h * 60 + parseInt(m[2], 10);
}

function groupByDay(visits, rate) {
  const byDate = new Map();
  for (const v of visits || []) {
    if (!byDate.has(v.date)) byDate.set(v.date, []);
    byDate.get(v.date).push(v);
  }
  const days = [...byDate.entries()].map(([date, vs]) => {
    vs.sort((a, b) => timeRank(a.time) - timeRank(b.time));
    return { date, visits: vs, dayTotal: vs.length * Number(rate || 0) };
  });
  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

module.exports = { escHtml, money, computeTotals, groupByDay, timeRank };
