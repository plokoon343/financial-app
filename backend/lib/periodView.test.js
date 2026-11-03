// Tests for the one set of period figures Home and Money both read (round 6, B2/B3/B5).
// The point of these is agreement: the same rows and the same period must give the
// same numbers whichever screen is asking.

const assert = require('assert');
const { monthRange, countedRows, cashToLog, needCategoryCount, lastSyncOf, periodFigures, COUNTED_TYPES } = require('./periodView');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass += 1; };
const eq = (name, got, want) => { assert.deepStrictEqual(got, want, `${name}: got ${JSON.stringify(got)}`); pass += 1; };

const now = new Date(2026, 9, 16, 12, 0, 0);     // 16 Oct 2026
const range = monthRange(now);
const d = (day, h = 10) => new Date(2026, 9, day, h).toISOString();
const lastMonth = new Date(2026, 8, 20, 10).toISOString();

const rows = [
  { type: 'expense', amount: -510, date: d(2), category: 'Subscriptions', createdAt: d(2) },
  { type: 'expense', amount: -1326, date: d(5), category: 'Other', createdAt: d(5) },
  { type: 'income', amount: 77000, date: d(6), category: 'Salary', createdAt: d(6) },
  { type: 'cash_withdrawal', amount: -20000, date: d(7), category: 'ATM/POS', createdAt: d(7) },
  { type: 'cash_withdrawal', amount: -1836, date: d(9), category: 'ATM/POS', createdAt: d(9) },
  { type: 'cash_withdrawal', amount: -50000, date: d(10), category: 'ATM/POS', cashAllocated: true, createdAt: d(10) },
  { type: 'internal_transfer', amount: -84000, date: d(11), category: 'Transfer', createdAt: d(11) },
  { type: 'failed', amount: -3000, date: d(12), category: 'Other', createdAt: d(12) },
  { type: 'cash_withdrawal', amount: -190000, date: lastMonth, category: 'ATM/POS', createdAt: lastMonth },
  { type: 'expense', amount: -2500, date: lastMonth, category: 'Food', createdAt: lastMonth },
];

// --- what counts as a row on a list -----------------------------------------
eq('this month counts six rows', countedRows(rows, range).length, 6);
check('an own move is not counted', !countedRows(rows, range).some((r) => r.type === 'internal_transfer'));
check('a failed transaction is not counted', !countedRows(rows, range).some((r) => r.type === 'failed'));
check('cash out is counted as a row', countedRows(rows, range).filter((r) => r.type === 'cash_withdrawal').length === 3);
check('every counted type is a real type', COUNTED_TYPES.every((t) => typeof t === 'string'));

// --- B2: cash to log is one figure for a stated period -----------------------
eq('cash to log this month', cashToLog(rows, range), { count: 2, total: 21836 });
check('cash already broken down is left out', cashToLog(rows, range).total === 20000 + 1836);
eq('all time is a different, larger figure', cashToLog(rows, null), { count: 3, total: 211836 });
eq('an empty month is zero, not null', cashToLog([], range), { count: 0, total: 0 });

// --- B5: the "needs a category" count ---------------------------------------
eq('one row needs a category this month', needCategoryCount(rows, range), 1);
eq('last month had none', needCategoryCount(rows, { from: new Date(2026, 8, 1), to: new Date(2026, 9, 1) }), 0);

// --- B3: one last-sync value -------------------------------------------------
eq('last sync is the newest row we hold', lastSyncOf(rows).toISOString(), d(12));
check('no rows means no last sync', lastSyncOf([]) === null);
check('a row with only a date still counts', lastSyncOf([{ date: d(3) }]).toISOString() === d(3));

// --- the two screens read the same answer ------------------------------------
const home = periodFigures(rows, range);
const money = periodFigures(rows, range);
eq('Home and Money agree on the count', home.count, money.count);
eq('Home and Money agree on cash', home.cash, money.cash);
eq('Home and Money agree on last sync', home.lastSyncAt.toISOString(), money.lastSyncAt.toISOString());
eq('and both name the period', home.periodLabel, 'this month');

// --- the range itself --------------------------------------------------------
eq('the month starts on the 1st', range.from.getDate(), 1);
eq('and ends at the start of the next', range.to.getMonth(), 10);

console.log(`\n${pass} passed, 0 failed`);
