'use strict';
// Run: node backend/lib/nudges.test.js
const { evaluate, select, pickVariant, render, mergeCopy, lagos } = require('./nudges');
const COPY = mergeCopy(require('../data/nudge-copy.json'));

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const DAY = 86400000;
// A UTC instant for a Lagos wall-clock time (Lagos is UTC+1).
const at = (iso) => new Date(new Date(`${iso}Z`).getTime() - 3600000);
const triggers = (s, now) => evaluate(s, now).map((c) => c.trigger);
const old = '2026-01-01T00:00:00Z'; // an established user
const tx = (daysAgo, amount, extra = {}, now = NOW) => ({ id: `t${Math.random()}`, date: new Date(now - daysAgo * DAY).toISOString(), amount, type: amount > 0 ? 'income' : 'expense', category: 'Other', description: '', ...extra });
const NOW = at('2026-10-14T10:00:00'); // a Wednesday

// Lagos time
check('lagos hour', lagos(at('2026-10-14T22:30:00')).hour === 22);
check('lagos weekday (Wed = 3)', lagos(NOW).weekday === 3);

// First week: setup nudges only
check('new user with nothing gets setup_connect', triggers({ createdAt: new Date(NOW - 2 * DAY), txns: [] }, NOW).join() === 'setup_connect');
check('new user with transactions gets setup_budget', triggers({ createdAt: new Date(NOW - 2 * DAY), txns: [tx(1, -500)] }, NOW).join() === 'setup_budget');
check('new user never gets other triggers', !triggers({ createdAt: new Date(NOW - 2 * DAY), txns: [tx(0.1, 250000, { description: 'SALARY OCT' })], budgets: [{ category: 'Food', amount: 1 }] }, NOW).includes('payday_detected'));

// Budgets
const food = (amt, daysAgo = 1) => tx(daysAgo, -amt, { category: 'Food' });
check('budget at 85% with days left -> budget_80', triggers({ createdAt: old, txns: [food(8500)], budgets: [{ category: 'Food', amount: 10000 }] }, NOW).includes('budget_80'));
check('budget at 85% with 3 days left -> nothing', !triggers({ createdAt: old, txns: [food(8500, 1)], budgets: [{ category: 'Food', amount: 10000 }] }, at('2026-10-28T10:00:00')).includes('budget_80'));
check('budget over -> budget_over', triggers({ createdAt: old, txns: [food(12000)], budgets: [{ category: 'Food', amount: 10000 }] }, NOW).includes('budget_over'));
check('budget at 50% -> nothing', triggers({ createdAt: old, txns: [food(5000)], budgets: [{ category: 'Food', amount: 10000 }] }, NOW).length === 0);

// Payday
check('salary credit today -> payday', triggers({ createdAt: old, txns: [tx(0.2, 180000, { description: 'SALARY OCT 2026 ACME' })] }, NOW).includes('payday_detected'));
check('big usual credit -> payday', triggers({ createdAt: old, txns: [tx(0.2, 150000, { description: 'TRF FROM ACME' }), tx(30, 160000, { description: 'TRF FROM ACME' })] }, NOW).includes('payday_detected'));
check('small credit -> no payday', !triggers({ createdAt: old, txns: [tx(0.2, 3000, { description: 'TRF FROM TUNDE' }), tx(30, 160000)] }, NOW).includes('payday_detected'));

// Spending spike
const steady = Array.from({ length: 56 }, (_, i) => tx(i + 7.5, -1000)); // 7,000 a week for 8 weeks
check('week 50% above average -> spend_spike', triggers({ createdAt: old, txns: [...steady, tx(1, -10500)] }, NOW).includes('spend_spike'));
check('normal week -> no spike', !triggers({ createdAt: old, txns: [...steady, tx(1, -7000)] }, NOW).includes('spend_spike'));
check('too little history -> no spike', !triggers({ createdAt: old, txns: [tx(10, -1000), tx(1, -50000)] }, NOW).includes('spend_spike'));

// Friday delivery
const FRI = at('2026-10-16T17:30:00');
const fridays = [1, 2, 3].map((w) => tx(w * 7, -4000, { description: 'CHOWDECK ORDER', category: 'Food' }, FRI));
check('Friday 17:30 with 3 delivery Fridays -> friday_delivery', triggers({ createdAt: old, txns: fridays }, FRI).includes('friday_delivery'));
check('Friday 20:00 -> no friday_delivery', !triggers({ createdAt: old, txns: fridays }, at('2026-10-16T20:00:00')).includes('friday_delivery'));
check('only 2 delivery Fridays -> none', !triggers({ createdAt: old, txns: fridays.slice(0, 2) }, FRI).includes('friday_delivery'));

// No-spend streak
const lastShop = (daysAgo) => [tx(daysAgo, -3000, { category: 'Shopping' }), tx(daysAgo + 0.5, -200, { category: 'Transfer' })];
const streak = evaluate({ createdAt: old, txns: lastShop(3.6) }, NOW).find((c) => c.trigger === 'no_spend_streak');
check('3 clean days -> streak with n=3', streak && streak.vars.n === 3, JSON.stringify(streak));
check('4 clean days -> no message (only at 3, 5, 7...)', !triggers({ createdAt: old, txns: lastShop(4.6) }, NOW).includes('no_spend_streak'));

// Bills and subscriptions
check('bill due in 3 days -> bill_due', triggers({ createdAt: old, bills: [{ id: 'b1', name: 'Rent', nextDue: new Date(NOW.getTime() + 3 * DAY) }] }, NOW).includes('bill_due'));
check('bill due in 5 days -> nothing', !triggers({ createdAt: old, bills: [{ id: 'b1', name: 'Rent', nextDue: new Date(NOW.getTime() + 5 * DAY) }] }, NOW).includes('bill_due'));
check('subscription tomorrow -> renewal', triggers({ createdAt: old, subs: [{ id: 's1', name: 'Netflix', nextRenewal: new Date(NOW.getTime() + DAY) }] }, NOW).includes('subscription_renewal'));

// Review, inactivity, recaps, goals
check('5 to review -> review_pending', triggers({ createdAt: old, reviewPending: 5 }, NOW).includes('review_pending'));
check('4 to review -> nothing', !triggers({ createdAt: old, reviewPending: 4 }, NOW).includes('review_pending'));
const away = { createdAt: old, lastActiveAt: new Date(NOW - 6 * DAY), txns: [{ ...tx(1, -500), createdAt: new Date(NOW - DAY) }] };
check('away 6 days with new rows -> inactive_5d', triggers(away, NOW).includes('inactive_5d'));
check('Sunday 18:00 -> weekly_recap', triggers({ createdAt: old }, at('2026-10-18T18:05:00')).includes('weekly_recap'));
check('Sunday 17:00 -> no recap yet', !triggers({ createdAt: old }, at('2026-10-18T17:05:00')).includes('weekly_recap'));
check('1st at 09:00 -> month_start', triggers({ createdAt: old }, at('2026-11-01T09:10:00')).includes('month_start'));
const goal = evaluate({ createdAt: old, goals: [{ id: 'g1', name: 'Laptop', target: 100000, current: 52000, notifiedMilestone: 25 }] }, NOW).find((c) => c.trigger === 'goal_progress');
check('goal crossing 50% -> goal_progress at 50', goal && goal.vars.pct === 50, JSON.stringify(goal));
check('goal already told about 50% -> nothing', !triggers({ createdAt: old, goals: [{ id: 'g1', name: 'Laptop', target: 100000, current: 52000, notifiedMilestone: 50 }] }, NOW).includes('goal_progress'));

// Selection: priority, settings, limits, quiet hours
const c = (trigger, key = trigger) => ({ trigger, key, vars: {} });
check('priority: bill before spike', select([c('spend_spike'), c('bill_due')], { copy: COPY, now: NOW }).trigger === 'bill_due');
check('category switched off is skipped', select([c('bill_due'), c('spend_spike')], { copy: COPY, now: NOW, prefs: { bills: false } }).trigger === 'spend_spike');
check('quiet hours 23:00 -> nothing', select([c('bill_due')], { copy: COPY, now: at('2026-10-14T23:00:00') }) === null);
check('quiet hours 06:30 -> nothing', select([c('bill_due')], { copy: COPY, now: at('2026-10-14T06:30:00') }) === null);
check('07:00 -> sends', select([c('bill_due')], { copy: COPY, now: at('2026-10-14T07:00:00') }) !== null);
const sent = (hoursAgo, trigger = 'month_start', key = `k${hoursAgo}`) => ({ trigger, key, sentAt: new Date(NOW - hoursAgo * 3600000) });
check('two already today -> nothing', select([c('bill_due')], { copy: COPY, now: NOW, log: [sent(4), sent(8)] }) === null);
check('one 2 hours ago -> wait (3h gap)', select([c('bill_due')], { copy: COPY, now: NOW, log: [sent(2)] }) === null);
check('one 4 hours ago -> sends', select([c('bill_due')], { copy: COPY, now: NOW, log: [sent(4)] }) !== null);
check('same trigger within 24h -> skipped', select([c('spend_spike', 'x')], { copy: COPY, now: NOW, log: [sent(20, 'spend_spike')] }) === null);
check('same occasion never twice', select([c('bill_due', 'bill_due:b1:2026-10-17')], { copy: COPY, now: NOW, log: [sent(40, 'bill_due', 'bill_due:b1:2026-10-17')] }) === null);

// Variants and rendering
const vs = COPY.payday_detected.variants;
check('never the same variant twice in a row', Array.from({ length: 50 }, () => pickVariant(vs, 'payday-1').id).every((id) => id !== 'payday-1'));
check('switched-off variant is never picked', Array.from({ length: 50 }, () => pickVariant([{ id: 'a', text: 'x', active: false }, { id: 'b', text: 'y' }], null).id).every((id) => id === 'b'));
const fri = COPY.friday_delivery.variants.find((v) => v.id === 'fri-2');
check('amounts off: amount-free line', render(fri, { remaining: 4500 }) === 'Friday cravings incoming. Check what\'s left in your food budget.');
check('amounts on: amount line', render(fri, { remaining: 4500 }, { showAmounts: true }) === 'Friday cravings incoming. Your food budget has ₦4,500 left.');
check('category filled', render(COPY.budget_80.variants[1], { category: 'Food', days_left: 9 }) === 'Food is at 80%. 9 days to go. You\'ve got this.');
check('a missing variable refuses to render', render(COPY.budget_80.variants[1], { category: 'Food' }) === null);
const noNaira = Object.values(COPY).flatMap((t) => [...(t.variants || []), ...(t.completeVariants || [])]).every((v) => !/₦|\bNGN\b|\{(amount|remaining)\}/.test(v.text));
check('no default line carries an amount', noNaira);
check('no emoji in any line', Object.values(COPY).flatMap((t) => [...(t.variants || []), ...(t.completeVariants || [])]).every((v) => !/\p{Extended_Pictographic}/u.test(`${v.text} ${v.withAmount || ''}`)));
check('every trigger has a category from the settings list', Object.values(COPY).every((t) => ['spending', 'budgets', 'bills', 'streaks', 'recap', 'tips'].includes(t.category)));

// Admin edits
const edited = mergeCopy(require('../data/nudge-copy.json'), [{ trigger: 'payday_detected', variantId: 'payday-1', text: 'Edited', active: false }, { trigger: 'payday_detected', variantId: 'payday-new', text: 'New line' }]);
check('admin edit replaces a line', edited.payday_detected.variants.find((v) => v.id === 'payday-1').text === 'Edited');
check('admin can add a line', edited.payday_detected.variants.some((v) => v.id === 'payday-new'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
