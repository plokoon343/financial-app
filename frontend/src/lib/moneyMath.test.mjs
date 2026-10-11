// Run: node frontend/src/lib/moneyMath.test.mjs
import { forInsights, selfNameWords, isInternal, monthCoverage, spotlightFor, sameDaysSpend, SENT_TO_PEOPLE } from './moneyMath.js';

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };
const d = (day, m = 9) => `2026-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}T10:00:00Z`;
const me = selfNameWords({ name: 'Tolu Adeyemi' });

// The Round 3 bug: "445% of your income went to Transfer".
const month = [
  { date: d(1), type: 'income', amount: 44000, category: 'Salary', description: 'SALARY SEP' },
  { date: d(3), type: 'expense', amount: -60000, category: 'Transfer', description: 'TRF TO TOLU ADEYEMI KUDA' },     // own account
  { date: d(4), type: 'expense', amount: -50000, category: 'Transfer', description: 'OWealth Deposit' },               // savings pocket
  { date: d(6), type: 'expense', amount: -40000, category: 'Transfer', description: 'TRANSFER TO JOHN OKAFOR' },       // a person
  { date: d(9), type: 'expense', amount: -20000, category: 'Food', description: 'CHICKEN REPUBLIC' },
  { date: d(14), type: 'expense', amount: -15000, category: 'Transport', description: 'BOLT' },
  { date: d(20), type: 'expense', amount: -8000, category: 'Airtime & Data', description: 'MTN' },
  { date: d(27), type: 'expense', amount: -4000, category: 'Food', description: 'SUYA' },
];
const view = forInsights(month, me);
check('transfer to own account is internal', view[1].type === 'internal_transfer');
check('OWealth deposit is internal', view[2].type === 'internal_transfer');
check('transfer to a person is spending, as Sent to people', view[3].type === 'expense' && view[3].category === SENT_TO_PEOPLE);
check('no bare Transfer category left in spending', !view.some((t) => t.type === 'expense' && t.category === 'Transfer'));
check('a person who shares one name word is not "me"', !isInternal({ type: 'expense', category: 'Transfer', description: 'TRANSFER TO TOLU BAKARE' }, me));
check('saved rows are untouched', month[1].type === 'expense' && month[3].category === 'Transfer');

const spent = view.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
check('spending excludes internal moves', spent === 87000);

const cov = monthCoverage(view, '2026-09', new Date('2026-10-11'));
check('September is covered', cov.complete);
const over = spotlightFor({ income: 44000, expense: spent, top: { name: SENT_TO_PEOPLE, value: 40000 }, coverage: cov });
check('spending above income is said in words, not as a %', over.kind === 'over' && over.spent === 87000 && over.income === 44000);
const share = spotlightFor({ income: 200000, expense: spent, top: { name: SENT_TO_PEOPLE, value: 40000 }, coverage: cov });
check('share of income when it is complete', share.kind === 'share' && share.pct === 20);
check('share never above 100%', spotlightFor({ income: 100, expense: 100, top: { name: 'x', value: 400 }, coverage: cov }).pct === 100);

// Incomplete months: only spending, no income comparison.
const partial = [{ date: d(18), type: 'expense', amount: -5000, category: 'Food', description: 'X' }, { date: d(28), type: 'income', amount: 1000, category: 'Salary', description: 'Y' }];
const pcov = monthCoverage(partial, '2026-09', new Date('2026-10-11'));
check('a month that starts on the 18th is incomplete', !pcov.complete);
check('incomplete month shows spending only', spotlightFor({ income: 1000, expense: 5000, top: { name: 'Food', value: 5000 }, coverage: pcov }).kind === 'spent');
check('no income shows spending only', spotlightFor({ income: 0, expense: 5000, top: { name: 'Food', value: 5000 }, coverage: cov }).kind === 'spent');
const cur = monthCoverage([{ date: '2026-10-02T09:00:00Z' }, { date: '2026-10-09T09:00:00Z' }], '2026-10', new Date('2026-10-11T12:00:00Z'));
check('current month counts up to today', cur.complete && cur.endDay === 11);

// Like-for-like: same days of both months.
const rows = [
  { date: d(5, 9), type: 'expense', amount: -1000, category: 'Bank Charges' },
  { date: d(25, 9), type: 'expense', amount: -24000, category: 'Bank Charges' },
  { date: d(5, 10), type: 'expense', amount: -1000, category: 'Bank Charges' },
];
check('same-days spend ignores the rest of last month', sameDaysSpend(rows, '2026-09', 11, 'Bank Charges') === 1000);
check('so 11 days of October vs 11 days of September is flat, not a 96% cut', sameDaysSpend(rows, '2026-10', 11, 'Bank Charges') === 1000);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
