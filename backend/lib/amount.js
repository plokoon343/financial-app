'use strict';

// Amount normalisation — the single source of truth for turning any human/parsed
// amount string into a number. Used by every input path (voice, SMS, statement,
// manual) so a "5,000" never becomes "50,000".
//
//   normalizeAmount('2.5k') -> { value: 2500, confidence: 'high', ambiguous: false, original: '2.5k', reason: null }
//
// Rules: strips currency (₦, N, NGN, naira); applies k/m/b (and word) multipliers;
// understands English number words incl. compounds ("two thousand five hundred");
// strips thousands separators; NEVER guesses on ambiguity — returns value:null so
// the caller can send the field back to the user empty.

const MULT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 };

const SMALL = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };

const DEFAULTS = { floor: 1, ceiling: 100_000_000 };

const ok = (value, confidence, original) => ({ value, confidence, ambiguous: false, original, reason: null });
const bad = (original, reason, ambiguous = true) => ({ value: null, confidence: 'low', ambiguous, original, reason });

// Parse a run of English number words into an integer, or null if any token is
// unknown. Handles "and", "hundred", and the thousand/million/billion scales.
function parseIntWords(str) {
  const tokens = str.replace(/\band\b/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let total = 0, current = 0, sawAny = false;
  for (const tk of tokens) {
    if (SMALL[tk] != null) { current += SMALL[tk]; sawAny = true; }
    else if (TENS[tk] != null) { current += TENS[tk]; sawAny = true; }
    else if (tk === 'hundred') { current = (current || 1) * 100; sawAny = true; }
    else if (SCALES[tk]) { total += (current || 1) * SCALES[tk]; current = 0; sawAny = true; }
    else return null;
  }
  return sawAny ? total + current : null;
}

// "one point five" -> 1.5 ; "two thousand five hundred" -> 2500
function wordsToNumber(str) {
  const parts = str.split(/\bpoint\b/);
  if (parts.length > 2) return null;
  const intVal = parseIntWords(parts[0]);
  if (intVal == null) return null;
  if (parts.length === 1) return intVal;
  const digits = parts[1].trim().split(/\s+/).filter(Boolean).map((w) => SMALL[w]);
  if (!digits.length || digits.some((d) => d == null)) return null;
  return intVal + parseFloat('0.' + digits.join(''));
}

// Parse a purely numeric string (no currency, no multiplier). Distinguishes
// "1,500" (thousands) from "1.500" (ambiguous). Returns { value } or { reason }.
function parseNumeric(raw) {
  const s = raw.replace(/\s+/g, '');
  if (!/[\d]/.test(s)) return { reason: 'not_numeric' };
  const hasComma = s.includes(',');
  const dots = (s.match(/\./g) || []).length;
  if (dots > 1) return { reason: 'multiple_decimals' };

  if (hasComma && dots === 1) {
    const cleaned = s.replace(/,/g, '');
    if (!/^\d+\.\d+$/.test(cleaned)) return { reason: 'malformed' };
    return { value: parseFloat(cleaned) };
  }
  if (hasComma && dots === 0) {
    const parts = s.split(',');
    if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((p) => /^\d{3}$/.test(p))) {
      return { value: parseInt(parts.join(''), 10) };
    }
    return { reason: 'ambiguous_comma' };
  }
  if (!hasComma && dots === 1) {
    const [i, d] = s.split('.');
    if (!/^\d+$/.test(i) || !/^\d+$/.test(d)) return { reason: 'malformed' };
    // "1.500": three trailing digits with no comma anywhere is ambiguous — could be
    // 1500 (dot as a thousands sep) or 1.5. Don't guess.
    if (d.length === 3) return { reason: 'ambiguous_dot_thousands' };
    return { value: parseFloat(s) };
  }
  if (!hasComma && dots === 0) {
    if (!/^\d+$/.test(s)) return { reason: 'not_numeric' };
    return { value: parseInt(s, 10) };
  }
  return { reason: 'unparseable' };
}

function normalizeAmount(input, opts = {}) {
  const { floor, ceiling } = { ...DEFAULTS, ...opts };
  const original = input == null ? '' : String(input);
  let s = original.toLowerCase().trim();
  if (!s) return bad(original, 'empty', false);

  // Strip currency markers: ₦, NGN, naira, and a leading N before a number.
  s = s.replace(/₦/g, ' ').replace(/\bngn\b/g, ' ').replace(/\bnaira\b/g, ' ');
  s = s.replace(/\bn(?=\s*[\d.])/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return bad(original, 'empty', false);

  const bounded = (value, confidence) => {
    if (!isFinite(value)) return bad(original, 'not_finite');
    if (value < floor) return bad(original, 'below_minimum');
    if (value > ceiling) return bad(original, 'above_maximum');
    return ok(Math.round(value * 100) / 100, confidence, original);
  };

  // Numeric, with an optional trailing multiplier: 2000, 2,000, 2.5k, 1.5m.
  let m = s.match(/^([\d][\d,\s.]*)\s*(k|m|b|thousand|million|billion)?$/);
  if (m) {
    const r = parseNumeric(m[1]);
    if (r.reason) return bad(original, r.reason);
    const factor = m[2] ? MULT[m[2]] : 1;
    return bounded(r.value * factor, 'high');
  }

  // Word path. Peel a trailing multiplier word/letter, then parse the words.
  let factor = 1;
  const suf = s.match(/[\s]?(k|m|b|thousand|million|billion)$/);
  if (suf) {
    // Only peel a scale if there is something before it (else "thousand" alone is nonsense).
    const before = s.slice(0, s.length - suf[0].length).trim();
    if (before) { factor = MULT[suf[1]]; s = before; }
  }
  if (/[a-z]/.test(s)) {
    const val = wordsToNumber(s);
    if (val == null) return bad(original, 'unrecognised_words');
    return bounded(val * factor, 'medium');
  }

  return bad(original, 'unparseable');
}

module.exports = { normalizeAmount };
