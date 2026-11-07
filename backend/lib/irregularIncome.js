// Irregular income (13.5): for "Hustling" users, or anyone whose income swung more
// than 25% between two of the last three months, safe-to-spend uses a careful
// estimate instead of a fixed salary. Pure.
'use strict';

// months: [{ key: 'YYYY-MM', total }], any order, at least the last 3 full months to
// judge volatility from.
function isIrregular(months, profile) {
  if (profile === 'hustling') return true;
  if (!months || months.length < 3) return false;
  const last3 = months.slice(-3).map((m) => m.total);
  for (let i = 0; i < last3.length; i++) {
    for (let j = 0; j < last3.length; j++) {
      if (i === j || !(last3[j] > 0)) continue;
      if (Math.abs(last3[i] - last3[j]) / last3[j] > 0.25) return true;
    }
  }
  return false;
}

// Planning amount for the hero: the lowest of the last three full months, labelled
// "your lowest recent month". A typed amount or the average overrides it (one tap).
function planningAmount(months, override) {
  if (override != null) return { amount: Math.round(Number(override) || 0), basis: 'custom' };
  const last3 = (months || []).slice(-3).map((m) => m.total).filter((n) => n > 0);
  if (!last3.length) return { amount: 0, basis: 'none' };
  return { amount: Math.round(Math.min(...last3)), basis: 'lowest' };
}

function averageAmount(months) {
  const last3 = (months || []).slice(-3).map((m) => m.total).filter((n) => n > 0);
  if (!last3.length) return 0;
  return Math.round(last3.reduce((a, n) => a + n, 0) / last3.length);
}

module.exports = { isIrregular, planningAmount, averageAmount };
