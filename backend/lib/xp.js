'use strict';

// Level and XP engine (Round 11 follow-up). Pure: the server loads plain rows and these
// functions decide. The ledger lives on the server, so XP follows the account and not
// the phone. Every XP source is an action the server already records, and each one is
// stored under a key that is unique per user, so the same action can never pay twice.

const DAILY_CAP = 50;

// What each action is worth. card_shared is defined but has no award path yet: the
// server does not record a share (the image is made on the phone), and a number a
// client merely claims is not one the server can defend.
const ACTIONS = {
  card_sorted: 5,
  checkin: 2,
  budget_set: 20,
  goal_hit: 50,
  tracking_on: 30,
  card_shared: 10,
};

const LEVELS = [
  { key: 'starter', name: 'Starter', min: 0 },
  { key: 'tracker', name: 'Tracker', min: 100 },
  { key: 'planner', name: 'Planner', min: 250 },
  { key: 'saver', name: 'Saver', min: 500 },
  { key: 'strategist', name: 'Strategist', min: 1000 },
  { key: 'boss', name: 'Boss', min: 2000 },
];

// What a level opens. `level` is the index into LEVELS.
//   app_icons    the alternate app icon picker in Settings
//   badge_slots  how many badges the Profile shelf pins before "See all"
const UNLOCKS = [
  { id: 'app_icons', name: 'App icons', level: 1 },
];
const BADGE_SLOTS = [4, 5, 6, 7, 8, 9];

const shelfSlots = (levelIndex) => BADGE_SLOTS[Math.max(0, Math.min(BADGE_SLOTS.length - 1, levelIndex))];

const cleanXp = (n) => (Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0);

// Level, and progress to the next one, for a total.
function levelFor(totalXp) {
  const xp = cleanXp(totalXp);
  let index = 0;
  for (let i = 0; i < LEVELS.length; i += 1) if (xp >= LEVELS[i].min) index = i;
  const cur = LEVELS[index];
  const nxt = LEVELS[index + 1] || null;
  const span = nxt ? nxt.min - cur.min : 0;
  const into = nxt ? xp - cur.min : 0;
  return {
    xp,
    index,
    level: index + 1,
    key: cur.key,
    name: cur.name,
    min: cur.min,
    next: nxt ? { key: nxt.key, name: nxt.name, min: nxt.min } : null,
    intoLevel: into,
    span,
    toNext: nxt ? nxt.min - xp : 0,
    pct: nxt ? Math.round((into / span) * 100) : 100,
  };
}

// How much a live action pays right now, given what was already earned today (live
// awards only; backfill is outside the cap). The remainder of the cap is paid, never
// more, so one big action near the cap pays part of its value.
function payout(action, todayLiveXp) {
  const base = ACTIONS[action];
  if (!base) return { base: 0, xp: 0, capped: false };
  const room = Math.max(0, DAILY_CAP - cleanXp(todayLiveXp));
  const xp = Math.min(base, room);
  return { base, xp, capped: xp < base };
}

// The single decision for a live award: null when the key is already in the ledger
// (the same action never pays twice) or the action is unknown, otherwise the entry to
// write. A capped action is still written, at 0 or part XP, so waiting for tomorrow
// and doing it again cannot pay it twice either. The server backs the first check with
// a unique index on (userId, key), so two requests at once cannot both write.
function decide(haveKeys, todayLiveXp, action, key) {
  if (!ACTIONS[action] || !key || haveKeys.has(key)) return null;
  const p = payout(action, todayLiveXp);
  return { key, action, xp: p.xp, capped: p.capped };
}

// Public shape for the app: total, level, progress, today, and what is unlocked.
function summary(totalXp, todayLiveXp) {
  const lv = levelFor(totalXp);
  const today = Math.min(DAILY_CAP, cleanXp(todayLiveXp));
  return {
    ...lv,
    today,
    dailyCap: DAILY_CAP,
    leftToday: Math.max(0, DAILY_CAP - today),
    badgeSlots: shelfSlots(lv.index),
    unlocks: UNLOCKS.map((u) => ({
      id: u.id,
      name: u.name,
      level: u.level + 1,
      levelName: LEVELS[u.level].name,
      xp: LEVELS[u.level].min,
      unlocked: lv.index >= u.level,
      xpToGo: Math.max(0, LEVELS[u.level].min - lv.xp),
    })),
  };
}

// The ledger keys. One key per real thing that happened, so a repeat is a no-op.
const keys = {
  card: (cardKey) => `card:${cardKey}`,
  checkin: (day) => `checkin:${day}`,
  budget: (month, category) => `budget:${month}:${String(category).trim().toLowerCase()}`,
  goal: (goalId) => `goal:${goalId}`,
  tracking: () => 'tracking',
};

// Backfill allowances. A long-standing account has many budget rows (one per category
// per month) and live budgets are paid inside a 50 a day cap, so history is limited to
// the first five budgets and the first five goals, to land an honest level and not
// a jump to the top.
const BACKFILL_MAX = { budget_set: 5, goal_hit: 5 };

// Decide what history the server can prove. Input is plain rows:
//   goals:   [{ _id, current, target }]                  (hit when current >= target > 0)
//   budgets: [{ month, category, createdAt }]
//   trackingOn: boolean (a capture key is set)
// Output is the ledger entries to write, in order, each { key, action, xp }.
function backfillPlan({ goals = [], budgets = [], trackingOn = false } = {}) {
  const out = [];
  const hit = goals.filter((g) => Number(g.target) > 0 && Number(g.current) >= Number(g.target))
    .sort((a, b) => String(a._id).localeCompare(String(b._id)))
    .slice(0, BACKFILL_MAX.goal_hit);
  for (const g of hit) out.push({ key: keys.goal(g._id), action: 'goal_hit', xp: ACTIONS.goal_hit });
  const seen = new Set();
  const ordered = [...budgets].sort((a, b) => (new Date(a.createdAt || 0) - new Date(b.createdAt || 0)) || String(a.month).localeCompare(String(b.month)));
  for (const b of ordered) {
    const key = keys.budget(b.month, b.category);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > BACKFILL_MAX.budget_set) break;
    out.push({ key, action: 'budget_set', xp: ACTIONS.budget_set });
  }
  if (trackingOn) out.push({ key: keys.tracking(), action: 'tracking_on', xp: ACTIONS.tracking_on });
  return out;
}

module.exports = { DAILY_CAP, ACTIONS, LEVELS, UNLOCKS, BADGE_SLOTS, BACKFILL_MAX, levelFor, payout, decide, summary, shelfSlots, keys, backfillPlan };
