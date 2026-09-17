'use strict';
// Run: node backend/lib/categorize.test.js
// Corpus of REAL bank-alert descriptions -> expected category. Guards the categoriser
// against regressions, especially the POS abbreviations Nigerian banks use.
const { categorizeTransaction } = require('./categorize');

let pass = 0, fail = 0;
const check = (label, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL  ${label}: got '${got}', want '${want}'`); } };

// [description, type, expectedCategory]
const CASES = [
  // Real GTBank alerts
  ['POS PUR T ABUBAKAR ISA DvJMSD 2214TMTR LANG 803456', 'expense', 'ATM/POS'],
  ['Commission on NIP Transfer', 'expense', 'Bank Charges'],
  ['VAT', 'expense', 'Bank Charges'],
  ['OUTWARD TRANSFER TO OPAY - CHIDUMEBI VINCENT ONUKOGU', 'expense', 'Transfer'],
  ['VIA AIRTIME VIA GTWORLD AIRTIME TO GLO AIRTIME COLLECTION', 'expense', 'Airtime & Data'],
  // POS abbreviation variants across banks
  ['POS/WEB PURCHASE LAGOS NG', 'expense', 'Shopping'],
  ['VPOS 1234 SOME SHOP', 'expense', 'ATM/POS'],
  ['ATM WITHDRAWAL GTB LAGOS', 'expense', 'ATM/POS'],
  // A known merchant on a POS line still wins over the generic POS bucket
  ['POS PURCHASE SHOPRITE IKEJA', 'expense', 'Groceries'],
  ['POS PUR NETFLIX.COM', 'expense', 'Subscriptions'],
  // Charges
  ['E-LEVY ON TRANSFER', 'expense', 'Bank Charges'],
  ['ACCOUNT MAINTENANCE FEE', 'expense', 'Bank Charges'],
  // Airtime/data, transport, fuel, utilities
  ['MTN VTU RECHARGE', 'expense', 'Airtime & Data'],
  ['UBER TRIP LEKKI', 'expense', 'Transport'],
  ['NNPC FILLING STATION PMS', 'expense', 'Fuel'],
  ['IKEDC PREPAID ELECTRICITY', 'expense', 'Utilities'],
  // Income
  ['SALARY PAYMENT SEPTEMBER', 'income', 'Salary'],
  ['MOBILE TRF GIFT FROM UCHE', 'income', 'Gift'],
  // Income description containing "subscription" must NOT become the expense-only
  // Subscriptions category (money came IN).
  ['DATA SUBSCRIPTION FROM WYZE CONSULTING SERVICES LTD', 'income', 'Freelance'],
  // Fallbacks
  ['SOME RANDOM NARRATION XYZ', 'expense', 'Other'],
  ['UNKNOWN CREDIT SOURCE', 'income', 'Other Income'],
];

for (const [desc, type, want] of CASES) {
  check(`${type} | ${desc.slice(0, 42)}`, categorizeTransaction(desc, type), want);
}

// amount-sign form (negative = expense) works like the string form
check('amount-sign expense', categorizeTransaction('POS PUR SHOP', -500), 'ATM/POS');
check('amount-sign income', categorizeTransaction('salary', 5000), 'Salary');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
