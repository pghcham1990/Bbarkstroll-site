/* ── Pricing Sheet View ───────────────────────────────────────────
   Strategic reference for Scott. Client-facing prices + proposed 1099
   contractor payouts + house margin for every service we offer.

   IMPORTANT: only the $20 / 30-min walk payout is set in the signed 1099
   contract today. Every other payout here is a PROPOSAL for Scott to set
   when he adds those tasks to a contract. Flagged per-row with `contracted`.

   This page is a reference sheet, not wired to billing. Client `rate` still
   lives per-customer in the DB; these are the recommended list prices.

   Rendering follows the house convention (see reports.js): innerHTML with
   every dynamic value passed through esc(); admin-only authenticated view.
─────────────────────────────────────────────────────────────────── */

/* Bread-and-butter + everyday services (per visit). */
const PRICING_CORE = [
  { svc: '30-min Dog Walk',        dur: '30 min', client: 32, payout: 20, tag: 'Bread & butter', contracted: true },
  { svc: 'Custom Care',            dur: '30 min', client: 32, payout: 20, tag: 'Most booked' },
  { svc: '45-min Dog Walk',        dur: '45 min', client: 42, payout: 28 },
  { svc: '60-min Adventure Walk',  dur: '60 min', client: 55, payout: 35, tag: 'Upsell' },
  { svc: 'Drop-In Visit',          dur: '30 min', client: 28, payout: 18 },
  { svc: 'Quick Visit / Feeding',  dur: '15 min', client: 20, payout: 12 },
  { svc: 'Pet Sitting Visit',      dur: '60 min', client: 42, payout: 26 },
  { svc: 'Poop / Yard Cleanup',    dur: '15 min', client: 25, payout: 12, tag: 'Recurring $18/wk' },
];

/* The wealth lever — overnights & house sitting. Premium on purpose. */
const PRICING_PREMIUM = [
  { svc: 'Overnight / Home Stay',  dur: '~12 hr, in client home', client: 125, payout: 75, unit: '/night' },
  { svc: 'Holiday Overnight',      dur: 'Major holidays',          client: 150, payout: 90, unit: '/night' },
  { svc: '24-hr House Sitting',    dur: 'Full day + overnight',    client: 165, payout: 100, unit: '/day' },
];

/* Add-ons & surcharges — pure margin stackers. Most go straight to the house. */
const PRICING_ADDONS = [
  { svc: 'Additional dog',          client: 8,  payout: 3, unit: '/visit' },
  { svc: 'Holiday surcharge',       client: 15, payout: 0, unit: '/visit', note: 'House keeps' },
  { svc: 'Last-minute (<12 hr)',    client: 10, payout: 0, unit: '/booking', note: 'House keeps' },
  { svc: 'Key pickup / return',     client: 15, payout: 0, unit: 'one-time', note: 'House keeps' },
  { svc: 'Medication admin',        client: 5,  payout: 0, unit: '/visit', note: 'House keeps' },
  { svc: 'Outside core radius',     client: 8,  payout: 3, unit: '/visit' },
];

/* Recurring packages — locked-in revenue is how a walking business gets wealthy. */
const PRICING_PACKAGES = [
  { name: 'Weekly Walker', detail: '5 walks / week', price: '$150/wk', per: '$30 / walk', note: '~$650/mo per client. Recurring, auto-renew.' },
  { name: 'Daily Midday', detail: '20 walks / month', price: '$580/mo', per: '$29 / walk', note: 'Predictable MRR. Slight volume discount.' },
  { name: 'Vacation Week', detail: '7 overnights', price: '$840', per: '$120 / night', note: '$350+ margin in a single booking.' },
];

const money = n => '$' + Number(n).toLocaleString('en-US');

async function render_pricing(el) {
  el.innerHTML = `
    <p class="section-label">Strategy</p>
    <h1 class="section-title">Pricing Sheet</h1>
    <p style="color:var(--text-soft);font-size:14px;max-width:680px;margin:-4px 0 22px;line-height:1.6;">
      Recommended list prices, proposed 1099 payouts, and what stays in the house on every service.
      The 30-min walk is the volume engine; overnights and packages are the wealth levers.
    </p>

    <div id="pricingLive"></div>

    <div class="glass-panel" style="margin-bottom:18px;">
      <div class="glass-panel-header"><h3 class="glass-panel-title">Everyday Services <span style="font-weight:400;color:var(--text-soft);font-size:13px;">&middot; per visit</span></h3></div>
      <div class="glass-panel-body" style="padding:0;overflow-x:auto;">${priceTable(PRICING_CORE)}</div>
    </div>

    <div class="glass-panel" style="margin-bottom:18px;border:1px solid rgba(196,164,78,.4);background:linear-gradient(180deg,rgba(196,164,78,.06),transparent);">
      <div class="glass-panel-header"><h3 class="glass-panel-title">&#128176; Overnights &amp; Home Stay <span style="font-weight:400;color:var(--text-soft);font-size:13px;">&middot; the wealth lever</span></h3></div>
      <div class="glass-panel-body" style="padding:0 0 6px;overflow-x:auto;">${priceTable(PRICING_PREMIUM, true)}</div>
      <div class="glass-panel-body" style="padding-top:6px;">
        <p style="font-size:12.5px;color:var(--text-soft);margin:0;line-height:1.6;">
          One week-long vacation booking = <b style="color:var(--forest);">${money(875)}</b> in, <b>${money(525)}</b> to the contractor,
          <b style="color:var(--forest);">${money(350)}</b> kept &mdash; or all ${money(875)} if you cover it yourself. Stack the per-dog and holiday rates on top.
        </p>
      </div>
    </div>

    <div class="glass-panel" style="margin-bottom:18px;">
      <div class="glass-panel-header"><h3 class="glass-panel-title">Add-Ons &amp; Surcharges</h3></div>
      <div class="glass-panel-body" style="padding:0;overflow-x:auto;">${priceTable(PRICING_ADDONS)}</div>
    </div>

    <div class="glass-panel" style="margin-bottom:18px;">
      <div class="glass-panel-header"><h3 class="glass-panel-title">Recurring Packages <span style="font-weight:400;color:var(--text-soft);font-size:13px;">&middot; locked-in revenue</span></h3></div>
      <div class="glass-panel-body">${packageCards()}</div>
    </div>

    <div class="glass-panel">
      <div class="glass-panel-header"><h3 class="glass-panel-title">&#128204; Read me</h3></div>
      <div class="glass-panel-body">
        <ul style="margin:0;padding-left:18px;color:var(--text-soft);font-size:13px;line-height:1.85;">
          <li>Only the <b>$20 / 30-min walk</b> payout is in the signed 1099 contract (marked <span style="color:var(--forest);font-weight:700;">&#9670;</span>). Every other payout is a proposal &mdash; lock it into a contract before assigning those tasks.</li>
          <li>The <b>$32</b> walk sits at the top of the local market. Current clients are at $25&ndash;30; grandfather them and quote new clients at list.</li>
          <li><b>Margin</b> = what the house keeps when a 1099 covers the visit. <b>You solo</b> = you keep the full client price.</li>
          <li>Wealth doesn't come from cheaper walks &mdash; it comes from <b>overnights, add-on stacking, and recurring packages</b>. Push those.</li>
        </ul>
      </div>
    </div>
  `;

  loadLivePricing(el.querySelector('#pricingLive'));
}

/* Build a price table. `premium` shows the per-unit suffix. */
function priceTable(rows, premium) {
  const head = `
    <table class="price-table">
      <thead><tr>
        <th>Service</th><th>${premium ? '' : 'Length'}</th>
        <th class="num">Client pays</th><th class="num">1099 payout</th>
        <th class="num">Your margin</th><th class="num">You solo</th>
      </tr></thead><tbody>`;
  const body = rows.map(r => {
    const margin = r.client - r.payout;
    const unit = r.unit ? `<span class="price-unit">${esc(r.unit)}</span>` : '';
    const tag = r.tag ? `<span class="price-tag">${esc(r.tag)}</span>` : '';
    const lock = r.contracted ? ` <span title="Set in 1099 contract" style="color:var(--forest);">&#9670;</span>` : '';
    const note = r.note ? `<div class="price-note">${esc(r.note)}</div>` : '';
    return `<tr>
      <td><span class="price-svc">${esc(r.svc)}</span>${tag}${note}</td>
      <td style="color:var(--text-soft);font-size:12.5px;">${esc(r.dur || '')}</td>
      <td class="num"><b>${money(r.client)}</b>${unit}</td>
      <td class="num">${r.payout ? money(r.payout) + lock : '<span style="color:var(--text-soft)">&mdash;</span>'}</td>
      <td class="num" style="color:var(--forest);font-weight:700;">${money(margin)}</td>
      <td class="num" style="color:var(--gold);font-weight:700;">${money(r.client)}</td>
    </tr>`;
  }).join('');
  return head + body + '</tbody></table>';
}

function packageCards() {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;">` +
    PRICING_PACKAGES.map(p => `
      <div style="border:1px solid var(--glass-border);border-radius:var(--radius-sm);padding:14px 16px;background:rgba(255,255,255,.45);">
        <div style="font-family:'DM Serif Display',serif;font-size:17px;color:var(--forest);">${esc(p.name)}</div>
        <div style="font-size:12px;color:var(--text-soft);margin-bottom:8px;">${esc(p.detail)}</div>
        <div style="font-size:22px;font-weight:700;color:var(--text);">${esc(p.price)}</div>
        <div style="font-size:12px;color:var(--gold);font-weight:600;margin-bottom:8px;">${esc(p.per)}</div>
        <div style="font-size:12px;color:var(--text-soft);line-height:1.5;">${esc(p.note)}</div>
      </div>`).join('') + `</div>`;
}

/* Live panel: pull the next 30 days of bookings, show the mix and what it
   would be worth at these list prices. Service names come from the DB and
   are escaped before rendering. */
async function loadLivePricing(box) {
  if (!box) return;
  const listPrice = { 'Dog Walking': 32, 'Custom Care': 32, 'Pet Sitting': 42, 'Pet Feeding': 20, 'Poop Removal': 25, 'Meet & Greet': 0 };
  const now = new Date();
  const start = now.toISOString();
  const end = new Date(now.getTime() + 30 * 864e5).toISOString();
  let appts = [];
  try {
    appts = await api(`/appointments?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  } catch (e) { return; /* silent — the sheet still stands on its own */ }
  if (!appts || !appts.length) return;

  const mix = {};
  let projected = 0;
  appts.forEach(a => {
    const n = a.service_name || 'Other';
    mix[n] = (mix[n] || 0) + 1;
    projected += (listPrice[n] != null ? listPrice[n] : 30);
  });
  const rows = Object.entries(mix).sort((a, b) => b[1] - a[1])
    .map(([n, c]) => `<span class="mix-pill">${esc(n)} <b>&times;${c}</b></span>`).join('');

  box.innerHTML = `
    <div class="glass-panel" style="margin-bottom:18px;">
      <div class="glass-panel-header"><h3 class="glass-panel-title">What's Coming In <span style="font-weight:400;color:var(--text-soft);font-size:13px;">&middot; next 30 days</span></h3></div>
      <div class="glass-panel-body">
        <div style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;">
          <div>
            <div style="font-size:32px;font-weight:700;color:var(--forest);line-height:1;">${appts.length}</div>
            <div style="font-size:12px;color:var(--text-soft);">booked visits</div>
          </div>
          <div>
            <div style="font-size:32px;font-weight:700;color:var(--gold);line-height:1;">${money(projected)}</div>
            <div style="font-size:12px;color:var(--text-soft);">value at list prices</div>
          </div>
          <div style="flex:1;min-width:200px;display:flex;flex-wrap:wrap;gap:6px;">${rows}</div>
        </div>
      </div>
    </div>`;
}
