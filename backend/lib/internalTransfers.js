// Internal-transfer detection (Spec 3). Finds pairs of transactions that are the
// user moving money between their OWN bank accounts: a debit from bank A matched
// to a credit into bank B, so they can be excluded from spending/income math.
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
  // Round 6, part A item 3: two receipts for the same transfer (e.g. the sending
  // bank's and the receiving wallet's) often carry the same bank reference/session
  // id. That is as certain a match as this gets, so it outweighs everything else.
  if (debit.reference && credit.reference && lc(debit.reference) === lc(credit.reference)) s += 60;
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
      if (d.bank && c.bank && lc(d.bank) === lc(c.bank)) continue; // must be different accounts
      const sameRef = d.reference && c.reference && lc(d.reference) === lc(c.reference);
      // Normally need both banks named to be sure these are two different accounts;
      // a shared bank reference (round 6, part A item 3 - the two receipts of one
      // transfer, read off the same NIP session id) is strong enough on its own,
      // for a receipt that never states which bank it's from in its own text.
      if (!sameRef && (!d.bank || !c.bank)) continue;
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

// How a bank or wallet is written on screen once we recognise its token. Receipts
// name wallets by their registered company ("OPAY DIGITAL SERVICES LIMITED"), which
// is not what anyone calls it.
const BANK_NAMES = [
  [/\bopay\b|opay digital/i, 'OPay'],
  [/\bpalmpay\b/i, 'PalmPay'],
  [/\bmoniepoint\b|\bmonie\b/i, 'Moniepoint'],
  [/\bkuda\b/i, 'Kuda'],
  [/\bpaycom\b/i, 'OPay'],
  [/\bvfd\b|\bvbank\b/i, 'VBank'],
  [/\balat\b/i, 'ALAT'],
  [/\bgtb(?:ank)?\b|guaranty/i, 'GTBank'],
  [/\baccess bank\b|\baccess\b/i, 'Access'],
  [/\bzenith\b/i, 'Zenith'],
  [/\buba\b/i, 'UBA'],
  [/\bfirst ?bank\b|\bfbn\b/i, 'First Bank'],
  [/\bfcmb\b/i, 'FCMB'],
  [/\bsterling\b/i, 'Sterling'],
  [/\bfidelity\b/i, 'Fidelity'],
  [/\bstanbic\b|\bibtc\b/i, 'Stanbic IBTC'],
  [/\becobank\b/i, 'Ecobank'],
  [/\bwema\b/i, 'Wema'],
  [/\bprovidus\b/i, 'Providus'],
  [/\bpolaris\b/i, 'Polaris'],
  [/\bunion bank\b/i, 'Union'],
];

// The bank or wallet named anywhere in these pieces of a receipt, as a person would
// write it, or '' when none is recognised.
function bankNameIn(...parts) {
  const text = parts.filter(Boolean).join(' ');
  if (!text.trim()) return '';
  for (const [re, name] of BANK_NAMES) if (re.test(text)) return name;
  return '';
}

// The own-account rule for a transfer receipt (round 6, B6). When the sender and the
// beneficiary are both the user, this is their own money moving between their own
// accounts: an Own move, left out of spending, with nothing to ask them. Returns null
// when the receipt does not say that, so the normal path and, later, the credit side
// arriving decide it instead.
function receiptOwnMove(receipt, userName) {
  if (!receipt || !userName) return null;
  const sender = receipt.sender || '';
  const beneficiary = receipt.receiver || receipt.receiverRaw || '';
  if (!sender || !beneficiary) return null;
  if (!mentionsSelf(sender, userName) || !mentionsSelf(beneficiary, userName)) return null;
  const bank = bankNameIn(receipt.receivingBank, receipt.remark, (receipt.receiverBlock || []).join(' '), beneficiary);
  return { own: true, bank, label: bank ? `Moved to ${bank}` : 'Moved to another account of yours' };
}

module.exports = {
  detectTransfers, scorePair, routeKey, mentionsBank, mentionsSelf, receiptOwnMove, bankNameIn, AUTO, ASK,
};
