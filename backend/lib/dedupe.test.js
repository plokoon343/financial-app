'use strict';
// Run: node backend/lib/dedupe.test.js
const { normalizeCounterparty, fingerprint, matchScore, classify, jaroWinkler } = require('./dedupe');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };
const score = (a, b) => matchScore(fingerprint(a), fingerprint(b));

// --- counterparty normalisation ---
check('cp strips rail noise + ref', normalizeCounterparty('NIP TRF FRM SAMUEL OLAMIDE/REF:0091823') === 'SAMUEL OLAMIDE');
check('cp strips POS + terminal', normalizeCounterparty('POS PUR 1234TERM SHOPRITE LEKKI') === 'SHOPRITE LEKKI');
check('cp empty', normalizeCounterparty('') === '');

// --- scoring ---
const gtbDebit = (amt, date, desc) => ({ amount: amt, type: 'expense', date, bank: 'GTB', description: desc });

// identical cross-source -> auto-merge
const sIdentical = score(gtbDebit(5000, '2026-08-01', 'POS SHOPRITE LEKKI'), gtbDebit(5000, '2026-08-01', 'NIP TRF TO SHOPRITE LEKKI/REF:9'));
check('identical -> 110', sIdentical === 110);
check('identical -> duplicate', classify(sIdentical) === 'duplicate');

// fuzzy payee, same amount/day/bank -> merge
const sFuzzy = score(gtbDebit(5000, '2026-08-01', 'POS SHOPRITE LEKKI'), gtbDebit(5000, '2026-08-01', 'POS SHOPRITE LEKKI LAGOS'));
check('fuzzy payee -> duplicate', classify(sFuzzy) === 'duplicate' && sFuzzy >= 100);

// different amount -> disqualified
check('diff amount -> 0', score(gtbDebit(5000, '2026-08-01', 'X'), gtbDebit(5001, '2026-08-01', 'X')) === 0);
// different direction -> disqualified
check('diff direction -> 0', score({ amount: 5000, type: 'expense', date: '2026-08-01', bank: 'GTB', description: 'X' }, { amount: 5000, type: 'income', date: '2026-08-01', bank: 'GTB', description: 'X' }) === 0);

// probable band (70-84): different account, 1 day apart, fuzzy payee
const sProbable = score(
  { amount: 5000, type: 'expense', date: '2026-08-01', bank: 'GTB', description: 'POS SHOPRITE LEKKI' },
  { amount: 5000, type: 'expense', date: '2026-08-02', bank: 'ACCESS', description: 'POS SHOPRITE LEKKI LAGOS' },
);
check('probable band 70-84', sProbable >= 70 && sProbable < 85, classify(sProbable) === 'probable');
check('probable classify', classify(sProbable) === 'probable');

// distinct: same amount, different bank, days apart, unrelated payee
const sDistinct = score(
  { amount: 5000, type: 'expense', date: '2026-08-01', bank: 'GTB', description: 'JUMIA ORDER' },
  { amount: 5000, type: 'expense', date: '2026-08-09', bank: 'ACCESS', description: 'KONGA STORE' },
);
check('distinct < 70', sDistinct < 70 && classify(sDistinct) === 'distinct');

// jaro-winkler sanity
check('jw identical=1', jaroWinkler('shoprite', 'shoprite') === 1);
check('jw close>0.8', jaroWinkler('SHOPRITE LEKKI', 'SHOPRITE LEKKI LAGOS') > 0.8);
check('jw far<0.5', jaroWinkler('JUMIA', 'KONGA') < 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
