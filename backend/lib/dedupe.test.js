'use strict';
// Run: node backend/lib/dedupe.test.js
const { normalizeCounterparty, fingerprint, matchScore, classify, splitDuplicates, jaroWinkler } = require('./dedupe');

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

// --- splitDuplicates (phone check P3, 8 Nov 2026): a certain duplicate (the ₦50
// Commission at 01:00 in the finding, identical amount/name/time) must never
// become a card - only a genuinely ambiguous pair is worth asking about. ---
{
  const pairs = [
    { a: { id: 'x1' }, b: { id: 'x2' }, score: sIdentical },   // 110: certain
    { a: { id: 'p1' }, b: { id: 'p2' }, score: sProbable },    // 70-84: ambiguous
    { a: { id: 'd1' }, b: { id: 'd2' }, score: sDistinct },    // <70: not a pair at all
  ];
  const { merge, ask } = splitDuplicates(pairs);
  check('an exact duplicate is merged, never a card', merge.length === 1 && merge[0].a.id === 'x1');
  check('an exact duplicate never reaches the ask list', !ask.some((p) => p.a.id === 'x1'));
  check('an ambiguous pair is still asked about', ask.length === 1 && ask[0].a.id === 'p1');
  check('a distinct pair is neither merged nor asked', merge.length + ask.length === 2);
}

// jaro-winkler sanity
check('jw identical=1', jaroWinkler('shoprite', 'shoprite') === 1);
check('jw close>0.8', jaroWinkler('SHOPRITE LEKKI', 'SHOPRITE LEKKI LAGOS') > 0.8);
check('jw far<0.5', jaroWinkler('JUMIA', 'KONGA') < 0.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
