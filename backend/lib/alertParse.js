// Bank-alert parsing helpers (spec: "perfect SMS + statement/email ingestion").
// Two pieces, both pure + dependency-free so they can be corpus-tested:
//   1) parseLabeledAlert — structured "Label : Value" alerts (GTBank GeNS and any
//      bank that lists Amount/Description/direction as fields). Near-100% reliable
//      because the direction and amount are stated explicitly, not inferred.
//   2) detectDirection — tiered credit/debit inference for free-text alerts, where
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

function detectDirection(raw) {
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

module.exports = { detectDirection, parseLabeledAlert, CREDIT_STRONG, DEBIT_STRONG, CREDIT_WEAK, DEBIT_WEAK };
