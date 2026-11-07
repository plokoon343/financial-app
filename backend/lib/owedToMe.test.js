'use strict';
// Run: node backend/lib/owedToMe.test.js
// Round 6, Block 5, section 6.2 acceptance tests O1-O3 (research doc 13.6).
const assert = require('assert');
const { lendRecord, isPaybackCandidate, applyPayback, writeOff } = require('./owedToMe');

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };

// O1: transfer NGN 10,000 to Tunde, marked "I lent this" -> not in spending; Owed to
// you NGN 10,000.
const record = lendRecord({ transactionId: 't1', person: 'Tunde', amount: 10000, date: new Date('2026-10-01') });
check('O1: the lend record tracks the full amount owed', record.amount === 10000 && record.status === 'open');

// O2: Tunde sends NGN 6,000 three weeks later -> suggested as payback; on Yes,
// NGN 4,000 still owed.
{
  const credit = { amount: 6000 };
  const when = new Date('2026-10-22'); // 21 days later
  check('O2: a partial credit within 90 days is suggested as a payback', isPaybackCandidate(record, credit, when));
  const after = applyPayback(record, 6000);
  check('O2: NGN 4,000 is still owed after accepting it', after.remaining === 4000 && after.status === 'open');
  check('O2: a credit bigger than what is owed is never suggested', !isPaybackCandidate({ ...record, repaid: 6000 }, { amount: 9000 }, when));
}

// O3: the user taps "Forget it" -> NGN 4,000 becomes Gifts and events spending on
// the original date.
{
  const partially = { ...record, repaid: 6000 };
  const off = writeOff(partially);
  check('O3: the remaining NGN 4,000 is written off', off.remaining === 4000 && off.status === 'written_off');
  check('O3: it lands in Gifts and events, not a new category', off.category === 'Gifts and events');
}

// A credit outside the 90-day window, or before the loan, is never suggested.
{
  check('Too late (past 90 days) is never suggested', !isPaybackCandidate(record, { amount: 5000 }, new Date('2027-02-01')));
  check('Before the loan was made is never suggested', !isPaybackCandidate(record, { amount: 5000 }, new Date('2026-09-01')));
  check('A settled record never suggests another payback', !isPaybackCandidate({ ...record, status: 'settled' }, { amount: 100 }, new Date('2026-10-10')));
}

console.log(`\n${passed} passed, 0 failed`);
