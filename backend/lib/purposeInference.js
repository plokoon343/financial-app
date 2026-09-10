// AI counterparty -> purpose inference (spec 6.1). Pure, dependency-free core so it
// unit-tests without a DB or the network: it finds transactions stuck on a generic
// "Transfer"/"Other" label, groups them by counterparty, and prepares a PRIVACY-
// STRIPPED prompt payload. The model only ever proposes; server.js validates every
// proposal against this allow-list and the user confirms before anything is written.
//
// Design guardrails (spec 6.1): AI proposes, deterministic validates, user confirms;
// strip account numbers / long refs / bare numbers before any cloud call.

'use strict';

// The purposes the model may choose from, each mapped to the category we'd apply.
// A closed set so a proposal can be validated deterministically — anything off it is
// rejected. Kept human-readable so it reads well in the ledger and insights.
const PURPOSES = [
  { id: 'rent', label: 'Rent', category: 'Rent & Housing' },
  { id: 'savings', label: 'Savings / moving to own account', category: 'Savings' },
  { id: 'family', label: 'Family & friends support', category: 'Family & Friends' },
  { id: 'salary', label: 'Salary / staff payment', category: 'Salary & Wages' },
  { id: 'loan_repayment', label: 'Loan or debt repayment', category: 'Loan Repayment' },
  { id: 'business', label: 'Business / supplier payment', category: 'Business' },
  { id: 'utilities', label: 'Bills & utilities', category: 'Bills & Utilities' },
  { id: 'investment', label: 'Investment', category: 'Investment' },
  { id: 'gift', label: 'Gift or donation', category: 'Gifts & Donations' },
  { id: 'school', label: 'School fees / tuition', category: 'Education' },
  { id: 'other', label: 'Something else / unsure', category: '' }, // '' => don't change it
];
const PURPOSE_IDS = PURPOSES.map((p) => p.id);
const purposeById = (id) => PURPOSES.find((p) => p.id === id) || null;

// Categories we treat as "not really categorised" — a transfer whose real purpose is
// unknown. These are the rows worth asking the model about.
const GENERIC_CATEGORIES = new Set(['', 'other', 'others', 'transfer', 'transfers', 'uncategorized', 'uncategorised', 'miscellaneous', 'misc']);
const isGenericCategory = (c) => GENERIC_CATEGORIES.has((c || '').toString().trim().toLowerCase());

// Bank-rail / boilerplate tokens that wrap the real payee name in an imported
// narration ("NIP/…/GTB", "TRANSFER TO …"). Stripped so the same payee groups
// together regardless of the rail that carried it.
const NOISE_TOKENS = new Set(['NIP', 'NXG', 'NEFT', 'RTGS', 'TRF', 'TRANSFER', 'TRFTO', 'TO', 'FRM', 'FROM', 'REF', 'USSD', 'POS', 'WEB', 'MOB', 'MOBILE', 'VIA', 'PAYMENT', 'PMT', 'TXN', 'VAT', 'CHARGE', 'CHARGES', 'FEE', 'FEES', 'BANK', 'PLC', 'MFB', 'LTD', 'SENT', 'RECEIVED', 'CR', 'DR', 'NGN']);

// Redact a counterparty/description before it leaves our server: drop account
// numbers, long reference codes, bare number runs, and rail boilerplate, keeping the
// human/merchant name. Never send raw digits to the model (spec 6.1 privacy rule).
function redactCounterparty(raw) {
  let s = (raw || '').toString();
  s = s
    .replace(/\b\d[\d\s-]{5,}\d\b/g, ' ')          // account/card/long number runs
    .replace(/\b[A-Z0-9]*\d[A-Z0-9]*\b/gi, (w) => (/^[a-z']+$/i.test(w) ? w : ' ')) // alnum ref codes w/ a digit
    .replace(/\b\d+\b/g, ' ')                       // any remaining bare numbers
    .replace(/[|/\\:]+/g, ' ')                       // rail separators
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Drop leading/standalone rail-noise tokens (keep interior name words intact).
  const words = s.split(/\s+/).filter((w) => w && !NOISE_TOKENS.has(w.toUpperCase()));
  return words.join(' ').slice(0, 60);
}

// A stable key to group a counterparty's transactions by (case/space-insensitive,
// redacted so numbers don't fragment the same payee into many groups).
function counterpartyKey(raw) {
  return redactCounterparty(raw).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
}

// Estimate cadence from the sorted day-gaps between a counterparty's transactions.
function cadenceOf(dates) {
  const days = dates.map((d) => Math.floor(new Date(d).getTime() / 86400000)).sort((a, b) => a - b);
  if (days.length < 2) return 'one-off';
  const gaps = [];
  for (let i = 1; i < days.length; i++) gaps.push(days[i] - days[i - 1]);
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (avg <= 10) return 'weekly';
  if (avg <= 45) return 'monthly';
  if (avg <= 120) return 'quarterly';
  return 'occasional';
}

// Build inference candidates from a user's transactions. Groups the generic-category
// transfers/expenses by counterparty and summarises each (count, amounts, cadence,
// direction, redacted samples). Only groups with a usable name are returned.
// `txns`: [{ _id, description, amount, category, type, date }]. `minCount` default 1.
function buildCandidates(txns, { minCount = 1, maxGroups = 25 } = {}) {
  const groups = new Map();
  for (const t of txns || []) {
    const type = t.type === 'income' ? 'income' : (t.type === 'expense' ? 'expense' : null);
    if (!type) continue;                              // skip excluded kinds
    if (!isGenericCategory(t.category)) continue;     // already meaningfully categorised
    const name = redactCounterparty(t.description);
    const key = counterpartyKey(t.description);
    if (!key || key.length < 3) continue;             // no usable name -> can't infer
    const g = groups.get(key) || { key, name, ids: [], amounts: [], dates: [], samples: [], creditN: 0, debitN: 0 };
    if (name.length > g.name.length) g.name = name;   // keep the fullest spelling seen
    g.ids.push(String(t._id));
    g.amounts.push(Math.abs(Number(t.amount) || 0));
    g.dates.push(t.date);
    if (g.samples.length < 3) { const r = redactCounterparty(t.description); if (r && !g.samples.includes(r)) g.samples.push(r); }
    if (type === 'income') g.creditN++; else g.debitN++;
    groups.set(key, g);
  }
  const candidates = [];
  for (const g of groups.values()) {
    if (g.ids.length < minCount) continue;
    const total = g.amounts.reduce((s, a) => s + a, 0);
    candidates.push({
      key: g.key,
      counterparty: g.name,
      txnIds: g.ids,
      count: g.ids.length,
      totalAmount: Math.round(total),
      avgAmount: Math.round(total / g.ids.length),
      direction: g.creditN > g.debitN ? 'in' : 'out',
      cadence: cadenceOf(g.dates),
      samples: g.samples,
    });
  }
  // Most active/most valuable first, capped to keep the model call cheap.
  candidates.sort((a, b) => b.count - a.count || b.totalAmount - a.totalAmount);
  return candidates.slice(0, maxGroups);
}

// The forced-tool schema the model fills in: one entry per candidate ref.
function proposalToolSchema() {
  return {
    name: 'propose_purposes',
    description: "For each counterparty ref, propose the most likely purpose of the money movement, or 'other' if unsure.",
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        proposals: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              ref: { type: 'integer', description: 'The candidate ref number given in the prompt.' },
              purpose: { type: 'string', enum: PURPOSE_IDS },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              reason: { type: 'string', description: 'A short, user-facing reason (<= 12 words).' },
            },
            required: ['ref', 'purpose', 'confidence'],
          },
        },
      },
      required: ['proposals'],
    },
    strict: true,
  };
}

// The redacted, privacy-safe prompt text describing the candidates for the model.
function buildInferencePrompt(candidates, nairaFmt = (n) => `NGN ${n}`) {
  const lines = candidates.map((c, i) => {
    const dir = c.direction === 'in' ? 'received from' : 'sent to';
    return `#${i} — ${dir} "${c.counterparty}" · ${c.count}x · ${c.cadence} · avg ${nairaFmt(c.avgAmount)} · total ${nairaFmt(c.totalAmount)}`;
  });
  return [
    "These are recurring money movements a Nigerian user hasn't categorised (mostly bank transfers). For EACH ref, infer the most likely purpose from the allowed list, using the counterparty name, amount and how often it happens. If you are not reasonably sure, use 'other'. Never invent a purpose to be helpful — 'other' is expected for unclear ones.",
    '',
    ...lines,
  ].join('\n');
}

// Validate + enrich the model's proposals against the candidates. Drops anything off
// the allow-list, low-confidence, 'other', or referencing an unknown/mismatched ref.
// Returns [{ counterparty, txnIds, purpose, label, category, confidence, reason }].
function validateProposals(rawProposals, candidates, { minConfidence = 'medium' } = {}) {
  const rank = { low: 0, medium: 1, high: 2 };
  const floor = rank[minConfidence] ?? 1;
  const out = [];
  for (const p of Array.isArray(rawProposals) ? rawProposals : []) {
    const c = candidates[p && p.ref];
    if (!c) continue;
    const purpose = purposeById(p.purpose);
    if (!purpose || purpose.id === 'other' || !purpose.category) continue; // no-op purposes
    if ((rank[p.confidence] ?? -1) < floor) continue;
    out.push({
      counterparty: c.counterparty,
      txnIds: c.txnIds,
      count: c.count,
      purpose: purpose.id,
      label: purpose.label,
      category: purpose.category,
      confidence: p.confidence,
      reason: (p.reason || '').toString().slice(0, 80),
    });
  }
  return out;
}

module.exports = {
  PURPOSES, PURPOSE_IDS, purposeById, isGenericCategory,
  redactCounterparty, counterpartyKey, cadenceOf, buildCandidates,
  proposalToolSchema, buildInferencePrompt, validateProposals,
};
