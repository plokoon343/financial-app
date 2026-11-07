'use strict';
// Pending and held charges (round 6, section 6.3; research doc 13.7).
//
// A hold is a bank telling us it has RESERVED money, not that money has moved.
// It is never stored as a Transaction: a Transaction is created only when the
// final charge arrives (which replaces the hold) or, if nothing ever settles,
// never at all. Keeping holds out of the Transaction collection entirely is what
// makes "a hold never counts toward any total" true by construction, instead of
// something every aggregation query has to remember to filter out.
//
// Pure and dependency-free so the detector and the matching rule can be tested
// without a database.

// Generic hold wording a bank uses for an authorisation that has not settled yet.
const HOLD_RE = /\b(?:pending authorization|pending authorisation|authorization hold|authorisation hold|pre-?auth(?:orization|orisation)?|hold (?:placed|on your (?:card|account))|will be (?:confirmed|settled) (?:later|within))\b/i;

// Specific descriptors known to mean a hold, even though the word "pending" or
// "hold" is not in them.
const KNOWN_HOLD_DESCRIPTORS = [
  /google\s*\*?\s*temporary hold/i,
  /\btemporary hold\b/i,
];

function isHoldText(text) {
  const t = String(text || '');
  if (!t) return false;
  if (KNOWN_HOLD_DESCRIPTORS.some((re) => re.test(t))) return true;
  return HOLD_RE.test(t);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOLD_WINDOW_DAYS = 7;

// Could `final` be the settlement of `hold`? Same bank, same account when both
// name one, an amount that is the hold's amount or a little less (a fuel pump or
// a hotel over-authorises and settles for less; it never settles for MORE than
// what it held), and inside the 7-day window.
function matchesFinal(hold, final, { tolerance = 0.1 } = {}) {
  if (!hold || !final) return false;
  if ((hold.bankCode || '') && (final.bankCode || '') && hold.bankCode !== final.bankCode) return false;
  if (hold.accountMask && final.accountMask && hold.accountMask !== final.accountMask) return false;
  const holdAmount = Math.abs(Number(hold.amount) || 0);
  const finalAmount = Math.abs(Number(final.amount) || 0);
  if (!holdAmount || !finalAmount) return false;
  if (finalAmount > holdAmount + 0.01) return false;
  if (finalAmount < holdAmount * (1 - tolerance)) return false;
  const holdAt = new Date(hold.eventTime || hold.date);
  const finalAt = new Date(final.eventTime || final.date);
  const days = Math.abs(finalAt.getTime() - holdAt.getTime()) / DAY_MS;
  return days <= HOLD_WINDOW_DAYS;
}

// Past its 7-day window with nothing to replace it: dropped silently (never shown,
// never counted - it simply stops existing).
function isExpired(hold, now = new Date()) {
  const at = new Date(hold.eventTime || hold.date || hold.createdAt);
  if (!Number.isFinite(at.getTime())) return true;
  return (now.getTime() - at.getTime()) / DAY_MS > HOLD_WINDOW_DAYS;
}

module.exports = { isHoldText, matchesFinal, isExpired, HOLD_WINDOW_DAYS };
