'use strict';
// Run: node backend/lib/llmExtract.test.js
const { buildExtractPrompt, parseExtract, validateExtract, extractAlertOpenAICompat } = require('./llmExtract');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const RAW = 'Txn on your Polaris acct: N15,000 moved to JANE via mobile app on 12/09/2026. Bal 3,000';

// --- prompt safety ---
check('prompt includes the alert', buildExtractPrompt(RAW).includes('JANE'));
check('prompt truncates long input', buildExtractPrompt('x'.repeat(5000)).length < 3000);

// --- tolerant JSON ---
check('plain json', parseExtract('{"amount":10}').amount === 10);
check('fenced json', parseExtract('```json\n{"amount":5}\n```').amount === 5);
check('garbage -> null', parseExtract('nope') === null);

// --- validation: accepts a good extraction whose amount appears in the text ---
const good = validateExtract({ is_transaction: true, amount: 15000, direction: 'credit', merchant: 'JANE', date: '2026-09-12' }, RAW);
check('valid credit', good && good.type === 'income' && good.amount === 15000 && good.merchant === 'JANE' && good.date === '2026-09-12');
const goodDebit = validateExtract({ is_transaction: true, amount: 15000, direction: 'debit', merchant: 'JANE' }, RAW);
check('valid debit -> expense', goodDebit && goodDebit.type === 'expense' && goodDebit.date === null);

// --- validation: rejects hallucinations / bad shapes ---
check('reject not-a-transaction', validateExtract({ is_transaction: false }, RAW) === null);
check('reject amount not in text (hallucinated)', validateExtract({ is_transaction: true, amount: 98765, direction: 'debit' }, RAW) === null);
check('reject zero amount', validateExtract({ is_transaction: true, amount: 0, direction: 'debit' }, RAW) === null);
check('reject missing direction', validateExtract({ is_transaction: true, amount: 15000 }, RAW) === null);
check('reject bad direction', validateExtract({ is_transaction: true, amount: 15000, direction: 'sideways' }, RAW) === null);
check('reject bad date -> null date but still valid', (() => { const r = validateExtract({ is_transaction: true, amount: 15000, direction: 'credit', date: 'yesterday' }, RAW); return r && r.date === null; })());

// --- the request wiring (mock fetch) ---
(async () => {
  let seen = null;
  const mockFetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"is_transaction":true,"amount":15000,"direction":"credit","merchant":"JANE","date":"2026-09-12"}' } }] }) };
  };
  const cfg = { baseURL: 'https://api.groq.com/openai/v1', apiKey: 'k', model: 'llama-3.3-70b-versatile', name: 'groq' };
  const out = await extractAlertOpenAICompat(RAW, cfg, mockFetch);
  check('calls chat/completions', seen.url.endsWith('/chat/completions'));
  check('json mode + temp0', seen.body.response_format.type === 'json_object' && seen.body.temperature === 0);
  check('bearer key', seen.auth === 'Bearer k');
  check('parses model reply', out.amount === 15000 && out.direction === 'credit');

  let threw = false;
  try { await extractAlertOpenAICompat(RAW, cfg, async () => ({ ok: false, status: 500, text: async () => 'err' })); } catch { threw = true; }
  check('throws on HTTP error', threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
