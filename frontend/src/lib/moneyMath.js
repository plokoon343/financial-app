// What counts as spending and income in insights, and whether a month's data is
// complete enough to compare against income. Kept in sync with the mobile copy
// (finpilot-mobile/src/lib/moneyMath.ts).
//
// - Moving money between your own accounts or into a savings pocket (OWealth, Cashbox,
//   Spend & Save...) is neither spending nor income.
// - Money sent to people is spending, shown as "Sent to people" unless the user
//   tagged the person (contacts already stamp their category on those rows).
// - "X% of your income" only appears when the month's income is complete and above
//   zero, and is never above 100%.

const POCKET = /\b(O-?WEALTH|CASH ?BOX|SPEND ?(?:&|AND)? ?SAVE|SAFE ?BOX|SAVE ?BOX|SAVINGS POCKET|TARGET SAVINGS?|FIXED (?:SAVINGS|DEPOSIT)|FLEX ?SAVINGS?|POCKET|VAULT|STASH|OWEALTH)\b/i;
const TRANSFERISH = /\b(TRANSFER|TRF|TRSF|NIP|NIBSS|FT|SENT|RECEIVED|FROM|TO|INWARD|OUTWARD|MOBILE TRF|USSD)\b/i;

export const SENT_TO_PEOPLE = 'Sent to people';

// Name words (3+ letters) for spotting transfers to the user's own accounts.
export function selfNameWords(user) {
  return String(user?.name || '').toUpperCase().split(/[^A-Z]+/).filter((w) => w.length >= 3);
}

function toSelf(t, nameWords) {
  if (!nameWords || nameWords.length < 2) return false;
  const d = String(t.description || '').toUpperCase();
  if (!TRANSFERISH.test(d)) return false;
  return nameWords.filter((w) => new RegExp(`\\b${w}\\b`).test(d)).length >= 2;
}

export function isInternal(t, nameWords) {
  if (t.type === 'internal_transfer' || t.transferPairId) return true;
  if (t.type !== 'expense' && t.type !== 'income') return false;
  const cat = t.category || 'Other';
  if (POCKET.test(t.description || '') && !/\binterest\b/i.test(t.description || '') && ['Transfer', 'Savings', 'Other', 'Investment', 'Investments'].includes(cat)) return true;
  return ['Transfer', 'Other', 'Savings'].includes(cat) && toSelf(t, nameWords);
}

// The rows insights should use: internal moves become 'internal_transfer' (so every
// sum that counts 'expense' / 'income' leaves them out) and a bare Transfer expense
// becomes "Sent to people". Nothing here is saved; it is a view for the numbers.
export function forInsights(rows, nameWords) {
  return rows.map((t) => {
    if (isInternal(t, nameWords)) return t.type === 'internal_transfer' ? t : { ...t, type: 'internal_transfer' };
    if (t.type === 'expense' && (!t.category || t.category === 'Transfer')) return { ...t, category: SENT_TO_PEOPLE };
    return t;
  });
}

const dayOf = (d) => { const x = new Date(d); return Number.isNaN(+x) ? null : x; };

// How completely a month is covered by the user's data: the first and last day with
// any transaction, and the biggest gap between days with data. A month counts as
// complete when it starts by the 5th, runs to within 4 days of its end (or of today
// for the current month) and has no gap over 12 days.
export function monthCoverage(all, monthKey, now = new Date()) {
  const y = +monthKey.slice(0, 4), m = +monthKey.slice(5, 7);
  const dim = new Date(y, m, 0).getDate();
  const isCurrent = now.getFullYear() === y && now.getMonth() + 1 === m;
  const endDay = isCurrent ? now.getDate() : dim;
  const days = [...new Set(all
    .map((t) => dayOf(t.date))
    .filter((d) => d && d.getFullYear() === y && d.getMonth() + 1 === m)
    .map((d) => d.getDate()))].sort((a, b) => a - b);
  if (!days.length) return { complete: false, firstDay: 0, lastDay: 0, endDay, maxGap: endDay, isCurrent };
  let maxGap = days[0] - 1;
  for (let i = 1; i < days.length; i++) maxGap = Math.max(maxGap, days[i] - days[i - 1]);
  maxGap = Math.max(maxGap, endDay - days[days.length - 1]);
  const complete = days[0] <= 5 && days[days.length - 1] >= endDay - 4 && maxGap <= 12;
  return { complete, firstDay: days[0], lastDay: days[days.length - 1], endDay, maxGap, isCurrent };
}

// The spotlight line for a month: a share of income only when it can be trusted.
// Returns { kind: 'share', name, value, pct } | { kind: 'over', spent, income }
// | { kind: 'spent', spent, name, value } | null.
export function spotlightFor({ income, expense, top, coverage }) {
  if (expense <= 0 || !top) return null;
  if (!coverage?.complete || income <= 0) return { kind: 'spent', spent: expense, name: top.name, value: top.value };
  if (expense > income) return { kind: 'over', spent: expense, income, name: top.name, value: top.value };
  const pct = Math.round((top.value / income) * 100);
  if (pct < 5) return null;
  return { kind: 'share', name: top.name, value: top.value, pct: Math.min(100, pct) };
}

// Spending in one category over the same days of two months (day 1 to `uptoDay`),
// so a half-finished month is never compared against a whole one.
export function sameDaysSpend(all, monthKey, uptoDay, category) {
  return all.filter((t) => {
    if (t.type !== 'expense') return false;
    if (category && (t.category || 'Other') !== category) return false;
    const d = dayOf(t.date);
    if (!d) return false;
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    return k === monthKey && d.getDate() <= uptoDay;
  }).reduce((s, t) => s + Math.abs(t.amount), 0);
}
