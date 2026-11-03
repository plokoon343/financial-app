// Decide what an incoming alert is before parsing it (Round 3, 3.1). Rules live in
// data/alertRules.json so they can grow without code changes:
//   transaction: a debit, credit or reversal          -> parse it
//   ignore:      OTP, promo, loan offer, balance enquiry, failed transaction notice,
//                login or account notice              -> drop it (with the reason)
//   fee:         stamp duty, SMS charge, transfer fee, VAT, maintenance -> Bank Charges
//   unsure:      has money in it but doesn't read like a transaction -> review, never
//                straight into the ledger
const RULES = require('../data/alertRules.json');

const rx = (s) => new RegExp(s, 'i');
const compile = (obj) => Object.fromEntries(Object.entries(obj).map(([k, list]) => [k, list.map(rx)]));
const ALWAYS = compile(RULES.alwaysIgnore);
const UNLESS = compile(RULES.ignoreUnlessTransaction);
const MOVED = rx(RULES.failedButMoved);
const MONEY = rx(RULES.transaction.money);
const DIRECTION = rx(RULES.transaction.direction);
const CONTEXT = rx(RULES.transaction.context);
// Wording that says money moved on its own, with no banking furniture around it.
// The context test below (balance, acct, ref, value date) is shaped like a bank SMS,
// and every SMS has one of those words. A bank APP's push notification does not:
// "OPay: You have received ₦5,000.00 from Ada" has an amount and a direction and
// nothing else, so it failed the test and was held for review instead of saved. That
// is what made notification capture look broken while it was working perfectly.
const SELF_EVIDENT = rx(RULES.transaction.selfEvident);
const FEES = RULES.fees.map(rx);
// "Fee: N10.75" inside a transfer alert is a detail of that transfer, not a fee alert.
const FEE_FIELD = /\b(?:fee|charges?|vat)\s*[:=]\s*(?:ngn|naira|₦|n)?\s*\d/gi;

const BANK_RULES = new Map((RULES.banks || []).map((b) => [b.code, {
  ...b,
  amountRe: b.amount ? rx(b.amount) : null,
  directionRe: b.direction ? rx(b.direction) : null,
  narrationRe: b.narration ? rx(b.narration) : null,
  dateRe: b.date ? rx(b.date) : null,
}]));
const BALANCE = new RegExp(RULES.shared.balance, 'gi');

// Sources where the alert was delivered by a bank: the bank's own app posted it, or
// it came from the bank's sender. Self-evident wording is enough there. Text a person
// pasted or shared has no such provenance, so it still needs the context word and
// otherwise waits for them to confirm it, which is the behaviour those paths rely on.
// Only the bank app's own push. A bank SMS and a forwarded bank email both carry the
// context words anyway, so relaxing the test for them would buy nothing and would
// weaken a guarantee those paths already rely on: text with money in it but no clear
// banking shape waits for a person instead of being saved.
const BANK_DELIVERED = new Set(['notification']);
const looksTransactional = (raw, source) =>
  MONEY.test(raw)
  && ((BANK_DELIVERED.has(source) && SELF_EVIDENT.test(raw)) || (DIRECTION.test(raw) && CONTEXT.test(raw)));
const firstHit = (groups, s) => {
  for (const [reason, list] of Object.entries(groups)) if (list.some((r) => r.test(s))) return reason;
  return null;
};

// Is this narration (or alert) a bank fee? Fee details inside another alert don't count.
function isFeeText(text) {
  const s = String(text || '').replace(FEE_FIELD, ' ');
  return FEES.some((r) => r.test(s));
}

// { kind, reason }. `description` (the parsed narration) is used for the fee check
// when the caller has it, so a fee mentioned in passing doesn't turn a transfer into
// a fee.
function classifyAlert(raw, { description, source = '' } = {}) {
  const s = String(raw || '');
  if (!s.trim()) return { kind: 'ignore', reason: 'empty' };
  const always = firstHit(ALWAYS, s);
  if (always === 'failed' && MOVED.test(s)) { /* a reversal of a failed payment is money moving */ }
  else if (always) return { kind: 'ignore', reason: always };
  // Only a balance in it (e.g. "OWealth update: acct bal NGN 52,000.00"): no money moved.
  const noBal = withoutBalance(s);
  if (!MONEY.test(noBal) && !DIRECTION.test(noBal)) return { kind: 'ignore', reason: 'balance_only' };
  if (looksTransactional(s, source)) {
    return isFeeText(description != null ? description : s) ? { kind: 'fee', reason: 'fee' } : { kind: 'transaction', reason: '' };
  }
  const unless = firstHit(UNLESS, s);
  if (unless) return { kind: 'ignore', reason: unless };
  // Money but no clear debit/credit wording: a person checks it. Dropping it could
  // lose a real transaction silently.
  if (MONEY.test(s) || (DIRECTION.test(s) && /\d{2,}/.test(s))) return { kind: 'unsure', reason: 'unclear' };
  return { kind: 'ignore', reason: 'no_amount' };
}

// Legacy shape used across the server: the reason to drop, or null to keep.
function alertIgnoreReason(raw) {
  const c = classifyAlert(raw);
  return c.kind === 'ignore' ? c.reason : null;
}

// The "shape" of an alert for personal "not a transaction" rules: lower case, every
// number blanked, spacing collapsed. Two alerts of the same kind share a shape even
// when the amounts, dates and references differ.
function alertShape(raw) {
  const s = String(raw || '').toLowerCase().replace(/[\d][\d,.:/*x-]*/g, '#').replace(/\s+/g, ' ').trim();
  return s.length >= 12 ? s.slice(0, 160) : '';
}

const bankRule = (code) => BANK_RULES.get(code) || null;
// The alert with its balance figures blanked out, so the amount is never the balance.
const withoutBalance = (raw) => String(raw || '').replace(BALANCE, ' ');

module.exports = { classifyAlert, alertIgnoreReason, alertShape, isFeeText, looksTransactional, bankRule, withoutBalance, RULES };
