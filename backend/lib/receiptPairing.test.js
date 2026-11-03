'use strict';
// Round 6, B6 and acceptance test T19: a shared bank receipt that prints every label
// first and then every value underneath.
//
// Before this, the reader took the line after a label as its value, so on this layout
// every field was the NEXT LABEL: the transfer came out titled "Transfer to Remark",
// with the amount read off the wrong line and no direction at all. Here the nth label
// belongs to the nth value, and the own-account rule finishes the job.

const { parseLabelledReceipt } = require('./alertParse');
const { parseAlert } = require('./alertParser');
const { receiptOwnMove, bankNameIn, detectTransfers } = require('./internalTransfers');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass += 1; else { fail += 1; console.log(`FAIL  ${label} ${extra}`); } };

const USER = 'Chidumebi Onukogu';
const SESSION = '000013251025110136123456789012';
const BANK_REF = 'ACC/2026/1025/987654';

// The real Access layout, redacted: nine labels, then their nine values.
const T19 = [
  'Transaction Amount', 'Transaction Type', 'Transaction Date', 'Sender', 'Beneficiary',
  'Remark', 'Session Id', 'Transaction Reference', 'Transaction Status',
  'NGN84,000.00', 'INTER-BANK', '2026-10-25 11:01:36', USER, USER,
  'OPAY DIGITAL SERVICES LIMITED 8012345678', SESSION, BANK_REF, 'Successful',
].join('\n');

// --- the fields come off the right lines ------------------------------------
const r = parseLabelledReceipt(T19);
check('T19: read as a labels-then-values receipt', r && r.paired === true);
check('T19: amount', r.amountText === 'NGN84,000.00', r.amountText);
check('T19: date', r.dateText === '2026-10-25 11:01:36', r.dateText);
check('T19: sender is the user', r.sender === USER, r.sender);
check('T19: beneficiary is the user', r.receiver === USER, r.receiver);
check('T19: the remark is not mistaken for a name', !/remark/i.test(r.receiver || ''), r.receiver);
check('T19: session id is a dedupe key', r.sessionId === SESSION, r.sessionId);
check('T19: and so is the bank reference', r.bankReference === BANK_REF, r.bankReference);
check('T19: status', r.status === 'Successful', r.status);
check('T19: INTER-BANK is money leaving', r.direction === 'expense', r.direction);

// --- the own-account rule ----------------------------------------------------
const own = receiptOwnMove(r, USER);
check('T19: both sides are the user, so it is an own move', !!own && own.own === true);
check('T19: and it is named after the wallet it went to', own && own.label === 'Moved to OPay', own && own.label);
check('bank name read from the company name', bankNameIn('OPAY DIGITAL SERVICES LIMITED 8012345678') === 'OPay');
check('a transfer to someone else is not an own move', receiptOwnMove({ sender: USER, receiver: 'Ada Okafor' }, USER) === null);
check('no user name means no own-move claim', receiptOwnMove(r, '') === null);

// --- end to end through the parser the share sheet uses ----------------------
const p = parseAlert(T19, { source: 'share', userName: USER, today: new Date('2026-10-26T09:00:00Z') });
check('T19: one transaction', !!p);
check('T19: amount 84,000', p.amount === 84000, String(p.amount));
check('T19: a debit', p.type === 'expense', p.type);
check('T19: dated from the receipt', p.date === '2026-10-25', p.date);
check('T19: titled "Moved to OPay"', p.description === 'Moved to OPay', p.description);
check('T19: left out of the totals as an own move', p.internal === true);
check('T19: carries the session id', p.sessionId === SESSION, p.sessionId);
check('T19: carries the bank reference', p.bankReference === BANK_REF, p.bankReference);
check('T19: never "Transfer to Remark"', !/remark/i.test(p.description), p.description);

// --- the other side, if it turns up within 10 minutes ------------------------
// The OPay credit for the same transfer carries the same session id, which pairs the
// two sides with certainty rather than by guesswork.
const pair = detectTransfers([
  { _id: 'd1', type: 'expense', amount: -84000, date: '2026-10-25T11:01:36+01:00', bank: 'Access', description: 'Moved to OPay', reference: SESSION },
  { _id: 'c1', type: 'income', amount: 84000, date: '2026-10-25T11:06:00+01:00', bank: 'OPay', description: `Transfer from ${USER}`, reference: SESSION },
], { userName: USER });
check('T19: an OPay credit minutes later links as the other side', pair.auto.length === 1, JSON.stringify(pair.ask));
check('T19: and it links the right two rows', pair.auto[0] && pair.auto[0].debit._id === 'd1' && pair.auto[0].credit._id === 'c1');

// --- the ordinary layout still reads the same way it always did --------------
const plain = parseLabelledReceipt([
  'Transaction Amount', 'NGN 12,000.00',
  'Sender', USER,
  'Beneficiary', 'Ada Okafor',
  'Receiving Bank', 'Kuda',
  'Transaction Type', 'INTER-BANK',
].join('\n'));
check('label-and-value receipts are not paired by position', plain && plain.paired === false);
check('and still read correctly', plain.receiver === 'Ada Okafor' && plain.amountText === 'NGN 12,000.00', JSON.stringify(plain));
check('a transfer to someone else keeps its own title', parseAlert([
  'Transaction Amount', 'Transaction Type', 'Transaction Date', 'Sender', 'Beneficiary', 'Remark', 'Session Id', 'Transaction Reference', 'Transaction Status',
  'NGN12,000.00', 'INTER-BANK', '2026-10-25 11:01:36', USER, 'Ada Okafor', 'for lunch', SESSION, BANK_REF, 'Successful',
].join('\n'), { source: 'share', userName: USER }).description === 'Transfer to Ada Okafor');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
