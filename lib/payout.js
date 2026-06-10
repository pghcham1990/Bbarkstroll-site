'use strict';

// Per-visit payout split for the earnings report. Pure + unit-tested so the pay
// math — and especially the owner no-double-count rule — can't silently regress.

const HOUSE_CUT = 5;       // original crew: walker keeps rate - $5, house takes $5
const CONTRACTOR_PAY = 20; // 1099 contractor: flat $20/visit, house keeps rate - $20

// Returns { walkerEarning, houseCut } for one visit at the given client `rate`.
//  - owner (Scott) walks it himself: keeps the full rate, NO house cut. Counting
//    a cut here would credit more than the client paid ($25 -> $25 + $5 = $30).
//  - 1099 contractor: flat $20, house keeps the remainder (rate - $20).
//  - original crew: keeps rate - $5, house takes a flat $5.
// In every branch walkerEarning + houseCut reconciles to the client rate
// (for rates >= the relevant floor).
function computePayout({ rate = 0, isScott = false, crewType = null } = {}) {
  if (isScott) return { walkerEarning: rate, houseCut: 0 };
  if (crewType === 'contractor') {
    return { walkerEarning: Math.min(rate, CONTRACTOR_PAY), houseCut: Math.max(rate - CONTRACTOR_PAY, 0) };
  }
  return { walkerEarning: Math.max(rate - HOUSE_CUT, 0), houseCut: HOUSE_CUT };
}

module.exports = { computePayout, HOUSE_CUT, CONTRACTOR_PAY };
