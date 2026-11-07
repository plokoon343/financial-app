'use strict';
// Run: node backend/lib/subscriptionSignals.test.js
// Round 6, Block 5, section 6.1 acceptance tests S1-S8 (research doc section 12).
const assert = require('assert');
const { categorizeTransaction } = require('./categorize');
const { brandFor } = require('./subscriptionBrands');
const { subscriptionKey } = require('./merchantKey');
const {
  planFromNarration, isPlanRename, priceChangeBadge, chargedTwice,
  shouldStop, notChargedThisMonth, defaultRemindRenewal,
} = require('./subscriptionSignals');

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };

// S1: first debit to NETFLIX -> subscription from first charge, Netflix logo, no
// question. The catalogue match + 'Subscriptions' category together is what makes
// maybeLinkSubscription() (server.js) create it on the very first charge - no
// waiting for a second occurrence, unlike the generic pattern-match path.
{
  const brand = brandFor('NETFLIX.COM LAGOS NG');
  check('S1: Netflix recognised as a brand (logo-eligible)', brand && brand.slug === 'netflix');
  check('S1: Netflix categorised as Subscriptions on the first row', categorizeTransaction('NETFLIX.COM LAGOS NG', 'expense') === 'Subscriptions');
}

// S2: unbranded recurring charge ("Iron Gym" twice) only becomes a subscription
// after the SECOND hit (pattern match, rule 2 of section 12), and gets no logo even
// then (initial icon fallback) since it never matched the catalogue.
{
  const brand = brandFor('IRON GYM MONTHLY FEE');
  check('S2: unknown merchant has no catalogue brand (no logo)', brand === null);
  const key1 = subscriptionKey('IRON GYM MONTHLY FEE');
  const key2 = subscriptionKey('IRON GYM MONTHLY FEE LAGOS');
  check('S2: both charges share one merchant key to count occurrences by', key1 === key2 && key1.length > 0);
}

// S3: apple.com/bill shows as Apple (App store bucket); which service it was is
// asked once, never auto-applied, since the narration never says.
{
  check('S3: apple.com/bill resolves to the App Store brand', brandFor('APPLE.COM/BILL').slug === 'app-store');
  check('S3: apple.com/bill categorises as Subscriptions', categorizeTransaction('WEB PUR APPLE.COM/BILL', 'expense') === 'Subscriptions');
}

// S4: a Google verification hold, later reversed, is never a subscription - even
// though "GOOGLE *" alone would otherwise match the generic Google Play brand.
{
  check('S4: a temporary hold is not a recognised brand', brandFor('GOOGLE *TEMPORARY HOLD') === null);
  check('S4: a temporary hold has no subscription key via a brand', subscriptionKey('GOOGLE *TEMPORARY HOLD') !== 'brand:google-play');
  check('S4: a real Google Play purchase still resolves normally', brandFor('GOOGLE *GAME COINS').slug === 'google-play');
}

// S5: Netflix at a steady 6,500 for 3 months, then 7,500 -> "Price up" badge.
{
  const badge = priceChangeBadge(6500, 7500);
  check('S5: a real increase is flagged', badge && badge.type === 'price_up' && badge.delta === 1000);
  check('S5: an unchanged price is not flagged', priceChangeBadge(6500, 6500) === null);
  check('S5: rounding drift (a few naira) is not flagged', priceChangeBadge(6500, 6505) === null);
}

// S6: a charge, a reversal, then a successful charge again the same day is ONE
// charge, not "Charged twice" - the reversed one must be excluded before this runs
// (reversals.js pairs it off), so chargedTwice() only ever sees the one real charge.
{
  check('S6: a single real charge is not "charged twice"', chargedTwice(['2026-10-05T10:00:00Z']) === false);
  check('S6: two real charges within 3 days IS "charged twice"', chargedTwice(['2026-10-05T10:00:00Z', '2026-10-06T10:00:00Z']) === true);
  check('S6: two real charges a month apart is not "charged twice"', chargedTwice(['2026-09-05T10:00:00Z', '2026-10-05T10:00:00Z']) === false);
}

// S7: DStv "Compact" paid in October; the SAME tier billed as "Sports" in November
// (the 5 Nov 2026 rename) -> shown as a renamed plan, not a price rise, even when
// the new tier's listed price differs slightly from the old one.
{
  check('S7: Compact -> Sports on/after 5 Nov 2026 is the known rename', isPlanRename('compact', 'sports', '2026-11-10'));
  check('S7: the same rename before 5 Nov 2026 is NOT recognised (too early to be the rename)', !isPlanRename('compact', 'sports', '2026-10-20'));
  check('S7: an unrelated plan change is not mistaken for the rename', !isPlanRename('compact', 'premium', '2026-11-10'));
  check('S7: the plan word is read off the bank narration', planFromNarration('MULTICHOICE DSTV COMPACT') === 'compact');
  check('S7: the renamed narration reads the new word', planFromNarration('MULTICHOICE DSTV SPORTS') === 'sports');
}

// S8: Spotify stops being charged for two months -> moves to Stopped.
{
  const sub = { frequency: 'monthly', lastCharge: '2026-08-20' };
  check('S8: two missed monthly cycles moves it to Stopped', shouldStop(sub, new Date('2026-11-05')));
  check('S8: one missed cycle does not yet stop it', !shouldStop(sub, new Date('2026-09-25')));
  check('S8: "not charged this month" is true as soon as the calendar month turns', notChargedThisMonth(sub, new Date('2026-09-02')));
}

// Renewal-alert default (section 12's alert table): on for yearly, or NGN 5,000+.
{
  check('Renewal default: yearly is on regardless of cost', defaultRemindRenewal({ frequency: 'yearly', cost: 100 }) === true);
  check('Renewal default: a big monthly charge is on', defaultRemindRenewal({ frequency: 'monthly', cost: 6500 }) === true);
  check('Renewal default: a small monthly charge is off', defaultRemindRenewal({ frequency: 'monthly', cost: 1600 }) === false);
}

console.log(`\n${passed} passed, 0 failed`);
