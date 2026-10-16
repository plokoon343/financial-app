'use strict';
// Run: node backend/lib/homeSummary.test.js
const { homeSummary, billsDueThisMonth, daysLeftInMonth } = require('./homeSummary');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date(2026, 9, 16); // 16 Oct 2026 (31-day month)

check('days left counts today (16..31 = 16)', daysLeftInMonth(now) === 16);
check('last day of month is 1 day left', daysLeftInMonth(new Date(2026, 9, 31)) === 1);

check('monthly bill later this month counts', billsDueThisMonth(now, [{ amount: 5000, frequency: 'monthly', dueDate: 20, status: 'active' }]) === 5000);
check('monthly bill already past does not', billsDueThisMonth(now, [{ amount: 5000, frequency: 'monthly', dueDate: 10, status: 'active' }]) === 0);
check('bill due today counts', billsDueThisMonth(now, [{ amount: 700, frequency: 'monthly', dueDate: 16 }]) === 700);
check('paused bill ignored', billsDueThisMonth(now, [{ amount: 5000, frequency: 'monthly', dueDate: 20, status: 'paused' }]) === 0);
check('nextDue next month ignored', billsDueThisMonth(now, [{ amount: 5000, nextDue: new Date(2026, 10, 3) }]) === 0);
check('nextDue this month counts', billsDueThisMonth(now, [{ amount: 5000, nextDue: new Date(2026, 9, 28) }]) === 5000);
check('active subscription counts, cancelled does not', billsDueThisMonth(now, [], [
  { cost: 2000, status: 'active', frequency: 'monthly', renewalDay: 25 },
  { cost: 9000, status: 'cancelled', frequency: 'monthly', renewalDay: 25 },
]) === 2000);
check('yearly subscription without a date is skipped', billsDueThisMonth(now, [], [{ cost: 9000, status: 'active', frequency: 'yearly', renewalDay: 25 }]) === 0);

const s = homeSummary({ now, monthlyIncome: 100000, monthIncome: 80000, monthExpense: 40000, bills: [{ amount: 10000, frequency: 'monthly', dueDate: 20 }], monthTxnCount: 12, lastSyncAt: '2026-10-16T08:00:00Z' });
check('safe to spend = income - spent - bills', s.safeToSpend === 50000, s);
check('daily allowance rounds to 50', s.dailyAllowance === 3150, s);
check('not over', s.over === 0);
check('carries count and sync time', s.monthTxnCount === 12 && s.lastSyncAt === '2026-10-16T08:00:00.000Z');

const o = homeSummary({ now, monthlyIncome: 50000, monthExpense: 60000 });
check('overspent: safe is 0 and over is reported', o.safeToSpend === 0 && o.over === 10000 && o.dailyAllowance === 0, o);

const hi = homeSummary({ now, monthlyIncome: 50000, monthIncome: 90000, monthExpense: 30000 });
check('actual income above the stated one is used', hi.safeToSpend === 60000, hi);

const n = homeSummary({ now, monthIncome: 90000, monthExpense: 30000 });
check('no stated income gives no safe-to-spend', n.incomeSet === false && n.safeToSpend === null && n.dailyAllowance === null && n.over === 0, n);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
