// The merchant and subscription catalogue (round 6, Block 3, section 5.2). [config]:
// backend/data/merchantCatalogue.json is the one table, service/category/patterns/
// subscriptionOnly/cadence/plans/lastChecked/cancelLink/logo, editable without an
// app release - this file only loads and matches it.
//
// "Block 5 already built a subscription catalogue... the same table widened, not a
// new one": subscriptionBrands.js's BRANDS table (28 entries, `kind: "subscription"`
// below) is this file's seed, unchanged in meaning. brandFor() keeps matching only
// those - the kind: "merchant" entries this round adds (Shoprite, Chowdeck, MTN...)
// must never make a grocery run look like a subscription, which is exactly the bug
// a shared matching loop would cause (subscriptionBrands.test.js's own
// "POS PURCHASE SHOPRITE IKEJA" -> null case would break the moment Shoprite joined
// the same search `brandFor` runs). catalogueMatch() below is the wider search, for
// the clean-name engine's "catalogue match" step and anything that genuinely wants
// every kind of entry.
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'merchantCatalogue.json');

// Match on a non-alphanumeric or string edge, or glued after a store prefix
// ("GOOGLEClaude") - identical to subscriptionBrands.js's original `re()`, since the
// first 28 patterns are that file's table verbatim and must keep matching the same.
function compilePattern(body) {
  return new RegExp(`(?:^|[^a-z0-9]|google|apple)(?:${body})`, 'i');
}

// A verification hold ("GOOGLE *TEMPORARY HOLD"), never a real charge.
const HOLD = /temporary ?hold|pending ?auth(?:orization)?/i;

let cache = null;
let cacheMtime = 0;

// Re-reads the JSON only when the file on disk has actually changed, so an edit to
// the catalogue (no app release) takes effect on the next match with no restart,
// while a hot path doesn't re-parse a JSON file on every transaction.
function load() {
  let mtime = 0;
  try { mtime = fs.statSync(FILE).mtimeMs; } catch { /* use whatever is cached */ }
  if (cache && mtime === cacheMtime) return cache;
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const entries = (raw.entries || []).map((e) => ({
    ...e,
    compiled: (e.patterns || []).map(compilePattern),
  }));
  cache = { lastUpdated: raw.lastUpdated || null, entries };
  cacheMtime = mtime;
  return cache;
}

// Force a reload on the next call (tests, or an admin action that just edited the
// file in the same process).
function reload() { cache = null; cacheMtime = 0; }

function matchesAny(entry, text) {
  return entry.compiled.some((re) => re.test(text));
}

// subscriptionBrands.js's exact original contract: the subscription brand a charge
// belongs to, or null. Only kind: "subscription" entries are searched.
function brandFor(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (HOLD.test(t)) return null;
  const { entries } = load();
  for (const e of entries) {
    if (e.kind === 'subscription' && matchesAny(e, t)) return { name: e.service, slug: e.slug };
  }
  return null;
}

// The full catalogue record for a charge, subscription or general merchant alike -
// section 5.2's widening. Never returns a hold. Returns the richer shape (category,
// subscriptionOnly, cadence, plans, cancelLink, logo, kind, patternStatus) a clean-
// name match or a subscription/merchant screen needs, not just a name.
function catalogueMatch(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  if (HOLD.test(t)) return null;
  const { entries } = load();
  for (const e of entries) {
    if (matchesAny(e, t)) {
      const { compiled, ...rest } = e;
      void compiled;
      return rest;
    }
  }
  return null;
}

function allEntries() { return load().entries.map(({ compiled, ...rest }) => { void compiled; return rest; }); }

module.exports = { brandFor, catalogueMatch, allEntries, reload, HOLD };
