'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePayout, HOUSE_CUT, CONTRACTOR_PAY } = require('../lib/payout');

test('owner (Scott) keeps the full rate with NO house cut', () => {
  const r = computePayout({ rate: 25, isScott: true });
  assert.deepEqual(r, { walkerEarning: 25, houseCut: 0 });
  // the bug this fix closes: owner walk must never sum to more than the client paid
  assert.equal(r.walkerEarning + r.houseCut, 25);
});

test('contractor gets a flat $20, house keeps the remainder', () => {
  const r = computePayout({ rate: 30, crewType: 'contractor' });
  assert.deepEqual(r, { walkerEarning: CONTRACTOR_PAY, houseCut: 30 - CONTRACTOR_PAY });
  assert.equal(r.walkerEarning + r.houseCut, 30);
});

test('contractor at a low rate floors house cut at 0 (never negative)', () => {
  const r = computePayout({ rate: 15, crewType: 'contractor' });
  assert.deepEqual(r, { walkerEarning: 15, houseCut: 0 });
});

test('original crew keeps rate - $5, house takes a flat $5', () => {
  const r = computePayout({ rate: 30, crewType: null });
  assert.deepEqual(r, { walkerEarning: 30 - HOUSE_CUT, houseCut: HOUSE_CUT });
  assert.equal(r.walkerEarning + r.houseCut, 30);
});

test('owner takes precedence over crew_type', () => {
  // Scott may be flagged as a contractor crew_type, but owner rule wins.
  const r = computePayout({ rate: 25, isScott: true, crewType: 'contractor' });
  assert.deepEqual(r, { walkerEarning: 25, houseCut: 0 });
});

test('defaults are safe (no args -> zeros, crew branch)', () => {
  assert.deepEqual(computePayout(), { walkerEarning: 0, houseCut: HOUSE_CUT });
});
