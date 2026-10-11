// AI fallback for bank alerts the rules can't read (unknown banks, odd wording). The
// model never decides the amount or the direction:
//  - it may only POINT at the amount, by quoting it exactly as written in the alert;
//    the quote must appear verbatim, must not be the balance, and the code parses it;
//  - the direction comes from the deterministic rules (lib/alertParse), never the model.
// A rescued alert always goes to review; it is never saved automatically. The alert
// carries personal data, so this runs on the PERSONAL provider only (paid Gemini).
// Pure except the injected chat call, so it unit-tests.

'use strict';

const { normalizeAmount } = require('./amount');
const { detectDirection } = require('./alertParse');

const EXTRACT_SYSTEM = 'You find the transaction amount in ONE bank alert (SMS or email) by quoting it exactly as written. Reply with JSON only, no prose.';

function buildExtractPrompt(text) {
  return [
    'Bank alert:',
    '"""',
    (text || '').slice(0, 2000),
    '"""',
    '',
    'Return JSON exactly like:',
    '{"is_transaction": true, "amount_text": "the transaction amount copied character for character from the alert, e.g. NGN15,000.00", "merchant": "who the money went to or came from (short)", "date": "YYYY-MM-DD or null"}',
    '',
    'Rules: amount_text is the TRANSACTION amount, never the account balance, copied exactly. If this is not a real money-movement alert (OTP, promo, balance enquiry, card delivery), return {"is_transaction": false}.',
  ].join('\n');
}

// Tolerant JSON extraction (handles fences / prose wrappers).
function parseExtract(txt) {
  let o;
  try { o = JSON.parse(txt); }
  catch { const m = (txt || '').match(/\{[\s\S]*\}/); if (!m) return null; try { o = JSON.parse(m[0]); } catch { return null; } }
  return o && typeof o === 'object' ? o : null;
}

// Check the model's pointer against the RAW alert and build the row from rules:
//  - amount_text must appear verbatim in the alert and parse to a clear positive amount;
//  - it must not be the balance (no "bal"/"avail" just before it);
//  - direction is read by detectDirection; when the rules can't tell, directionKnown is
//    false and the user picks.
// Returns { amount, type, directionKnown, merchant, date, amountText } or null.
function validateExtract(ex, rawText) {
  if (!ex || ex.is_transaction === false) return null;
  const raw = String(rawText || '');
  const quote = String(ex.amount_text || '').trim();
  if (!quote || quote.length > 30 || !/\d/.test(quote)) return null;
  const at = raw.indexOf(quote);
  if (at < 0) return null;                                         // not in the alert: invented
  if (/\b(bal|balance|avail|available|ledger)\b[^\d]{0,12}$/i.test(raw.slice(Math.max(0, at - 20), at))) return null;
  const n = normalizeAmount(quote.replace(/([A-Za-z₦])(?=\d)/g, '$1 ')); // "NGN15,000" -> "NGN 15,000"
  if (n.value == null || n.ambiguous || !(n.value > 0)) return null;
  const dir = detectDirection(raw);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ex.date || '') ? ex.date : null;
  return {
    amount: +n.value.toFixed(2), type: dir.type, directionKnown: dir.conf !== 'low',
    merchant: (ex.merchant || '').toString().replace(/\s+/g, ' ').trim().slice(0, 140), date, amountText: quote,
  };
}

// Ask the model; returns the RAW parsed object (validate it with validateExtract).
// `run` is the provider call (aiProviders.runPersonal); null when AI is off.
async function extractAlertLLM(text, run) {
  const r = await run({ system: EXTRACT_SYSTEM, content: buildExtractPrompt(text), maxTokens: 300 });
  if (!r) return null;
  return parseExtract(r.text || '{}');
}

module.exports = { EXTRACT_SYSTEM, buildExtractPrompt, parseExtract, validateExtract, extractAlertLLM };
