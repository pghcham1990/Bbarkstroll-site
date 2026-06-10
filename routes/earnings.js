const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { computePayout, HOUSE_CUT } = require('../lib/payout');

// GET /admin/api/earnings?year=2026
// Returns earnings breakdown: house cut ($5/walk), each walker's take, and Scott's full keeps
router.get('/earnings', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const startDate = `${year}-01-01`;
  const endDate = `${parseInt(year) + 1}-01-01`;

  // Get all appointments for the year (completed + scheduled)
  const appts = db.prepare(`
    SELECT a.id, a.start_time, a.end_time, a.status, a.employee_id,
           e.first_name as walker_first, e.last_name as walker_last, e.crew_type,
           c.rate as customer_rate
    FROM appointments a
    JOIN employees e ON e.id = a.employee_id
    JOIN customers c ON c.id = a.customer_id
    LEFT JOIN services s ON s.id = a.service_id
    WHERE a.start_time >= ? AND a.start_time < ?
      AND a.status IN ('completed', 'scheduled')
      AND COALESCE(s.name, '') <> 'Meet & Greet'
    ORDER BY a.start_time
  `).all(startDate, endDate);

  // Eastern Monday-of-week key for a timestamp, e.g. "2026-05-18". Used to count
  // the distinct weeks a walker actually worked, so the hours/week average reflects
  // a typical working week rather than being diluted across idle calendar weeks.
  function weekKey(iso) {
    const et = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const dow = (et.getDay() + 6) % 7; // 0 = Monday
    et.setDate(et.getDate() - dow);
    return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
  }

  // Scott's employee id
  const scott = db.prepare("SELECT id FROM employees WHERE first_name = 'Scott' AND last_name = 'Rocca'").get();
  const scottId = scott ? scott.id : null;

  const walkerMap = {};
  let houseTotalCompleted = 0;
  let houseTotalAll = 0;

  for (const a of appts) {
    const rate = a.customer_rate || 0;
    const walkerKey = a.walker_first;
    if (!walkerMap[walkerKey]) {
      walkerMap[walkerKey] = { name: walkerKey, walks_completed: 0, walks_scheduled: 0, earned_completed: 0, earned_all: 0, hours_completed: 0, _weeks: new Set(), isScott: a.employee_id === scottId };
    }

    const isScott = a.employee_id === scottId;
    const { walkerEarning, houseCut } = computePayout({ rate, isScott, crewType: a.crew_type });

    if (a.status === 'completed') {
      walkerMap[walkerKey].walks_completed++;
      walkerMap[walkerKey].earned_completed += walkerEarning;
      // Actual visit duration in hours (falls back to 0.5h if end_time missing).
      const durHrs = a.end_time ? (new Date(a.end_time) - new Date(a.start_time)) / 3600000 : 0.5;
      walkerMap[walkerKey].hours_completed += durHrs;
      walkerMap[walkerKey]._weeks.add(weekKey(a.start_time));
      houseTotalCompleted += houseCut;
    }
    walkerMap[walkerKey].walks_scheduled++;
    walkerMap[walkerKey].earned_all += walkerEarning;
    houseTotalAll += houseCut;
  }

  // Average hours per week per walker, over the distinct weeks they actually worked.
  for (const w of Object.values(walkerMap)) {
    const activeWeeks = Math.max(1, w._weeks.size);
    w.weeks_active = w._weeks.size;
    w.avg_hours_per_week = w.hours_completed / activeWeeks;
    delete w._weeks;
  }

  res.json({
    year: parseInt(year),
    house_cut_per_walk: HOUSE_CUT,
    house_total_completed: houseTotalCompleted,
    house_total_projected: houseTotalAll,
    total_walks_completed: appts.filter(a => a.status === 'completed').length,
    total_walks_all: appts.length,
    walkers: Object.values(walkerMap)
  });
});

module.exports = router;
