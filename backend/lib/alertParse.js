// Bank-alert parsing helpers (spec: "perfect SMS + statement/email ingestion").
// Two pieces, both pure + dependency-free so they can be corpus-tested:
//   1) parseLabeledAlert: structured "Label : Value" alerts (GTBank GeNS and any
//      bank that lists Amount/Description/direction as fields). Near-100% reliable
//      because the direction and amount are stated explicitly, not inferred.
//   2) detectDirection: tiered credit/debit inference for free-text alerts, where
//      the direction has to be read from wording. Strong signals win; the noisy
//      generics only break a tie, so an email footer can't flip a real credit.

'use strict';

// ── Direction (free-text fallback) ──
// Strong = how banks actually label direction. NB: "credit/debit transaction" covers
// GTBank's "a CREDIT transaction occurred"; verbs (credited/debited) not the bare
// nouns, which appear in noise ("debit card", "unauthorized debit", "credit limit").
const CREDIT_STRONG = /\bcredited\b|credit\s+alert|credit\s+transaction|money\s+in|\binflow\b|\bdeposit(ed)?\b|\breceived\b|\breversal\b|\brefund(ed)?\b/i;
const DEBIT_STRONG  = /\bdebited\b|debit\s+alert|debit\s+transaction|money\s+out|\bwithdraw(n|al)\b|\bpurchase\b/i;
const CREDIT_WEAK   = /\b(sent to you|paid you|received from)\b/i;
const DEBIT_WEAK    = /\b(withdrawn|payment|paid|pos|transfer to|sent|charged)\b/i;

// Some banks state the direction as a heading ("Debit" / "Credit" on its own first
// line) or a field ("Credit: NGN5,000"), which is as explicit as it gets.
const DIRECTION_HEAD = /^\s*(credit|debit)\b(?!\s*card)|\b(credit|debit)\s*:\s*(?:ngn|naira|₦|n)?\s*\d/i;

function detectDirection(raw) {
  const head = (raw || '').match(DIRECTION_HEAD);
  if (head) return { type: /^credit$/i.test(head[1] || head[2]) ? 'income' : 'expense', conf: 'high' };
  const cs = CREDIT_STRONG.test(raw), ds = DEBIT_STRONG.test(raw);
  if (cs && !ds) return { type: 'income', conf: 'high' };
  if (ds && !cs) return { type: 'expense', conf: 'high' };
  const cr = /\bcr\b/i.test(raw), dr = /\bdr\b/i.test(raw);
  if (cr && !dr) return { type: 'income', conf: 'high' };
  if (dr && !cr) return { type: 'expense', conf: 'high' };
  const cw = CREDIT_WEAK.test(raw), dw = DEBIT_WEAK.test(raw);
  if (cw && !dw) return { type: 'income', conf: 'medium' };
  if (dw && !cw) return { type: 'expense', conf: 'medium' };
  return { type: 'expense', conf: 'low' }; // ambiguous → default spend, flag for review
}

// ── Structured labeled alerts ──
// A field like "Amount : NGN 1300" and a "a CREDIT/DEBIT transaction occurred" line.
// Both must be present, else this isn't a labeled alert (return null → caller uses the
// free-text path). Returns { amount, type, description, date, labeled:true }.
function parseLabeledAlert(raw) {
  const t = (raw || '').replace(/\r/g, ' ');
  const dm = t.match(/\ba\s+(credit|debit)\s+transaction\b/i)
    || t.match(/\btransaction\s+type\b\s*[:=-]?\s*(credit|debit)\b/i)
    || t.match(/\btxn\s+type\b\s*[:=-]?\s*(cr|dr|credit|debit)\b/i);
  const am = t.match(/\bamount\b\s*[:=-]?\s*(?:ngn|naira|n|₦)?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!dm || !am) return null;
  const amount = parseFloat(am[1].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  const d = dm[1].toLowerCase();
  const type = (d === 'credit' || d === 'cr') ? 'income' : 'expense';
  // Description: the "Description :" field value, up to the next labelled field.
  let description = '';
  // Fields are newline-separated ("Description : <value>"), so take the rest of the
  // line; then also cut any labels that share the line on single-line variants.
  const de = t.match(/\bdescription\b\s*[:=-]?\s*([^\n]+)/i);
  if (de) {
    description = de[1]
      .replace(/\s*\b(?:remarks|value date|time of transaction|amount|document number|current balance|available balance)\b.*$/i, '')
      .replace(/\s{2,}/g, ' ').trim().slice(0, 140);
  }
  // Value Date if present.
  let date = null;
  const vd = t.match(/\bvalue date\b\s*[:=-]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-][A-Za-z0-9]{2,4}[\/-]\d{2,4})/i);
  if (vd) date = vd[1];
  return { amount, type, description, date, labeled: true };
}

// The best human-readable description in an alert: a labelled narration field when
// there is one, else the alert text with bank boilerplate removed. Email alerts carry
// a generic subject ("Transaction Notification") and a greeting before the useful
// part, and those must never become the description. Returns '' when nothing useful
// is left, so the caller can fall back.
const NARRATION_LABELS = 'description|desc|narration|narrative|remarks?|details|beneficiary(?: name)?|merchant(?: name)?|purpose|payment for|sender(?: name)?|recipient(?: name)?';
const FIELD_LABELS = 'description|desc|narration|narrative|remarks?|details|beneficiary|merchant|purpose|amount|amt|value date|date|time|reference|ref|document number|account(?: number| no\\.?)?|acct|current balance|available balance|avail(?:able)?\\.? bal(?:ance)?|bal|balance|branch|transaction type|txn type|txn|channel|session id';
const BOILERPLATE = [
  /\b(?:transaction|debit|credit|e-?mail)\s+(?:notification|alert)s?\b[:\s-]*/gi,
  /\b(?:gens|nip|instant)\s+alert\b[:\s-]*/gi,
  /\bdear\s+[^,\n]{0,60}[,\n]/gi,
  /\bwe wish to (?:inform|notify) you that[^.\n]*?(?:account|with us)[^.\n]*[.\n]?/gi,
  /\bthis is to (?:inform|notify) you that[^.\n]*?(?:account|with us)[^.\n]*[.\n]?/gi,
  /\b(?:a|the following)\s+(?:debit|credit)\s+transaction\s+(?:has\s+)?occurred[^.\n]*[.\n]?/gi,
  /\bthank you for (?:banking|choosing)[^.\n]*[.\n]?/gi,
  /\b(?:for (?:any )?(?:enquiries|inquiries|complaints)|please do not reply)[^\n]*/gi,
  /\b(?:current|available|ledger|book|cleared)\s+balance\b[^\n]*/gi,
  /\b(?:avail(?:able)?\.?\s+bal(?:ance)?|bal)\b\s*[:=-]?[^\n]*/gi,
  /\b(?:your\s+)?(?:account|acct)\s*(?:number|no\.?|#)?\s*[:=-]?\s*[\dX*]{3,}\b/gi,
];

// Prose alerts name the other party in a phrase: "debited with NGN 4,200.00 for BOLT
// RIDE LAGOS on 02/10", "credited with NGN 20,000.00 from JOHN DOE." Only an
// all-caps name is taken, which is how banks print counterparties.
const COUNTERPARTY_RE = /\b(?:for|to|from|at|by)\s+([A-Z][A-Z0-9&'.\/\- ]{1,58}[A-Z0-9])(?=\s+(?:on|at|ref|via)\b|\s*[.,;\n]|\s*$)/;

function alertDescription(raw) {
  const t = (raw || '').replace(/\r/g, '');
  const field = t.match(new RegExp(`\\b(?:${NARRATION_LABELS})\\b\\s*[:=-]\\s*([^\\n]+)`, 'i'));
  if (field) {
    const v = field[1]
      .replace(new RegExp(`\\s*\\b(?:${FIELD_LABELS})\\b\\s*[:=-].*$`, 'i'), '')
      .replace(/\s{2,}/g, ' ').trim();
    if (/[A-Za-z]{2,}/.test(v)) return v.slice(0, 140);
  }
  const cp = t.match(COUNTERPARTY_RE);
  if (cp && /[A-Z]{3,}/.test(cp[1]) && !/^(?:NGN|ACCOUNT|ACCT)\b/.test(cp[1])) return cp[1].trim();
  let body = t;
  for (const re of BOILERPLATE) body = body.replace(re, ' ');
  body = body
    .replace(/(?:ngn|naira|₦|n)\s?[\d,]+(?:\.\d{1,2})?/gi, ' ')
    .replace(/\b\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3})[\/-]\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?/gi, ' ')
    .replace(/\b(?:ref|txn|transaction id|receipt|session id)[:#\s]*[A-Za-z0-9]+/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, '')
    .trim();
  return /[A-Za-z]{3,}/.test(body) ? body.slice(0, 140) : '';
}

// ── Is this even a transaction? ──
// Banks and wallet apps push OTPs, loan offers, promos and balance notices through the
// same channel as real alerts, often with an amount and the word "account" in them.
// Returns why a message should be dropped, or null to parse it. Two kinds of message
// are never a completed transaction however much they look like one: a code to
// approve a payment, and an offer of money. Everything else that carries a real
// debit/credit signature is kept, since a false drop is silent data loss.
const MONEY_RE = /(?:ngn|naira|₦)\s*[\d,]+(?:\.\d{1,2})?|\bn\d[\d,]*(?:\.\d{1,2})?|\b[\d,]+\.\d{2}\b/i;
const ALERT_DIRECTION_RE = /\b(debit(?:ed)?|credit(?:ed)?|dr|cr|withdraw(?:n|al)?|deposit(?:ed)?|received|transfer(?:red)?|pos\b|reversal)\b/i;
const ALERT_CONTEXT_RE = /\b(bal(?:ance)?|avail|a\/c|acct|account|ref|value date|txn|transaction|desc)\b/i;
// A code is present, not just a "never share your OTP" footer.
const OTP_RE = /\b(?:otp|code|token|password)\b[^\n]{0,100}?\bis\s*:?\s*\d{4,8}\b|\b(?:otp|code|token)\s*[:\-]?\s*\d{4,8}\b|\b\d{4,8}\s+is your\b|\buse\s+\d{4,8}\s+to\b/i;
const OFFER_RE = /\b(get a loan|borrow up to|loan offer|apply now|you(?:'?re| are) eligible|eligible for|up to (?:ngn|naira|₦|n)\s?[\d,]+|win a|limited time)\b/i;

function alertLooksTransactional(raw) {
  return ALERT_DIRECTION_RE.test(raw) && MONEY_RE.test(raw) && ALERT_CONTEXT_RE.test(raw);
}

function alertIgnoreReason(raw) {
  const s = (raw || '').toLowerCase();
  if (!s.trim()) return 'empty';
  if (OTP_RE.test(s)) return 'otp';
  if (OFFER_RE.test(s)) return 'promo';
  if (alertLooksTransactional(raw)) return null;
  if (/\b(otp|one[-\s]?time (?:password|pin|code)|verification code|is your (?:code|otp|pin|token))\b/.test(s)) return 'otp';
  if (/\b(enjoy|special offer|promo(?:tion)?|discount|cash ?back|congratulations|download our app|dial \*\d|upgrade to)\b/.test(s)) return 'promo';
  if (/\b(login|log[-\s]?in|sign[-\s]?in|new device|password (?:has been|was|is) (?:changed|reset|updated)|security alert)\b/.test(s)) return 'login';
  if (/\b(balance (?:enquiry|inquiry)|bal(?:ance)? enq|your (?:available )?balance is)\b/.test(s)) return 'balance_enquiry';
  if (/\b(card (?:is )?(?:ready|delivered|activated|blocked)|cheque ?book|statement (?:is )?ready|e-?statement (?:is )?ready)\b/.test(s)) return 'notice';
  return null;
}

module.exports = {
  detectDirection, parseLabeledAlert, alertDescription, alertIgnoreReason, alertLooksTransactional,
  CREDIT_STRONG, DEBIT_STRONG, CREDIT_WEAK, DEBIT_WEAK,
};
