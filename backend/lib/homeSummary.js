'use strict';
// Numbers for the mobile Home hero: safe to spend for the rest of the calendar
// month, after bills and subscriptions still to come. Pure so it can be tested.
//
// Safe to spend = (the money you have this month) - (what you've spent) - (bills
// and subscriptions due between today and month end). "Money you have" is the
// stated monthly income, or what has actually come in if that is higher. With no
// stated income there is no honest figure, so safeToSpend is null and the client
// shows net instead.

const round = (n) => Math.round(n);

// Whole days from today through the last day of the month, today included.
function daysLeftInMonth(now) {
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return end - now.getDate() + 1;
}

// Total of bills and subscriptions still due from today to month end.
function billsDueThisMonth(now, bills = [], subs = []) {
  const y = now.getFullYear(), m = now.getMonth(), today = now.getDate();
  const last = new Date(y, m + 1, 0).getDate();
  const inRest = (d) => d.getFullYear() === y && d.getMonth() === m && d.getDate() >= today;
  let total = 0;
  for (const b of bills) {
    if (!b || b.status === 'paused' || !(b.amount > 0)) continue;
    if (b.nextDue) { if (inRest(new Date(b.nextDue))) total += b.amount; continue; }
    if (b.frequency === 'monthly' && b.dueDate >= today && b.dueDate <= last) total += b.amount;
  }
  for (const s of subs) {
    if (!s || s.status !== 'active' || !(s.cost > 0)) continue;
    if (s.nextPayment) { if (inRest(new Date(s.nextPayment))) total += s.cost; continue; }
    if (s.frequency === 'monthly' && s.renewalDay >= today && s.renewalDay <= last) total += s.cost;
  }
  return round(total);
}

function homeSummary({ now = new Date(), monthlyIncome = 0, monthIncome = 0, monthExpense = 0, bills = [], subs = [], monthTxnCount = 0, lastSyncAt = null } = {}) {
  const daysLeft = daysLeftInMonth(now);
  const billsDue = billsDueThisMonth(now, bills, subs);
  const incomeSet = monthlyIncome > 0;
  let safeToSpend = null, dailyAllowance = null, over = 0;
  if (incomeSet) {
    const have = Math.max(monthlyIncome, monthIncome);
    const left = have - monthExpense - billsDue;
    safeToSpend = Math.max(0, round(left));
    over = left < 0 ? round(-left) : 0;
    // Nearest 50 naira reads as a daily allowance, not false precision.
    dailyAllowance = Math.round(safeToSpend / daysLeft / 50) * 50;
  }
  return {
    incomeSet, safeToSpend, dailyAllowance, over, billsDue, daysLeft,
    monthTxnCount, lastSyncAt: lastSyncAt ? new Date(lastSyncAt).toISOString() : null,
  };
}

module.exports = { homeSummary, billsDueThisMonth, daysLeftInMonth };
