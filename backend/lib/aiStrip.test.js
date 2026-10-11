'use strict';
// Run: node backend/lib/aiStrip.test.js
const { stripText, merchantForAi, isStripped } = require('./aiStrip');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

const s1 = stripText('POS PURCHASE SHOPRITE LEKKI 08031234567 NGN 4,500.00 on 12/09/2026');
check('amounts, phones and dates are removed', !/\d/.test(s1) && s1.includes('SHOPRITE LEKKI'), s1);
check('currency words and signs are removed', !/ngn|₦/i.test(stripText('₦4,500 NGN 300 naira')));
check('emails and links are removed', !/@|http|www/.test(stripText('mail ada@x.com see https://x.co/a www.y.com')));
check('a name after "to" is removed', !/ADA OBI/.test(stripText('PAYMENT TO ADA OBI')), stripText('PAYMENT TO ADA OBI'));
check('a cashier name on a receipt is removed', !/Musa/.test(stripText('Cashier: Musa Bello\nSHOPRITE')), stripText('Cashier: Musa Bello\nSHOPRITE'));
check('"served by" names are removed', !/Chika/.test(stripText('Served by Chika')));
check('card masks are removed', !/\*|\d/.test(stripText('CARD 5399****1234 KFC')));

check('merchant: a POS purchase keeps the shop', merchantForAi('POS PURCHASE SHOPRITE LEKKI 4500') === 'POS PURCHASE SHOPRITE LEKKI');
check('merchant: a web payment keeps the merchant', /NETFLIX/.test(merchantForAi('WEB PMT NETFLIX.COM 4400') || ''));
check('merchant: a person transfer is never sent', merchantForAi('NIP TRF TO ADEBAYO OKONKWO 0123456789') === null);
check('merchant: "Transfer to Mum" is never sent', merchantForAi('Transfer to Mum') === null);
check('merchant: inward transfers are never sent', merchantForAi('INWARD TRANSFER FROM CHIDI EZE') === null);
check('merchant: USSD transfers are never sent', merchantForAi('USSD TRSF 737 KEMI') === null);
check('merchant: digits only gives nothing', merchantForAi('1234567890') === null);
check('merchant: kept short', (merchantForAi('A'.repeat(200)) || '').length <= 60);
check('merchant results never carry a digit', ['KFC LEKKI PHASE 1', 'JUMIA ORDER 12345', 'AIRTIME MTN 0803'].every((d) => isStripped(merchantForAi(d) || '')));

check('isStripped refuses digits, @ and ₦', !isStripped('KFC 1') && !isStripped('a@b') && !isStripped('₦') && isStripped('KFC LEKKI'));

console.log(`aiStrip: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
