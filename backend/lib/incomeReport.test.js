'use strict';
// Run: node backend/lib/incomeReport.test.js
const { buildSummary, renderReportHTML, prettySource } = require('./incomeReport');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const NOW = '2026-06-15T00:00:00Z'; // anchor "now" so month windows are deterministic
const tx = (type, amount, date, description = '', category = '') => ({ type, amount, date, description, category });

// 3 months of data ending June 2026: Apr/May/Jun.
const txns = [
  tx('income', 200000, '2026-04-05', 'SALARY FROM ACME LTD', ''),
  tx('income', 200000, '2026-05-05', 'SALARY FROM ACME LTD', ''),
  tx('income', 260000, '2026-06-05', 'SALARY FROM ACME LTD', ''),
  tx('income', 40000, '2026-06-20', 'NIP TRF FROM JOHN 12345', ''),
  tx('expense', 50000, '2026-04-10', 'SHOPRITE', 'Groceries'),
  tx('expense', 30000, '2026-05-12', 'IKEDC PREPAID', 'Utilities'),
  tx('expense', 30000, '2026-06-14', 'BOLT RIDE', 'Transport'),
  tx('internal_transfer', 100000, '2026-06-02', 'TRF TO MY OPAY', ''), // must be excluded
  tx('income', 999999, '2026-01-01', 'OLD SALARY', ''),                // out of 3-month window
];

const s = buildSummary(txns, { months: 3, userName: 'Ada Obi', now: NOW, walletBalance: 123456 });

check('period 3 months', s.period.months === 3 && s.period.end === '2026-06');
check('monthly has 3 rows', s.monthly.length === 3);
check('total income excludes transfer + out-of-window', s.totals.income === 700000);
check('total expense', s.totals.expense === 110000);
check('net', s.totals.net === 590000);
check('avg monthly income = total/3', s.avgMonthlyIncome === Math.round((700000 / 3) * 100) / 100);
check('largest single credit', s.largestIncome === 260000);
check('income count (transfer excluded)', s.incomeCount === 4);
check('months with income', s.monthsWithIncome === 3);
check('wallet balance passed through', s.walletBalance === 123456);
check('stability label present', typeof s.stability.label === 'string');
check('top income source is salary', s.topIncomeSources[0].label.toLowerCase().includes('salary'));
check('expense breakdown has categories', s.expenseBreakdown.length === 3);
check('June net = 300000-30000', s.monthly[2].net === 270000);

// internal_transfer never counts
check('transfer not in income', s.totals.income !== 800000);

// prettySource cleans rails/refs
check('prettySource strips refs', prettySource('NIP TRF FROM JOHN 12345').toLowerCase().includes('john'));

// HTML render
const html = renderReportHTML(s);
check('html is a full doc', html.startsWith('<!doctype html>') && html.includes('Financial Summary Report'));
check('html shows subject name', html.includes('Ada Obi'));
check('html has disclaimer', html.toLowerCase().includes('not a bank statement'));
check('html escapes user name', renderReportHTML(buildSummary([], { months: 3, userName: '<script>x</script>', now: NOW })).includes('&lt;script&gt;'));

// empty data doesn't throw
const empty = buildSummary([], { months: 6, userName: '', now: NOW });
check('empty avg income 0', empty.avgMonthlyIncome === 0);
check('empty stability = insufficient', empty.stability.label === 'Insufficient history');
check('empty renders', renderReportHTML(empty).includes('No income recorded'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
