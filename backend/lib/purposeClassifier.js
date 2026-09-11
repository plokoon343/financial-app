// Tier-1 deterministic purpose classifier (spec 6.1, free/no-LLM half of the hybrid).
// Given a candidate counterparty group (from purposeInference.buildCandidates) plus an
// optional prior-category hint (from the user's learned categories / global consensus),
// it proposes a purpose using keyword rules + cadence/amount/direction heuristics —
// $0, on-box, private. Conservative: returns null unless it's at least "medium" sure,
// so the hard tail falls through to the optional LLM tier. Pure + dependency-free.

'use strict';

const { PURPOSES, purposeById } = require('./purposeInference');

// Invert PURPOSES (id -> category) so a learned/consensus CATEGORY can map back to a
// purpose id for the hint path.
const CATEGORY_TO_PURPOSE = {};
for (const p of PURPOSES) if (p.category) CATEGORY_TO_PURPOSE[p.category.toLowerCase()] = p.id;

// Keyword signatures per purpose, in priority order (most specific first). Keywords
// are normalisation-safe (lowercase, alphanumerics + single spaces) and matched as
// whole tokens/phrases against the normalised text (so "rent" won't fire in "current"
// and "bro" won't fire in "brother account").
const RULES = [
  { id: 'savings', kw: ['piggyvest', 'piggy vest', 'cowrywise', 'cowry', 'safelock', 'flex naira', 'target save', 'savings', 'my savings', 'ajo', 'esusu', 'thrift'] },
  { id: 'investment', kw: ['risevest', 'rise vest', 'bamboo', 'trove', 'chaka', 'mutual fund', 'treasury bill', 'tbill', 't bill', 'bond', 'stanbic asset', 'ibtc asset', 'investment', 'invest', 'binance', 'stock'] },
  { id: 'loan_repayment', kw: ['loan repay', 'loan repayment', 'repayment', 'repay loan', 'renmoney', 'fairmoney', 'palmcredit', 'okash', 'aella', 'specta', 'payday loan', 'credit repay', 'loan'], out: true },
  { id: 'rent', kw: ['house rent', 'rent', 'landlord', 'landlady', 'caretaker', 'tenancy', 'apartment rent', 'accommodation', 'lease', 'agent fee'], out: true },
  { id: 'school', kw: ['school fees', 'sch fees', 'tuition', 'university', 'polytechnic', 'college', 'academy', 'school', 'matric', 'wsp', 'education fee'], out: true },
  { id: 'utilities', kw: ['ikedc', 'ekedc', 'phcn', 'aedc', 'ibedc', 'eedc', 'kaedco', 'jos electric', 'kano electric', 'disco', 'prepaid meter', 'recharge meter', 'band a', 'water board', 'lawma', 'waste', 'electricity'], out: true },
  { id: 'gift', kw: ['tithe', 'offering', 'church', 'rccg', 'mfm', 'winners chapel', 'mosque', 'zakat', 'sadaqah', 'donation', 'charity', 'gift', 'ngo'], out: true },
  { id: 'salary', kw: ['salary', 'payroll', 'wages', 'stipend', 'remuneration', 'emolument', 'staff pay', 'staff salary', 'monthly pay'] },
  { id: 'family', kw: ['mummy', 'mommy', 'mum', 'mom', 'daddy', 'dad', 'father', 'mother', 'brother', 'bro', 'sister', 'sis', 'uncle', 'aunty', 'aunt', 'cousin', 'wife', 'husband', 'hubby', 'family', 'upkeep', 'feeding money'] },
  { id: 'business', kw: ['enterprise', 'enterprises', 'ventures', 'nig ltd', 'ltd', 'limited', 'global resources', 'resources', 'stores', 'supplies', 'trading', 'concept', 'concepts', 'and sons', 'nigeria plc', 'plc'] },
];

// Heuristic thresholds.
const RENT_MIN = 70000;         // a "rent-sized" monthly outflow (₦)
const REGULAR_CADENCES = new Set(['weekly', 'monthly']);
const roundish = (n) => n >= 1000 && (n % 1000 === 0 || n % 500 === 0);

const norm = (s) => ` ${(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

// Classify one candidate. `priorCategory` is an optional hint (the category the user's
// learned rules / global consensus already associate with this counterparty). Returns
// { purpose, confidence, reason, source } or null when not confident enough.
function classifyPurpose(candidate, priorCategory) {
  const c = candidate || {};
  const hay = norm(`${c.counterparty || ''} ${(c.samples || []).join(' ')}`);
  const out = c.direction === 'out';
  const income = c.direction === 'in';

  // 1) Prior learned/consensus category — the strongest, cheapest signal.
  if (priorCategory) {
    const pid = CATEGORY_TO_PURPOSE[priorCategory.toLowerCase()];
    if (pid) return { purpose: pid, confidence: 'high', reason: 'You’ve categorised this payee before', source: 'learned' };
  }

  // 2) Keyword rules (priority order). Direction-gated where a purpose only makes
  //    sense one way (rent/school/utilities/gift/loan repayment are outgoing). Every
  //    keyword is matched whole-token (wrapped in spaces against the padded hay).
  for (const r of RULES) {
    if (r.out && income) continue; // an incoming "rent" is almost certainly mislabelled
    if (r.kw.some((k) => hay.includes(` ${k} `))) {
      // salary is only "high" when it's actually incoming money.
      const conf = r.id === 'salary' && !income ? 'medium' : 'high';
      return { purpose: r.id, confidence: conf, reason: `Matched “${r.id.replace('_', ' ')}” wording`, source: 'rules' };
    }
  }

  // 3) Cadence + amount + direction heuristics (no keyword hit).
  const regular = REGULAR_CADENCES.has(c.cadence);
  if (income && regular && (c.count || 0) >= 3) {
    return { purpose: 'salary', confidence: 'medium', reason: 'Regular income from the same source', source: 'heuristic' };
  }
  if (out && c.cadence === 'monthly' && (c.avgAmount || 0) >= RENT_MIN && roundish(c.avgAmount) && (c.count || 0) >= 2) {
    return { purpose: 'rent', confidence: 'medium', reason: 'A large, round amount on a monthly cycle', source: 'heuristic' };
  }
  return null;
}

// Turn a classifier result + its candidate into the proposal shape the app consumes
// (same shape validateProposals produces), or null for a no-op purpose.
function proposalFrom(candidate, result) {
  if (!result) return null;
  const purpose = purposeById(result.purpose);
  if (!purpose || !purpose.category) return null; // 'other' etc. => no-op
  return {
    counterparty: candidate.counterparty,
    txnIds: candidate.txnIds,
    count: candidate.count,
    purpose: purpose.id,
    label: purpose.label,
    category: purpose.category,
    confidence: result.confidence,
    reason: result.reason,
    source: result.source, // 'learned' | 'rules' | 'heuristic'
  };
}

module.exports = { classifyPurpose, proposalFrom, CATEGORY_TO_PURPOSE, RULES };
