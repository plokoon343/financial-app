'use strict';
// The three answers on a category card (round 6, Block 4; brief 4.3 priority 3).
//
// A card offers the top suggestions and nothing else, so the order they come in IS
// the answer the user taps. Ranked best evidence first:
//
//   1. the user's own learned category for this merchant key   (their past answer)
//   2. the approved global consensus for the same key          (what everyone agrees)
//   3. the merchant catalogue / keyword rules                  (what the name says)
//   4. what this user uses most in general                     (a sane fourth guess)
//
// A category the user has already rejected for this merchant is never offered again,
// which is the difference between a suggestion and a nag.
//
// Pure: callers load the maps.

const CATCH_ALL = new Set(['', 'Other', 'Other Income', 'Uncategorized', 'Uncategorised']);
const isCatchAll = (c) => CATCH_ALL.has(String(c || '').trim());

/**
 * suggest({ ruleGuess, learned, global, popular, exclude, limit })
 *   ruleGuess  what the keyword/merchant rules said (may be a catch-all)
 *   learned    this user's learned category for the merchant key, or null
 *   global     the approved consensus category for the key, or null
 *   popular    this user's most-used categories, most first
 *   exclude    categories not to offer (already rejected for this merchant)
 *   limit      how many to return (3 on a single card, 2 on a grouped one)
 *
 * Always returns at least one, so a card always has something to tap: "Other" is a
 * real answer when nothing is known, and it still beats asking the user to type.
 */
function suggest({ ruleGuess = '', learned = '', global: consensus = '', popular = [], exclude = [], limit = 3 } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  const out = [];
  const add = (c) => {
    const v = String(c || '').trim();
    if (!v || skip.has(v) || out.includes(v)) return;
    out.push(v);
  };
  add(learned);
  add(consensus);
  if (!isCatchAll(ruleGuess)) add(ruleGuess);
  for (const p of popular) { if (out.length >= limit) break; add(p); }
  if (!out.length) add(isCatchAll(ruleGuess) ? ruleGuess || 'Other' : 'Other');
  return out.slice(0, limit);
}

/**
 * The categories this user reaches for most, from their own filed rows. Used as the
 * fourth guess so a new merchant still offers something plausible rather than three
 * flavours of nothing.
 *   rows: [{ category }]
 */
function popularCategories(rows = [], limit = 5) {
  const n = new Map();
  for (const r of rows) {
    const c = String(r && r.category || '').trim();
    if (!c || isCatchAll(c)) continue;
    n.set(c, (n.get(c) || 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([c]) => c);
}

module.exports = { suggest, popularCategories, isCatchAll };
