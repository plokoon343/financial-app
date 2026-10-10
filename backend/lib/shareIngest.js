// Share-to-Automonie ingestion helpers (share-sheet channel). Pure + dependency-free
// so they can be unit-tested; server.js runs the shared text through the SAME
// deterministic parser used for SMS/email (parseOneAlert), then maps each parsed row
// into the share API candidate here.
//
// NON-NEGOTIABLE: amount and debit/credit direction come ONLY from the deterministic
// parse. This module never invents either: if the parse didn't produce a clean
// amount, toCandidate returns null (→ the endpoint answers 422 "no transaction").

'use strict';

const { extractCounterparty } = require('./counterparty');

// Map a parsed alert row (from parseOneAlert) into the share confirm candidate.
// Returns null when there is no usable amount, so a non-transaction share is dropped.
function toCandidate(parsed) {
  if (!parsed || !(Number(parsed.amount) > 0)) return null;
  // Direction is deterministic: the parser's own credit/debit, else income→credit.
  // When the text has no debit/credit wording at all it is null and the user picks;
  // guessing "money out" is how credits ended up shown as spending.
  const direction = parsed.directionKnown === false ? null
    : (parsed._parse && parsed._parse.direction) || (parsed.type === 'income' ? 'credit' : 'debit');
  const cp = extractCounterparty(parsed.description || parsed.raw || '');
  let occurredAt = null;
  if (parsed.date) { const d = new Date(parsed.date); if (!isNaN(d)) occurredAt = d.toISOString(); }
  return {
    amount: +Number(parsed.amount).toFixed(2),
    direction,
    counterparty: (cp && cp.name) || null,
    description: parsed.description || null,
    sourceBank: parsed.bank || null,
    suggestedCategory: parsed.category || null,
    account: parsed.accountMask || null,
    occurredAt,
  };
}

// Confidence tier for the confirm sheet. 'high' = clean deterministic parse (one-tap);
// otherwise 'low' so the sheet opens with the uncertain fields flagged for the user.
// (Anything below a fully-confident deterministic parse is 'low': the AI never fills
// the gap.)
function confidenceTier(parsed) {
  return parsed && parsed.confidence === 'high' && Number(parsed.amount) > 0 ? 'high' : 'low';
}

// Defensive size guard: bank alerts are short; anything huge is a pasted statement or
// junk. Truncate before parse (never persist/parse an oversized blob whole).
const MAX_SHARE_CHARS = 10000;
function guardText(text) {
  const s = (text || '').toString();
  return s.length > MAX_SHARE_CHARS ? s.slice(0, MAX_SHARE_CHARS) : s;
}

module.exports = { toCandidate, confidenceTier, guardText, MAX_SHARE_CHARS };
