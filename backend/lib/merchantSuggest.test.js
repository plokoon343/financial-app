'use strict';
// Run: node backend/lib/merchantSuggest.test.js
const ms = require('./merchantSuggest');
const { isStripped } = require('./aiStrip');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const CATS = ['Food', 'Groceries', 'Transport', 'Shopping', 'Other'];

const txns = [
  { _id: 'a', description: 'POS PURCHASE SHOPRITE LEKKI 4500', category: 'Other', type: 'expense' },
  { _id: 'b', description: 'POS PURCHASE SHOPRITE LEKKI 1200', category: 'Other', type: 'expense' },
  { _id: 'c', description: 'WEB PMT KILIMANJARO 3400', category: 'Other', type: 'expense' },
  { _id: 'd', description: 'NIP TRF TO ADEBAYO OKONKWO 0123456789', category: 'Other', type: 'expense' },
  { _id: 'e', description: 'POS PURCHASE SHOPRITE LEKKI', category: 'Groceries', type: 'expense' },
  { _id: 'f', description: 'SALARY HARBOUR LTD', category: 'Other', type: 'income' },
];
const g = ms.merchantGroups(txns);
check('groups "Other" expenses by stripped merchant, biggest first', g.length === 2 && g[0].merchant === 'POS PURCHASE SHOPRITE LEKKI' && g[0].count === 2, g);
check('person transfers are never included', !g.some((x) => /ADEBAYO/.test(x.merchant)));
check('already-categorised rows and income are left alone', !g.some((x) => x.txnIds.includes('e') || x.txnIds.includes('f')));
check('groups are capped', ms.merchantGroups(Array.from({ length: 50 }, (_, i) => ({ _id: String(i), description: `SHOP ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'xyz'[i % 3]}`, category: 'Other', type: 'expense' })), 10).length === 10);

const prompt = ms.buildPrompt(g.map((x) => x.merchant), CATS);
check('the prompt carries no digits (passes the free-tier guard)', isStripped(prompt), prompt);
check('the prompt lists every merchant', prompt.includes('SHOPRITE') && prompt.includes('KILIMANJARO'));

const v = ms.validate({ items: [
  { merchant: 'pos purchase shoprite lekki', category: 'Groceries' },
  { merchant: 'WEB PMT KILIMANJARO', category: 'Other' },
  { merchant: 'Spar Ikeja', category: 'Groceries' },
  { merchant: 'WEB PMT KILIMANJARO', category: 'Loans' },
] }, g.map((x) => x.merchant), CATS);
check('a valid answer is kept (case-insensitive)', v.get('pos purchase shoprite lekki') === 'Groceries');
check('"Other" is not an answer', !v.has('web pmt kilimanjaro'));
check('merchants we did not ask about are dropped', !v.has('spar ikeja'));
check('categories we do not offer are dropped', v.size === 1);
check('junk replies are safe', ms.validate(null, ['A'], CATS).size === 0 && ms.validate('x', ['A'], CATS).size === 0);
check('a bare array reply is accepted', ms.validate([{ merchant: 'A', category: 'Food' }], ['A'], CATS).get('a') === 'Food');

console.log(`merchantSuggest: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
