'use strict';
// Insights that sit on Home, Money, Plan and a transaction's detail (Round 5, 10).
// Every number comes from the user's own rows with plain arithmetic here; nothing is
// calculated by an AI. Text is a template over those numbers. An insight is left out
// (never guessed) when the period has too little data, and a "Transfer" category or
// any move between the user's own accounts is never talked about.
// Percentages and counts only, so the lines are safe with Hide amounts on.

const { deriveCategoryKey } = require('./merchantKey');

const DAY = 86400000;
const LAGOS = 3600000; // WAT is UTC+1, no DST
const lagosDay = (t) => new Date(new Date(t).getTime() + LAGOS).toISOString().slice(0, 10);
const lagosMonth = (t) => lagosDay(t).slice(0, 7);
const weekday = (t) => new Date(new Date(t).getTime() + LAGOS).getUTCDay(); // 0 Sun

const MIN_MONTH_TXNS = 8;      // fewer expenses than this and the month is too thin to talk about
const MIN_WEEK_TXNS = 3;       // per week, for a week-on-week comparison
const SKIP_CATEGORIES = new Set(['Transfer', 'Sent to people', 'Other']);

const spend = (txns) => txns.filter((t) => t.type === 'expense' && !SKIP_CATEGORIES.has(t.category));
const abs = (t) => Math.abs(t.amount);
const sum = (rows) => rows.reduce((s, t) => s + abs(t), 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const lower = (c) => (c ? c.charAt(0).toLowerCase() + c.slice(1) : c);
const upper = (c) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : c);

function byCategory(rows) {
  const m = new Map();
  rows.forEach((t) => m.set(t.category || 'Other', (m.get(t.category || 'Other') || 0) + abs(t)));
  return m;
}

function merchantName(description) {
  const key = deriveCategoryKey(description || '');
  if (!key || key.length < 3) return '';
  return key.replace(/^(term|alert|pos|pur)\s+/, '').split(' ').map(upper).join(' ');
}

const ordinal = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 >> 3) ^ 1 && n % 10 < 4 ? n % 10 : 0]}`;

// Week windows in Lagos days: this = the 7 days ending today, prior = the 7 before.
function weekWindows(now) {
  const end = lagosDay(now);
  const startThis = lagosDay(new Date(now).getTime() - 6 * DAY);
  const startPrior = lagosDay(new Date(now).getTime() - 13 * DAY);
  return { end, startThis, startPrior };
}

function weekComparison(txns, now, { excludeTopFromChange = false } = {}) {
  const { end, startThis, startPrior } = weekWindows(now);
  const rows = spend(txns);
  const thisW = rows.filter((t) => { const d = lagosDay(t.date); return d >= startThis && d <= end; });
  const priorW = rows.filter((t) => { const d = lagosDay(t.date); return d >= startPrior && d < startThis; });
  if (thisW.length < MIN_WEEK_TXNS || priorW.length < MIN_WEEK_TXNS) return null;
  const a = byCategory(thisW), b = byCategory(priorW);
  const total = sum(thisW);
  const top = [...a.entries()].sort((x, y) => y[1] - x[1])[0];
  let change = null;
  for (const [cat, now$] of a) {
    if (excludeTopFromChange && top && cat === top[0]) continue;
    const before = b.get(cat) || 0;
    if (before <= 0 || now$ <= 0) continue;
    const delta = Math.round(((now$ - before) / before) * 100);
    if (Math.abs(delta) >= 10 && (!change || Math.abs(delta) > Math.abs(change.delta))) change = { cat, delta };
  }
  return { top: top ? { cat: top[0], share: pct(top[1], total) } : null, change };
}

// "Your week in money: Food took 38%, transport is down 12%." (Sunday push) or null.
function weeklyLine(txns, now) {
  const w = weekComparison(txns, now, { excludeTopFromChange: true });
  if (!w || !w.top) return null;
  const parts = [`${w.top.cat} took ${w.top.share}%`];
  if (w.change && w.change.cat !== w.top.cat) parts.push(`${lower(w.change.cat)} is ${w.change.delta < 0 ? 'down' : 'up'} ${Math.abs(w.change.delta)}%`);
  return `Your week in money: ${parts.join(', ')}.`;
}

function weekendLine(monthRows) {
  const wk = (t) => { const d = weekday(t.date); return d === 0 || d === 6; };
  const end = monthRows.filter(wk), mid = monthRows.filter((t) => !wk(t));
  if (end.length < 3 || mid.length < 3) return null;
  const days = new Set(monthRows.map((t) => lagosDay(t.date)));
  let we = 0, wd = 0;
  days.forEach((d) => { const g = new Date(`${d}T12:00:00Z`).getUTCDay(); if (g === 0 || g === 6) we += 1; else wd += 1; });
  if (we < 2 || wd < 4) return null;
  const perWe = sum(end) / we, perWd = sum(mid) / wd;
  if (perWe >= perWd * 1.25) return 'You spent more on weekends this month.';
  if (perWd >= perWe * 1.25) return 'You spent more on weekdays than weekends this month.';
  return null;
}

// Up to 4 insights, best first. now defaults to the present.
function buildFeed(txns, now = new Date()) {
  const month = lagosMonth(now);
  const monthRows = spend(txns).filter((t) => lagosMonth(t.date) === month);
  if (monthRows.length < MIN_MONTH_TXNS) return [];
  const out = [];
  const total = sum(monthRows);
  const cats = [...byCategory(monthRows).entries()].sort((a, b) => b[1] - a[1]);
  if (cats[0]) out.push({ id: 'top-category', kind: 'category', route: '/insights', text: `${cats[0][0]} is ${pct(cats[0][1], total)}% of what you spent this month.` });

  const w = weekComparison(txns, now);
  if (w && w.change) out.push({ id: 'week-change', kind: 'week', route: '/insights', text: `${w.change.cat} is ${w.change.delta < 0 ? 'down' : 'up'} ${Math.abs(w.change.delta)}% on last week.` });

  const we = weekendLine(monthRows);
  if (we) out.push({ id: 'weekend', kind: 'weekend', route: '/insights', text: we });

  const counts = new Map();
  monthRows.forEach((t) => { const n = merchantName(t.description); if (n) counts.set(n, (counts.get(n) || 0) + 1); });
  const rep = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (rep && rep[1] >= 3) out.push({ id: 'repeat-merchant', kind: 'merchant', route: '/insights', text: `${rep[1]} visits to ${rep[0]} this month.` });

  return out.slice(0, 4);
}

// One line under the Money totals.
function moneyLine(txns, now = new Date()) {
  const f = buildFeed(txns, now);
  return (f.find((i) => i.kind === 'weekend') || f.find((i) => i.kind === 'week') || f[0] || null);
}

// Plan: one forecast sentence from the month's pace (plain arithmetic).
function forecastLine(txns, now = new Date()) {
  const month = lagosMonth(now);
  const rows = spend(txns).filter((t) => lagosMonth(t.date) === month);
  const day = +lagosDay(now).slice(8, 10);
  if (rows.length < MIN_MONTH_TXNS || day < 5) return null;
  const y = +month.slice(0, 4), m = +month.slice(5, 7);
  const dim = new Date(y, m, 0).getDate();
  const prevKey = lagosMonth(new Date(Date.UTC(y, m - 2, 15)));
  const prev = sum(spend(txns).filter((t) => lagosMonth(t.date) === prevKey));
  const projected = (sum(rows) / day) * dim;
  if (prev < 1) return null;
  const delta = Math.round(((projected - prev) / prev) * 100);
  if (Math.abs(delta) < 5) return 'At this pace you will spend about the same as last month.';
  return `At this pace you will spend about ${Math.abs(delta)}% ${delta > 0 ? 'more' : 'less'} than last month.`;
}

// Detail: "Your 4th Chicken Republic this month" for an expense seen at least twice.
function contextLine(txn, monthTxns) {
  if (!txn || txn.type !== 'expense' || SKIP_CATEGORIES.has(txn.category)) return null;
  const name = merchantName(txn.description);
  if (!name) return null;
  const same = monthTxns
    .filter((t) => t.type === 'expense' && merchantName(t.description) === name && lagosMonth(t.date) === lagosMonth(txn.date))
    .sort((a, b) => new Date(a.date) - new Date(b.date) || String(a._id).localeCompare(String(b._id)));
  const idx = same.findIndex((t) => String(t._id) === String(txn._id));
  if (same.length < 2 || idx < 1) return null;
  return `Your ${ordinal(idx + 1)} ${name} this month.`;
}

module.exports = { buildFeed, moneyLine, weeklyLine, forecastLine, contextLine, merchantName };
