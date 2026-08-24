// Internal-transfer detection (Spec 3). Finds pairs of transactions that are the
// user moving money between their OWN bank accounts — a debit from bank A matched
// to a credit into bank B — so they can be excluded from spending/income math.
// Pure and dependency-free so it can be unit-tested; server.js applies the DB
// changes. A fee (when the debited and credited amounts differ) becomes a real
// Bank Charges expense.

const AUTO = 80;   // >= auto-classify both sides as internal_transfer
const ASK = 55;    // 55-79 -> ask the user (surfaced by the caller); < 55 -> leave

// Common Nigerian bank tokens, for "does A's narration mention B's bank".
const BANK_TOKENS = [
  'gtb', 'gtbank', 'guaranty', 'access', 'zenith', 'uba', 'first bank', 'firstbank', 'fbn',
  'fcmb', 'union', 'sterling', 'fidelity', 'stanbic', 'ibtc', 'ecobank', 'polaris', 'keystone',
  'providus', 'wema', 'alat', 'kuda', 'opay', 'palmpay', 'moniepoint', 'monie', 'jaiz', 'vfd',
  'vbank', 'carbon', 'globus', 'premiumtrust', 'unity', 'taj', 'paycom',
];

const lc = (s) => (s || '').toString().toLowerCase();
const feeTolerance = (a, b) => Math.max(50, Math.max(Math.abs(a), Math.abs(b)) * 0.01);
const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Does the transfer narration reference the other side's bank?
function mentionsBank(desc, otherBank) {
  const d = lc(desc);
  if (!d) return false;
  const b = lc(otherBank);
  if (b && d.includes(b)) return true;
  // match on a shared known-bank token (e.g. debit narration "TRF TO ACCESS" and B is an Access account)
  return BANK_TOKENS.some((tok) => b.includes(tok) && d.includes(tok));
}

// Does the narration look like the user's own name (self-transfer)?
function mentionsSelf(desc, userName) {
  const name = lc(userName).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  if (name.length < 2) return false;
  const d = lc(desc);
  const hits = name.filter((w) => d.includes(w)).length;
  return hits >= 2; // at least two name parts present
}

// Score one (debit, credit) candidate. Returns 0 if it fails a hard gate.
function scorePair(debit, credit, opts = {}) {
  const { userName = '', routeKeys = new Set() } = opts;
  const da = Math.abs(debit.amount), ca = Math.abs(credit.amount);
  const diff = Math.abs(da - ca);
  const tol = feeTolerance(da, ca);
  let s = 0;
  if (diff === 0) s += 40; else if (diff <= tol) s += 30; else return 0;   // amount gate
  const hrs = hoursBetween(debit.date, credit.date);
  if (hrs < 0 || hrs > 72) return 0;                                        // time gate (debit first)
  if (sameDay(debit.date, credit.date)) s += 25; else if (hrs <= 24) s += 18; else s += 8;
  if (mentionsBank(debit.description, credit.bank) || mentionsBank(credit.description, debit.bank)) s += 20;
  if (mentionsSelf(debit.description, userName) || mentionsSelf(credit.description, userName)) s += 15;
  const rk = routeKey(debit.bank, credit.bank);
  if (routeKeys.has(rk)) s += 25;                                           // user previously confirmed this route
  return s;
}

// A direction-agnostic key for a pair of accounts (banks), for remembered routes.
function routeKey(bankA, bankB) {
  return [lc(bankA) || '?', lc(bankB) || '?'].sort().join('|');
}

// Detect internal-transfer pairs among a set of transactions.
// txns: [{ _id, type:'income'|'expense', amount, date, bank, description }]
// Returns { auto:[pair], ask:[pair] } where pair = { debit, credit, score, fee }.
// `fee` is the positive difference (debited minus credited) when the debit is larger.
function detectTransfers(txns, opts = {}) {
  const debits = txns.filter((t) => t.type === 'expense');
  const credits = txns.filter((t) => t.type === 'income');
  const candidates = [];
  for (const d of debits) {
    for (const c of credits) {
      if (lc(d.bank) === lc(c.bank)) continue;           // must be different accounts
      if (!d.bank || !c.bank) continue;                  // need both banks to be sure
      const score = scorePair(d, c, opts);
      if (score >= ASK) candidates.push({ debit: d, credit: c, score });
    }
  }
  // Greedy assignment: strongest first, then nearest in time; each txn used once.
  candidates.sort((x, y) =>
    y.score - x.score ||
    Math.abs(hoursBetween(x.debit.date, x.credit.date)) - Math.abs(hoursBetween(y.debit.date, y.credit.date)));
  const used = new Set();
  const auto = [], ask = [];
  for (const cand of candidates) {
    const di = String(cand.debit._id), ci = String(cand.credit._id);
    if (used.has(di) || used.has(ci)) continue;
    used.add(di); used.add(ci);
    const fee = Math.max(0, Math.abs(cand.debit.amount) - Math.abs(cand.credit.amount));
    const pair = { debit: cand.debit, credit: cand.credit, score: cand.score, fee };
    (cand.score >= AUTO ? auto : ask).push(pair);
  }
  return { auto, ask };
}

module.exports = { detectTransfers, scorePair, routeKey, mentionsBank, mentionsSelf, AUTO, ASK };
