'use strict';
// Run: node backend/lib/cashflowMath.test.js
const { typicalDailySpend } = require('./cashflowMath');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };
const today = new Date('2026-10-24T12:00:00Z');
const ago = (d) => new Date(today.getTime() - d * 86400000);
const row = (d, amt) => ({ date: ago(d), amount: -amt });

// Steady spender: 2,000 a day for 90 days.
const steady = Array.from({ length: 90 }, (_, i) => row(i, 2000));
check('steady spend is about 2,000 a day', Math.abs(typicalDailySpend(steady, today) - 2000) < 100, typicalDailySpend(steady, today));

// The same person with a 2.5M school fee: the forecast must not treat it as a habit.
const withFee = [...steady, row(40, 2500000)];
const burn = typicalDailySpend(withFee, today);
check('a one-off 2.5M does not set the daily rate', burn < 3000, burn);
check('the old plain average would have been about 30K a day', (withFee.reduce((s, t) => s + Math.abs(t.amount), 0) / 90) > 25000);

// Little history: a lone huge row is left out rather than dividing it over 90 days.
const fresh = [row(2, 1500), row(3, 900), row(5, 800000)];
check('short history: a row over half the total is left out', typicalDailySpend(fresh, today) < 100, typicalDailySpend(fresh, today));
check('no spending is zero', typicalDailySpend([], today) === 0);
check('rows older than the window are ignored', typicalDailySpend([row(200, 99999)], today) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
