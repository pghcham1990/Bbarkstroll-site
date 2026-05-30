// backfill-cris-visits.js — one-shot. Cris's proposal (#BBS-2026-0716) predates visits_json.
const db = require('./lib/db');
const visits = [
  { date: '2026-07-16', time: '3:00 PM', label: 'Afternoon Visit' },
  { date: '2026-07-16', time: '9:00 PM', label: 'Evening Visit' },
];
for (const d of ['17','18','19','20','21']) {
  visits.push({ date: `2026-07-${d}`, time: '8:00 AM', label: 'Morning Visit' });
  visits.push({ date: `2026-07-${d}`, time: '3:00 PM', label: 'Afternoon Visit' });
  visits.push({ date: `2026-07-${d}`, time: '9:00 PM', label: 'Evening Visit' });
}
const row = db.prepare("SELECT id FROM documents WHERE customer_id=20 AND doc_number='#BBS-2026-0716'").get();
if (!row) { console.error('Cris proposal not found'); process.exit(1); }
db.prepare('UPDATE documents SET visits_json=? WHERE id=?').run(JSON.stringify(visits), row.id);
console.log('Backfilled doc', row.id, 'with', visits.length, 'visits');
