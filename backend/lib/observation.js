'use strict';
// The Observation model (round 6, Block 2, section 3.1).
//
// Every alert, share, statement row and manual entry is stored as an Observation:
// what one source said it saw. Transactions are then BUILT from Observations rather
// than written directly. That is the whole point of the change: today a second
// source describing the same money either silently overwrites the first or quietly
// becomes a second transaction, and either way the evidence is gone. Keeping the
// evidence makes "Not the same" a one-tap undo, lets the real number of transactions
// be checked rather than trusted, and gives every merge and link an author.
//
// Two rules hold everywhere below:
//   - Amounts are integer KOBO. Naira floats do not survive arithmetic: 0.1 + 0.2
//     is not 0.3, and a ledger that drifts by a kobo is a ledger nobody trusts.
//   - Times are instants, compared in Africa/Lagos when a calendar day matters.
//
// Pure and dependency-free so the whole ladder can be tested without a database.

const { createHash } = require('crypto');

// Where an Observation came from. 'email' is a bank alert that arrived by forwarding;
// it is the bank's own words, so it is treated as an alert, not as something a person
// typed.
const SOURCES = ['sms', 'notification', 'email', 'share', 'statement', 'manual', 'mono'];

// Sources that are a bank telling us something as it happened. The merge windows in
// section 3.2 are written in terms of "alert", which means these three.
const ALERT_SOURCES = new Set(['sms', 'notification', 'email']);
const isAlert = (source) => ALERT_SOURCES.has(source);

// Which source wins a field when two disagree (section 3.3). Statement is first
// because it is the bank's own reconciled record; manual is last because a person
// typing from memory is the least reliable, not because their intent matters least.
// 'email' is not in the brief's list: it carries the bank's own alert text, so it
// sits with the alerts, just after SMS.
const AMOUNT_PRECEDENCE = ['statement', 'sms', 'email', 'mono', 'notification', 'share', 'manual'];

const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year, no DST.

const ms = (t) => (t instanceof Date ? t.getTime() : new Date(t).getTime());

// Naira (number or string) to integer kobo. Rounds at the kobo, so a bank that
// prints 1,234.565 does not become a fraction of a kobo we then carry forever.
function toKobo(naira) {
  const n = typeof naira === 'string' ? Number(naira.replace(/,/g, '')) : Number(naira);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}
const toNaira = (kobo) => Math.round(Number(kobo) || 0) / 100;

// The calendar day in Lagos, as 'YYYY-MM-DD'. A transaction at 00:30 Lagos time is
// stored as 23:30 UTC the day before, and a statement that says it happened on the
// 3rd is right; comparing in UTC would put it on the 2nd and break the same-value-date
// rule for statement and Mono rows.
function lagosDay(t) {
  const at = ms(t);
  if (!Number.isFinite(at)) return '';
  return new Date(at + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}

// Which of the user's accounts this touched: the bank plus the masked tail when the
// source showed one. Without digits it is the bank alone, which still rules out two
// different banks while allowing the "same bank, one side has no digits" case the
// ladder's step 4 depends on.
function accountRef({ bankCode = '', bank = '', accountMask = '' } = {}) {
  const code = String(bankCode || bank || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const tail = String(accountMask || '').replace(/\D/g, '').slice(-4);
  if (!code) return tail ? `?:${tail}` : '';
  return tail ? `${code}:${tail}` : code;
}
// The bank half of an accountRef, for "same bank when one side lacks digits".
const bankOf = (ref) => String(ref || '').split(':')[0];
const hasDigits = (ref) => String(ref || '').includes(':');

// A stable hash of exactly what a source delivered. Two deliveries of one SMS are
// byte-identical, so this catches a re-delivery without any fuzzy matching at all.
// Whitespace is collapsed first: some gateways re-wrap long messages.
function rawHash(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return createHash('sha1').update(text).digest('hex');
}

// Build a normalised Observation. Callers pass whatever their source gave them; this
// is the one place that decides the shape, so a new source cannot invent fields.
function makeObservation(input = {}) {
  const {
    id = '', userId = '', source = 'manual', raw = '',
    direction = null, amount = null, amountKobo = null,
    eventTime = null, receivedAt = null,
    balanceAfter = null, balanceAfterKobo = null,
    reference = '', sessionId = '', bankReference = '',
    counterpartyRaw = '', channelHints = [],
    bank = '', bankCode = '', accountMask = '',
    status = 'final',
  } = input;

  const received = receivedAt != null ? ms(receivedAt) : Date.now();
  // The time the money moved, as the text stated it. Falling back to when we received
  // it is deliberate: a source with no time in it still has to sit somewhere sensible
  // on a timeline, and "when it reached us" is the only honest answer available.
  const event = eventTime != null ? ms(eventTime) : received;

  return {
    id: String(id || ''),
    userId: String(userId || ''),
    source: SOURCES.includes(source) ? source : 'manual',
    direction: direction === 'credit' || direction === 'debit' ? direction : null,
    amountKobo: amountKobo != null ? Math.round(amountKobo) : toKobo(amount),
    eventTime: event,
    receivedAt: received,
    balanceAfterKobo: balanceAfterKobo != null ? Math.round(balanceAfterKobo)
      : (balanceAfter != null ? toKobo(balanceAfter) : null),
    // Both identifiers the bank may have stated. The session id is shared by both
    // banks in one NIP transfer; a bank's own reference is internal to that bank.
    reference: String(reference || sessionId || '').trim(),
    bankReference: String(bankReference || '').trim(),
    counterpartyRaw: String(counterpartyRaw || '').trim(),
    channelHints: Array.isArray(channelHints) ? channelHints.slice(0, 8) : [],
    accountRef: accountRef({ bank, bankCode, accountMask }),
    bank: String(bank || ''),
    rawHash: rawHash(raw),
    raw: String(raw || ''),
    // 'pending' is a hold the bank has not settled. A pending Observation never
    // counts toward any total (13.7); it waits for the final charge to replace it.
    status: status === 'pending' ? 'pending' : 'final',
  };
}

// Every identifier this Observation offers, for the reference step of the ladder.
const referencesOf = (o) => [o.reference, o.bankReference].filter(Boolean).map((r) => r.toLowerCase());

module.exports = {
  SOURCES, ALERT_SOURCES, AMOUNT_PRECEDENCE, isAlert,
  toKobo, toNaira, lagosDay, accountRef, bankOf, hasDigits, rawHash,
  makeObservation, referencesOf,
};
