'use strict';
// Run: node backend/lib/metrics.test.js
const m = require('./metrics');
const plans = require('./plans');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const today = '2026-10-11'; // a Sunday
const at = (day, hh = '10:00') => new Date(`${day}T${hh}:00+01:00`);

check('Lagos day: 23:30 UTC is the next day in Lagos', m.lagosDay('2026-10-10T23:30:00Z') === '2026-10-11');
check('Lagos day: 22:30 UTC is still the same day', m.lagosDay('2026-10-10T22:30:00Z') === '2026-10-10');
check('weeks start on Monday', m.weekOf('2026-10-11') === '2026-10-05' && m.weekOf('2026-10-05') === '2026-10-05' && m.weekOf('2026-10-12') === '2026-10-12');
check('adding days crosses months', m.addDays('2026-09-30', 1) === '2026-10-01');

const users = [
  { id: 'a', createdAt: at('2026-09-28'), client: 'web' },
  { id: 'b', createdAt: at('2026-09-29'), client: 'android-beta' },
  { id: 'c', createdAt: at('2026-10-06'), client: 'android-play' },
  { id: 'd', createdAt: at('2026-10-10') },
  { id: 'old', createdAt: at('2025-01-01'), client: 'web' },
];
const s = m.signupsByWeek(users, today, 3);
check('signups: three weeks, oldest first', s.map((r) => r.week).join() === '2026-09-21,2026-09-28,2026-10-05', s.map((r) => r.week).join());
check('signups: counted per week', s[1].total === 2 && s[2].total === 2 && s[0].total === 0);
check('signups: by app, unknown when not sent', s[1].byClient.web === 1 && s[1].byClient['android-beta'] === 1 && s[2].byClient.unknown === 1);
check('signups: older weeks are left out', s.reduce((t, r) => t + r.total, 0) === 4);

const days = [
  { userId: 'a', day: '2026-09-28' }, { userId: 'a', day: '2026-10-06' }, { userId: 'a', day: '2026-10-11' },
  { userId: 'b', day: '2026-09-29' },
  { userId: 'c', day: '2026-10-06' }, { userId: 'c', day: '2026-10-11' },
  { userId: 'd', day: '2026-10-10' },
  { userId: 'old', day: '2026-09-15' },
];
const a = m.activeCounts(days, today);
check('DAU counts today', a.dau === 2, a);
check('WAU counts the last 7 days', a.wau === 3, a);
check('MAU counts the last 30 days', a.mau === 5, a);
check('series is 30 days ending today', a.series.length === 30 && a.series[29].day === today && a.series[29].users === 2);
check('stickiness is average DAU over MAU', a.stickiness === Math.round((5 / 7 / 5) * 1000) / 10, a.stickiness);
check('no activity gives zeros, not errors', m.activeCounts([], today).mau === 0 && m.activeCounts([], today).stickiness === null);

const r = m.retention(users, days, today, 3);
const w0928 = r.find((x) => x.week === '2026-09-28');
check('retention: signup week counts as week 0', w0928.size === 2 && w0928.rates[0] === 100, w0928);
check('retention: week 1 is the share active the week after', w0928.rates[1] === 50, w0928);
check('retention: weeks that have not started are null', w0928.rates[2] === null);
check('retention: empty cohort has nulls', r.find((x) => x.week === '2026-09-21').rates.every((v) => v === null));

const firsts = [
  { userId: 'a', date: at('2026-09-29'), source: 'sms' },
  { userId: 'b', date: at('2026-10-20'), source: 'import' },
  { userId: 'c', date: at('2026-10-07'), source: 'email' },
];
const act = m.activation(users, firsts, today, 3);
const c0928 = act.cohorts.find((x) => x.week === '2026-09-28');
check('activation: only first transactions within 7 days count', c0928.eligible === 2 && c0928.activated === 1 && c0928.rate === 50, c0928);
const c1005 = act.cohorts.find((x) => x.week === '2026-10-05');
check('activation: signups younger than 7 days are not judged yet', c1005.size === 2 && c1005.eligible === 0 && c1005.rate === null, c1005);
check('activation: first transaction source mix', act.firstSource.sms === 1 && act.firstSource.import === 1 && act.firstSource.email === 1);
check('activation: share who ever added one', act.everActivated === 60);

const now = new Date('2026-10-11T12:00:00Z');
const D = 86400000;
const pu = [
  { createdAt: new Date(now - 3 * D), plan: 'free' }, // trial
  { createdAt: new Date(now - 60 * D), plan: 'pro', planExpiry: new Date(+now + 10 * D), planEverPaid: true },
  { createdAt: new Date(now - 60 * D), plan: 'student', planExpiry: new Date(+now + 50 * D), student: { status: 'verified', expiresAt: new Date(+now + 300 * D) } }, // free months
  { createdAt: new Date(now - 200 * D), plan: 'student', planExpiry: new Date(+now + 20 * D), planEverPaid: true, student: { status: 'verified', expiresAt: new Date(+now + 100 * D) } },
  { createdAt: new Date(now - 90 * D), plan: 'free' },
];
const mo = m.money(pu, plans, now, plans.config({ PAYWALL_ENABLED: 'true' }));
check('money: trial users', mo.onTrial === 1, mo);
check('money: paid by plan', mo.paid.pro === 1 && mo.paid.student === 2 && mo.paidTotal === 3, mo);
check('money: MRR leaves out free Student months', mo.mrr === 1500 + 700, mo.mrr);
check('money: trial-to-paid conversion', mo.trialEnded === 4 && mo.converted === 2 && mo.conversion === 50, mo);
check('money: verified students', mo.studentsVerified === 2);

const im = m.imports([{ source: 'sms', total: 80, review: 8 }, { source: 'email', total: 20, review: 2 }], 5);
check('imports: totals and review share', im.total === 100 && im.reviewShare === 10 && im.correctionRate === 5, im);
check('imports: sources largest first, with shares', im.sources[0].source === 'sms' && im.sources[0].share === 80);
check('imports: nothing imported is safe', m.imports([], 0).reviewShare === null);

console.log(`metrics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
