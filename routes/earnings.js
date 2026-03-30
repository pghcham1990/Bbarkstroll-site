const express = require('express');
const router = express.Router();
const db = require('../lib/db');

// GET /admin/api/earnings?year=2026
// Returns earnings breakdown: house cut ($5/walk), each walker's take, and Scott's full keeps
router.get('/earnings', (req, res) => {
  const year = req.query.year || new Date().getFullYear();
  const startDate = `${year}-01-01`;
  const endDate = `${parseInt(year) + 1}-01-01`;

  const HOUSE_CUT = 5;

  // Get all appointments for the year (completed + scheduled)
  const appts = db.prepare(`
    SELECT a.id, a.start_time, a.status, a.employee_id,
           e.first_name as walker_first, e.last_name as walker_last,
           c.rate as customer_rate
    FROM appointments a
    JOIN employees e ON e.id = a.employee_id
    JOIN customers c ON c.id = a.customer_id
    WHERE a.start_time >= ? AND a.start_time < ?
      AND a.status IN ('completed', 'scheduled')
    ORDER BY a.start_time
  `).all(startDate, endDate);

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
      walkerMap[walkerKey] = { name: walkerKey, walks_completed: 0, walks_scheduled: 0, earned_completed: 0, earned_all: 0, isScott: a.employee_id === scottId };
    }

    const isScott = a.employee_id === scottId;
    // Scott keeps full rate; other walkers get rate - $5
    const walkerEarning = isScott ? rate : Math.max(rate - HOUSE_CUT, 0);
    const houseCut = HOUSE_CUT;

    if (a.status === 'completed') {
      walkerMap[walkerKey].walks_completed++;
      walkerMap[walkerKey].earned_completed += walkerEarning;
      houseTotalCompleted += houseCut;
    }
    walkerMap[walkerKey].walks_scheduled++;
    walkerMap[walkerKey].earned_all += walkerEarning;
    houseTotalAll += houseCut;
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
