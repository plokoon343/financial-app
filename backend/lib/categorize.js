// Keyword transaction categoriser. Pure + dependency-free apart from the merchant
// layer. Every keyword is matched as a WHOLE WORD or phrase using the same
// edge-anchored pattern lib/merchants.js uses, so "rent" no longer fires inside
// "current", "vat" inside "private", "rida" inside "Farida" or "cot" inside "Scott"
// (round 10, A1). The lists themselves live in data/keywordRules.json (A4) so a fix
// ships as data. This is the keyword + merchant layer only: the user's own rules,
// contact labels and learned merchants sit above it in lib/categorise.js, which is
// the entry point everything else calls.
//
// "Transfer" and "ATM/POS" are no longer categories this can return: a person
// transfer is decided by lib/categorise (Sent to people / Money from People) and a
// withdrawal is a cash kind, not a spending category (A3).

'use strict';

const fs = require('fs');
const path = require('path');
const { matchMerchant } = require('./merchants');

const FILE = path.join(__dirname, '..', 'data', 'keywordRules.json');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Same anchoring as merchants.js's b(): a non-alphanumeric or string edge on both
// sides. Spaces inside a phrase tolerate any run of whitespace.
const wholeWord = (kw) => new RegExp(`(?:^|[^a-z0-9])${escapeRe(kw.trim()).replace(/\s+/g, '\\s+')}(?:[^a-z0-9]|$)`, 'i');

let cache = null;
let cacheMtime = 0;
function load() {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { /* keep the cache */ }
  if (cache && mtime === cacheMtime) return cache;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  cache = {
    version: raw.version || 1,
    rules: (raw.rules || []).map((r) => ({ for: r.for, category: r.category, compiled: (r.keywords || []).map(wholeWord) })),
  };
  cacheMtime = mtime;
  return cache;
}

// The first keyword rule that matches, as { category }, or null. `isExpense` picks
// the direction the rules apply to.
function keywordMatch(description, isExpense) {
  const text = (description || '').toString();
  if (!text.trim()) return null;
  for (const rule of load().rules) {
    if (rule.for !== 'both' && ((rule.for === 'expense') !== isExpense)) continue;
    if (rule.compiled.some((re) => re.test(text))) return { category: rule.category };
  }
  return null;
}

// The legacy two-layer entry (merchant then keyword) kept for callers that only need
// the layers without a user, and for the tests. Returns Other / Other Income when
// nothing matches. Prefer lib/categorise.categorise everywhere in the app.
const categorizeTransaction = (description, typeOrAmount) => {
  const isExpense = typeof typeOrAmount === 'string' ? typeOrAmount === 'expense' : typeOrAmount < 0;
  if (isExpense) {
    const m = matchMerchant(description);
    if (m) return m.category;
  }
  const k = keywordMatch(description, isExpense);
  if (k) return k.category;
  return isExpense ? 'Other' : 'Other Income';
};

module.exports = { categorizeTransaction, keywordMatch, wholeWord, load };
