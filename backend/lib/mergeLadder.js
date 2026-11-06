'use strict';
// The merge ladder (round 6, Block 2, section 3.2).
//
// Given one incoming Observation and the Transactions already held, decide whether
// this is money we have already seen described by another source, or money we have
// not seen before. Climbing in order matters: each rung is more certain than the one
// below it, so a certain answer is never reached by a fuzzy route.
//
//   1. Re-delivery   same source, same rawHash, inside 24h  -> drop silently
//   2. Reference     the same session id or bank reference  -> merge, any sources, any gap
//   3. Balance       same account and same balance after     -> merge
//   4. Window        same account, compatible counterparty, inside the pair's window
//   5. One candidate -> merge. Two or more -> ask "Is this the same as...".
//
// The rule that keeps this honest: NEVER merge two Observations from the same source
// at steps 3 to 5. Two 500 naira airtime texts a minute apart are two purchases, not
// one described twice. A source that saw something twice saw two things; only a
// DIFFERENT source describing the same money is a duplicate. Steps 1 and 2 are exempt
// because they are identity, not resemblance: the same bytes, or the bank's own id.
//
// Field resolution lives next door in lib/fieldWinners (section 3.3) and linking in
// section 3.4, deliberately kept apart: deciding WHICH transaction an observation
// belongs to and deciding WHAT IT SAYS are different questions, and folding them
// together is how a merge quietly starts rewriting amounts.
//
// Pure and dependency-free apart from lib/dedupe's string helpers.

const { isAlert, lagosDay, bankOf, hasDigits, referencesOf } = require('./observation');
const { normalizeCounterparty, jaroWinkler } = require('./dedupe');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// How far apart two Observations of the same money may be, by which pair of sources
// described it. A phone's push and the bank's SMS land together; a person sharing a
// screenshot or typing it in may be two days late.
const SMS_NOTIFICATION_WINDOW = 15 * MINUTE;
const ALERT_SHARE_WINDOW = 48 * HOUR;
const ALERT_MANUAL_WINDOW = 48 * HOUR;
// Statement rows and Mono carry a value date, not a time, so they match on the
// calendar day in Lagos, give or take one.
const SAME_VALUE_DATE_DAYS = 1;

// How close two counterparty names must be to be "compatible". Names arrive mangled
// differently by every bank, so this is deliberately forgiving; a missing name on one
// side is compatible with anything, because a source that said nothing contradicts
// nothing.
const NAME_SIMILAR = 0.82;

const dayNumber = (t) => Math.floor(Date.parse(`${lagosDay(t)}T00:00:00Z`) / 86400000);

// Does this pair of sources match on a calendar day rather than a clock time?
const valueDatePair = (a, b) =>
  a === 'statement' || b === 'statement' || a === 'mono' || b === 'mono';

// The allowed gap for a pair of sources, in ms, or null when the pair matches on the
// value date instead.
function windowFor(sourceA, sourceB) {
  if (valueDatePair(sourceA, sourceB)) return null;
  const pair = new Set([sourceA, sourceB]);
  if (pair.has('sms') && pair.has('notification')) return SMS_NOTIFICATION_WINDOW;
  if (pair.has('share') && (isAlert(sourceA) || isAlert(sourceB))) return ALERT_SHARE_WINDOW;
  if (pair.has('manual') && (isAlert(sourceA) || isAlert(sourceB))) return ALERT_MANUAL_WINDOW;
  // Two alerts of different kinds (an SMS and a forwarded email of that same SMS)
  // behave like the SMS/notification pair: the bank sent them at the same moment.
  if (isAlert(sourceA) && isAlert(sourceB)) return SMS_NOTIFICATION_WINDOW;
  // Anything else unlisted gets the short window. A pair we have not thought about
  // should fail to merge and ask, not merge on a guess.
  return SMS_NOTIFICATION_WINDOW;
}

// Are these two near enough in time for this pair of sources?
function withinWindow(a, b) {
  const w = windowFor(a.source, b.source);
  if (w === null) return Math.abs(dayNumber(a.eventTime) - dayNumber(b.eventTime)) <= SAME_VALUE_DATE_DAYS;
  return Math.abs(a.eventTime - b.eventTime) <= w;
}

// Two names are compatible when either side is silent, or they read as the same
// person or merchant once the rail noise is stripped.
function counterpartyCompatible(a, b) {
  // What a person typed is a note to themselves ("Rent share"), not the name the bank
  // put on the payment. Holding it against the bank's own counterparty would stop a
  // manual entry ever merging with the alert for the same money, which is the one
  // thing it most needs to do.
  const na = a.source === 'manual' ? '' : normalizeCounterparty(a.counterpartyRaw);
  const nb = b.source === 'manual' ? '' : normalizeCounterparty(b.counterpartyRaw);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return jaroWinkler(na, nb) >= NAME_SIMILAR;
}

// Same account, or the same bank when one side never showed its digits. A statement
// row rarely repeats the account number on every line, and an app push almost never
// does, so insisting on digits on both sides would stop most real merges.
function accountCompatible(a, b) {
  if (!a.accountRef || !b.accountRef) return true;
  if (a.accountRef === b.accountRef) return true;
  if (hasDigits(a.accountRef) && hasDigits(b.accountRef)) return false; // both knew, and differed
  return bankOf(a.accountRef) === bankOf(b.accountRef);
}

// The hard gate before any rung: the same user, the same direction and the same
// amount to the kobo. Sources that disagree on either of these are not describing one
// movement of money, and section 3.3 says to raise "Which is right?" rather than pick.
function comparable(a, b) {
  if (a.userId && b.userId && a.userId !== b.userId) return false;
  if (a.direction && b.direction && a.direction !== b.direction) return false;
  return a.amountKobo === b.amountKobo;
}

const sharesReference = (a, b) => {
  const ra = referencesOf(a), rb = referencesOf(b);
  return ra.length > 0 && rb.length > 0 && ra.some((r) => rb.includes(r));
};

// A transaction is a bag of Observations; these ask about the bag.
const observationsOf = (txn) => (Array.isArray(txn) ? txn : (txn && txn.observations) || []);
const hasSource = (txn, source) => observationsOf(txn).some((o) => o.source === source);

/**
 * Decide what to do with `incoming` given the transactions already held.
 *
 * Returns { action, step, reason, target, candidates }:
 *   'drop'     a re-delivery of something already attached; add nothing.
 *   'merge'    attach to `target`.
 *   'ask'      two or more could be it; the Action Center asks "Is this the same as..."
 *   'conflict' the bank's own reference says this IS `target`, but the two sources
 *              disagree on the amount or the direction. Never merged, never counted
 *              twice: `conflict` carries { field, values, sources } for the
 *              "Which is right?" card (section 3.3).
 *   'new'      money we have not seen; start a Transaction.
 */
function mergeDecision(incoming, transactions = []) {
  const all = transactions.filter(Boolean);

  // Step 1: the identical bytes from the identical source, inside a day. This is the
  // one case where the same source CAN mean a duplicate, because it is not a
  // resemblance, it is the same delivery arriving twice.
  if (incoming.rawHash) {
    for (const txn of all) {
      for (const o of observationsOf(txn)) {
        if (o.source !== incoming.source || o.rawHash !== incoming.rawHash) continue;
        if (Math.abs(incoming.receivedAt - o.receivedAt) > 24 * HOUR) continue;
        return { action: 'drop', step: 1, reason: 're-delivery', target: txn, candidates: [] };
      }
    }
  }

  // Step 2: the bank's own identifier. Certain, so it outranks everything below and
  // ignores both the clock and which sources are involved.
  //
  // The same reference with a DIFFERENT amount or direction is the one case where the
  // bank itself says two sources are describing one movement of money and the sources
  // still disagree about what it was. That is not a merge and it is not two separate
  // transactions either: it is the "Which is right?" card (section 3.3). Returning a
  // plain 'new' here would lose the only evidence that a disagreement ever happened,
  // and the two figures would sit in the ledger as if both were real.
  for (const txn of all) {
    for (const o of observationsOf(txn)) {
      if (!sharesReference(incoming, o)) continue;
      if (comparable(incoming, o)) {
        return { action: 'merge', step: 2, reason: 'reference', target: txn, candidates: [txn] };
      }
      const field = (incoming.direction && o.direction && incoming.direction !== o.direction) ? 'direction' : 'amount';
      return {
        action: 'conflict', step: 2, reason: `reference-${field}`, target: txn, candidates: [txn],
        conflict: {
          field,
          values: field === 'direction'
            ? [o.direction, incoming.direction]
            : [o.amountKobo, incoming.amountKobo],
          sources: [o.source, incoming.source],
        },
      };
    }
  }

  // Steps 3 and 4 gather candidates. From here on, a source never matches itself.
  const byBalance = [];
  const byWindow = [];
  for (const txn of all) {
    if (hasSource(txn, incoming.source)) continue; // never merge two of one source
    for (const o of observationsOf(txn)) {
      if (!comparable(incoming, o)) continue;

      // Step 3: the account agrees and the balance after agrees. A balance is a
      // fingerprint of a moment in an account, so two sources quoting the same one
      // are describing the same moment.
      if (incoming.balanceAfterKobo != null && o.balanceAfterKobo != null
        && incoming.balanceAfterKobo === o.balanceAfterKobo
        && incoming.accountRef && o.accountRef && incoming.accountRef === o.accountRef) {
        byBalance.push(txn);
        break;
      }

      // Step 4: same account, compatible name, inside this pair's window.
      if (accountCompatible(incoming, o) && counterpartyCompatible(incoming, o) && withinWindow(incoming, o)) {
        byWindow.push(txn);
        break;
      }
    }
  }

  if (byBalance.length === 1) return { action: 'merge', step: 3, reason: 'balance', target: byBalance[0], candidates: byBalance };
  if (byBalance.length > 1) return { action: 'ask', step: 3, reason: 'several-balance', target: null, candidates: byBalance };

  // Step 5: one candidate is an answer, more than one is a question.
  if (byWindow.length === 1) return { action: 'merge', step: 4, reason: 'window', target: byWindow[0], candidates: byWindow };
  if (byWindow.length > 1) return { action: 'ask', step: 5, reason: 'several-candidates', target: null, candidates: byWindow };

  return { action: 'new', step: 0, reason: 'unmatched', target: null, candidates: [] };
}

/**
 * Feed a run of Observations through the ladder in arrival order and return the
 * Transactions that result. Each Transaction is { observations, askedAbout }.
 * 'ask' keeps the Observation as its own Transaction and marks it, because the money
 * is real whether or not we yet know which item it belongs to: the user is never
 * blocked, and their answer merges or separates it afterwards.
 */
function buildTransactions(observations = []) {
  const txns = [];
  for (const o of observations) {
    const d = mergeDecision(o, txns);
    if (d.action === 'drop') { (d.target.dropped = d.target.dropped || []).push(o); continue; }
    if (d.action === 'merge') { d.target.observations.push(o); continue; }
    // A conflict stays its own Transaction, carrying what it disagreed with. The
    // money is real either way, so nothing is blocked; the card decides which figure
    // survives, and until then both are visible rather than one silently chosen.
    txns.push({
      observations: [o],
      askedAbout: d.action === 'ask' ? d.candidates : null,
      conflict: d.action === 'conflict' ? { ...d.conflict, against: d.target } : null,
    });
  }
  return txns;
}

/**
 * The count check from section 3.2, which is the whole ladder's guard rail: for any
 * cluster of matching Observations, the number of Transactions must equal the largest
 * number any single source contributed. Three sources describing one payment is one
 * transaction; one source reporting three payments is three. Any other answer means
 * the ladder either lost money or invented it.
 */
function expectedTransactionCount(observations = []) {
  // A source's DELIVERIES are counted, not its messages. The same bytes arriving
  // twice from one gateway is one thing said twice, so it must not raise the expected
  // count and turn a correct drop into an apparent lost transaction. Observations
  // with no hash to compare are each counted on their own.
  const perSource = new Map();
  for (const o of observations) {
    if (!perSource.has(o.source)) perSource.set(o.source, { hashes: new Set(), unhashed: 0 });
    const entry = perSource.get(o.source);
    if (o.rawHash) entry.hashes.add(o.rawHash); else entry.unhashed += 1;
  }
  if (!perSource.size) return 0;
  return Math.max(...[...perSource.values()].map((e) => e.hashes.size + e.unhashed));
}

module.exports = {
  mergeDecision, buildTransactions, expectedTransactionCount,
  windowFor, withinWindow, counterpartyCompatible, accountCompatible, comparable, sharesReference,
  SMS_NOTIFICATION_WINDOW, ALERT_SHARE_WINDOW, ALERT_MANUAL_WINDOW, SAME_VALUE_DATE_DAYS, NAME_SIMILAR,
};
