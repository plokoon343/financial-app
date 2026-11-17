'use strict';
// Run: node backend/lib/xp.test.js
const x = require('./xp');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };

// Level boundaries: each threshold is the first XP of its level.
const at = (n) => x.levelFor(n).name;
check('0 is Starter', at(0) === 'Starter');
check('99 is still Starter', at(99) === 'Starter');
check('100 is Tracker', at(100) === 'Tracker');
check('249 Tracker, 250 Planner', at(249) === 'Tracker' && at(250) === 'Planner');
check('499 Planner, 500 Saver', at(499) === 'Planner' && at(500) === 'Saver');
check('999 Saver, 1000 Strategist', at(999) === 'Saver' && at(1000) === 'Strategist');
check('1999 Strategist, 2000 Boss', at(1999) === 'Strategist' && at(2000) === 'Boss');
check('far past the top stays Boss at 100%', at(99999) === 'Boss' && x.levelFor(99999).pct === 100 && x.levelFor(99999).next === null);
check('junk is 0', at(-5) === 'Starter' && at('x') === 'Starter' && at(NaN) === 'Starter');
check('level number is index + 1', x.levelFor(250).level === 3);
const p = x.levelFor(175);
check('progress to next: 75 of 150 is 50%, 75 to go', p.pct === 50 && p.intoLevel === 75 && p.span === 150 && p.toNext === 75 && p.next.name === 'Planner');

// Values the owner approved.
check('action values', x.ACTIONS.card_sorted === 5 && x.ACTIONS.checkin === 2 && x.ACTIONS.budget_set === 20 && x.ACTIONS.goal_hit === 50 && x.ACTIONS.tracking_on === 30 && x.ACTIONS.card_shared === 10);
check('cap is 50', x.DAILY_CAP === 50);

// Daily cap.
check('under the cap pays in full', x.payout('goal_hit', 0).xp === 50);
check('exactly at the cap pays nothing', x.payout('card_sorted', 50).xp === 0 && x.payout('card_sorted', 50).capped);
check('near the cap pays the remainder only', x.payout('budget_set', 40).xp === 10 && x.payout('budget_set', 40).capped);
check('never more than the cap in a day', (() => {
  let today = 0; const have = new Set();
  for (let i = 0; i < 200; i++) { const e = x.decide(have, today, 'card_sorted', `card:${i}`); have.add(e.key); today += e.xp; }
  return today === 50;
})());
check('a long sorting session cannot jump a level (100 needs 2 days)', (() => {
  let today = 0, total = 0; const have = new Set();
  for (let i = 0; i < 100; i++) { const e = x.decide(have, today, 'card_sorted', `card:${i}`); have.add(e.key); today += e.xp; total += e.xp; }
  return total === 50 && x.levelFor(total).name === 'Starter';
})());
check('unknown action pays nothing', x.payout('nope', 0).xp === 0 && x.decide(new Set(), 0, 'nope', 'k') === null);

// Idempotency.
check('same key never awards twice', (() => {
  const have = new Set(); const first = x.decide(have, 0, 'goal_hit', x.keys.goal('g1'));
  have.add(first.key);
  return first.xp === 50 && x.decide(have, 0, 'goal_hit', x.keys.goal('g1')) === null;
})());
check('a capped award still burns its key, so tomorrow cannot pay it again', (() => {
  const have = new Set(); const e = x.decide(have, 50, 'goal_hit', 'goal:g2'); have.add(e.key);
  return e.xp === 0 && x.decide(have, 0, 'goal_hit', 'goal:g2') === null;
})());
check('budget key ignores case and spaces', x.keys.budget('2026-11', ' Food ') === x.keys.budget('2026-11', 'food'));
check('different month is a different budget', x.keys.budget('2026-11', 'food') !== x.keys.budget('2026-12', 'food'));

// Unlocks.
const s0 = x.summary(0, 0), s1 = x.summary(100, 12);
check('icons locked at Starter, open at Tracker', s0.unlocks[0].unlocked === false && s0.unlocks[0].xpToGo === 100 && s1.unlocks[0].unlocked === true && s1.unlocks[0].levelName === 'Tracker');
check('today and left today', s1.today === 12 && s1.leftToday === 38 && s1.dailyCap === 50);
check('today is clamped to the cap', x.summary(10, 999).today === 50);
check('badge slots grow with level', x.summary(0, 0).badgeSlots === 4 && x.summary(2000, 0).badgeSlots === 9);

// Backfill.
check('no history, no XP', x.backfillPlan({}).length === 0);
const full = x.backfillPlan({
  goals: [{ _id: 'a', current: 100, target: 100 }, { _id: 'b', current: 50, target: 100 }, { _id: 'c', current: 0, target: 0 }],
  budgets: [{ month: '2026-09', category: 'Food', createdAt: '2026-09-01' }, { month: '2026-09', category: 'food', createdAt: '2026-09-02' }, { month: '2026-10', category: 'Food', createdAt: '2026-10-01' }],
  trackingOn: true,
});
const total = (plan) => plan.reduce((n, e) => n + e.xp, 0);
check('only a hit goal counts', full.filter((e) => e.action === 'goal_hit').length === 1);
check('a budget repeated by case counts once; a new month counts', full.filter((e) => e.action === 'budget_set').length === 2);
check('tracking counts once', full.filter((e) => e.action === 'tracking_on').length === 1);
check('total is 50 + 40 + 30', total(full) === 120 && x.levelFor(120).name === 'Tracker');
check('backfill keys match the live keys', full.some((e) => e.key === x.keys.goal('a')) && full.some((e) => e.key === x.keys.budget('2026-10', 'food')) && full.some((e) => e.key === x.keys.tracking()));
const mk = (rev) => {
  const goals = Array.from({ length: 12 }, (_, i) => ({ _id: `g${i}`, current: 1, target: 1 }));
  return x.backfillPlan({
    goals: rev ? goals.reverse() : goals,
    budgets: Array.from({ length: 80 }, (_, i) => ({ month: `2026-${String(i % 12 + 1).padStart(2, '0')}`, category: `c${i}`, createdAt: new Date(2026, 0, 1 + i) })),
    trackingOn: true,
  });
};
const heavy = mk(false);
check('a long-standing account is capped: 5 goals, 5 budgets, tracking', heavy.length === 11 && total(heavy) === 250 + 100 + 30);
check('the heaviest possible backfill lands on Planner, never above', x.levelFor(total(heavy)).name === 'Planner');
check('backfill is deterministic', JSON.stringify(heavy) === JSON.stringify(mk(true)));

console.log(`xp: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
