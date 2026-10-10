'use strict';
// Run: node backend/lib/shareIngest.test.js
// Tests the pure share-candidate shaping. Parsed rows are synthetic (shaped like
// parseOneAlert output) so we test the mapping + confidence tiering, not the parser.
const assert = require('assert');
const { toCandidate, confidenceTier, guardText, MAX_SHARE_CHARS } = require('./shareIngest');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed += 1; };
const eq = (name, a, b) => { assert.strictEqual(a, b, `${name}: ${a} !== ${b}`); passed += 1; };

// A GTB-style debit → deterministic amount + debit direction, high confidence.
const gtbDebit = {
  amount: 5000, type: 'expense', description: 'POS SHOPRITE', bank: 'GTBank',
  accountMask: '4120', category: 'Shopping', date: '2026-09-20', confidence: 'high',
  _parse: { direction: 'debit' },
};
const c1 = toCandidate(gtbDebit);
eq('gtb amount', c1.amount, 5000);
eq('gtb direction', c1.direction, 'debit');
eq('gtb bank', c1.sourceBank, 'GTBank');
eq('gtb account', c1.account, '4120');
eq('gtb category', c1.suggestedCategory, 'Shopping');
ok('gtb occurredAt iso', c1.occurredAt && c1.occurredAt.startsWith('2026-09-20'));
eq('gtb confidence high', confidenceTier(gtbDebit), 'high');

// An OPay-style credit → credit direction from the parse; counterparty pulled out.
const opayCredit = {
  amount: 20000, type: 'income', description: 'Transfer from JOHN DOE', bank: 'OPay',
  accountMask: '0928', category: 'Transfer', date: '2026-09-21', confidence: 'high',
  _parse: { direction: 'credit' },
};
const c2 = toCandidate(opayCredit);
eq('opay direction', c2.direction, 'credit');
eq('opay counterparty', c2.counterparty, 'JOHN DOE');
eq('opay confidence high', confidenceTier(opayCredit), 'high');

// Direction falls back to type→credit/debit when the parse gave no explicit direction.
const noDir = { amount: 1000, type: 'income', description: 'Credit alert', confidence: 'medium' };
eq('fallback direction credit', toCandidate(noDir).direction, 'credit');
eq('medium tier is low', confidenceTier(noDir), 'low');

// Ambiguous (no clean amount) → null candidate (endpoint answers 422).
// Bug 2.1/2.2: no debit/credit wording means the user picks, never a guessed "money out".
eq('unknown direction -> null', toCandidate({ amount: 500, type: 'expense', directionKnown: false, confidence: 'low' }).direction, null);
eq('description passed through', toCandidate({ amount: 500, type: 'expense', description: 'POS PURCHASE SPAR' }).description, 'POS PURCHASE SPAR');
eq('no amount -> null', toCandidate({ amount: 0, type: 'expense', confidence: 'low' }), null);
eq('missing parse -> null', toCandidate(null), null);
eq('low tier for no-amount', confidenceTier({ amount: 0, confidence: 'low' }), 'low');

// guardText truncates oversized blobs, leaves normal alerts untouched.
eq('short text untouched', guardText('Debit NGN500'), 'Debit NGN500');
eq('oversized truncated', guardText('x'.repeat(MAX_SHARE_CHARS + 500)).length, MAX_SHARE_CHARS);
eq('empty safe', guardText(null), '');

console.log(`\n${passed} passed, 0 failed`);
