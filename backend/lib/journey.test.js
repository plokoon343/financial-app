'use strict';
// Run: node backend/lib/journey.test.js
const journey = require('./journey');
const nudges = require('./nudges');
const BASE = require('../data/journey-moments.json');
const COPY = nudges.mergeCopy(require('../data/nudge-copy.json'));

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const DAY = 86400000;
const at = (iso) => new Date(new Date(`${iso}Z`).getTime() - 3600000);   // Lagos wall clock to a UTC instant
const MOMENTS = journey.mergeMoments(BASE.moments, {});

// A simulated account, stepped day by day the way the server does it: pick, then claim.
// Created Tuesday 3 Nov 2026; month end (30 Nov) is day 27, 1 Dec is day 28.
const CREATED = at('2026-11-03T09:00:00');
function simulate(over = {}, { days = 31, hourOf = (d) => (d === 0 ? 19 : 12), moments = MOMENTS, snapOf, awayFrom, awayTo } = {}) {
  const served = [], log = [];
  for (let d = 0; d <= days; d++) {
    if (awayFrom != null && d >= awayFrom && d <= awayTo) continue;           // did not open the app
    const now = new Date(CREATED.getTime() + d * DAY + (hourOf(d) - 9) * 3600000);
    const snap = {
      createdAt: CREATED, audience: '', plan: 'free', lastActiveAt: now, incomeSet: true, budgetSet: false, ruleMade: false,
      cashUsed: false, bankCount: 1, askUsed: false, aiOn: true, hasTxns: true,
      txns: d === 8 ? [{ id: 'p', date: new Date(now.getTime() - 4 * 3600000), amount: 250000, type: 'income', description: 'SALARY NOV' }] : [],
      ...over, ...(snapOf ? snapOf(d, now) : {}),
    };
    const r = journey.pick({ moments, snap, served, now });
    if (r && r.fresh) {
      served.push({ momentId: r.moment.id, claimDay: nudges.lagosDay(now), status: 'shown' });
      log.push({ day: d, id: r.moment.id, dateKey: nudges.lagosDay(now) });
    }
  }
  return log;
}
const dayOf = (log, id) => log.filter((l) => l.id === id).map((l) => l.day);

// 1. A 30-day account gets each moment once, on its day.
{
  const log = simulate();
  const want = { day0_summary: 0, day1_found: 1, day2_rule: 2, day3_budget: 3, day4_cash: 4, day5_bank: 5, day7_recap: 7, payday: 8,
    day10_ask: 10, day14_check: 14, day21_sapa: 21, better_month: 25, month_end: 27, month_after: 28 };
  for (const [id, d] of Object.entries(want)) check(`${id} once, on day ${d}`, dayOf(log, id).join() === String(d), JSON.stringify(dayOf(log, id)));
  check('never two moments on one day', new Set(log.map((l) => l.dateKey)).size === log.length);
  check('nothing from the other branches (student, corper, win-back email)', !log.some((l) => ['day21_lasting', 'corper_allowance', 'day14_winback'].includes(l.id)));
  check('every served moment id is unique', new Set(log.map((l) => l.id)).size === log.length);
}

// 2. Already done means never served.
{
  check('budget set: day 3 never reaches them', !simulate({ budgetSet: true }).some((l) => l.id === 'day3_budget'));
  check('budget set on day 2: still skipped on day 3', !simulate({}, { snapOf: (d) => (d >= 2 ? { budgetSet: true } : {}) }).some((l) => l.id === 'day3_budget'));
  check('rule made: day 2 skipped', !simulate({ ruleMade: true }).some((l) => l.id === 'day2_rule'));
  check('cash used: day 4 skipped', !simulate({ cashUsed: true }).some((l) => l.id === 'day4_cash'));
  check('three banks: day 5 skipped', !simulate({ bankCount: 3 }).some((l) => l.id === 'day5_bank'));
  check('Ask already used: day 10 skipped', !simulate({ askUsed: true }).some((l) => l.id === 'day10_ask'));
  check('Ask is for Free only', !simulate({ plan: 'pro' }).some((l) => l.id === 'day10_ask'));
  check('Ask needs the assistant on', !simulate({ aiOn: false }).some((l) => l.id === 'day10_ask'));
  check('no income set: no Sapa radar', !simulate({ incomeSet: false }).some((l) => l.id === 'day21_sapa'));
  check('no transactions yet: no "here is what we found"', !simulate({ hasTxns: false }).some((l) => l.id === 'day1_found'));
}

// 3. Branches: corper replaces payday, students get their own day 21, inactive get the email not the card.
{
  const corper = simulate({ audience: 'corper' });
  check('corper: allowance moment on day 8', dayOf(corper, 'corper_allowance').join() === '8');
  check('corper: the payday moment is replaced, never both', !corper.some((l) => l.id === 'payday'));
  check('non-corper: payday and no allowance moment', dayOf(simulate(), 'payday').length === 1 && !simulate().some((l) => l.id === 'corper_allowance'));
  const student = simulate({ audience: 'student' });
  check('student: "how long will the money last" on day 21', dayOf(student, 'day21_lasting').join() === '21');
  check('student: no Sapa radar', !student.some((l) => l.id === 'day21_sapa'));
  const quiet = simulate({}, { snapOf: (d, now) => (d >= 8 ? { lastActiveAt: new Date(CREATED.getTime() + 6 * DAY) } : {}) });
  const cards = journey.mergeMoments(BASE.moments, {});
  check('away at day 14: no two-week card', !quiet.some((l) => l.id === 'day14_check'));
  const email = simulate({}, { snapOf: (d) => (d >= 8 ? { lastActiveAt: new Date(CREATED.getTime() + 6 * DAY) } : {}), moments: cards.map((m) => ({ ...m })) });
  check('card channel never serves the email moment', !email.some((l) => l.id === 'day14_winback'));
  // The email channel picks it instead.
  const now = new Date(CREATED.getTime() + 14 * DAY + 3 * 3600000);
  const snap = { createdAt: CREATED, plan: 'free', lastActiveAt: new Date(CREATED.getTime() + 6 * DAY), hasTxns: true, txns: [] };
  const em = journey.pick({ moments: MOMENTS, snap, served: [], now, channel: 'email' });
  check('email channel serves the win-back to someone away', em && em.moment.id === 'day14_winback');
  const em2 = journey.pick({ moments: MOMENTS, snap: { ...snap, lastActiveAt: now }, served: [], now, channel: 'email' });
  check('and not to someone who is active', !em2);
}

// 4. Nobody gets a backlog.
{
  // Away days 2 to 9, back on day 10: only day 10's own moment, nothing from days 2 to 9 that has expired.
  const log = simulate({}, { awayFrom: 2, awayTo: 9, snapOf: (d) => ({ lastActiveAt: new Date(CREATED.getTime() + (d >= 10 ? d : 1) * DAY) }) });
  const ids = log.map((l) => l.id);
  check('back after a week: today only, no stale moments', ids.join() === 'day0_summary,day1_found,day10_ask,day14_check,day21_sapa,better_month,month_end,month_after'.replace(',day14_check', ',day14_check'), ids.join());
  check('stale days 2 to 7 never arrive late', !['day2_rule', 'day3_budget', 'day4_cash', 'day5_bank', 'day7_recap'].some((i) => ids.includes(i)));
  // Day 0 has a 6 pm gate and no grace: opened at 10 am gets nothing, and it is not owed later.
  const early = simulate({}, { hourOf: () => 10 });
  check('day 0 evening summary never shows before 6 pm and is not owed later', !early.some((l) => l.id === 'day0_summary'));
  // Window ends: an old account sees nothing.
  const old = journey.pick({ moments: MOMENTS, snap: { createdAt: new Date(CREATED.getTime() - 200 * DAY), plan: 'free', hasTxns: true, incomeSet: true, txns: [] }, served: [], now: CREATED });
  check('an established account gets no journey moment', old === null);
  // Week-long gap with the week's recap still inside its grace window comes once.
  const l2 = simulate({}, { awayFrom: 0, awayTo: 8 });
  check('back on day 9: the week recap is within grace and arrives once, nothing else stale', l2.filter((l) => l.day === 9).map((l) => l.id).join() === 'day7_recap', JSON.stringify(l2.slice(0, 3)));
}

// 5. A claimed day is final; dismissed means silence for the rest of the day.
{
  const now = new Date(CREATED.getTime() + 3 * DAY + 3 * 3600000);
  const snap = { createdAt: CREATED, plan: 'free', hasTxns: true, txns: [] };
  const served = [{ momentId: 'day2_rule', claimDay: nudges.lagosDay(now), status: 'shown' }];
  check('a claimed day keeps its moment, even if another is due', journey.pick({ moments: MOMENTS, snap, served, now }).moment.id === 'day2_rule');
  check('and it is not fresh', journey.pick({ moments: MOMENTS, snap, served, now }).fresh === false);
  const dismissed = [{ momentId: 'day2_rule', claimDay: nudges.lagosDay(now), status: 'dismissed' }];
  check('dismissed: nothing else today', journey.pick({ moments: MOMENTS, snap, served: dismissed, now }) === null);
  const skipped = [{ momentId: 'better_month', status: 'skipped' }];
  const lateNow = new Date(CREATED.getTime() + 26 * DAY + 3 * 3600000);
  check('skipped (not real) frees the day and never returns', journey.pick({ moments: MOMENTS, snap: { ...snap, incomeSet: true }, served: skipped, now: lateNow }) === null);
}

// 6. Quiet hours and the push line.
{
  check('quiet at 22', journey.inQuiet(22, null)); check('quiet at 23', journey.inQuiet(23, null));
  check('quiet at 3', journey.inQuiet(3, null)); check('quiet at 7', journey.inQuiet(7, null));
  check('not quiet at 8', !journey.inQuiet(8, null)); check('not quiet at 21', !journey.inQuiet(21, null));
  check("the person's own wider quiet hours also hold", journey.inQuiet(20, { from: 19, to: 7 }) && !journey.inQuiet(14, { from: 19, to: 7 }));
  const m = MOMENTS.find((x) => x.id === 'day3_budget');
  check('push only inside the moment window and outside quiet', journey.pushNow(m, at('2026-11-06T10:00:00'), null) && !journey.pushNow(m, at('2026-11-06T22:30:00'), null) && !journey.pushNow(m, at('2026-11-06T07:00:00'), null));
  const msg = journey.pushText(m, { copy: COPY, prefs: {} });
  check('day 3 push reuses the setup_budget nudge copy', msg && COPY.setup_budget.variants.some((v) => v.text === msg.body), JSON.stringify(msg));
  // The push call is hoisted OUT of the some() predicate on purpose. Inline, it ran once
  // per variant and picked a fresh random variant each time, so the assertion only held
  // when one of three independent picks happened to match the variant being compared:
  // (2/3)^3, about a 30% failure rate. One pick, then look for it.
  const payMsg = journey.pushText(MOMENTS.find((x) => x.id === 'payday'), { copy: COPY });
  check('payday push reuses the payday_detected copy', payMsg && COPY.payday_detected.variants.some((v) => v.text === payMsg.body), JSON.stringify(payMsg));
  check('a switched-off category sends nothing', journey.pushText(m, { copy: COPY, prefs: { budgets: false } }) === null);
  check('a moment with no push has none', journey.pushText(MOMENTS.find((x) => x.id === 'day2_rule'), { copy: COPY }) === null);
  check('better_month has no push (the phone verifies it)', !MOMENTS.find((x) => x.id === 'better_month').push);
}

// 7. Configurable from the server: overrides change a day, copy and switches; bad edits fall back.
{
  const moved = journey.mergeMoments(BASE.moments, { day3_budget: { day: 6, card: { title: 'Budget time' } } });
  const m = moved.find((x) => x.id === 'day3_budget');
  check('override moves a moment to another day', m.day === 6 && m.card.title === 'Budget time' && m.card.body.startsWith('Pick one'));
  check('and the scheduler follows it', dayOf(simulate({}, { moments: moved }), 'day3_budget').join() === '6');
  check('override switches a moment off', !simulate({}, { moments: journey.mergeMoments(BASE.moments, { day4_cash: { enabled: false } }) }).some((l) => l.id === 'day4_cash'));
  const bad = journey.mergeMoments(BASE.moments, { day3_budget: { card: { body: 'Set it — now' } } });
  check('copy with an em dash is refused and the default stays', bad.find((x) => x.id === 'day3_budget').card.body.startsWith('Pick one'));
  const emoji = journey.mergeMoments(BASE.moments, { day3_budget: { card: { title: 'Budget \u{1F4B0}' } } });
  check('copy with an emoji is refused', emoji.find((x) => x.id === 'day3_budget').card.title === 'Set your first budget');
  const added = journey.mergeMoments(BASE.moments, { day9_extra: { trigger: 'day', day: 9, card: { title: 'Extra', body: 'A new moment.', nav: '/goals' } } });
  check('a new moment can be added from the server', added.some((x) => x.id === 'day9_extra') && dayOf(simulate({}, { moments: added }), 'day9_extra').join() === '9');
  check('an incomplete new moment is dropped', !journey.mergeMoments(BASE.moments, { nope_one: { trigger: 'day', day: 9 } }).some((x) => x.id === 'nope_one'));
  const loaded = journey.mergeMoments(BASE.moments, { day3_budget: { enabled: 'nope', trigger: 'sideways' } });
  check('an unknown trigger falls back to the default', loaded.find((x) => x.id === 'day3_budget').trigger === 'day');
}

// 8. The shipped copy follows the house rules.
{
  const all = BASE.moments.flatMap((m) => [m.card && m.card.title, m.card && m.card.body, m.card && m.card.button, m.email && m.email.subject, m.email && m.email.text, m.push && m.push.text]).filter(Boolean);
  check('no emoji or dashes in any shipped moment', all.every(journey.copyOk));
  check('every push copyKey exists in the nudge copy', BASE.moments.filter((m) => m.push && m.push.copyKey).every((m) => COPY[m.push.copyKey]));
  check('every card has a title, a message and an app route', BASE.moments.filter((m) => m.card).every((m) => m.card.title && m.card.body && m.card.nav.startsWith('/')));
  check('every shipped moment passes validation unchanged', BASE.moments.every((m) => !journey.sanitizeMoment(m, m.id).error));
  check('titles fit the card (60)', MOMENTS.every((m) => !m.card || m.card.title.length <= 60));
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
