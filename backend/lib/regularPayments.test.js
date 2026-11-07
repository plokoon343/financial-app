'use strict';
// Run: node backend/lib/regularPayments.test.js
// Round 6, Block 5, section 6.2 acceptance tests E1 and R1 (research doc 13.3, 13.4).
const assert = require('assert');
const { detectRegularPayments, missedBadge, trackingLine } = require('./regularPayments');
const { electricityRhythm } = require('./electricityRhythm');

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };

// R1: NGN 20,000 to Mama on the 1st, twice -> one question; on Yes, Regular payments
// shows Mama monthly.
{
  const groups = [{
    key: 'mama', name: 'Mama',
    amounts: [20000, 20000],
    dates: ['2026-09-01T09:00:00Z', '2026-10-01T09:00:00Z'],
  }];
  const candidates = detectRegularPayments(groups);
  check('R1: Mama surfaces as exactly one candidate', candidates.length === 1);
  check('R1: shown as a monthly regular payment of NGN 20,000', candidates[0].frequency === 'monthly' && candidates[0].amount === 20000);
}

// A single occurrence never asks (needs two hits, same as subscriptions rule 2).
{
  const groups = [{ key: 'once', name: 'Once', amounts: [20000], dates: ['2026-10-01T09:00:00Z'] }];
  check('One occurrence is not yet a candidate', detectRegularPayments(groups).length === 0);
}

// Already tracked or dismissed never resurfaces.
{
  const groups = [{ key: 'mama', name: 'Mama', amounts: [20000, 20000], dates: ['2026-09-01', '2026-10-01'] }];
  check('An existing/dismissed key is skipped', detectRegularPayments(groups, new Set(['mama'])).length === 0);
}

// "Not paid yet this month" - in-app badge only, 5 days past the expected date.
{
  check('Missed badge fires after 5 days past due', missedBadge('2026-10-01', new Date('2026-10-07')));
  check('Missed badge does not fire within the grace window', !missedBadge('2026-10-01', new Date('2026-10-03')));
}

// Yearly/termly tracking line: "About NGN X a month gets you there."
{
  check('Rent 600,000/year tracks at 50,000/month', trackingLine(600000, 'yearly') === 50000);
  check('A monthly payment has no tracking line (it already is the cadence)', trackingLine(20000, 'monthly') === null);
}

// E1: five electricity buys, 8 to 10 days apart -> Coming up shows "usually every 9 days".
{
  const purchases = [
    { date: '2026-09-01', amount: 8000 },
    { date: '2026-09-09', amount: 8200 },
    { date: '2026-09-18', amount: 7800 },
    { date: '2026-09-27', amount: 8100 },
    { date: '2026-10-07', amount: 7900 },
  ];
  const rhythm = electricityRhythm(purchases, new Date('2026-10-15'));
  check('E1: the usual interval reads as about 9 days', rhythm.intervalDays === 9);
  check('E1: the usual amount is the median of the last purchases', rhythm.amount === 8000);
  check('E1: days since the last purchase is tracked for "Last bought N days ago"', rhythm.daysSinceLast === 8);
}

// Fewer than 3 purchases: no rhythm yet (per 13.4, "after 3 electricity purchases").
{
  check('Two purchases is not enough to learn a rhythm', electricityRhythm([{ date: '2026-09-01', amount: 8000 }, { date: '2026-09-09', amount: 8000 }]) === null);
}

console.log(`\n${passed} passed, 0 failed`);
