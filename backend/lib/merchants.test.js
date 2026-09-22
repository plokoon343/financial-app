'use strict';
// Run: node backend/lib/merchants.test.js
const { matchMerchant } = require('./merchants');
const { categorizeTransaction } = require('./categorize');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };
const cat = (d) => { const m = matchMerchant(d); return m ? m.category : null; };

// --- real OPay-style narrations ---
check('electricity biller', cat('Electricity | 0195130023409 | capricorn_eko_prepaid | 47.3 kWh') === 'Utilities');
check('airtime telco', cat('Airtime | 9052493659 | Glo') === 'Airtime & Data');
check('chowdeck = food (beats transfer)', cat('Transfer to CHOWDECK/KOON PLO | PAYSTACK- TITAN | 9982425026') === 'Food');
check('stamp duty = charge', cat('Stamp Duty') === 'Bank Charges');
check('vat = charge', cat('VAT Charges') === 'Bank Charges');
check('owealth = savings', cat('Auto-save to OWealth Balance') === 'Savings');

// --- brands across categories ---
check('mtn', cat('MTN VTU AIRTIME') === 'Airtime & Data');
check('ikedc', cat('IKEDC PREPAID TOKEN') === 'Utilities');
check('dstv', cat('DSTV SUBSCRIPTION RENEWAL') === 'Utilities');
check('netflix', cat('NETFLIX.COM') === 'Subscriptions');
check('bolt ride', cat('POS/BOLT RIDES LAGOS') === 'Transport');
check('shoprite', cat('POS PUR SHOPRITE LEKKI') === 'Groceries');
check('nnpc fuel', cat('NNPC RETAIL FUEL') === 'Fuel');
check('jumia shopping', cat('JUMIA NIGERIA ORDER') === 'Shopping');
check('bet9ja', cat('BET9JA DEPOSIT') === 'Entertainment');
check('piggyvest savings', cat('PIGGYVEST SAVE') === 'Savings');
check('medplus health', cat('MEDPLUS PHARMACY') === 'Healthcare');
check('waec education', cat('WAEC RESULT CHECKER') === 'Education');
check('leadway insurance', cat('LEADWAY ASSURANCE PREMIUM') === 'Insurance');

// --- must NOT false-fire ---
check('plain person transfer -> no merchant', cat('Transfer to UCHENDU JULIUS OKWUCHUKWU | First Bank Of Nigeria') === null);
check('supermarket does not trip bare "market square" only', cat('random narration with no brand') === null);
check('glo needs boundary (not "global")', cat('GLOBAL VENTURES LTD') === null);

// --- integration: categorizeTransaction applies merchants on expense, not income ---
check('categorize: chowdeck expense -> Food', categorizeTransaction('Transfer to CHOWDECK/KOON PLO', 'expense') === 'Food');
check('categorize: income ignores merchant layer', categorizeTransaction('OWealth Interest Earned', 'income') !== 'Savings');
check('categorize: dstv expense -> Utilities', categorizeTransaction('DSTV renewal', 'expense') === 'Utilities');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
