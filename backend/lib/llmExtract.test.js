'use strict';
// Run: node backend/lib/llmExtract.test.js
const { buildExtractPrompt, parseExtract, validateExtract, extractAlertLLM } = require('./llmExtract');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

const RAW = 'Txn on your Polaris acct: N15,000 moved to JANE via mobile app on 12/09/2026. Bal 3,000';
const CREDIT = 'Polaris: Acct 12**34 CREDITED with NGN15,000.00 from JANE. Avail Bal NGN3,000.00';

// --- prompt ---
check('prompt includes the alert', buildExtractPrompt(RAW).includes('JANE'));
check('prompt truncates long input', buildExtractPrompt('x'.repeat(5000)).length < 3000);
check('prompt asks for a quote, not a number or a direction', buildExtractPrompt(RAW).includes('amount_text') && !/direction/i.test(buildExtractPrompt(RAW)));

// --- tolerant JSON ---
check('plain json', parseExtract('{"amount_text":"N10"}').amount_text === 'N10');
check('fenced json', parseExtract('```json\n{"a":5}\n```').a === 5);
check('garbage -> null', parseExtract('nope') === null);

// --- the amount: only a verbatim quote, parsed by code ---
const g = validateExtract({ is_transaction: true, amount_text: 'N15,000', merchant: 'JANE', date: '2026-09-12' }, RAW);
check('a verbatim quote is parsed by code', g && g.amount === 15000 && g.merchant === 'JANE' && g.date === '2026-09-12', g);
check('quote without a space after NGN still parses', validateExtract({ is_transaction: true, amount_text: 'NGN15,000.00' }, CREDIT)?.amount === 15000);
check('a quote not in the alert is rejected (invented)', validateExtract({ is_transaction: true, amount_text: 'N98,765' }, RAW) === null);
check('a re-formatted quote is rejected (must be exact)', validateExtract({ is_transaction: true, amount_text: '15000' }, RAW) === null);
check('the balance is rejected', validateExtract({ is_transaction: true, amount_text: '3,000' }, RAW) === null && validateExtract({ is_transaction: true, amount_text: 'NGN3,000.00' }, CREDIT) === null);
check('a bare number field is ignored (no amount_text)', validateExtract({ is_transaction: true, amount: 15000 }, RAW) === null);
check('not a transaction', validateExtract({ is_transaction: false }, RAW) === null);
check('a quote with no digits is rejected', validateExtract({ is_transaction: true, amount_text: 'JANE' }, RAW) === null);
check('bad date becomes null', validateExtract({ is_transaction: true, amount_text: 'N15,000', date: 'yesterday' }, RAW)?.date === null);

// --- the direction: rules only ---
const c = validateExtract({ is_transaction: true, amount_text: 'NGN15,000.00', direction: 'debit' }, CREDIT);
check('direction comes from the rules, not the model', c.type === 'income' && c.directionKnown, c);
const u = validateExtract({ is_transaction: true, amount_text: 'N15,000', direction: 'credit' }, RAW);
check('when the rules cannot tell, directionKnown is false (the user picks)', u.directionKnown === false, u);

// --- the provider call ---
(async () => {
  let seen = null;
  const run = async (req) => { seen = req; return { text: '{"is_transaction":true,"amount_text":"N15,000","merchant":"JANE"}', provider: 'gemini-paid' }; };
  const out = await extractAlertLLM(RAW, run);
  check('sends the prompt to the provider', seen.content.includes('JANE') && seen.system.includes('quoting'));
  check('returns the raw reply for validation', out.amount_text === 'N15,000');
  check('AI off gives null', (await extractAlertLLM(RAW, async () => null)) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
