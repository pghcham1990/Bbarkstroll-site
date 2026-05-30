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

function daySig(day) { return day.visits.map(v => v.time).join('|'); }

function layoutRows(days, rate, opts = {}) {
  const threshold = opts.collapseThresholdDays || 10;
  const perDayRow = (d) => ({
    kind: 'day',
    date: d.date,
    times: d.visits.map(v => v.time),
    labels: d.visits.map(v => v.label).filter(Boolean),
    count: d.visits.length,
    amount: d.dayTotal,
  });
  if (days.length <= threshold) return days.map(perDayRow);

  const rows = [];
  let i = 0;
  while (i < days.length) {
    const sig = daySig(days[i]);
    let j = i + 1;
    while (j < days.length && daySig(days[j]) === sig) j++;
    const run = days.slice(i, j);
    if (run.length >= 3) {
      const visitsPerDay = run[0].visits.length;
      rows.push({
        kind: 'range',
        startDate: run[0].date,
        endDate: run[run.length - 1].date,
        dayCount: run.length,
        times: run[0].visits.map(v => v.time),
        visitsPerDay,
        amount: run.reduce((s, d) => s + d.dayTotal, 0),
      });
    } else {
      for (const d of run) rows.push(perDayRow(d));
    }
    i = j;
  }
  return rows;
}

const COMPACT_CSS = `
  :root{--green:#3a5c3a;--green-pale:#eef4ee;--cream:#faf8f4;--border:#e2ddd5;--text-dark:#1e2b1e;--text-mid:#4a5a4a;--text-light:#8a9e8a;--accent:#c8a84b;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'DM Sans',sans-serif;background:var(--cream);color:var(--text-dark);padding:24px;}
  .inv{background:#fff;max-width:780px;margin:0 auto;border:1px solid var(--border);border-radius:5px;overflow:hidden;box-shadow:0 2px 16px rgba(58,92,58,.10);}
  .hd{background:var(--green);color:#fff;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;}
  .hd .b{display:flex;align-items:center;gap:9px;}
  .hd .logo{width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.14);border:1.5px solid rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:15px;}
  .hd h1{font-family:'Playfair Display',serif;font-size:16px;margin:0;line-height:1;}
  .hd .bp{font-size:8px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.55);margin:2px 0 0;}
  .hd .meta{text-align:right;}
  .hd .num{font-family:'Playfair Display',serif;font-size:15px;color:var(--accent);}
  .hd .badge{display:inline-block;background:var(--accent);color:#1a1a1a;font-size:8px;font-weight:600;letter-spacing:.7px;text-transform:uppercase;padding:3px 8px;border-radius:11px;margin-top:3px;}
  .bd{padding:18px 20px;}
  .billing{display:flex;justify-content:space-between;gap:24px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);}
  .billing h3{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-light);margin:0 0 4px;}
  .billing .cn{font-family:'Playfair Display',serif;font-size:15px;margin:0 0 2px;}
  .billing p{font-size:11px;color:var(--text-mid);line-height:1.5;margin:0;}
  .pet{display:inline-block;background:var(--green-pale);border:1px solid #c8dcc8;color:var(--green);font-size:10px;padding:2px 9px;border-radius:11px;margin-top:5px;}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;}
  thead tr{background:var(--green-pale);}
  th{font-size:8px;letter-spacing:1px;text-transform:uppercase;color:var(--green);padding:7px 11px;text-align:left;}
  th:last-child{text-align:right;}
  td{padding:9px 11px;border-bottom:1px solid #f2ede6;vertical-align:top;}
  .sn{font-size:12px;font-weight:500;}
  .sd{font-size:10px;color:var(--text-light);margin-top:1px;}
  .dt{font-size:11px;color:var(--text-mid);}
  .pr{text-align:right;font-weight:500;font-size:12px;white-space:nowrap;}
  .foot{display:flex;justify-content:space-between;gap:22px;align-items:flex-start;}
  .notes{flex:1;}
  .notes h3{font-size:8px;letter-spacing:1.5px;text-transform:uppercase;color:var(--text-light);margin:0 0 5px;}
  .notes p{font-size:10.5px;color:var(--text-mid);line-height:1.55;margin:0;}
  .pay{margin-top:10px;font-size:10px;color:var(--text-light);} .pay b{color:var(--text-dark);}
  .totals{width:190px;flex-shrink:0;}
  .trow{display:flex;justify-content:space-between;padding:5px 0;font-size:11px;color:var(--text-mid);border-bottom:1px solid var(--border);}
  .ttot{background:var(--green);color:#fff;padding:9px 13px;border-radius:4px;margin-top:7px;display:flex;justify-content:space-between;align-items:center;}
  .ttot .l{font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:rgba(255,255,255,.65);}
  .ttot .v{font-family:'Playfair Display',serif;font-size:17px;color:var(--accent);}
  @media print{body{background:#fff;padding:0;}.inv{box-shadow:none;border:none;max-width:100%;}}
`;

const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function fmtDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]} ${MON[m - 1]} ${d}`;
}

const STANDARD_NOTE = "We'll keep your pet's routine consistent across every visit. A small, trusted Bark & Stroll team supports the schedule so coverage stays reliable.";

function renderDoc({ docType, docNumber, client, dogs = [], visits = [], rate = 25, customNote, collapseThresholdDays }) {
  const isProposal = docType === 'proposal';
  const days = groupByDay(visits, rate);
  const rows = layoutRows(days, rate, { collapseThresholdDays });
  const { subtotal, tax, total } = computeTotals(visits, rate);

  const dateRange = days.length
    ? (days.length === 1 ? fmtDate(days[0].date) : `${fmtDate(days[0].date)} – ${fmtDate(days[days.length - 1].date)}`)
    : '';

  const petTags = dogs.map(d => `<span class="pet">🐶 ${escHtml(d.name)}</span>`).join(' ');

  const hasRange = rows.some(r => r.kind === 'range');
  const rowHtml = rows.map(r => {
    if (r.kind === 'range') {
      return `<tr><td><div class="sn">Daily Care · ${r.visitsPerDay} visit${r.visitsPerDay>1?'s':''}/day</div><div class="sd">${escHtml(r.times.join(', '))}</div></td>`
        + `<td class="dt">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}<br><span style="color:#b5bcc4">(${r.dayCount} days)</span></td>`
        + `<td class="pr">${money(r.amount)}</td></tr>`;
    }
    const labelText = (r.labels && r.labels.length) ? ' · ' + escHtml(r.labels.join(', ')) : '';
    return `<tr><td><div class="sn">${fmtDate(r.date)}</div><div class="sd">${r.count} visit${r.count>1?'s':''}${labelText}</div></td>`
      + `<td class="dt">${escHtml(r.times.join(' · '))}</td>`
      + `<td class="pr">${money(r.amount)}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bark & Stroll, ${escHtml(isProposal ? 'Proposal' : 'Invoice')}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>${COMPACT_CSS}</style></head><body>
<div class="inv">
  <div class="hd">
    <div class="b"><div class="logo">🐾</div><div><h1>Bark &amp; Stroll</h1><div class="bp">Professional Pet Care · Bridgeville, PA</div></div></div>
    <div class="meta"><div class="num">${escHtml(docNumber || '')}</div><div class="badge">${isProposal ? 'Proposed Services' : 'Payment Due Before Service'}</div></div>
  </div>
  <div class="bd">
    <div class="billing">
      <div><h3>${isProposal ? 'Prepared For' : 'Billed To'}</h3>
        <div class="cn">${escHtml(client.first_name)} ${escHtml(client.last_name)}</div>
        <p>${escHtml(client.address || 'Bridgeville, PA')}${client.phone ? ' · ' + escHtml(client.phone) : ''}</p>
        ${petTags}</div>
      <div style="text-align:right;"><h3>Service Period</h3><p><b>${escHtml(dateRange)}</b></p><p>${money(rate)} / visit</p></div>
    </div>
    <table>
      <thead><tr><th style="width:42%">Service</th><th>${hasRange ? 'Dates' : 'Times'}</th><th>Amount</th></tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
    <div class="foot">
      <div class="notes"><h3>Care Notes</h3><p>${escHtml(customNote || STANDARD_NOTE)}</p>
        <div class="pay"><b>Payment:</b> Venmo @Scott-Rocca · note ${escHtml(docNumber || '')} · due before service begins.</div></div>
      <div class="totals">
        <div class="trow"><span>Subtotal</span><span>${money(subtotal)}</span></div>
        <div class="trow"><span>Tax</span><span>${money(tax)}</span></div>
        <div class="ttot"><span class="l">Total ${isProposal ? 'Estimated' : 'Due'}</span><span class="v">${money(total)}</span></div>
      </div>
    </div>
  </div>
</div></body></html>`;
}

module.exports = { escHtml, money, computeTotals, groupByDay, timeRank, layoutRows, renderDoc, fmtDate, STANDARD_NOTE };
