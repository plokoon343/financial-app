'use strict';
// Run: node backend/lib/bankRegistry.test.js
const { resolveBank, extractAccountMask, jaroWinkler } = require('./bankRegistry');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };
const name = (t, s) => { const r = resolveBank(t, s); return r ? r.name : null; };

// The headline case: truncated sender ID.
check('PREMIUMTRST → Premium Trust', name('PREMIUMTRST\nAmt: NGN27,000.00 DR') === 'Premium Trust');
check('Premium-Trst → Premium Trust', name('Premium-Trst Alert: acct credited') === 'Premium Trust');
check('PREMIUMTRUSTBK contains → Premium Trust', name('From PREMIUMTRUSTBK') === 'Premium Trust');

// Clean names + tokens.
check('GTBank', name('Your GTBank account was debited') === 'GTBank');
check('GTB token', name('GTB: NGN5000 DR') === 'GTBank');
check('OPay', name('OPay credit alert') === 'OPay');
check('email domain', name('noreply@e.gtbank.com sent this') === 'GTBank');

// Short aliases must NOT false-hit inside a name (the OMOLA→MoMo bug).
check('OMOLA not MoMo', name('Trf from OMOLA, CHUKWUYEM IS') === null);
check('no bank token → null', name('Acct: 023****258 CR: NGN60.00 Desc: UIP Trf') === null);

// Fuzzy only fires on a sender ID, never body words.
check('fuzzy sender PREMIUMTRUST', name('random body', 'PREMIUMTRUXT') === 'Premium Trust'); // 1 typo in sender
check('body word never fuzzy', name('PREMIUMTRUXT in the body, no sender') === null);
check('ambiguous fuzzy → null', name('x', 'XYZQWERTY') === null);

// Account mask.
check('mask ****4120', extractAccountMask('Acct: ******4120') === '4120');
check('mask A/C', extractAccountMask('A/C 023****258') === '258');
check('no mask', extractAccountMask('no account here') === null);

// jaroWinkler sanity
check('jw identical', jaroWinkler('PREMIUMTRST', 'PREMIUMTRST') === 1);
check('jw close high', jaroWinkler('PREMIUMTRST', 'PREMIUMTRUST') >= 0.9);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
