'use strict';

// Core metrics for the admin dashboard. Pure: the server loads plain rows and these
// functions count them. Days are Lagos calendar days (UTC+1, no daylight saving);
// weeks start on Monday.
//
//   Acquisition   signups per week, by the app they signed up in
//   Activation    share of each week's signups with a transaction within 7 days, and
//                 how that first transaction came in (SMS, email, statement, …)
//   Engagement    daily / weekly / monthly active users, stickiness (DAU ÷ MAU)
//   Retention     of each signup week, the share active in each following week
//   Money         trial, paid by plan, trial-to-paid conversion, monthly revenue
//   Imports       last 30 days of transactions by source, share needing review

const DAY = 86400000;
const LAGOS_OFFSET = 3600000;

const lagosDay = (d) => new Date(new Date(d).getTime() + LAGOS_OFFSET).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekOf = (day) => {
  const dow = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
};
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// The last `weeks` week-start days, oldest first, ending with the current week.
function weekList(today, weeks) {
  const current = weekOf(today);
  return Array.from({ length: weeks }, (_, i) => addDays(current, -7 * (weeks - 1 - i)));
}

// users: [{ id, createdAt, client }]
function signupsByWeek(users, today, weeks = 8) {
  const list = weekList(today, weeks);
  const rows = Object.fromEntries(list.map((w) => [w, { week: w, total: 0, byClient: {} }]));
  for (const u of users) {
    const r = rows[weekOf(lagosDay(u.createdAt))];
    if (!r) continue;
    r.total += 1;
    const c = u.client || 'unknown';
    r.byClient[c] = (r.byClient[c] || 0) + 1;
  }
  return list.map((w) => rows[w]);
}

// days: [{ userId, day }] (one row per user per active day)
function activeCounts(days, today) {
  const since = (n) => addDays(today, -(n - 1));
  const count = (from) => new Set(days.filter((d) => d.day >= from && d.day <= today).map((d) => String(d.userId))).size;
  const dau = count(today), wau = count(since(7)), mau = count(since(30));
  const perDay = {};
  for (const d of days) (perDay[d.day] ||= new Set()).add(String(d.userId));
  const series = Array.from({ length: 30 }, (_, i) => { const day = since(30 - i); return { day, users: perDay[day]?.size || 0 }; });
  // Stickiness over the last week's average day, so one quiet morning doesn't swing it.
  const avgDau = series.slice(-7).reduce((s, x) => s + x.users, 0) / 7;
  return { dau, wau, mau, stickiness: pct(avgDau, mau), series };
}

// Of each signup week, the share active in week 0 (signup week), 1, 2, … Only weeks
// that have started are filled; later ones are null.
function retention(users, days, today, weeks = 8) {
  const activeWeeks = {};
  for (const d of days) (activeWeeks[String(d.userId)] ||= new Set()).add(weekOf(d.day));
  const thisWeek = weekOf(today);
  return weekList(today, weeks).map((week) => {
    const cohort = users.filter((u) => weekOf(lagosDay(u.createdAt)) === week);
    const rates = Array.from({ length: weeks }, (_, k) => {
      const w = addDays(week, 7 * k);
      if (w > thisWeek || !cohort.length) return null;
      return pct(cohort.filter((u) => activeWeeks[String(u.id)]?.has(w)).length, cohort.length);
    });
    return { week, size: cohort.length, rates };
  });
}

// firstTxns: [{ userId, date, source }] (each user's earliest transaction)
function activation(users, firstTxns, today, weeks = 8) {
  const first = Object.fromEntries(firstTxns.map((t) => [String(t.userId), t]));
  const cohorts = weekList(today, weeks).map((week) => {
    const cohort = users.filter((u) => weekOf(lagosDay(u.createdAt)) === week);
    // Only users who have had their full 7 days count towards the rate.
    const eligible = cohort.filter((u) => new Date(u.createdAt).getTime() + 7 * DAY <= Date.parse(`${today}T23:59:59Z`));
    const activated = eligible.filter((u) => {
      const t = first[String(u.id)];
      return t && new Date(t.date).getTime() - new Date(u.createdAt).getTime() <= 7 * DAY;
    });
    return { week, size: cohort.length, eligible: eligible.length, activated: activated.length, rate: pct(activated.length, eligible.length) };
  });
  const bySource = {};
  for (const u of users) { const t = first[String(u.id)]; if (t) bySource[t.source || 'manual'] = (bySource[t.source || 'manual'] || 0) + 1; }
  const withAny = users.filter((u) => first[String(u.id)]).length;
  return { cohorts, firstSource: bySource, everActivated: pct(withAny, users.length) };
}

// users: full user docs (plan fields); plans: lib/plans
function money(users, plans, now = new Date(), cfg = plans.config()) {
  const prices = Object.fromEntries(plans.catalog(cfg).map((p) => [p.code, p.priceNaira]));
  const paid = {}; let onTrial = 0, mrr = 0, trialEnded = 0, converted = 0;
  for (const u of users) {
    const e = plans.entitlement(u, now, cfg);
    if (e.source === 'trial') onTrial += 1;
    if (e.source === 'paid') {
      paid[e.tier] = (paid[e.tier] || 0) + 1;
      // A Student still in their free months isn't revenue yet.
      if (!(e.tier === 'student' && !u.planEverPaid)) mrr += prices[e.tier] || 0;
    }
    // Trial-to-paid: accounts whose trial has ended, and how many of them have paid.
    if (e.trialEndsAt && e.trialEndsAt <= now) { trialEnded += 1; if (u.planEverPaid) converted += 1; }
  }
  const studentsVerified = users.filter((u) => plans.studentVerified(u, now)).length;
  return { onTrial, paid, paidTotal: Object.values(paid).reduce((s, n) => s + n, 0), mrr, trialEnded, converted, conversion: pct(converted, trialEnded), studentsVerified };
}

// bySource: [{ source, total, review }] for the last 30 days; corrections: count
function imports(bySource, corrections) {
  const total = bySource.reduce((s, r) => s + r.total, 0);
  const review = bySource.reduce((s, r) => s + r.review, 0);
  return {
    total, review, reviewShare: pct(review, total), corrections, correctionRate: pct(corrections, total),
    sources: [...bySource].sort((a, b) => b.total - a.total).map((r) => ({ ...r, share: pct(r.total, total) })),
  };
}

module.exports = { lagosDay, weekOf, addDays, signupsByWeek, activeCounts, retention, activation, money, imports };
