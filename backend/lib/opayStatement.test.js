'use strict';
// Run: node backend/lib/opayStatement.test.js
const { parseOpayStatement, looksLikeOpay, isInternal, extractAccountName } = require('./opayStatement');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// A trimmed OPay statement mirroring the real pdf.js line grouping (header summary,
// then records where each spans a date-time line, description line(s) and a glued
// debit/credit/balance/channel line).
const SAMPLE = [
  'Account Statement',
  'Account Name',
  'CHIDUMEBI VINCENT ONUKOGU',
  'Account Number',
  '9064435165',
  'Wallet Account',
  'Trans. TimeValue DateDescription',
  'Debit(₦)Credit(₦)',
  // 1) real income: transfer in from a family member
  '25 Jul 2026 22:22:0125 Jul 2026',
  'Transfer from CHIMDALU MIRIAM ONUKOGU | MONIE POINT | 503****065 | AT139',
  '--2,000.002,000.00Mobile',
  '0000142607252222002876',
  // 2) OWealth auto-save (internal churn) - debit that nets to savings
  '25 Jul 2026 22:23:0325 Jul 2026',
  'Auto-save to OWealth Balance',
  '2,000.00--0.00Mobile260725140300012078123392',
  // 3) OWealth withdrawal (internal churn) - credit back from savings
  '26 Jul 2026 22:38:1826 Jul 2026',
  'OWealth Withdrawal(Transaction Payment)',
  '--3,100.003,100.00Mobile260726010201047767831629',
  // 4) real expense: electricity
  '26 Jul 2026 22:38:1426 Jul 2026',
  'Electricity | 0195130023409 | capricorn_eko_prepaid |',
  '47.3 kWh',
  '3,100.00--0.00Mobile',
  '2607260901000478686014',
  // 5) real expense: transfer out to another person
  '29 Jul 2026 06:18:4429 Jul 2026',
  'Transfer to UCHENDU JULIUS OKWUCHUKWU | First Bank Of Nigeria | 3049402864',
  '3,000.00--0.00Mobile',
  // 6) own-name transfer in (self / internal)
  '30 Jul 2026 06:18:4430 Jul 2026',
  'Transfer from CHIDUMEBI VINCENT ONUKOGU | Access Bank | 150****731',
  '--5,000.005,000.00Mobile',
  // 7) OWealth interest (real, tiny income - NOT internal)
  '20 Sep 2026 00:00:0020 Sep 2026',
  'OWealth Interest Earned',
  '--0.810.81Mobile',
].join('\n');

// --- detection ---
check('detects OPay statement', looksLikeOpay(SAMPLE) === true);
check('ignores a normal bank PDF', looksLikeOpay('GTBank\n01-Aug-2026 Opening Balance 1,000.00') === false);
check('reads account holder name', extractAccountName(SAMPLE.split('\n')) === 'CHIDUMEBI VINCENT ONUKOGU');

// --- internal classification ---
check('auto-save is internal', isInternal('Auto-save to OWealth Balance', 'CHIDUMEBI VINCENT ONUKOGU') === true);
check('owealth withdrawal is internal', isInternal('OWealth Withdrawal(Transaction Payment)', 'X') === true);
check('owealth interest is NOT internal', isInternal('OWealth Interest Earned', 'X') === false);
check('own-name transfer is internal', isInternal('Transfer from CHIDUMEBI VINCENT ONUKOGU | Access', 'CHIDUMEBI VINCENT ONUKOGU') === true);
check('other-person transfer is NOT internal', isInternal('Transfer to UCHENDU JULIUS OKWUCHUKWU', 'CHIDUMEBI VINCENT ONUKOGU') === false);

// --- parse ---
const rows = parseOpayStatement(SAMPLE);
check('parsed all 7 records', rows.length === 7);

const real = rows.filter(r => !r.internal);
const internal = rows.filter(r => r.internal);
check('4 real rows', real.length === 4);       // family-in, electricity, transfer-out, interest
check('3 internal rows', internal.length === 3); // auto-save, owealth withdrawal, self-transfer

const income = real.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
const expense = real.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
check('real income = 2000.81', Math.abs(income - 2000.81) < 0.005);
check('real expense = 6100', Math.abs(expense - 6100) < 0.005);

const elec = rows.find(r => /Electricity/.test(r.description));
check('electricity is expense', elec && elec.type === 'expense' && elec.amount === 3100);
check('electricity keeps full remarks', elec && /capricorn_eko_prepaid/.test(elec.description));

const familyIn = rows.find(r => /CHIMDALU/.test(r.description));
check('family transfer-in is income', familyIn && familyIn.type === 'income' && familyIn.amount === 2000);

const selfIn = rows.find(r => r.internalReason === 'Transfer between your own accounts');
check('self transfer flagged internal, keeps true direction', !!selfIn && selfIn.internal === true && selfIn.type === 'income');
check('internal rows keep income/expense type', internal.every(r => r.type === 'income' || r.type === 'expense'));

check('all rows have ISO dates', rows.every(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
check('holder name attached', rows.holderName === 'CHIDUMEBI VINCENT ONUKOGU');
check('account number attached', rows.accountNumber === '9064435165');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
