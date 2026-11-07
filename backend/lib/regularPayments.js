// Regular payments that are not subscriptions (13.3): rent, school fees, ajo, family
// support, loan repayments. Same idea as the subscription pattern match (section 12
// rule 2) but a looser 15% amount tolerance and no catalogue - these are almost
// always transfers to a person or business, so nothing here auto-applies the way a
// Netflix charge does; the caller always asks once. Pure + dependency-free.
'use strict';

const DAY = 86400000;
const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const daysBetween = (a, b) => Math.abs(new Date(b).getTime() - new Date(a).getTime()) / DAY;

// Classify a recurring interval from the gaps between occurrences, or null if it
// isn't steady enough to call regular.
function cadenceFor(gapsDays) {
  if (!gapsDays.length) return null;
  const avg = gapsDays.reduce((a, g) => a + g, 0) / gapsDays.length;
  if (avg >= 25 && avg <= 35) return 'monthly';
  if (avg >= 350 && avg <= 380) return 'yearly';
  return null;
}

// groups: [{ key, name, amounts: [...], dates: [...] }], already grouped by
// counterparty signature by the caller. existingKeys: already tracked or dismissed.
// Returns candidates with 2+ occurrences, a consistent amount (within 15%), and a
// steady monthly/yearly cadence.
function detectRegularPayments(groups, existingKeys = new Set()) {
  const out = [];
  for (const g of groups) {
    if (existingKeys.has(g.key)) continue;
    if (!g.dates || g.dates.length < 2) continue;
    const med = median(g.amounts);
    if (!(med > 0)) continue;
    const consistent = g.amounts.filter((a) => Math.abs(a - med) <= med * 0.15).length;
    if (consistent < 2) continue;
    const sorted = [...g.dates].sort((a, b) => new Date(a) - new Date(b));
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetween(sorted[i - 1], sorted[i]));
    const cadence = cadenceFor(gaps);
    if (!cadence) continue;
    out.push({ key: g.key, name: g.name, amount: Math.round(med), frequency: cadence, occurrences: g.dates.length, lastDate: sorted[sorted.length - 1] });
  }
  return out;
}

// "Not paid yet this month" badge: in-app only, never a push. True once the expected
// date is more than 5 days past with nothing new matching it.
function missedBadge(nextDue, now = new Date()) {
  if (!nextDue) return false;
  return (new Date(now).getTime() - new Date(nextDue).getTime()) / DAY > 5;
}

// Big yearly/termly payments show a monthly tracking line: "About NGN X a month gets
// you there." Tracking only - never "auto-save"/"save automatically"/"autopay".
function trackingLine(amount, frequency) {
  const months = frequency === 'yearly' ? 12 : frequency === 'termly' ? 4 : 0;
  if (!months) return null;
  return Math.ceil(amount / months);
}

// Reminder lead time (13.3): 3 days before for yearly/termly, 1 day for monthly.
function reminderLeadDays(frequency) {
  return frequency === 'monthly' ? 1 : 3;
}

module.exports = { detectRegularPayments, cadenceFor, missedBadge, trackingLine, reminderLeadDays };
