'use strict';
// Which source wins each field (round 6, Block 2, section 3.3).
//
// Once several Observations are attached to one Transaction they will disagree about
// the details, because every source describes the same money differently: one knows
// the time to the second, another knows the balance, a third has the only readable
// name. Picking per field rather than per source gets the best of each.
//
//   Amount and direction  statement, SMS, email, Mono, notification, share, manual.
//                         If two sources genuinely DISAGREE, do not pick: say so, and
//                         the Action Center asks "Which is right?". Silently choosing
//                         one is how a wrong number gets into the ledger with nothing
//                         to show it was ever in doubt.
//   Time                  the alert, then the statement. An alert is sent as it
//                         happens; a statement only knows the day.
//   Balance after         the latest alert.
//   Counterparty          the longest clean name.
//   Category              the user's choice, then their rule, then a learned
//                         merchant, then a suggestion.
//
// Pure and dependency-free.

const { AMOUNT_PRECEDENCE, isAlert } = require('./observation');
const { normalizeCounterparty } = require('./dedupe');

const rank = (source) => {
  const i = AMOUNT_PRECEDENCE.indexOf(source);
  return i === -1 ? AMOUNT_PRECEDENCE.length : i;
};
const bySourceRank = (a, b) => rank(a.source) - rank(b.source);

// Pending holds never speak for a Transaction's figures: a hold is the bank asking
// to reserve money, not a record of money moving (13.7).
const settled = (obs) => obs.filter((o) => o.status !== 'pending');

/**
 * Resolve one Transaction's fields from its Observations.
 * Returns { amountKobo, direction, eventTime, balanceAfterKobo, counterpartyClean,
 *           sources, conflict }.
 * `conflict` is null, or { field, values } when two sources disagree on a figure that
 * cannot be averaged away. The caller must not merge on a conflict; it raises the card.
 */
function resolveFields(observations = []) {
  const obs = settled(observations);
  if (!obs.length) {
    return { amountKobo: 0, direction: null, eventTime: null, balanceAfterKobo: null, counterpartyClean: '', sources: [], conflict: null };
  }

  // --- Amount and direction, with disagreement surfaced rather than resolved ---
  const amounts = [...new Set(obs.map((o) => o.amountKobo).filter((a) => Number.isFinite(a)))];
  const directions = [...new Set(obs.map((o) => o.direction).filter(Boolean))];
  let conflict = null;
  if (amounts.length > 1) conflict = { field: 'amount', values: amounts.slice().sort((a, b) => a - b) };
  else if (directions.length > 1) conflict = { field: 'direction', values: directions };

  const ranked = obs.slice().sort(bySourceRank);
  const amountKobo = ranked[0].amountKobo;
  const direction = ranked.find((o) => o.direction)?.direction || null;

  // --- Time: an alert knows the moment, a statement only the day ---
  const alerts = obs.filter((o) => isAlert(o.source) && o.eventTime);
  const statements = obs.filter((o) => o.source === 'statement' && o.eventTime);
  const timeFrom = alerts.length ? alerts : (statements.length ? statements : obs);
  const eventTime = timeFrom.reduce((best, o) => (best == null || o.eventTime < best ? o.eventTime : best), null);

  // --- Balance: the most recent alert that quoted one ---
  const withBalance = obs
    .filter((o) => o.balanceAfterKobo != null)
    .sort((a, b) => (isAlert(b.source) ? 1 : 0) - (isAlert(a.source) ? 1 : 0) || b.eventTime - a.eventTime);
  const balanceAfterKobo = withBalance.length ? withBalance[0].balanceAfterKobo : null;

  // --- Counterparty: the longest readable name any source managed ---
  const counterpartyClean = obs
    .map((o) => normalizeCounterparty(o.counterpartyRaw))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || '';

  return {
    amountKobo, direction, eventTime, balanceAfterKobo, counterpartyClean,
    sources: [...new Set(obs.map((o) => o.source))],
    conflict,
  };
}

/**
 * The category, in the order that respects what the user has already told us.
 * A choice they made on this very transaction beats a rule they made once, which
 * beats what we learned from a merchant, which beats a guess. `guessed` is true when
 * nothing but the last of these applied, so the row can be marked as a guess rather
 * than presented as fact.
 */
function resolveCategory({ userChoice = '', userRule = '', learnedMerchant = '', suggestion = '' } = {}) {
  if (userChoice) return { category: userChoice, from: 'user', guessed: false };
  if (userRule) return { category: userRule, from: 'rule', guessed: false };
  if (learnedMerchant) return { category: learnedMerchant, from: 'merchant', guessed: false };
  if (suggestion) return { category: suggestion, from: 'suggestion', guessed: true };
  return { category: '', from: 'none', guessed: true };
}

module.exports = { resolveFields, resolveCategory, rank };
