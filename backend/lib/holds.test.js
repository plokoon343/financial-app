'use strict';
// Run: node backend/lib/holds.test.js
// Tests H1 and H2 from research doc 13.12's acceptance table (holds are specified
// in 13.7; the test labels live in the 13.12 table).

const { isHoldText, matchesFinal, isExpired, HOLD_WINDOW_DAYS } = require('./holds');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── H1: Hold NGN5,000, then a final charge of NGN4,850 two days later ────────
// Expected: one transaction of NGN4,850; hold gone.
{
  const hold = { amount: 5000, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-01T10:00:00+01:00' };
  const final = { amount: 4850, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-03T09:00:00+01:00' };
  check('H1: a nearby, smaller final charge replaces the hold', matchesFinal(hold, final));
  check('H1: not expired at 2 days', !isExpired(hold, new Date('2026-10-03T09:00:00+01:00')));
}

// ── H2: Hold NGN50 with nothing after 7 days ──────────────────────────────────
// Expected: dropped; never counted.
{
  const hold = { amount: 50, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-01T10:00:00+01:00' };
  check('H2: not yet expired at day 6', !isExpired(hold, new Date('2026-10-07T09:00:00+01:00')));
  check('H2: expired past day 7', isExpired(hold, new Date('2026-10-09T00:00:00+01:00')));
  check('H2: window is 7 days', HOLD_WINDOW_DAYS === 7);
}

// ── Detection wording ─────────────────────────────────────────────────────────
{
  check('detect: GOOGLE *TEMPORARY HOLD', isHoldText('GOOGLE *TEMPORARY HOLD NGN500.00'));
  check('detect: generic "pending authorization"', isHoldText('Your card has a pending authorization of NGN2,000.00'));
  check('detect: a settled debit is not a hold', !isHoldText('Debit Alert: NGN2,000.00 to Shoprite'));
  check('detect: empty text is not a hold', !isHoldText(''));
}

// ── matchesFinal edge cases ───────────────────────────────────────────────────
{
  const hold = { amount: 5000, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-01T10:00:00+01:00' };
  check('matchesFinal: a different bank never matches', !matchesFinal(hold, { amount: 4850, bankCode: 'access', accountMask: '6083', eventTime: '2026-10-02T10:00:00+01:00' }));
  check('matchesFinal: settling for MORE than the hold is a different charge', !matchesFinal(hold, { amount: 5200, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-02T10:00:00+01:00' }));
  check('matchesFinal: outside the 7-day window never matches', !matchesFinal(hold, { amount: 4850, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-10T10:00:00+01:00' }));
  check('matchesFinal: far below the hold amount is not the same charge', !matchesFinal(hold, { amount: 100, bankCode: 'gtb', accountMask: '6083', eventTime: '2026-10-02T10:00:00+01:00' }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
