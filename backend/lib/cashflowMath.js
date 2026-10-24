'use strict';
// Maths behind the cashflow forecast, kept pure so it can be tested.

const DAY = 86400000;

// Typical daily spend from expense rows in the last `windowDays` days.
// Rows are totalled by week (weeks counted back from `today`); with at least 8 weeks
// of history the heaviest 2 are dropped (a one-off such as school fees or a deposit
// lands in one week), then the rest are averaged per day. With less history there is
// not enough to tell a one-off from a habit, so the plain average is used, but a single
// row that is more than half of everything is left out.
function typicalDailySpend(expenses, today, windowDays = 90) {
  const weeks = Math.ceil(windowDays / 7);
  const totals = new Array(weeks).fill(0);
  let all = 0;
  let biggest = 0;
  for (const t of expenses) {
    const age = Math.floor((today.getTime() + DAY - new Date(t.date).getTime()) / DAY);
    if (age < 0 || age >= weeks * 7) continue;
    const amt = Math.abs(t.amount);
    totals[Math.floor(age / 7)] += amt;
    all += amt;
    biggest = Math.max(biggest, amt);
  }
  const filled = totals.filter((x) => x > 0).length;
  if (filled >= 8) {
    const sorted = [...totals].sort((a, b) => a - b);
    const kept = sorted.slice(0, sorted.length - 2);
    return kept.reduce((s, x) => s + x, 0) / (kept.length * 7);
  }
  const trimmed = biggest > all / 2 && expenses.length > 1 ? all - biggest : all;
  return trimmed / windowDays;
}

module.exports = { typicalDailySpend };
