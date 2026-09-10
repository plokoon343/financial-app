'use strict';
// Run: node backend/lib/purposeInference.test.js
const {
  PURPOSE_IDS, isGenericCategory, redactCounterparty, counterpartyKey, cadenceOf,
  buildCandidates, proposalToolSchema, buildInferencePrompt, validateProposals,
} = require('./purposeInference');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// --- generic-category detection ---
check('empty is generic', isGenericCategory(''));
check('Transfer is generic', isGenericCategory('Transfer'));
check('OTHER is generic', isGenericCategory('OTHER'));
check('Food is not generic', isGenericCategory('Food') === false);

// --- redaction (privacy: no digits leave) ---
check('redact strips account no', !/\d/.test(redactCounterparty('TRANSFER TO JOHN DOE 0123456789')));
check('redact keeps the name', /john doe/i.test(redactCounterparty('NIP/0123456789/JOHN DOE/GTB')));
check('redact strips ref codes', !/\d/.test(redactCounterparty('POS REF A1B2C3 SHOPRITE 4567')));
check('redact caps length', redactCounterparty('x'.repeat(200)).length <= 60);

// --- grouping key ---
check('key ignores digits/case', counterpartyKey('JOHN DOE 123') === counterpartyKey('john doe 456'));
check('key empty for pure number', counterpartyKey('0123456789') === '');

// --- cadence ---
check('one-off', cadenceOf(['2026-01-01']) === 'one-off');
check('monthly', cadenceOf(['2026-01-01', '2026-02-01', '2026-03-01']) === 'monthly');
check('weekly', cadenceOf(['2026-01-01', '2026-01-08', '2026-01-15']) === 'weekly');

// --- candidate building ---
const txns = [
  { _id: 'a1', description: 'TRANSFER TO KUNLE ADEBAYO 0123456789', amount: -150000, category: 'Transfer', type: 'expense', date: '2026-01-03' },
  { _id: 'a2', description: 'NIP/KUNLE ADEBAYO/9988776655', amount: -150000, category: '', type: 'expense', date: '2026-02-03' },
  { _id: 'a3', description: 'KUNLE ADEBAYO', amount: -150000, category: 'Transfer', type: 'expense', date: '2026-03-03' },
  { _id: 'b1', description: 'SHOPRITE', amount: -5000, category: 'Food', type: 'expense', date: '2026-01-10' }, // already categorised -> excluded
  { _id: 'c1', description: 'From MUM', amount: 40000, category: 'Transfer', type: 'income', date: '2026-01-15' },
  { _id: 'd1', description: 'OWN SAVINGS 111', amount: -100000, category: 'Transfer', type: 'internal_transfer', date: '2026-01-20' }, // excluded kind
];
const cands = buildCandidates(txns);
const kunle = cands.find((c) => /kunle/i.test(c.counterparty));
check('candidate groups the 3 Kunle rows', kunle && kunle.count === 3);
check('candidate direction out', kunle && kunle.direction === 'out');
check('candidate cadence monthly', kunle && kunle.cadence === 'monthly');
check('candidate avg amount', kunle && kunle.avgAmount === 150000);
check('candidate carries no digits', kunle && !/\d/.test(kunle.counterparty));
check('categorised row excluded', !cands.some((c) => /shoprite/i.test(c.counterparty)));
check('excluded-kind row excluded', !cands.some((c) => /savings/i.test(c.counterparty)));
check('income counterparty present', cands.some((c) => /mum/i.test(c.counterparty) && c.direction === 'in'));

// --- tool schema ---
const schema = proposalToolSchema();
check('schema forces enum', JSON.stringify(schema.input_schema).includes(PURPOSE_IDS[0]));
check('schema is strict', schema.strict === true);

// --- prompt is privacy-safe (no raw account numbers) ---
const prompt = buildInferencePrompt(cands);
check('prompt leaks no account numbers', !prompt.includes('0123456789') && !prompt.includes('9988776655'));
check('prompt references each candidate', prompt.includes('#0'));

// --- proposal validation ---
const refKunle = cands.indexOf(kunle);
const proposals = [
  { ref: refKunle, purpose: 'rent', confidence: 'high', reason: 'Same large amount monthly' },
  { ref: refKunle, purpose: 'family', confidence: 'low' },          // dropped: low confidence
  { ref: 999, purpose: 'rent', confidence: 'high' },                 // dropped: bad ref
  { ref: 0, purpose: 'other', confidence: 'high' },                  // dropped: no-op purpose
  { ref: 0, purpose: 'not_a_purpose', confidence: 'high' },          // dropped: off allow-list
];
const valid = validateProposals(proposals, cands);
check('validation keeps only the good rent proposal', valid.length === 1);
check('validation maps to category', valid[0].category === 'Rent & Housing');
check('validation carries txnIds', Array.isArray(valid[0].txnIds) && valid[0].txnIds.length === 3);
check('validation drops low confidence', !valid.some((v) => v.confidence === 'low'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
