'use strict';
// Run: node backend/lib/llmStatement.test.js
const {
  parseStatementRows, validateStatementRows, chunkStatementText, dedupeRows, extractStatement,
} = require('./llmStatement');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// --- tolerant JSON parse ---
check('parses clean json', parseStatementRows('{"transactions":[{"amount":1}]}').length === 1);
check('parses fenced json', parseStatementRows('```json\n{"transactions":[{"amount":1}]}\n```').length === 1);
check('parses bare array', parseStatementRows('[{"amount":1}]').length === 1);
check('bad json -> []', parseStatementRows('not json').length === 0);

// --- validation / anti-hallucination ---
const RAW = 'Electricity 3,100.00 debit\nTransfer from ADA 2,000.00 credit\n25 Jul 2026';
const rows = validateStatementRows([
  { date: '2026-07-26', description: 'Electricity', amount: 3100, direction: 'debit' },
  { date: '2026-07-25', description: 'Transfer from ADA', amount: 2000, direction: 'credit' },
  { date: '2026-07-25', description: 'Hallucinated', amount: 99999, direction: 'debit' }, // digits not in RAW
  { date: '2026-07-25', description: 'no direction', amount: 500, direction: '' },
  { date: 'bad-date', description: 'bad date', amount: 100, direction: 'debit' },
  { date: '2026-07-25', description: 'zero', amount: 0, direction: 'debit' },
], RAW);
check('keeps the 2 real rows only', rows.length === 2);
check('drops hallucinated amount (not in source)', !rows.some(r => r.amount === 99999));
check('maps credit->income, debit->expense', rows.find(r => r.amount === 2000).type === 'income' && rows.find(r => r.amount === 3100).type === 'expense');

// --- chunking ---
const big = Array.from({ length: 400 }, (_, i) => `line ${i} value ${i}.00`).join('\n');
const chunks = chunkStatementText(big, { size: 1000, overlap: 100 });
check('splits big text into several chunks', chunks.length > 3);
check('chunks overlap (recover straddling rows)', chunks.length > 1 && big.indexOf(chunks[1].slice(0, 20)) < big.indexOf(chunks[0].slice(-20)) + chunks[0].length);
check('short text -> single chunk', chunkStatementText('one line').length === 1);
check('empty text -> no chunks', chunkStatementText('   ').length === 0);

// --- dedupe across overlaps ---
const dd = dedupeRows([
  { date: '2026-07-25', type: 'income', amount: 2000, description: 'Transfer from ADA' },
  { date: '2026-07-25', type: 'income', amount: 2000, description: 'Transfer from ADA' },   // exact overlap dup -> drop
  { date: '2026-07-25', type: 'income', amount: 2000, description: 'Transfer from MARY' },  // different payee -> keep
  { date: '2026-07-25', type: 'expense', amount: 2000, description: 'Transfer from ADA' },  // different direction -> keep
]);
check('dedupes exact overlap dup, keeps distinct payee/direction', dd.length === 3);

// --- full extract with a fake provider ---
(async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify({ transactions: [
      { date: '2026-07-26', description: 'Electricity', amount: 3100, direction: 'debit' },
      { date: '2026-07-25', description: 'Transfer from ADA', amount: 2000, direction: 'credit' },
    ] }) } }] }),
  });
  const cfg = { baseURL: 'http://x', apiKey: 'k', model: 'm', name: 'fake' };
  const out = await extractStatement(RAW, cfg, { fetchImpl: fakeFetch });
  check('extractStatement returns validated, sorted rows', out.length === 2 && out[0].date <= out[1].date);

  // provider error on a chunk is swallowed -> [] not a throw
  const boomFetch = async () => ({ ok: false, status: 500, text: async () => 'err' });
  const out2 = await extractStatement(RAW, cfg, { fetchImpl: boomFetch });
  check('provider error -> [] (never throws)', Array.isArray(out2) && out2.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
