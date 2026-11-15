'use strict';
// Run: node backend/lib/categorize.test.js
// Corpus of REAL bank-alert descriptions -> expected category, through the single
// entry point (lib/categorise). Guards the categoriser against regressions,
// especially the POS abbreviations Nigerian banks use and the whole-word rule
// (round 10, A1): a keyword never matches inside another word.
const { categorise } = require('./categorise');
const { categorizeTransaction } = require('./categorize');

let pass = 0, fail = 0;
const check = (label, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL  ${label}: got '${got}', want '${want}'`); } };

// [description, type, expectedCategory]
const CASES = [
  // Real GTBank alerts
  ['POS PUR T ABUBAKAR ISA DvJMSD 2214TMTR LANG 803456', 'expense', 'Other'],
  ['Commission on NIP Transfer', 'expense', 'Bank Charges'],
  ['VAT', 'expense', 'Bank Charges'],
  ['VIA AIRTIME VIA GTWORLD AIRTIME TO GLO AIRTIME COLLECTION', 'expense', 'Airtime & Data'],
  // POS abbreviation variants across banks: an unknown shop is Other (a guess), never ATM/POS
  ['POS/WEB PURCHASE LAGOS NG', 'expense', 'Other'],
  ['VPOS 1234 SOME SHOP', 'expense', 'Other'],
  ['ATM WITHDRAWAL GTB LAGOS', 'expense', 'Other'],
  // A person transfer is Sent to people / Money from People, never Transfer
  ['TRANSFER TO ADA OBI', 'expense', 'Sent to people'],
  ['TRANSFER FROM ADA OBI', 'income', 'Money from People'],
  // A known merchant on a POS line still wins over the generic channel
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
  ['NYSC ALLOWANCE OCTOBER', 'income', 'Allowance'],
  ['MOBILE TRF GIFT FROM UCHE', 'income', 'Gift'],
  // Income description containing "subscription" must NOT become the expense-only
  // Subscriptions category (money came IN).
  ['DATA SUBSCRIPTION FROM WYZE CONSULTING SERVICES LTD', 'income', 'Freelance'],
  // Whole-word matching (A1): none of these may fire a keyword inside another word
  ['Payment on current account', 'expense', 'Other'],
  ['Private session fee for Salvation Army', 'expense', 'Other'],
  ['Trf to Farida Bello', 'expense', 'Sent to people'],
  ['Training for mobile Scott', 'expense', 'Other'],
  ['House rent for November', 'expense', 'Housing'],
  // Fallbacks
  ['SOME RANDOM NARRATION XYZ', 'expense', 'Other'],
  ['UNKNOWN CREDIT SOURCE', 'income', 'Other Income'],
];

for (const [desc, type, want] of CASES) {
  check(`${type} | ${desc.slice(0, 42)}`, categorise({ txn: { description: desc, type } }).category, want);
}

// amount-sign form (negative = expense) on the layer function, still works
check('amount-sign expense', categorizeTransaction('POS PUR SHOP', -500), 'Other');
check('amount-sign income', categorizeTransaction('salary', 5000), 'Salary');
check('amount-sign on categorise', categorise({ txn: { description: 'salary', amount: 5000 } }).category, 'Salary');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
