// Subscription badges (price up, charged twice, renews tomorrow, not charged) and the
// DStv/GOtv 5 Nov 2026 package rename. Kept out of server.js so each rule is pure and
// unit-tested against the real narrations; server.js wires these against the ledger.
'use strict';

const DAY = 86400000;

// DStv/GOtv renamed these packages on 5 Nov 2026. A cost or plan-name change on or
// after that date that matches the alias is the rename, not a price rise.
const DSTV_GOTV_ALIASES = {
  access: 'starter',
  family: 'select',
  compact: 'sports',
  'compact plus': 'premium',
};
const RENAME_EFFECTIVE = new Date('2026-11-05T00:00:00Z');

// Longest plan words first, so "compact plus" is found before "compact".
const PLAN_WORDS = Object.keys(DSTV_GOTV_ALIASES)
  .concat(Object.values(DSTV_GOTV_ALIASES))
  .sort((a, b) => b.length - a.length);

// The DStv/GOtv package name mentioned in a charge's narration, lowercased, or null.
function planFromNarration(text) {
  const t = (text || '').toString().toLowerCase();
  for (const w of PLAN_WORDS) if (t.includes(w)) return w;
  return null;
}

// The new name for an old package, or null when it isn't one of the renamed ones.
function aliasPlanName(oldName) {
  const key = (oldName || '').toString().trim().toLowerCase();
  return DSTV_GOTV_ALIASES[key] || null;
}

// Does a plan change on this date match the known rename (so it reads "Changed to
// Sports (new package name)" instead of a price rise)?
function isPlanRename(planBefore, planAfter, chargeDate) {
  if (!planBefore || !planAfter) return false;
  if (new Date(chargeDate) < RENAME_EFFECTIVE) return false;
  return aliasPlanName(planBefore) === planAfter.toString().trim().toLowerCase();
}

// A meaningful jump between the last known amount and the new one. null when there's
// nothing to compare, or the move is rounding noise (under 2%, at least 1 naira).
function priceChangeBadge(prevCost, newCost) {
  const prev = Math.abs(Number(prevCost) || 0);
  const next = Math.abs(Number(newCost) || 0);
  if (!(prev > 0) || !(next > 0)) return null;
  const delta = Math.round(next - prev);
  if (Math.abs(delta) < Math.max(1, prev * 0.02)) return null;
  return delta > 0 ? { type: 'price_up', delta } : { type: 'price_down', delta: Math.abs(delta) };
}

// Two or more successful charges within `windowDays` of each other. Callers must
// already have excluded reversed/refunded charges (a failed-then-retried charge is
// one charge, not two: see reversals.js).
function chargedTwice(chargeDates, windowDays = 3) {
  const sorted = [...chargeDates].map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= windowDays * DAY) return true;
  }
  return false;
}

// Cycle length in ms for a subscription's billing frequency.
function cycleMs(frequency) {
  return frequency === 'yearly' ? 365 * DAY : frequency === 'weekly' ? 7 * DAY : 30 * DAY;
}

// How many whole billing cycles have fully elapsed since the last real charge with
// no new charge landing (0 = on schedule or less than one cycle overdue).
function missedCycles(sub, now = new Date()) {
  const last = sub.lastCharge && new Date(sub.lastCharge);
  if (!last || isNaN(last)) return 0;
  const elapsed = new Date(now).getTime() - last.getTime();
  return Math.max(0, Math.floor(elapsed / cycleMs(sub.frequency)));
}

// Two missed cycles in a row moves a subscription to Stopped automatically (13's
// "Cancelled: two missed cycles move it to Stopped automatically").
function shouldStop(sub, now = new Date()) {
  return missedCycles(sub, now) >= 2;
}

// In-app-only badge: nothing charged in the current calendar month, but not yet two
// full cycles overdue (that's `shouldStop` instead).
function notChargedThisMonth(sub, now = new Date()) {
  if (!sub.lastCharge) return false;
  const last = new Date(sub.lastCharge);
  const n = new Date(now);
  return !(last.getUTCFullYear() === n.getUTCFullYear() && last.getUTCMonth() === n.getUTCMonth());
}

// Default for the "renews tomorrow" alert (12's alert table): on for yearly
// subscriptions, or anything NGN 5,000 or more regardless of frequency. The user can
// still flip it either way per subscription (remindRenewal overrides this).
function defaultRemindRenewal(sub) {
  if ((sub.frequency || 'monthly') === 'yearly') return true;
  return Number(sub.cost) >= 5000;
}

// The effective on/off state for the renewal alert: an explicit user choice wins,
// else the computed default above.
function effectiveRemindRenewal(sub) {
  return sub.remindRenewal != null ? !!sub.remindRenewal : defaultRemindRenewal(sub);
}

module.exports = {
  DSTV_GOTV_ALIASES, RENAME_EFFECTIVE,
  planFromNarration, aliasPlanName, isPlanRename,
  priceChangeBadge, chargedTwice,
  missedCycles, shouldStop, notChargedThisMonth,
  defaultRemindRenewal, effectiveRemindRenewal,
};
