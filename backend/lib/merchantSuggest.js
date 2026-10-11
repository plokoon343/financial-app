'use strict';

// AI categories for spending the rules left as "Other". Only merchants go out (never
// a person transfer), stripped of every number and name (lib/aiStrip), on the free
// stripped-data chain; answers are cached per merchant, so each shop is asked about
// once for everyone. The user confirms before anything changes.

const { merchantForAi } = require('./aiStrip');

const UNSORTED = new Set(['Other', 'Uncategorized', 'Uncategorised', '']);

// The "Other" expenses grouped by stripped merchant, biggest groups first.
// txns: [{ _id, description, category, type }]
function merchantGroups(txns, limit = 30) {
  const groups = new Map();
  for (const t of txns) {
    if (t.type !== 'expense' || !UNSORTED.has(t.category || '')) continue;
    const merchant = merchantForAi(t.description);
    if (!merchant) continue;
    const key = merchant.toLowerCase();
    if (!groups.has(key)) groups.set(key, { key, merchant, txnIds: [] });
    groups.get(key).txnIds.push(String(t._id));
  }
  return [...groups.values()].map((g) => ({ ...g, count: g.txnIds.length }))
    .sort((a, b) => b.count - a.count).slice(0, limit);
}

const SYSTEM = 'You sort Nigerian shop and merchant names from bank statements into spending categories. Choose only from the given categories. If you are not sure, use "Other". Reply with JSON only.';

// One request for many merchants. No numbering: the text must carry no digits at all.
function buildPrompt(merchants, categories) {
  return [
    'Merchants:',
    ...merchants.map((m) => `- ${m}`),
    '',
    `Categories: ${categories.join(', ')}.`,
    'Return JSON exactly like: {"items":[{"merchant":"the merchant as written","category":"one of the categories"}]}',
  ].join('\n');
}

// Keep only answers about merchants we asked about, in categories we offer, and not
// "Other" (that's no answer). Returns Map key -> category.
function validate(raw, merchants, categories) {
  const out = new Map();
  const asked = new Map(merchants.map((m) => [m.toLowerCase(), m]));
  const allowed = new Set(categories);
  const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  for (const it of items) {
    const key = String(it?.merchant || '').trim().toLowerCase();
    const cat = String(it?.category || '').trim();
    if (asked.has(key) && allowed.has(cat) && cat !== 'Other') out.set(key, cat);
  }
  return out;
}

module.exports = { merchantGroups, buildPrompt, validate, SYSTEM, UNSORTED };
