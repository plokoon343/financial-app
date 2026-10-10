// Push nudges: which message (if any) a user should get right now, from their own
// data. Pure and dependency-free so every rule is unit-tested; the server builds the
// snapshot, sends, and logs. Copy lives in data/nudge-copy.json (plus admin edits).
//
// Flow per user, run hourly: evaluate() lists the triggers that apply, select()
// applies the user's settings, quiet hours and the frequency limits and picks the
// highest-priority one, pickVariant() avoids repeating the last line, render() fills
// the variables and keeps amounts off the lock screen unless the user opted in.
'use strict';

const DAY = 86400000;
const LAGOS_OFFSET = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year

// Highest first, from the brief. Setup nudges only go to users in their first week.
const PRIORITY = [
  'bill_due', 'subscription_renewal', 'budget_over', 'budget_80', 'payday_detected',
  'spend_spike', 'review_pending', 'goal_progress', 'no_spend_streak', 'friday_delivery',
  'weekly_recap', 'month_start', 'inactive_5d', 'setup_connect', 'setup_budget',
];
const SETUP = new Set(['setup_connect', 'setup_budget']);
const CATEGORIES = ['spending', 'budgets', 'bills', 'streaks', 'recap', 'tips'];

const LIMITS = { perDay: 2, minGapMs: 3 * 3600000, perTriggerMs: DAY, quietFrom: 22, quietTo: 7 };

// Spending that counts against a no-spend streak (bills, rent, transfers don't).
const DISCRETIONARY = new Set(['Food', 'Shopping', 'Entertainment', 'Subscriptions']);
const DELIVERY = /chowdeck|glovo|jumia ?food|bolt ?food|heyfood|food ?court|delivery/i;
const PAYDAY = /\b(salary|sal\b|payroll|allowance|stipend|nysc|wages?)\b/i;
const STREAK_MARKS = new Set([3, 5, 7, 10, 14, 21, 30]);
const GOAL_MARKS = [25, 50, 75, 100];

// Wall-clock time in Lagos for a UTC instant.
function lagos(now) {
  const d = new Date(now.getTime() + LAGOS_OFFSET);
  return {
    hour: d.getUTCHours(), weekday: d.getUTCDay(), dom: d.getUTCDate(),
    dateKey: d.toISOString().slice(0, 10), monthKey: d.toISOString().slice(0, 7),
    daysInMonth: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(),
  };
}
// The Lagos calendar day of a timestamp, as 'YYYY-MM-DD'.
const lagosDay = (t) => new Date(new Date(t).getTime() + LAGOS_OFFSET).toISOString().slice(0, 10);
const abs = (n) => Math.abs(Number(n) || 0);

// Which triggers apply right now. snapshot = {
//   createdAt, lastActiveAt, txns: [{ id, date, amount, type, category, description, createdAt }],
//   budgets: [{ category, amount }], bills: [{ id, name, nextDue }], subs: [{ id, name, nextRenewal }],
//   goals: [{ id, name, target, current, notifiedMilestone }], reviewPending }
// Each candidate: { trigger, key, vars }. key identifies the occasion so the same one
// is never sent twice (this month's Food budget, this bill's due date, ...).
function evaluate(s, now) {
  const L = lagos(now);
  const out = [];
  const add = (trigger, key, vars = {}) => out.push({ trigger, key: `${trigger}:${key}`, vars });
  const txns = s.txns || [];
  const ageDays = s.createdAt ? (now - new Date(s.createdAt)) / DAY : 999;

  // First week: setup nudges only.
  if (ageDays < 7) {
    if (!txns.length) add('setup_connect', L.dateKey);
    else if (!(s.budgets || []).length) add('setup_budget', L.dateKey);
    return out;
  }

  const expenses = txns.filter((t) => t.type === 'expense');
  const thisMonth = expenses.filter((t) => lagosDay(t.date).slice(0, 7) === L.monthKey);
  const daysLeft = L.daysInMonth - L.dom;

  // Budgets: at 80% with more than 5 days left, or over.
  for (const b of s.budgets || []) {
    if (!(b.amount > 0)) continue;
    const spent = thisMonth.filter((t) => t.category === b.category).reduce((a, t) => a + abs(t.amount), 0);
    if (spent > b.amount) add('budget_over', `${L.monthKey}:${b.category}`, { category: b.category });
    else if (spent >= b.amount * 0.8 && daysLeft > 5) add('budget_80', `${L.monthKey}:${b.category}`, { category: b.category, days_left: daysLeft, remaining: b.amount - spent });
  }

  // Payday: a salary-like credit in the last 24 hours, or one at least 60% of the
  // biggest credit in the previous two months (and at least NGN 20,000).
  const credits = txns.filter((t) => t.type === 'income');
  const recent = credits.filter((t) => now - new Date(t.date) <= DAY && now - new Date(t.date) >= 0);
  const older = credits.filter((t) => now - new Date(t.date) > DAY && now - new Date(t.date) <= 62 * DAY);
  const usual = Math.max(0, ...older.map((t) => abs(t.amount)));
  const pay = recent.find((t) => PAYDAY.test(t.description || '') || (usual >= 20000 && abs(t.amount) >= usual * 0.6));
  if (pay) add('payday_detected', pay.id, { amount: abs(pay.amount) });

  // Spending spike: the last 7 days more than 40% above the weekly average of the 8
  // weeks before (needs at least 4 weeks of history).
  const week = expenses.filter((t) => now - new Date(t.date) < 7 * DAY).reduce((a, t) => a + abs(t.amount), 0);
  const prior = expenses.filter((t) => { const age = now - new Date(t.date); return age >= 7 * DAY && age < 63 * DAY; });
  const oldest = prior.reduce((m, t) => Math.max(m, now - new Date(t.date)), 0);
  const weeks = Math.min(8, Math.ceil((oldest - 7 * DAY) / (7 * DAY))); // full weeks of history before this one
  if (weeks >= 4) {
    const avg = prior.reduce((a, t) => a + abs(t.amount), 0) / weeks;
    if (avg > 0 && week > avg * 1.4) add('spend_spike', `${L.monthKey}-w${Math.ceil(L.dom / 7)}`);
  }

  // Friday 17:00 to 19:00, with food delivery on at least 3 of the last 4 Fridays.
  if (L.weekday === 5 && L.hour >= 17 && L.hour < 19) {
    let fridays = 0;
    for (let w = 1; w <= 4; w++) {
      const day = lagosDay(now.getTime() - w * 7 * DAY);
      if (expenses.some((t) => lagosDay(t.date) === day && DELIVERY.test(t.description || ''))) fridays += 1;
    }
    if (fridays >= 3) {
      const food = (s.budgets || []).find((b) => b.category === 'Food');
      const foodSpent = thisMonth.filter((t) => t.category === 'Food').reduce((a, t) => a + abs(t.amount), 0);
      add('friday_delivery', L.dateKey, food ? { remaining: Math.max(0, food.amount - foodSpent) } : {});
    }
  }

  // No-spend streak: days without discretionary spending, ending yesterday, for people
  // who normally do spend (some discretionary spending in the 30 days before).
  if (expenses.some((t) => DISCRETIONARY.has(t.category) && now - new Date(t.date) <= 30 * DAY)) {
    const spendDays = new Set(expenses.filter((t) => DISCRETIONARY.has(t.category)).map((t) => lagosDay(t.date)));
    let n = 0;
    while (n < 60 && !spendDays.has(lagosDay(now.getTime() - (n + 1) * DAY))) n += 1;
    if (STREAK_MARKS.has(n)) add('no_spend_streak', `${lagosDay(now.getTime() - n * DAY)}:${n}`, { n });
  }

  // Bills due in 3 days, subscriptions renewing tomorrow.
  const inDays = (date, n) => lagosDay(date) === lagosDay(now.getTime() + n * DAY);
  for (const b of s.bills || []) {
    if (b.nextDue && inDays(b.nextDue, 3)) add('bill_due', `${b.id}:${lagosDay(b.nextDue)}`, { bill: b.name, date: lagosDay(b.nextDue) });
  }
  for (const sub of s.subs || []) {
    if (sub.nextRenewal && inDays(sub.nextRenewal, 1)) add('subscription_renewal', `${sub.id}:${lagosDay(sub.nextRenewal)}`, { service: sub.name });
  }

  // Five or more items waiting for a decision (asked at most every 3 days).
  if ((s.reviewPending || 0) >= 5) add('review_pending', `${Math.floor(now / (3 * DAY))}`, { n: s.reviewPending });

  // Not opened in 5 days while new transactions kept arriving.
  if (s.lastActiveAt && now - new Date(s.lastActiveAt) >= 5 * DAY) {
    const fresh = txns.filter((t) => new Date(t.createdAt || t.date) > new Date(s.lastActiveAt)).length;
    if (fresh > 0) add('inactive_5d', lagosDay(s.lastActiveAt), { n: fresh });
  }

  // Sunday from 18:00, the 1st from 09:00 (before quiet hours).
  if (L.weekday === 0 && L.hour >= 18) add('weekly_recap', L.dateKey);
  if (L.dom === 1 && L.hour >= 9) add('month_start', L.monthKey);

  // Goals crossing 25, 50, 75 or 100%.
  for (const g of s.goals || []) {
    if (!(g.target > 0)) continue;
    const pct = Math.min(100, (g.current / g.target) * 100);
    const mark = [...GOAL_MARKS].reverse().find((m) => pct >= m);
    if (mark && mark > (g.notifiedMilestone || 0)) add('goal_progress', `${g.id}:${mark}`, { goal: g.name, pct: mark, goalId: g.id });
  }
  return out;
}

// Pick at most one candidate to send now, or null. log = this user's recent sends
// [{ trigger, key, sentAt }]; prefs = { spending, budgets, ... } (missing = on).
function select(candidates, { log = [], prefs = {}, copy, now }) {
  const L = lagos(now);
  if (L.hour >= LIMITS.quietFrom || L.hour < LIMITS.quietTo) return null; // queued: re-evaluated after 07:00
  const today = log.filter((l) => lagosDay(l.sentAt) === L.dateKey);
  if (today.length >= LIMITS.perDay) return null;
  const last = log.reduce((m, l) => Math.max(m, new Date(l.sentAt).getTime()), 0);
  if (last && now - last < LIMITS.minGapMs) return null;
  const sentKeys = new Set(log.map((l) => l.key));
  const ok = candidates.filter((c) => {
    const cat = copy?.[c.trigger]?.category;
    if (cat && prefs[cat] === false) return false;
    if (sentKeys.has(c.key)) return false;
    return !log.some((l) => l.trigger === c.trigger && now - new Date(l.sentAt) < LIMITS.perTriggerMs);
  });
  ok.sort((a, b) => PRIORITY.indexOf(a.trigger) - PRIORITY.indexOf(b.trigger));
  return ok[0] || null;
}

// A variant for this trigger that isn't the one this user got last time.
function pickVariant(variants, lastVariantId, rand = Math.random) {
  const live = (variants || []).filter((v) => v.active !== false);
  if (!live.length) return null;
  const pool = live.length > 1 ? live.filter((v) => v.id !== lastVariantId) : live;
  return pool[Math.floor(rand() * pool.length)];
}

const naira = (n) => `₦${Math.round(abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
const MONEY_VARS = new Set(['amount', 'remaining']);

// Fill {variables}. The amount-free text is used unless the user turned on amounts
// and the variant has an amount version. A text that would leave a money variable
// unfilled, or show one without permission, is refused (null).
function render(variant, vars, { showAmounts = false } = {}) {
  const tpl = showAmounts && variant.withAmount ? variant.withAmount : variant.text;
  let missing = false;
  const body = tpl.replace(/\{(\w+)\}/g, (_, k) => {
    if (MONEY_VARS.has(k)) { if (!showAmounts || vars[k] == null) { missing = true; return ''; } return naira(vars[k]); }
    if (vars[k] == null || vars[k] === '') { missing = true; return ''; }
    return String(vars[k]);
  });
  return missing ? null : body;
}

// The copy library: the file's triggers, with admin edits (by variant id) applied.
function mergeCopy(base, overrides = []) {
  const copy = JSON.parse(JSON.stringify(base));
  delete copy._about;
  for (const o of overrides) {
    const t = copy[o.trigger];
    if (!t) continue;
    const list = o.complete ? (t.completeVariants = t.completeVariants || []) : t.variants;
    const i = list.findIndex((v) => v.id === o.variantId);
    const v = { id: o.variantId, text: o.text, ...(o.withAmount ? { withAmount: o.withAmount } : {}), active: o.active !== false };
    if (i >= 0) list[i] = { ...list[i], ...v }; else list.push(v);
  }
  return copy;
}

module.exports = { evaluate, select, pickVariant, render, mergeCopy, lagos, lagosDay, PRIORITY, CATEGORIES, LIMITS, SETUP };
