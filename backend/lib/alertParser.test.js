'use strict';
// Run: node backend/lib/alertParser.test.js
// Every parser change must pass the anonymised alert test set (corpus/alerts): amount,
// direction, "was it a transaction at all" and fee detection are gated at 100%.
const { coverage } = require('../scripts/parser-coverage');
const { classifyAlert } = require('./alertClassify');
const { parseAlert } = require('./alertParser');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };

const { rows, failures } = coverage();
const gated = failures.filter((f) => f.field !== 'date');
check('corpus: amount, direction, parsed and dropped are all correct', gated.length === 0, JSON.stringify(gated.slice(0, 3)));
const all = rows.reduce((a, r) => ({ txn: a.txn + r.txn, date: a.date + r.date, fee: a.fee + r.fee, feeOk: a.feeOk + r.feeOk }), { txn: 0, date: 0, fee: 0, feeOk: 0 });
check('corpus: dates at least 99% right', all.txn && all.date / all.txn >= 0.99);
check('corpus: every fee found', all.fee === all.feeOk);
check('corpus: covers at least 50 alerts', rows.reduce((s, r) => s + r.n, 0) >= 50);

// Classifier behaviour the corpus can't show on its own.
check('a debit with money is a transaction', classifyAlert('Acct 12**34 debited NGN5,000.00 POS. Bal NGN1,000.00').kind === 'transaction');
check('money with no debit/credit wording goes to review, not the bin', classifyAlert('NGN 5,000 sent to ADA OBI').kind === 'unsure');
check('an unclear alert is parsed but flagged for review', parseAlert('NGN 5,000 sent to ADA OBI').needsReview === true);
check('a fee alert is Bank Charges', parseAlert('Debit\nAmt:NGN50.00\nDesc:FGN Stamp Duty\nDate:25/07/2026\nAvail Bal:NGN99.00').category === 'Bank Charges');
check('a refund after a failure is money in', parseAlert('Your failed transfer of NGN2,000.00 has been reversed and credited back. Bal: NGN5,000.00').type === 'income');
check('the balance is never read as the amount', parseAlert('Bal: NGN 99,000.00. Acct debited NGN 1,500.00 for POS').amount === 1500);
check('text with no numbers is dropped', classifyAlert('Welcome to mobile banking').kind === 'ignore');

// Transfer receipts (a shared GTWorld PDF): the narration is who it went to, never the date line.
const RCPT = ['Receipt', '17 Oct 2026, 15:05, GMT+01:00', '₦10,600.00', 'Ten Thousand Six Hundred Naira Zero Kobo', 'Success', 'Sender', 'Onukogu, Chidumebi Vincent', 'Receiver', 'Chimdalu Miriam Onukogu', 'Account number', '7043467062', 'Receiving bank', 'Moniepoint Mfb', 'Reference number', '000013261017150533000068396299', 'Remark', 'Instant Outward Transfer 000013261017150533000068396299 To Moniepoint Mfb/Chimdalu Miriam Onukogu'];
for (const [label, text] of [['lines', RCPT.join('\n')], ['one line', RCPT.join(' ')]]) {
  const r = parseAlert(text, { source: 'share' });
  check(`receipt (${label}): narration is the receiver`, r && r.description === 'Transfer to Chimdalu Miriam Onukogu', r && r.description);
  check(`receipt (${label}): amount, direction and category`, r && r.amount === 10600 && r.type === 'expense' && r.category === 'Transfer');
  check(`receipt (${label}): the receiving bank is not the user's bank`, r && r.bank !== 'Moniepoint', r && r.bank);
}
check('interest earned is income, not Other Income', parseAlert('Credit Alert NGN2.99 Interest Earned Bal: NGN500.00', { source: 'notification' }).category === 'Investment');
check('owealth interest is its own category, not Investment', parseAlert('Credit Alert NGN2.99 OWealth Interest Earned Bal: NGN500.00', { source: 'notification' }).category === 'OWealth Interest');

// --- A bank app's push notification is short (3 Nov 2026) -------------------
// The context test (balance, acct, ref, value date) is shaped like a bank SMS, and
// every SMS carries one of those words. A push from the bank's own app carries none:
// "OPay: You have received ₦5,000.00 from Ada" is an amount and a direction and
// nothing else. Those were all held for review instead of saved, which is what made
// notification capture look broken to the owner while it was working.
const push = (t) => parseAlert(t, { source: 'notification' });
const saved = (t) => { const p = push(t); return !!p && p.kind === 'transaction' && p.amount > 0 && p.directionKnown; };
check('push: you have received', saved('OPay\nYou have received ₦5,000.00 from ADA OKAFOR'));
check('push: amount then received', saved('OPay\n₦5,000.00 received'));
check('push: money received', saved('₦5,000.00\nMoney received from ADA OKAFOR'));
check('push: has been credited', saved('OPay\nYour wallet has been credited with ₦5,000.00'));
check('push: you sent', saved('PalmPay\nYou sent ₦2,000.00 to ADA OKAFOR'));
check('push: direction is read right', push('OPay\nYou have received ₦5,000.00 from ADA OKAFOR').type === 'income');
check('push: and the other way', push('PalmPay\nYou sent ₦2,000.00 to ADA OKAFOR').type === 'expense');
// No direction word at all still waits for the owner rather than guessing.
check('push: a bare amount is still held', push('OPay\n+₦5,000.00 from ADA OKAFOR').needsReview === true);
// The relaxation must not let the usual junk through.
check('push: a loan offer is still dropped', push('Get a loan of up to ₦50,000 today. Apply now!') === null);
check('push: an OTP is still dropped', push('Your OTP is 123456 for a ₦5,000 transfer') === null);
check('push: eligibility promo is still dropped', push('You are eligible for ₦200,000. Limited time') === null);
// Pasted and shared text has no bank behind it, so it keeps the old caution.
check('paste: the same words still wait for a person', parseAlert('NGN 5,000 sent to ADA OBI', { source: 'share' }).needsReview === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
