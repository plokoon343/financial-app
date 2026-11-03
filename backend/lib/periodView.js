'use strict';
// One definition of "the figures for a period" (round 6, B2/B3/B5).
//
// Home and Money each used to work out their own version of the same three numbers,
// over different sets of rows and different spans of time, so they disagreed on
// screen: "190.9K cash to log" against "1,836 taken out as cash", "4 transactions"
// against "6 transactions". A number that disagrees between two screens is a release
// blocker, so both screens now read these functions, and both say which period they
// are talking about.
//
// Pure and dependency-free: the same rules are mirrored on the phone in
// src/lib/moneyView.ts so a figure computed on the server and one computed on the
// device cannot drift apart.

// What counts as a transaction in a list. internal_transfer is the user moving their
// own money and is hidden by default on both screens; 'failed' never happened, so it
// is not a row a person should be asked to count.
const COUNTED_TYPES = ['income', 'expense', 'cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal'];

// A category the machine assigns when it has nothing better: these are the rows the
// "needs a category" count is about.
const UNCATEGORISED = ['', 'Other', 'Other Income'];

const ms = (d) => (d instanceof Date ? d.getTime() : new Date(d).getTime());

// The calendar month `now` falls in: [from, to) in the server's own clock, which runs
// in Africa/Lagos in production.
function monthRange(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { from, to, label: 'this month' };
}

const inRange = (row, range) => {
  if (!range) return true;
  const t = ms(row.date);
  return t >= ms(range.from) && t < ms(range.to);
};

// Rows of this period that a person would count on a list.
const countedRows = (rows = [], range = null) =>
  rows.filter((r) => r && COUNTED_TYPES.includes(r.type) && inRange(r, range));

// Cash taken out in this period and not yet broken down into what it was spent on.
function cashToLog(rows = [], range = null) {
  let count = 0, total = 0;
  for (const r of rows) {
    if (!r || r.type !== 'cash_withdrawal' || r.cashAllocated) continue;
    if (!inRange(r, range)) continue;
    count += 1;
    total += Math.abs(Number(r.amount) || 0);
  }
  return { count, total: Math.round(total) };
}

// Rows of this period still waiting for a category.
const needCategoryCount = (rows = [], range = null) =>
  rows.filter((r) => r && (r.type === 'income' || r.type === 'expense')
    && UNCATEGORISED.includes(r.category || '') && inRange(r, range)).length;

// When the data last changed: the newest row we hold, not when this screen last
// asked the server. "Updated just now" on one screen and "1 day ago" on another was
// the same list, described two different ways.
function lastSyncOf(rows = []) {
  let newest = 0;
  for (const r of rows) {
    const t = ms(r && (r.createdAt || r.date));
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return newest ? new Date(newest) : null;
}

// Everything both screens show for one period, from one pass over one set of rows.
function periodFigures(rows = [], range = null) {
  return {
    count: countedRows(rows, range).length,
    cash: cashToLog(rows, range),
    needCategory: needCategoryCount(rows, range),
    lastSyncAt: lastSyncOf(rows),
    periodLabel: (range && range.label) || 'all time',
  };
}

module.exports = {
  COUNTED_TYPES, UNCATEGORISED, monthRange, countedRows, cashToLog, needCategoryCount, lastSyncOf, periodFigures,
};
