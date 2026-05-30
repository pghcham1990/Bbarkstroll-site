'use strict';

// Distinct visit dates, ascending. visits = [{date,time,label}].
function uniqueDates(visits) {
  return [...new Set((visits || []).map(v => v.date))].sort((a, b) => a.localeCompare(b));
}

// The times for one date, in chronological order (reuses docgen-render's timeRank).
const { timeRank } = require('./docgen-render');
function timesForDate(visits, date) {
  return (visits || [])
    .filter(v => v.date === date)
    .sort((a, b) => timeRank(a.time) - timeRank(b.time))
    .map(v => v.time);
}

// assignments = [{date, employee_id|null}]. Day is filled when employee_id set.
function fillStatus(assignments) {
  const total = (assignments || []).length;
  const filled = (assignments || []).filter(a => a.employee_id != null).length;
  const open = total - filled;
  const percent = total === 0 ? 0 : Math.round((filled / total) * 100);
  return { total, filled, open, percent, complete: total > 0 && open === 0 };
}

// existingStarts = array of ISO start_time strings for ONE employee's other appts.
// Conflict = any existing appt on the same calendar date (YYYY-MM-DD prefix).
function hasConflict(existingStarts, date) {
  return (existingStarts || []).some(s => String(s).slice(0, 10) === date);
}

// Group assigned days by walker, attaching each day's visit times. Open days excluded.
function buildWalkerSummary(assignments, visits, meta = {}) {
  const byWalker = new Map();
  for (const a of assignments || []) {
    if (a.employee_id == null) continue;
    if (!byWalker.has(a.employee_id)) {
      byWalker.set(a.employee_id, {
        employee_id: a.employee_id,
        employee_name: a.employee_name || '',
        days: [],
      });
    }
    byWalker.get(a.employee_id).days.push({ date: a.date, times: timesForDate(visits, a.date) });
  }
  const out = [...byWalker.values()];
  for (const w of out) w.days.sort((x, y) => x.date.localeCompare(y.date));
  out.sort((a, b) => a.employee_id - b.employee_id);
  out.customerName = meta.customerName;  // harmless metadata for callers
  out.dogNames = meta.dogNames;
  return out;
}

module.exports = { uniqueDates, timesForDate, fillStatus, hasConflict, buildWalkerSummary };
