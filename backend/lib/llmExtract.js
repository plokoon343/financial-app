// Tier-2 LLM extraction fallback for bank alerts (spec 6.1 hybrid, applied to the
// PARSER). Only the ambiguous tail the deterministic layer can't handle — unknown
// banks / unstructured wording — is sent here. The model PROPOSES a structured
// transaction; validateExtract checks it against the raw text so a hallucinated
// amount/direction is rejected. Reuses the same OpenAI-compatible providers as the
// purpose tier (Groq / Gemini). Pure except the injected fetch, so it unit-tests.

'use strict';

const EXTRACT_SYSTEM = 'You extract ONE financial transaction from a bank alert (SMS or email). Reply with JSON only, no prose.';

function buildExtractPrompt(text) {
  return [
    'Bank alert:',
    '"""',
    (text || '').slice(0, 2000),
    '"""',
    '',
    'Return JSON exactly like:',
    '{"is_transaction": true, "amount": 1500.00, "direction": "credit"|"debit", "merchant": "who the money went to or came from (short)", "date": "YYYY-MM-DD or null"}',
    '',
    'Rules: amount is the TRANSACTION amount, never the account balance. direction is "credit" if money came IN, "debit" if money went OUT. If this is not a real money-movement alert (OTP, promo, balance enquiry, card delivery), return {"is_transaction": false}.',
  ].join('\n');
}

// Tolerant JSON extraction (handles fences / prose wrappers).
function parseExtract(txt) {
  let o;
  try { o = JSON.parse(txt); }
  catch { const m = (txt || '').match(/\{[\s\S]*\}/); if (!m) return null; try { o = JSON.parse(m[0]); } catch { return null; } }
  return o && typeof o === 'object' ? o : null;
}

// Validate the model's extraction against the RAW text (anti-hallucination):
//  - must be flagged a transaction with a positive amount,
//  - the amount's integer part must literally appear in the alert's digits,
//  - direction must be credit|debit.
// Returns { amount, type, merchant, date } or null.
function validateExtract(ex, rawText) {
  if (!ex || ex.is_transaction === false) return null;
  const amount = Number(ex.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const digits = (rawText || '').replace(/[^\d]/g, '');
  const intPart = String(Math.trunc(amount));
  if (intPart.length >= 2 && !digits.includes(intPart)) return null; // amount not in text → reject
  const dir = (ex.direction || '').toString().toLowerCase();
  if (dir !== 'credit' && dir !== 'debit') return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ex.date || '') ? ex.date : null;
  return { amount: +amount.toFixed(2), type: dir === 'credit' ? 'income' : 'expense', merchant: (ex.merchant || '').toString().replace(/\s+/g, ' ').trim().slice(0, 140), date };
}

// Call an OpenAI-compatible provider (Groq/Gemini) to extract; returns the RAW parsed
// object (validate it with validateExtract). Throws on transport/HTTP error.
async function extractAlertOpenAICompat(text, cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model, temperature: 0, max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: EXTRACT_SYSTEM }, { role: 'user', content: buildExtractPrompt(text) }],
    }),
  });
  if (!res.ok) { const b = await res.text().catch(() => ''); throw new Error(`${cfg.name} ${res.status} ${b.slice(0, 150)}`); }
  const data = await res.json();
  return parseExtract(data?.choices?.[0]?.message?.content || '{}');
}

module.exports = { EXTRACT_SYSTEM, buildExtractPrompt, parseExtract, validateExtract, extractAlertOpenAICompat };
