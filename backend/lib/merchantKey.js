// Merchant keys: one stable signature per merchant, shared by category learning,
// subscription tracking and dismissals so they always agree. Pure.
'use strict';
const { brandFor } = require('./subscriptionBrands');

// Words too generic to identify a merchant - stripped when building a learning key.
const CATEGORY_KEY_STOPWORDS = new Set([
  'transfer','transaction','nip','neft','trf','to','from','pos','pur','purchase','payment',
  'pay','ref','via','self','the','for','and','inward','outward','debit','credit','value',
  'date','bank','plc','ltd','limited','nigeria','mobile','app','online','web','intl','txn',
  'session','charges','charge','vat','reversal','instant','outward','www','com',
]);

// Build a stable per-merchant signature from a description, used both when LEARNING a
// correction and when LOOKING UP a learned category (so they match symmetrically).
const deriveCategoryKey = (description) => {
  const tokens = (description || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')          // drop digits & punctuation
    .split(/\s+/)
    .filter(w => w.length >= 3 && !CATEGORY_KEY_STOPWORDS.has(w));
  return tokens.slice(0, 3).join(' ');
};

// One key per service: the recognised brand when we know it, else the merchant words.
const subscriptionKey = (text) => {
  const brand = brandFor(text);
  return brand ? `brand:${brand.slug}` : deriveCategoryKey(text || '');
};

module.exports = { deriveCategoryKey, subscriptionKey };
