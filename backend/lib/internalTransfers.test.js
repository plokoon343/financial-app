'use strict';
// Run: node backend/lib/internalTransfers.test.js
const { detectTransfers, scorePair, routeKey } = require('./internalTransfers');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

const debit = (over = {}) => ({ _id: 'd1', type: 'expense', amount: -84000, date: '2026-10-25T11:01:36Z', bank: 'Access', description: 'Transfer to Opay Digital Services Limited', ...over });
const credit = (over = {}) => ({ _id: 'c1', type: 'income', amount: 84000, date: '2026-10-25T11:02:10Z', bank: 'OPay', description: 'Received from Chidumebi Onukogu', ...over });

check('a same-amount, same-day, bank-mentioning pair auto-classifies', detectTransfers([debit(), credit()], { userName: 'Chidumebi Onukogu' }).auto.length === 1);
check('a plain unrelated debit+credit does not pair', detectTransfers([debit({ description: 'POS PURCHASE SHOPRITE' }), credit({ description: 'Salary' })]).auto.length === 0);
check('amount too far apart never pairs', scorePair(debit({ amount: -84000 }), credit({ amount: 50000 })) === 0);
check('more than 72 hours apart never pairs', scorePair(debit(), credit({ date: '2026-10-29T11:02:10Z' })) === 0);
check('a small fee (debit a bit more than credit) still scores', scorePair(debit({ amount: -5050 }), credit({ amount: 5000 })) > 0);

// round 6, part A item 3: two receipts for the same transfer (sending bank's,
// receiving wallet's) that share a bank reference (NIP session id) pair with
// certainty, even when one side's own bank never appears in its own text.
const refDebit = debit({ bank: '', reference: '00012345678' });     // Access's own name wasn't in the PDF text
const refCredit = credit({ reference: '00012345678' });
const { auto } = detectTransfers([refDebit, refCredit], { userName: 'Chidumebi Onukogu' });
check('a shared reference pairs even when one side has no detected bank', auto.length === 1, auto);
check('the reference match is a strong bonus on its own', scorePair(refDebit, refCredit) >= 80);

// Without a shared reference, both sides still need a known bank - a reference-less,
// bank-less pair must not be guessed into existence.
const noRefNoBank = detectTransfers([debit({ bank: '' }), credit({ bank: '' })]);
check('no bank and no reference never pairs (nothing to go on)', noRefNoBank.auto.length === 0 && noRefNoBank.ask.length === 0);

// A mismatched reference should never add the bonus (different transfers that
// happen to land close in time and amount by coincidence).
const mismatch = scorePair(debit({ reference: 'AAA' }), credit({ reference: 'BBB' }));
const noRefScore = scorePair(debit(), credit());
check('a different reference on each side adds nothing', mismatch === noRefScore);

check('routeKey is direction-agnostic', routeKey('Access', 'OPay') === routeKey('OPay', 'Access'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
