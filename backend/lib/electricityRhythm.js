// Prepaid electricity has no due date, so Automonie learns the rhythm instead
// (13.4): the median interval and amount of the last 6 purchases. Pure.
'use strict';

const DAY = 86400000;
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

// purchases: [{ date, amount }], any order. Needs at least 3 to say anything
// ("after 3 electricity purchases").
function electricityRhythm(purchases, now = new Date()) {
  if (!purchases || purchases.length < 3) return null;
  const sorted = [...purchases].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-6);
  const gaps = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((new Date(sorted[i].date) - new Date(sorted[i - 1].date)) / DAY);
  const intervalDays = Math.round(median(gaps));
  const amount = Math.round(median(sorted.map((p) => p.amount)));
  const last = sorted[sorted.length - 1];
  const daysSinceLast = Math.floor((new Date(now).getTime() - new Date(last.date).getTime()) / DAY);
  return { intervalDays, amount, lastBought: last.date, daysSinceLast };
}

// One day before the usual next-purchase date. Opt-in only.
function dueSoon(rhythm) {
  if (!rhythm) return false;
  const dueIn = rhythm.intervalDays - rhythm.daysSinceLast;
  return dueIn <= 1 && dueIn >= 0;
}

module.exports = { electricityRhythm, dueSoon };
