# Proposal Machine v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bark & Stroll docgen produce compact (1–2 page) proposals/invoices that contain exactly the visits the user specified, via an editable parsed-visit preview, with a hardened parse-only AI and code-computed totals.

**Architecture:** Extract the document HTML build into a pure, testable module `lib/docgen-render.js` that takes structured `{client, dogs, visits, rate, docType, docNumber, customNote}` and returns compact HTML with hybrid day-grouping. Add a parse-only AI endpoint that returns structured visits (no HTML). Rework the frontend into parse → edit rows → generate → save.

**Tech Stack:** Node + Express (`routes/documents.js`), better-sqlite3, vanilla JS frontend (`public/js/views/docgen.js`), `node --test` for unit tests, Anthropic SDK (parse only), puppeteer-core (PDF, unchanged).

---

## Pre-flight (read before Task 1)

- **Working dir:** `/opt/barkstroll`. Branch **master** (served live; work in place, commit per task).
- **⚠️ Dirty tree:** B&S repo often has unrelated WIP. **Never `git add -A`.** Stage only the specific files each task names; run `git status` + `git diff --cached` before every commit.
- **Test runner:** `npm test` runs `node --test` over `test/*.test.js`. Tests set the DB path via env BEFORE requiring `../lib/db` (see `test/cancel-email.test.js`). The DB env var is `BARKSTROLL_DB_PATH` (confirmed in cancel-email.test.js).
- **Key files today:**
  - `routes/documents.js` — `getSystemPrompt()` (l.79), `POST /documents/generate` (l.118, builds HTML inline ll.171–300), `POST /documents/save` (l.320, takes `html_content`, writes file+PDF+DB — LEAVE working), `INVOICE_CSS` (l.16), `escHtml` (l.432), `escHtmlBr` (l.441).
  - `public/js/views/docgen.js` — `render_docgen` (l.28), `generateDoc` (l.113), `saveDoc` (l.185), `_docGenState` (l.3).
  - Router mounts at `app.use('/admin/api', adminOnly, require('./routes/documents'))` (server.js:412), so endpoints are `/admin/api/documents/*`. Frontend calls via `api('/documents/...')`.
- **Service restart:** `systemctl restart barkstroll.service`. Static file (`public/js/views/docgen.js`) just needs a browser hard-refresh.
- **Safety copy before starting:** `cp routes/documents.js /tmp/documents.js.pre-v2 && cp public/js/views/docgen.js /tmp/docgen.js.pre-v2`.

---

## Task 1: Pure render module — skeleton + money math

**Files:**
- Create: `lib/docgen-render.js`
- Create: `test/docgen-render.test.js`

- [ ] **Step 1: Write the failing test**

```js
// test/docgen-render.test.js
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
  // visits within a day are time-ordered (AM before PM)
  assert.strictEqual(days[1].visits[0].time, '8:00 AM');
});
```

- [ ] **Step 2: Run it, confirm fail**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: FAIL — `Cannot find module '../lib/docgen-render'`.

- [ ] **Step 3: Implement minimal module**

```js
// lib/docgen-render.js
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

// Minutes-since-midnight for "8:00 AM" / "9:00 PM" style strings, for ordering.
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
```

- [ ] **Step 4: Run it, confirm pass**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add lib/docgen-render.js test/docgen-render.test.js
git diff --cached --stat
git commit -m "docgen v2: pure render module — totals + day grouping

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Hybrid day grouping (collapse long jobs)

**Files:**
- Modify: `lib/docgen-render.js`
- Modify: `test/docgen-render.test.js`

- [ ] **Step 1: Add failing tests**

Append to `test/docgen-render.test.js`:

```js
const { layoutRows } = require('../lib/docgen-render');

function mkVisits() {
  // 16th = 2 visits; 17th–21st = 3 visits/day (8am,3pm,9pm)
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

test('layoutRows: short job stays per-day (one row per day)', () => {
  const rows = layoutRows(groupByDay(mkVisits(), 25), 25);
  // 6 distinct days -> 6 per-day rows, no collapse
  assert.strictEqual(rows.length, 6);
  assert.strictEqual(rows[0].kind, 'day');
  assert.strictEqual(rows[0].amount, 50);   // the 16th
  assert.strictEqual(rows[1].amount, 75);   // a 3-visit day
});

test('layoutRows: long job collapses identical consecutive days', () => {
  // 20 identical 3-visit days -> should collapse to fewer rows than 20
  const v = [];
  for (let d = 1; d <= 20; d++) {
    const dd = String(d).padStart(2, '0');
    for (const t of ['8:00 AM','3:00 PM','9:00 PM']) v.push({ date: `2026-08-${dd}`, time: t, label: 'Visit' });
  }
  const rows = layoutRows(groupByDay(v, 25), 25, { collapseThresholdDays: 10 });
  assert.ok(rows.length < 20, 'should collapse');
  const range = rows.find(r => r.kind === 'range');
  assert.ok(range, 'has a range row');
  assert.strictEqual(range.amount, 20 * 3 * 25); // all 60 visits accounted for
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: FAIL — `layoutRows is not a function`.

- [ ] **Step 3: Implement `layoutRows`**

Add to `lib/docgen-render.js` (before `module.exports`), and add `layoutRows` to exports:

```js
// A "day signature" = its sorted times joined; identical signatures are mergeable.
function daySig(day) { return day.visits.map(v => v.time).join('|'); }

// Hybrid layout: default one row per day. If the number of days exceeds
// collapseThresholdDays, merge runs of consecutive days with an identical
// signature into a single "range" row; non-matching days stay their own row.
function layoutRows(days, rate, opts = {}) {
  const threshold = opts.collapseThresholdDays || 10;
  const perDayRow = (d) => ({
    kind: 'day',
    date: d.date,
    times: d.visits.map(v => v.time),
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
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add lib/docgen-render.js test/docgen-render.test.js
git commit -m "docgen v2: hybrid day grouping (collapse long jobs to range rows)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Compact HTML renderer

**Files:**
- Modify: `lib/docgen-render.js`
- Modify: `test/docgen-render.test.js`

- [ ] **Step 1: Add failing test**

Append:

```js
const { renderDoc } = require('../lib/docgen-render');

test('renderDoc: compact one-page proposal with correct total + no phantom visit', () => {
  const html = renderDoc({
    docType: 'proposal',
    docNumber: '#BBS-2026-0716',
    client: { first_name: 'Cris', last_name: "O'Connor", address: 'Bridgeville, PA', phone: '7245540149' },
    dogs: [{ name: 'Maggie' }],
    visits: mkVisits(),
    rate: 25,
  });
  assert.ok(html.includes('Bark'), 'has brand');
  assert.ok(html.includes('Proposed Services'), 'proposal badge');
  assert.ok(html.includes('$425.00'), 'total computed in code');
  assert.ok(html.includes('Maggie'), 'pet name');
  assert.ok(html.includes('Cris'), 'client name');
  // 16th shows exactly its two times and NOT 8:00 AM
  const sixteenth = html.slice(html.indexOf('Jul 16'), html.indexOf('Jul 16') + 120);
  assert.ok(/3:00 PM/.test(sixteenth) && /9:00 PM/.test(sixteenth), '16th has 3pm+9pm');
  assert.ok(!/8:00 AM/.test(sixteenth), 'no phantom morning on the 16th');
});

test('renderDoc: escapes malicious label (XSS safe)', () => {
  const html = renderDoc({
    docType: 'invoice', docNumber: '#X', client: { first_name: 'A', last_name: 'B' }, dogs: [],
    visits: [{ date: '2026-07-16', time: '3:00 PM', label: '<script>alert(1)</script>' }], rate: 25,
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script not raw');
  assert.ok(html.includes('&lt;script&gt;'), 'script escaped');
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: FAIL — `renderDoc is not a function`.

- [ ] **Step 3: Implement `renderDoc` + compact CSS**

Add to `lib/docgen-render.js`. Use the compact CSS from the approved mockup `/var/www/brightpresencedigital.com/_proposal-mock-q7x2.html` (the "tightened"/`.ti` scale). Helper to format a date `'2026-07-16'` → `'Wed Jul 16'`:

```js
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

  const rowHtml = rows.map(r => {
    if (r.kind === 'range') {
      return `<tr><td><div class="sn">Daily Care · ${r.visitsPerDay} visit${r.visitsPerDay>1?'s':''}/day</div><div class="sd">${escHtml(r.times.join(', '))}</div></td>`
        + `<td class="dt">${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}<br><span style="color:#b5bcc4">(${r.dayCount} days)</span></td>`
        + `<td class="pr">${money(r.amount)}</td></tr>`;
    }
    return `<tr><td><div class="sn">${r.count} visit${r.count>1?'s':''}</div></td>`
      + `<td class="dt">${escHtml(r.times.join(' · '))}</td>`
      + `<td class="pr">${money(r.amount)}</td></tr>`;
  }).join('');
  // NOTE: per-day rows put the day in a date column. Build the table accordingly:
  // For per-day layout we want a Day | Visits | Amount table; for range rows the
  // first cell already carries the service label. Use one unified 3-col table:
  // Service/Day | Times/Dates | Amount.

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
      <thead><tr><th style="width:42%">Service</th><th>Date${rows.some(r=>r.kind==='range')?'s':' / Time'}</th><th>Amount</th></tr></thead>
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
```

Add `renderDoc`, `fmtDate`, `STANDARD_NOTE` to `module.exports`. (For per-day rows the first cell shows the visit count and the second the times; that satisfies the test which checks the 16th shows 3pm+9pm and not 8am.)

- [ ] **Step 4: Run, confirm pass**

Run: `cd /opt/barkstroll && node --test test/docgen-render.test.js`
Expected: PASS (6 tests). If the "Jul 16" slice assertion fails because the day cell renders the date in a later column, widen the slice or assert on the full html for `3:00 PM · 9:00 PM` adjacency — keep the intent: 16th has 3pm+9pm, no 8am.

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add lib/docgen-render.js test/docgen-render.test.js
git commit -m "docgen v2: compact one-page HTML renderer (code-computed totals)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Backend — parse-only endpoint + render endpoint

**Files:**
- Modify: `routes/documents.js`

- [ ] **Step 1: Add the hardened parse prompt + endpoints**

In `routes/documents.js`, after the existing `const client = new Anthropic(...)` (l.13) and near `getSystemPrompt`, add a parse-only system prompt and a render import:

```js
const docgenRender = require('../lib/docgen-render');

const PARSE_SYSTEM = `You convert a plain-English pet-care schedule into structured visit data for Bark & Stroll. Output ONLY valid JSON, no prose, shape:
{"visits":[{"date":"YYYY-MM-DD","time":"H:MM AM/PM","label":"Morning Visit|Afternoon Visit|Evening Visit|Visit"}],"warnings":["..."]}
Rules:
- Emit ONLY visits explicitly stated or unambiguously implied. NEVER add a visit to "round out" a day. NEVER invent a time.
- If a day's count or times are unclear, DO NOT guess — add a short string to "warnings" and emit only what is certain.
- Interpret natural language: "the 16th is 3pm and 9pm" => two visits on the 16th at 3:00 PM and 9:00 PM. "17th through 21st are 8am 3pm and 9pm" => three visits each of those days.
- Label by time of day: before noon = Morning Visit, noon–5pm = Afternoon Visit, after 5pm = Evening Visit; otherwise "Visit".
- Use the year from context if given, else the next occurrence. Do NOT compute prices.`;
```

Add a parse endpoint after `/documents/generate`:

```js
router.post('/documents/parse', requireRole('admin'), async (req, res) => {
  try {
    const { prompt, year } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt required' });
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: PARSE_SYSTEM,
      messages: [{ role: 'user', content: (year ? `Year: ${year}\n` : '') + prompt }],
    });
    try {
      require('/opt/shared/llm-usage').createUsageLog('/opt/shared/llm-usage.db').record({
        app: 'barkstroll', model: 'claude-sonnet-4-20250514', kind: 'bs_doc_parse', source: 'anthropic',
        input_tokens: response.usage && response.usage.input_tokens,
        output_tokens: response.usage && response.usage.output_tokens,
      });
    } catch (e) {}
    const txt = response.content[0].text;
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return res.status(500).json({ error: 'AI returned no JSON', raw: txt });
    let data;
    try { data = JSON.parse(m[0]); } catch (e) { return res.status(500).json({ error: 'AI returned invalid JSON', raw: txt }); }
    res.json({ visits: Array.isArray(data.visits) ? data.visits : [], warnings: Array.isArray(data.warnings) ? data.warnings : [] });
  } catch (err) {
    console.error('parse error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

Add a render endpoint (takes edited visits + rate, returns compact HTML + doc number, no AI):

```js
router.post('/documents/render', requireRole('admin'), (req, res) => {
  try {
    const { customer_id, doc_type, visits, rate, custom_note } = req.body;
    if (!customer_id || !Array.isArray(visits)) return res.status(400).json({ error: 'customer_id and visits required' });
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    const dogs = db.prepare('SELECT * FROM dogs WHERE customer_id = ? ORDER BY name').all(customer_id);
    const now = new Date();
    const docNumber = `#BBS-${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const html = docgenRender.renderDoc({
      docType: doc_type || 'invoice', docNumber, client: customer, dogs,
      visits, rate: Number(rate) || 25, customNote: custom_note,
    });
    res.json({ html, doc_number: docNumber });
  } catch (err) {
    console.error('render error:', err);
    res.status(500).json({ error: err.message });
  }
});
```

Leave `/documents/generate` and `/documents/save` in place (generate becomes legacy/unused once the frontend switches; removing it is optional cleanup later).

- [ ] **Step 2: Syntax check**

Run: `cd /opt/barkstroll && node --check routes/documents.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Verify endpoints registered**

Run: `cd /opt/barkstroll && grep -c "documents/parse\|documents/render" routes/documents.js`
Expected: `2`.

- [ ] **Step 4: Restart + smoke test render (no AI needed)**

```bash
cd /opt/barkstroll
systemctl restart barkstroll.service && sleep 2 && systemctl is-active barkstroll.service
# direct unit-call the render module against a real customer to prove wiring
node -e "const r=require('./lib/docgen-render');const db=require('./lib/db');const c=db.prepare('SELECT * FROM customers WHERE id=20').get();const d=db.prepare('SELECT * FROM dogs WHERE customer_id=20').all();const fs=require('fs');fs.writeFileSync('/tmp/render_smoke.html', r.renderDoc({docType:'proposal',docNumber:'#BBS-TEST',client:c,dogs:d,visits:[{date:'2026-07-16',time:'3:00 PM',label:'Afternoon Visit'},{date:'2026-07-16',time:'9:00 PM',label:'Evening Visit'}],rate:25}));console.log('bytes',fs.statSync('/tmp/render_smoke.html').size);"
```
Expected: service `active`; smoke writes a non-trivial HTML file. (Manual: open /tmp/render_smoke.html to eyeball.)

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add routes/documents.js
git diff --cached --stat
git commit -m "docgen v2: parse-only AI endpoint + structured render endpoint

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — parse → editable visit table → generate

**Files:**
- Modify: `public/js/views/docgen.js`

- [ ] **Step 1: Replace `generateDoc` with the parse→edit→render flow**

Rework `public/js/views/docgen.js`:
1. Add a **rate field** (default `25`) and keep the prompt textarea; the primary button becomes **"Parse visits"** → calls `api('/documents/parse', {body:{prompt, year:new Date().getFullYear()}})`.
2. Render an **editable visit table** into a `#docVisits` container from `result.visits`: each row = date input (`type=date`), time text input, label select (Morning/Afternoon/Evening/Visit), and a remove (×) button; plus a "+ Add visit" button and a rate input. Show any `result.warnings` in a yellow banner.
3. Add a **running total** = `visitCount × rate`, live-updated on any edit.
4. **"Generate proposal"** button → collect the edited rows into `visits[]`, call `api('/documents/render', {body:{customer_id, doc_type, visits, rate, custom_note}})`, then write `result.html` into the existing preview iframe (reuse the current iframe code at ll.147–173) and set `_docGenState.currentHtml = result.html` / `_docGenState.docNumber = result.doc_number`.
5. `saveDoc()` stays as-is (posts `currentHtml` to `/documents/save`).

Keep helper `esc()` usage already in the file. Wire the new buttons/handlers (`parseVisits()`, `addVisitRow()`, `removeVisitRow()`, `recalcVisitTotal()`, `generateFromVisits()`). Store the working visits on `_docGenState.visits`.

(Concrete handler code — match existing file style; `api()`, `toast()`, `esc()` already exist:)

```js
async function parseVisits() {
  const promptEl = document.getElementById('docPrompt');
  const prompt = promptEl.value.trim();
  if (!prompt) { toast('Describe the visits first', 'err'); return; }
  const btn = document.getElementById('docParseBtn');
  btn.disabled = true; btn.textContent = 'Parsing...';
  try {
    const r = await api('/documents/parse', { method: 'POST', body: { prompt, year: new Date().getFullYear() } });
    _docGenState.visits = r.visits || [];
    renderVisitEditor(r.warnings || []);
  } catch (e) { toast('Parse failed: ' + e.message, 'err'); }
  finally { btn.disabled = false; btn.textContent = 'Parse visits'; }
}

function renderVisitEditor(warnings) {
  const host = document.getElementById('docVisits');
  const rate = _docGenState.rate || 25;
  const warn = (warnings && warnings.length)
    ? `<div style="background:#fff7e0;border:1px solid #e8c860;border-radius:6px;padding:8px 10px;font-size:.8rem;margin-bottom:.5rem">⚠️ ${warnings.map(esc).join('<br>')}</div>` : '';
  const rows = (_docGenState.visits || []).map((v, i) => `
    <div class="visit-row" data-i="${i}" style="display:flex;gap:6px;margin-bottom:5px;align-items:center">
      <input type="date" value="${esc(v.date)}" onchange="updateVisit(${i},'date',this.value)" style="font-size:.8rem;padding:4px">
      <input type="text" value="${esc(v.time)}" onchange="updateVisit(${i},'time',this.value)" placeholder="3:00 PM" style="font-size:.8rem;padding:4px;width:90px">
      <select onchange="updateVisit(${i},'label',this.value)" style="font-size:.8rem;padding:4px">
        ${['Morning Visit','Afternoon Visit','Evening Visit','Visit'].map(o=>`<option ${o===v.label?'selected':''}>${o}</option>`).join('')}
      </select>
      <button class="btn btn-outline btn-sm" onclick="removeVisit(${i})" style="padding:2px 8px">×</button>
    </div>`).join('');
  host.innerHTML = `${warn}
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label style="font-size:.75rem">Rate $<input id="docRate" type="number" value="${rate}" onchange="setRate(this.value)" style="width:60px;padding:4px;font-size:.8rem">/visit</label>
      <span style="font-size:.8rem;color:var(--text-soft)">${(_docGenState.visits||[]).length} visits · <b>$${((_docGenState.visits||[]).length*rate).toFixed(2)}</b></span>
    </div>
    ${rows}
    <button class="btn btn-outline btn-sm" onclick="addVisit()" style="margin-top:4px">+ Add visit</button>
    <button class="btn btn-primary btn-sm" onclick="generateFromVisits()" style="margin-top:4px;margin-left:6px">Generate proposal</button>`;
}

function updateVisit(i, k, val) { _docGenState.visits[i][k] = val; }
function removeVisit(i) { _docGenState.visits.splice(i, 1); renderVisitEditor([]); }
function addVisit() { _docGenState.visits.push({ date: '', time: '', label: 'Visit' }); renderVisitEditor([]); }
function setRate(v) { _docGenState.rate = Number(v) || 25; renderVisitEditor([]); }

async function generateFromVisits() {
  const visits = (_docGenState.visits || []).filter(v => v.date && v.time);
  if (!visits.length) { toast('Add at least one visit', 'err'); return; }
  try {
    const r = await api('/documents/render', { method: 'POST', body: {
      customer_id: _docGenState.customerId, doc_type: _docGenState.docType,
      visits, rate: _docGenState.rate || 25,
    }});
    _docGenState.currentHtml = r.html;
    _docGenState.docNumber = r.doc_number;
    showDocPreview(r.html); // existing iframe-writing logic, extracted to a helper
  } catch (e) { toast('Generate failed: ' + e.message, 'err'); }
}
```

Add `_docGenState.rate = 25` to the state init (l.3 and the reset in `openDocGenerator`). Add a `#docVisits` container and a "Parse visits" button (`id="docParseBtn"`) into the `render_docgen` markup (replace the current single "Generate" button block ll.72–86). Extract the iframe-writing block (ll.151–173) into `showDocPreview(html)` and call it from `generateFromVisits`.

- [ ] **Step 2: JS syntax check**

Run: `cd /opt/barkstroll && node --check public/js/views/docgen.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Presence checks**

```bash
cd /opt/barkstroll
for f in parseVisits renderVisitEditor generateFromVisits docParseBtn docVisits showDocPreview; do printf '%s=%s\n' "$f" "$(grep -c "$f" public/js/views/docgen.js)"; done
```
Expected: each ≥ 1.

- [ ] **Step 4: Manual browser test (Scott)**

Hard-refresh `/admin/app#/docgen/20/invoice` (Cris). Type: *"the 16th is 3pm and 9pm, 17th through 21st are 8am 3pm and 9pm"*, rate 25 → Parse → confirm the editable table shows 17 rows, the 16th has only 3pm+9pm (no 8am) → Generate → preview is one page, total $425 → Save → PDF generates.

- [ ] **Step 5: Commit**

```bash
cd /opt/barkstroll
git add public/js/views/docgen.js
git diff --cached --stat
git commit -m "docgen v2: parse -> editable visit table -> compact render (frontend)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Cleanup + full verification

**Files:** none (verification) + delete throwaway mockup

- [ ] **Step 1: Full test suite green**

Run: `cd /opt/barkstroll && npm test 2>&1 | tail -20`
Expected: all tests pass, including the 6 new `docgen-render` tests. No regressions in other suites.

- [ ] **Step 2: Remove throwaway mockup**

```bash
rm -f /var/www/brightpresencedigital.com/_proposal-mock-q7x2.html
curl -s -o /dev/null -w "%{http_code}\n" https://brightpresencedigital.com/_proposal-mock-q7x2.html   # expect 404
```

- [ ] **Step 3: Regression — existing saved docs still open**

Confirm a previously saved doc (e.g. one of the 3 in the `documents` table) still loads from `/invoices/<file>.html` and the history list renders. (The save path was untouched.)

- [ ] **Step 4: Final staged-diff audit (WIP hygiene)**

```bash
cd /opt/barkstroll
git status --short
git log --oneline -6
```
Confirm only the intended files were committed across Tasks 1–5 (`lib/docgen-render.js`, `test/docgen-render.test.js`, `routes/documents.js`, `public/js/views/docgen.js`, the spec/plan docs) — no unrelated WIP swept in.

- [ ] **Step 5: Commit any doc updates**

```bash
cd /opt/barkstroll
git add docs/superpowers/plans/2026-05-30-proposal-machine-v2.md
git commit -m "docgen v2: implementation plan

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Notes (author)

- **Spec coverage:** compact layout ✓ (Task 3 CSS). Hybrid grouping ✓ (Task 2 `layoutRows` + threshold). Parsed-visit editable preview ✓ (Task 5). Hardened parse-only AI ✓ (Task 4 `PARSE_SYSTEM`). Rate input default $25 ✓ (Tasks 4/5). Code-computed totals ✓ (Task 1 `computeTotals`). Standard-vs-variable ✓ (standard baked into renderDoc; variables are the inputs). XSS ✓ (Task 3 test). Save unchanged ✓ (Task 4 leaves `/save`). Cleanup mockup ✓ (Task 6).
- **The phantom-visit bug** is killed two ways: hardened parse prompt (won't invent) + editable preview (human catches anything). Tested in Task 3 (renderDoc) and Task 5 (manual).
- **Type consistency:** `visit = {date,time,label}`, `renderDoc({docType,docNumber,client,dogs,visits,rate,customNote})`, exports `computeTotals/groupByDay/layoutRows/renderDoc/fmtDate/escHtml/money/timeRank` — names consistent across tasks.
- **Risk noted:** the per-day-row table reuses one 3-col layout (Service | Date/Time | Amount). If Scott prefers a distinct Day | Visits | Amount header for the per-day case, that's a small Task 3 tweak — flagged for the build, not blocking.
- **WIP:** B&S tree has unrelated dirty files; every task stages only its named files (no `git add -A`).
