'use strict';
// Run: node backend/lib/dollarAccounts.test.js
// Tests D1 and D2 from research doc 13.12's acceptance table (dollar amounts are
// specified in 13.8; the test labels live in the 13.12 table).

const { effectiveRate, describeDollarCharge, totalsWithDollar } = require('./dollarAccounts');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── D1: NGN170,000 paid for $100, then a $9.99 charge ─────────────────────────
// Expected: row shows "$9.99 - about NGN16,983 at your rate".
{
  const fundings = [{ nairaAmount: 170000, usdAmount: 100, date: '2026-09-01' }];
  check('D1: rate is naira paid / dollars received', effectiveRate(fundings) === 1700);
  const row = describeDollarCharge(9.99, fundings);
  check('D1: naira figure at the real rate', row.nairaAmount === 16983, `got ${row.nairaAmount}`);
  check('D1: included in the naira total', row.includedInNairaTotal === true);
  check('D1: label reads "$9.99 - about N16,983 at your rate"', row.label === '$9.99 · about ₦16,983 at your rate', row.label);
}

// ── D2: $9.99 charge with no funding seen ─────────────────────────────────────
// Expected: totals add "plus $9.99 on your dollar card", no naira figure.
{
  const row = describeDollarCharge(9.99, []);
  check('D2: no naira figure without a known rate', row.nairaAmount === null);
  check('D2: not included in the naira total', row.includedInNairaTotal === false);
  check('D2: label is the dollar figure alone', row.label === '$9.99');
  const t = totalsWithDollar([{ usdAmount: 9.99, fundings: [] }]);
  check('D2: nothing added to the naira total', t.nairaFromDollar === 0);
  check('D2: unconverted total is kept separate', t.unconvertedUsd === 9.99);
  check('D2: totals label reads "plus $9.99 on your dollar card"', t.unconvertedLabel === 'plus $9.99 on your dollar card', t.unconvertedLabel);
}

// ── Never a guessed or market rate ────────────────────────────────────────────
{
  // An older funding is never substituted once a more recent one exists - the rate
  // actually paid for the dollars being spent now is the only one that counts.
  const fundings = [
    { nairaAmount: 150000, usdAmount: 100, date: '2026-08-01' }, // rate 1500
    { nairaAmount: 170000, usdAmount: 100, date: '2026-09-01' }, // rate 1700, most recent
  ];
  check('rate: the most recent funding wins, never an older rate', effectiveRate(fundings) === 1700);
  check('rate: no fundings means no rate at all, never a default', effectiveRate([]) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
