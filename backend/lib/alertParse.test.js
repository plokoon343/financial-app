'use strict';
// Run: node backend/lib/alertParse.test.js
// Corpus of REAL GTBank GeNS email alerts (account numbers/names/refs already masked),
// with the correct amount + direction. Guards the parser against regressions.
const { parseLabeledAlert, detectDirection, alertDescription } = require('./alertParse');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// Builder: GTBank GeNS body with the given direction/amount/description.
const gt = (dir, amount, desc) => [
  'Dear ONUKOGU, CHIDUMEBI VINCENT',
  'Guaranty Trust Bank electronic Notification Service (GeNS)',
  `We wish to inform you that a ${dir} transaction occurred on your account with us.`,
  'Transaction Notification',
  'Account Number : ******9384',
  'Transaction Location : 205',
  `Description : ${desc}`,
  `Amount : NGN ${amount}`,
  'Value Date : 2026-09-11',
  'Remarks : CHARGES',
  'Time of Transaction : 7:35:35 PM',
  'Current Balance : NGN 2831963.21',
  'Available Balance : NGN 2831963.21',
  'Thank you for choosing Guaranty Trust Bank Limited',
].join('\n');

// Each real case: [direction, amount, description, expectedType, expectedAmount]
const CASES = [
  ['DEBIT', '1300', 'POS PUR T ABUBAKAR ISA DvJMSD 2214TMTR LANG 803456', 'expense', 1300],
  ['CREDIT', '10000', 'VIA GAPS 639246 DATA SUBSCRIPTION FOR SEPTEMBER 2026 FROM WYZE CONSULTING SERVICES LTD', 'income', 10000],
  ['DEBIT', '10', 'Commission on NIP Transfer', 'expense', 10],
  ['DEBIT', '0.75', 'VAT', 'expense', 0.75],
  ['DEBIT', '7000', 'OUTWARD TRANSFER TO OPAY - CHIDUMEBI VINCENT ONUKOGU', 'expense', 7000],
  ['DEBIT', '1.88', 'VAT', 'expense', 1.88],
  ['DEBIT', '2000', 'VIA AIRTIME VIA GTWORLD AIRTIME TO GLO AIRTIME COLLECTION', 'expense', 2000],
  ['CREDIT', '10000', 'MOBILE TRF TO GTB GIFT ONUKOGU CHIDUMEBI VINCENT ACCESS AM UCHE PHILIPPA', 'income', 10000],
  ['DEBIT', '25', 'Commission on NIP Transfer', 'expense', 25],
];

for (const [dir, amt, desc, expType, expAmt] of CASES) {
  const body = gt(dir, amt, desc);
  const r = parseLabeledAlert(body);
  check(`${dir} ${amt}: parsed`, !!r);
  check(`${dir} ${amt}: type=${expType}`, r && r.type === expType);
  check(`${dir} ${amt}: amount=${expAmt}`, r && r.amount === expAmt);
  check(`${dir} ${amt}: description captured`, r && r.description && r.description.length > 0 && !/current balance|available/i.test(r.description));
  check(`${dir} ${amt}: value date`, r && r.date === '2026-09-11');
}

// Amount must be the transaction amount, never the balance or account number.
const one = parseLabeledAlert(gt('DEBIT', '1300', 'POS PUR SHOPRITE'));
check('amount is not the balance', one.amount === 1300);
check('amount is not the account number', one.amount !== 9384);

// A non-labeled free-text alert returns null (caller uses detectDirection instead).
check('free-text -> null (not labeled)', parseLabeledAlert('You paid NGN5000 to SHOPRITE') === null);

// detectDirection covers the free-text path incl. GTBank-style wording if unlabeled.
check('dir: CREDIT transaction -> income', detectDirection('a CREDIT transaction occurred').type === 'income');
check('dir: DEBIT transaction -> expense', detectDirection('a DEBIT transaction occurred').type === 'expense');
check('dir: credit w/ debit footer -> income', detectDirection('credited with NGN5000. report unauthorized debit to 0700').type === 'income');
check('dir: pos debit -> expense', detectDirection('NGN2000 POS purchase at SHOPRITE').type === 'expense');

// --- alertDescription: never the email subject or greeting ---------------------
const gtEmail = 'Transaction Notification\nDear CHIDUMEBI ONUKOGU,\nWe wish to inform you that a Debit transaction occurred on your account with us.\nAccount Number : 0123***384\nTransaction Location : 635\nDescription : NIP TRANSFER TO OPAY - MSQ MARYLAND\nAmount : NGN 2,845.00\nValue Date : 02-Aug-2026\nRemarks : -\nCurrent Balance : NGN 32,351.48';
check('desc: labelled description field', alertDescription(gtEmail) === 'NIP TRANSFER TO OPAY - MSQ MARYLAND');
const narration = 'Debit Alert\nAcct: 089****384\nAmt: NGN5,000.00\nNarration: POS PURCHASE SHOPRITE IKEJA\nDate: 03-Oct-2026\nAvail Bal: NGN12,000.00';
check('desc: narration field', alertDescription(narration) === 'POS PURCHASE SHOPRITE IKEJA');
const prose = 'Transaction Notification\nDear Customer,\nYour account 0123***45 has been debited with NGN 4,200.00 for BOLT RIDE LAGOS on 02/10/2026 12:41. Available balance: NGN 8,000.00. Thank you for banking with us.';
check('desc: prose -> the counterparty', alertDescription(prose) === 'BOLT RIDE LAGOS');
const credited = 'Credit Alert\nDear Customer, your account 0123***45 has been credited with NGN 20,000.00 from JOHN DOE. Ref: 123456789. Avail Bal: NGN 28,000.00';
check('desc: credit from a person', alertDescription(credited) === 'JOHN DOE');
check('desc: only boilerplate -> empty', alertDescription('Transaction Notification\nDear Customer,') === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
