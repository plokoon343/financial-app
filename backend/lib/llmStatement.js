// LLM statement extractor — the sustainability layer. When no deterministic parser
// recognises a statement's layout, we send its raw text to an OpenAI-compatible model
// (Gemini/Groq, same config as the purpose/alert tiers) and get structured rows back.
// This is what lets a brand-new bank/fintech format import with ZERO per-bank code.
//
// An LLM must never be trusted with money on its own, so nothing here is trusted
// blindly: every row is validated against the raw text (the amount's digits must
// actually appear), and the caller re-checks the whole ledger with the reconciliation
// oracle (opening + credits − debits = closing). If it doesn't balance, it's rejected
// exactly like any other parse. Pure except the injected fetch, so it unit-tests.

'use strict';

const STMT_SYSTEM = 'You extract transactions from a bank or wallet statement. The text is raw and the columns may be jumbled or split across lines. Reply with JSON only, no prose.';

function buildStatementPrompt(chunk) {
  return [
    'Here is part of a bank/wallet statement (raw extracted text):',
    '"""',
    (chunk || '').slice(0, 12000),
    '"""',
    '',
    'Extract EVERY real transaction. Return JSON exactly like:',
    '{"transactions":[{"date":"YYYY-MM-DD","description":"short payee or narration","amount":1234.56,"direction":"credit"}]}',
    '',
    'Rules:',
    '- amount is the TRANSACTION amount, NEVER the running/closing balance.',
    '- direction is "credit" if money came IN, "debit" if money went OUT.',
    '- date must be YYYY-MM-DD.',
    '- If a transaction spans several lines, combine them into one entry.',
    '- Skip headers, summaries, totals, and anything that is not a real money movement.',
    '- If there are none in this text, return {"transactions":[]}.',
  ].join('\n');
}

// Tolerant JSON parse (handles code fences / prose wrappers), returns the array.
function parseStatementRows(txt) {
  let o;
  try { o = JSON.parse(txt); }
  catch { const m = (txt || '').match(/\{[\s\S]*\}/); if (!m) return []; try { o = JSON.parse(m[0]); } catch { return []; } }
  const arr = o && Array.isArray(o.transactions) ? o.transactions : (Array.isArray(o) ? o : []);
  return arr;
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Validate model rows against the RAW text (anti-hallucination) and normalise them.
// Keeps only rows whose amount digits actually appear in the source text.
function validateStatementRows(rows, rawText) {
  const digits = (rawText || '').replace(/[^\d]/g, '');
  const out = [];
  for (const r of (rows || [])) {
    const amount = Number(r && r.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const intPart = String(Math.trunc(amount));
    if (intPart.length >= 2 && !digits.includes(intPart)) continue; // amount not in source → drop
    const dir = (r.direction || '').toString().toLowerCase();
    if (dir !== 'credit' && dir !== 'debit') continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null;
    if (!date) continue;
    const description = (r.description || '').toString().replace(/\s+/g, ' ').trim().slice(0, 160) || 'Transaction';
    out.push({ date, description, amount: round2(amount), type: dir === 'credit' ? 'income' : 'expense' });
  }
  return out;
}

// Split long statement text into overlapping chunks so a multi-page statement fits
// the model context without a transaction being cut across a boundary (the overlap +
// the caller's de-dup recover any straddling row). Splits on line breaks.
function chunkStatementText(rawText, { size = 9000, overlap = 500 } = {}) {
  const text = (rawText || '');
  if (text.length <= size) return text.trim() ? [text] : [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end);
      if (nl > start + size * 0.5) end = nl; // prefer a line boundary
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

// De-duplicate rows assembled from overlapping chunks: same day + direction + amount
// + a description prefix is the same transaction seen twice.
function dedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const key = `${r.date}|${r.type}|${r.amount}|${(r.description || '').toLowerCase().slice(0, 24)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// One provider call for a chunk; returns validated rows for that chunk. Throws on
// transport/HTTP error so the caller can decide to fall back.
async function extractStatementChunk(chunk, cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model, temperature: 0, max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: STMT_SYSTEM }, { role: 'user', content: buildStatementPrompt(chunk) }],
    }),
  });
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error(`${cfg.name} ${res.status} ${b.slice(0, 150)}`); }
  const data = await res.json();
  return validateStatementRows(parseStatementRows(data?.choices?.[0]?.message?.content || '{}'), chunk);
}

// Full extraction over a whole statement: chunk → extract each → merge → de-dup →
// sort by date. `maxChunks` caps cost on very large statements. Never throws (a chunk
// error is skipped); returns [] when nothing valid came back.
async function extractStatement(rawText, cfg, { fetchImpl = fetch, maxChunks = 14 } = {}) {
  const chunks = chunkStatementText(rawText).slice(0, maxChunks);
  const all = [];
  for (const chunk of chunks) {
    try { all.push(...await extractStatementChunk(chunk, cfg, fetchImpl)); }
    catch (e) { if (typeof console !== 'undefined') console.error('[llmStatement] chunk failed:', e.message); }
  }
  const rows = dedupeRows(all).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

module.exports = {
  STMT_SYSTEM, buildStatementPrompt, parseStatementRows, validateStatementRows,
  chunkStatementText, dedupeRows, extractStatementChunk, extractStatement,
};
