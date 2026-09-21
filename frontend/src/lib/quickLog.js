// Natural-language money log — the user types (or dictates) a line like
// "2k bike to school", "spent 5000 on data", "got 20k salary" and we turn it into a
// transaction. Fully client-side, no API cost. Ported 1:1 from the mobile parser
// (finpilot-mobile/src/lib/quickLog.ts) so web and mobile behave identically.

const CAT_RULES = [
  [/\b(bike|okada|keke|bus|danfo|uber|bolt|indrive|taxi|brt|fare|ride|transport|fuel|petrol)\b/i, 'Transport'],
  [/\b(food|lunch|dinner|breakfast|chop|rice|eat|snack|suya|shawarma|chowdeck|restaurant|amala|swallow|meal|pizza)\b/i, 'Food'],
  [/\b(airtime|recharge|mtn|glo|airtel|9mobile|top ?up|call ?card)\b/i, 'Airtime & Data'],
  [/\b(data|internet|wifi|subscription|netflix|dstv|gotv|spotify)\b/i, 'Subscriptions'],
  [/\b(nepa|electricity|light|power|water|utility|bill)\b/i, 'Utilities'],
  [/\b(groceries|market|shoprite|provisions|foodstuff|supermarket)\b/i, 'Groceries'],
  [/\b(rent|house|landlord|accommodation)\b/i, 'Housing'],
  [/\b(drug|medicine|hospital|pharmacy|clinic|chemist)\b/i, 'Healthcare'],
  [/\b(school|tuition|book|fees|jamb|waec)\b/i, 'Education'],
  [/\b(clothes|shoe|jumia|konga|store|shopping|boutique)\b/i, 'Shopping'],
  [/\b(save|savings|piggy|ajo)\b/i, 'Savings'],
  [/\b(bet|bet9ja|sportybet|betking|cinema|movie|club|game)\b/i, 'Entertainment'],
];
const INCOME = /\b(got|received|earn(?:ed)?|salary|paid me|credit(?:ed)?|income|allowance|stipend|sent me|refund|gift|won)\b/i;
const FILLER = /\b(spent|spend|on|for|paid|pay|to|from|got|received|receive|naira|ngn|the|a|an|my|of|at|in|some|about|around)\b/ig;

export function parseQuickLog(text) {
  const t = (text || '').trim();
  if (!t) return null;

  // First money-like token: 2k / 2,000 / 5000 / 1.5k / n2000 / 20 thousand / 3m.
  const m = t.match(/(?:₦|n|ngn)?\s*([\d][\d,]*(?:\.\d+)?)\s*(k|thousand|grand|m|million)?/i);
  if (!m) return null;
  let amount = parseFloat(m[1].replace(/,/g, ''));
  const unit = (m[2] || '').toLowerCase();
  if (unit === 'k' || unit === 'thousand' || unit === 'grand') amount *= 1000;
  else if (unit === 'm' || unit === 'million') amount *= 1000000;
  if (!(amount > 0)) return null;

  const type = INCOME.test(t) ? 'income' : 'expense';

  let category = '';
  for (const [re, c] of CAT_RULES) { if (re.test(t)) { category = c; break; } }
  if (type === 'income' && !category) category = 'Salary';

  let description = t.replace(m[0], ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  description = description.replace(/^[-,.\s]+|[-,.\s]+$/g, '').slice(0, 60);
  if (!description) description = type === 'income' ? 'Cash in' : 'Cash spend';

  return { amount, description, category, type };
}
