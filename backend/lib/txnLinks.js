'use strict';

// Linking (Round 6, brief 3.4; research doc section 2, "Linking rules").
//
// Merging says "these records are the same money". Linking says "these are two
// different movements of money that belong together": a move between the user's
// own accounts, a reversal, a refund, the bank charge on a transfer, or the cash
// spending broken out of a withdrawal.
//
// Every link records WHO made it and by WHICH rule, so Transaction detail can
// explain itself and the user can undo it (lib/linkUndo). Pure and
// dependency-free, so the whole of 3.4 is testable without a database.

const { normalizeCounterparty, jaroWinkler } = require('./dedupe');
const { mentionsSelf, mentionsBank, bankNameIn } = require('./internalTransfers');

const KINDS = ['ownMove', 'reversal', 'refund', 'fee', 'cash'];

const lc = (s) => (s || '').toString().toLowerCase();
const ms = (d) => new Date(d).getTime();
const minutesBetween = (a, b) => (ms(b) - ms(a)) / 60000;   // signed: b after a is positive
const daysBetween = (a, b) => (ms(b) - ms(a)) / 86400000;
const abs = (n) => Math.abs(Number(n) || 0);
const id = (t) => String(t._id != null ? t._id : t.id);

// A transaction's direction, whatever its `type` has been narrowed to. The sign
// of `amount` is kept true to the real direction everywhere in this codebase, so
// it is the honest fallback once a row has become internal_transfer or reversal.
function direction(t) {
  if (t.direction === 'debit' || t.direction === 'credit') return t.direction;
  if (t.type === 'income') return 'credit';
  if (t.type === 'expense') return 'debit';
  return Number(t.amount) >= 0 ? 'credit' : 'debit';
}
const isDebit = (t) => direction(t) === 'debit';
const isCredit = (t) => direction(t) === 'credit';

// The fee table [config]. Seeded with the Nigerian transfer fees and the 7.5% VAT
// figures on each, both the VAT alone (it is sometimes debited separately) and the
// VAT-inclusive total. Overridable so a changed CBN fee needs config, not a deploy.
const SEED_FEES = [6.98, 10, 25, 50];
const VAT_RATE = 0.075;
function buildFeeTable(seed) {
  const base = (seed && seed.length ? seed : SEED_FEES).map(abs).filter((n) => n > 0);
  const out = new Set();
  for (const n of base) {
    out.add(round2(n));
    out.add(round2(n * VAT_RATE));          // the VAT line on its own
    out.add(round2(n * (1 + VAT_RATE)));    // the VAT-inclusive total
  }
  return [...out].sort((a, b) => a - b);
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Read the table from config. `FEE_TABLE` is a comma-separated naira list.
function feeTableFromEnv(env) {
  const raw = ((env || {}).FEE_TABLE || '').toString().trim();
  if (!raw) return buildFeeTable(SEED_FEES);
  const seed = raw.split(',').map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n) && n > 0);
  return buildFeeTable(seed.length ? seed : SEED_FEES);
}

const DEFAULT_FEE_TABLE = buildFeeTable(SEED_FEES);
const FEE_TOLERANCE = 0.01;
function inFeeTable(amount, table) {
  const t = table && table.length ? table : DEFAULT_FEE_TABLE;
  const a = round2(abs(amount));
  return t.some((f) => Math.abs(f - a) <= FEE_TOLERANCE);
}

// Wording that says a debit is the bank's own charge rather than something bought.
const FEE_WORDS = /\b(fee|fees|charge|charges|commission|comm\.?|stamp\s*duty|stampduty|vat|levy|sms\s*alert|maintenance|ussd|session\s*charge|cot)\b/i;
const looksLikeFee = (t) => FEE_WORDS.test(lc(t.description)) || lc(t.category) === 'bank charges';

// Wording that says a credit is money coming back, not money earned.
const REVERSAL_WORDS = /\b(revers(al|ed|e)|refund(ed)?|returned|return\s*of|failed\s*(transaction|transfer)|declin(ed|e)|charge\s*back|chargeback|unsuccessful|rvsl)\b/i;
const looksLikeReversal = (t) => REVERSAL_WORDS.test(lc(t.description)) || t.type === 'reversal';

// ATM and POS-agent withdrawals: money that left the bank as cash.
const CASH_WORDS = /\b(atm|cash\s*(out|withdrawal|wdl)|withdrawal|pos\s*agent|agent\s*(cash|withdrawal))\b/i;
const looksLikeCashOut = (t) => t.type === 'cash_withdrawal'
  || (isDebit(t) && CASH_WORDS.test(lc(t.description)) && !/\bpur(chase)?\b|\bweb\b/i.test(lc(t.description)));

// Wallets and savings apps a transfer can fund. A debit naming one of these is a
// move into an account of the user's, not spending.
const WALLET_WORDS = [
  'opay', 'opay digital', 'paycom', 'palmpay', 'moniepoint', 'kuda', 'carbon', 'vbank', 'vfd',
  'alat', 'piggyvest', 'piggy vest', 'cowrywise', 'risevest', 'rise vest', 'owealth', 'sendcash',
  'chipper', 'grey', 'binance', 'quidax', 'luno', 'busha',
];
function namesWallet(text) {
  const s = lc(text);
  return WALLET_WORDS.find((w) => s.includes(w)) || '';
}
// Card or wallet funding gets the longer window the brief allows (60 minutes).
function isWalletFunding(debit, credit) {
  return !!(namesWallet(debit.description) || namesWallet(credit.description)
    || namesWallet(debit.bank) || namesWallet(credit.bank));
}

// Two rows are at the same account when the resolved account fingerprint matches,
// else when the bank name matches.
function sameAccount(a, b) {
  const ma = (a.accountMask || '').toString().replace(/\D/g, '');
  const mb = (b.accountMask || '').toString().replace(/\D/g, '');
  if (ma && mb) {
    if (ma !== mb) return false;
    if (a.bankCode && b.bankCode) return lc(a.bankCode) === lc(b.bankCode);
    return !a.bank || !b.bank || lc(a.bank) === lc(b.bank);
  }
  if (a.bankCode && b.bankCode) return lc(a.bankCode) === lc(b.bankCode);
  if (a.bank && b.bank) return lc(a.bank) === lc(b.bank);
  return false;
}
function differentAccount(a, b) {
  const ma = (a.accountMask || '').toString().replace(/\D/g, '');
  const mb = (b.accountMask || '').toString().replace(/\D/g, '');
  if (ma && mb && ma !== mb) return true;
  if (a.bankCode && b.bankCode && lc(a.bankCode) !== lc(b.bankCode)) return true;
  if (a.bank && b.bank && lc(a.bank) !== lc(b.bank)) return true;
  return false;
}

// Do two rows look like the same merchant? Used for refunds.
function sameMerchant(a, b) {
  const ca = normalizeCounterparty(a.counterparty || a.description || '');
  const cb = normalizeCounterparty(b.counterparty || b.description || '');
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  if (ca.includes(cb) || cb.includes(ca)) return true;
  return jaroWinkler(ca, cb) > 0.88;
}

// `from` and `to` may be a transaction or an id; either way a link stores ids.
function link(kind, from, to, rule, extra) {
  const key = (t) => (t && typeof t === 'object' ? id(t) : String(t));
  return Object.assign({
    kind, fromId: key(from), toId: key(to),
    createdBy: 'rule', rule, confidence: 'high',
  }, extra || {});
}

// ── Fee (brief 3.4) ───────────────────────────────────────────────────────────
// Debits at the same account within 2 minutes AFTER a parent, whose amount is in
// the fee table (or whose narration says it is a charge). Children of the parent.
function detectFeeLinks(txns, opts) {
  const o = opts || {};
  const table = o.feeTable || DEFAULT_FEE_TABLE;
  const windowMin = o.feeWindowMinutes != null ? o.feeWindowMinutes : 2;
  const debits = txns.filter(isDebit);
  const links = [];
  const claimed = new Set();
  // Smallest first, so a ₦10 charge is never treated as the parent of a ₦50 one.
  const fees = debits
    .filter((t) => inFeeTable(t.amount, table) || looksLikeFee(t))
    .sort((a, b) => abs(a.amount) - abs(b.amount));
  for (const fee of fees) {
    if (claimed.has(id(fee))) continue;
    const parents = debits.filter((p) => {
      if (id(p) === id(fee)) return false;
      if (claimed.has(id(p))) return false;
      if (abs(p.amount) <= abs(fee.amount)) return false;       // a parent is larger than its charge
      if (inFeeTable(p.amount, table) && looksLikeFee(p)) return false; // another charge, not a parent
      if (!sameAccount(p, fee)) return false;
      const gap = minutesBetween(p.date, fee.date);
      return gap >= 0 && gap <= windowMin;
    });
    if (parents.length !== 1) continue;                         // ambiguous: leave it alone
    const parent = parents[0];
    claimed.add(id(fee));
    links.push(link('fee', fee, parent, 'fee_after_parent', {
      reason: 'a bank charge at the same account right after this transaction',
      amount: round2(abs(fee.amount)),
    }));
  }
  return links;
}

// The detail line the brief asks for: "₦15,060 including ₦60 charges".
function feeSummary(parent, feeRows, formatMoney) {
  const total = (feeRows || []).reduce((s, f) => s + abs(f.amount), 0);
  if (!total) return '';
  const fmt = formatMoney || ((n) => '₦' + Math.round(n).toLocaleString('en-NG'));
  return fmt(abs(parent.amount) + total) + ' including ' + fmt(total) + ' charges';
}

// ── Reversal (brief 3.4) ──────────────────────────────────────────────────────
// A credit at the SAME account for the SAME amount within 72 hours, with reversal
// wording or the same reference. Both sides become Cancelled. A fee credit links
// to the fee it gives back.
function detectReversalLinks(txns, opts) {
  const o = opts || {};
  const hours = o.reversalWindowHours != null ? o.reversalWindowHours : 72;
  const credits = txns.filter(isCredit).sort((a, b) => ms(a.date) - ms(b.date));
  const debits = txns.filter(isDebit);
  const used = new Set();
  const links = [];
  for (const c of credits) {
    const refMatch = (d) => c.reference && d.reference && lc(c.reference) === lc(d.reference);
    const cands = debits.filter((d) => {
      if (used.has(id(d))) return false;
      if (Math.abs(abs(d.amount) - abs(c.amount)) > 0.5) return false;
      if (!sameAccount(d, c)) return false;
      const gap = minutesBetween(d.date, c.date) / 60;
      if (gap < 0 || gap > hours) return false;
      return looksLikeReversal(c) || refMatch(d);
    });
    if (!cands.length) continue;
    // Nearest in time, with a stated reference match preferred outright.
    cands.sort((x, y) => (refMatch(y) - refMatch(x))
      || minutesBetween(x.date, c.date) - minutesBetween(y.date, c.date));
    const d = cands[0];
    used.add(id(d));
    links.push(link('reversal', c, d, refMatch(d) ? 'reversal_same_reference' : 'reversal_window', {
      reason: refMatch(d)
        ? 'a credit with the same reference giving this back'
        : 'a credit at the same account giving this back',
      cancels: true,
    }));
  }
  return links;
}

// ── Own move (brief 3.4) ──────────────────────────────────────────────────────
// A debit at account A and a credit at account B, both the user's, the same amount
// (the credit may be smaller by a fee-table amount), within 10 minutes, or 60 for
// card-to-wallet funding. Auto-link when the counterparty is the user's own name or
// a wallet provider; otherwise ask once and save the answer as a rule.
function detectOwnMoveLinks(txns, opts) {
  const o = opts || {};
  const userName = o.userName || '';
  const routeKeys = o.routeKeys || new Set();
  const table = o.feeTable || DEFAULT_FEE_TABLE;
  const baseWindow = o.ownMoveWindowMinutes != null ? o.ownMoveWindowMinutes : 10;
  const fundingWindow = o.fundingWindowMinutes != null ? o.fundingWindowMinutes : 60;

  const debits = txns.filter(isDebit);
  const credits = txns.filter(isCredit);
  const cands = [];
  for (const d of debits) {
    for (const c of credits) {
      if (id(d) === id(c)) continue;
      if (!differentAccount(d, c)) continue;              // a move needs two accounts
      const da = abs(d.amount), ca = abs(c.amount);
      const shortfall = round2(da - ca);
      // Equal, or the credit smaller by a known fee.
      if (shortfall < 0) continue;
      if (shortfall > 0 && !inFeeTable(shortfall, table)) continue;
      const gap = minutesBetween(d.date, c.date);
      if (gap < 0) continue;                               // the debit happens first
      const funding = isWalletFunding(d, c);
      if (gap > (funding ? fundingWindow : baseWindow)) continue;

      const selfNamed = mentionsSelf(d.description, userName) || mentionsSelf(c.description, userName);
      const wallet = namesWallet(d.description) || namesWallet(c.description)
        || namesWallet(c.bank) || namesWallet(d.bank);
      const banksAgree = mentionsBank(d.description, c.bank) || mentionsBank(c.description, d.bank);
      const refMatch = !!(d.reference && c.reference && lc(d.reference) === lc(c.reference));
      const rk = routeKeyOf(d.bank, c.bank);
      const known = routeKeys.has && routeKeys.has(rk);

      let rule = null;
      if (refMatch) rule = 'own_move_same_reference';
      else if (selfNamed) rule = 'own_move_own_name';
      else if (wallet) rule = 'own_move_wallet_provider';
      else if (known) rule = 'own_move_saved_route';
      const auto = !!rule;
      if (!auto && !banksAgree) continue;                  // not even worth asking about
      cands.push({
        debit: d, credit: c, gap, auto,
        rule: rule || 'own_move_ask',
        fee: shortfall,
        wallet,
        reason: refMatch ? 'both sides carry the same bank reference'
          : selfNamed ? 'the other side is your own name'
            : wallet ? 'the other side is your ' + prettyWallet(wallet) + ' account'
              : known ? 'you told us this route is your own money'
                : 'a debit and a credit of the same amount minutes apart at two of your accounts',
      });
    }
  }
  // Strongest first (auto before ask), then nearest in time. Each row used once.
  cands.sort((x, y) => (y.auto - x.auto) || (x.gap - y.gap));
  const used = new Set();
  const links = [];
  const ask = [];
  for (const c of cands) {
    if (used.has(id(c.debit)) || used.has(id(c.credit))) continue;
    used.add(id(c.debit)); used.add(id(c.credit));
    const label = moveLabel(c.credit, c.debit);
    const payload = {
      reason: c.reason, fee: c.fee, label,
      routeKey: routeKeyOf(c.debit.bank, c.credit.bank),
    };
    if (c.auto) links.push(link('ownMove', c.debit, c.credit, c.rule, payload));
    else ask.push(Object.assign(link('ownMove', c.debit, c.credit, c.rule, payload), { confidence: 'ask' }));
  }
  return { links, ask };
}

function routeKeyOf(bankA, bankB) {
  return [lc(bankA) || '?', lc(bankB) || '?'].sort().join('|');
}
function prettyWallet(token) {
  return bankNameIn(token) || token.replace(/\b\w/g, (m) => m.toUpperCase());
}
// "Moved to Kuda", from whichever side names a bank we recognise.
function moveLabel(credit, debit) {
  const name = (credit && credit.bank && bankNameIn(credit.bank))
    || bankNameIn(debit && debit.description)
    || bankNameIn(credit && credit.description)
    || (credit && credit.bank) || '';
  return name ? 'Moved to ' + name : 'Moved to another account of yours';
}

// ── Refund (brief 3.4) ────────────────────────────────────────────────────────
// A credit from the same merchant within 90 days, equal to or less than one
// earlier debit. Linked only when exactly one debit matches: it reduces that
// category's spending and is never Income.
function detectRefundLinks(txns, opts) {
  const o = opts || {};
  const days = o.refundWindowDays != null ? o.refundWindowDays : 90;
  const credits = txns.filter(isCredit).sort((a, b) => ms(a.date) - ms(b.date));
  const debits = txns.filter(isDebit);
  const used = new Set();
  const links = [];
  const ask = [];
  for (const c of credits) {
    if (looksLikeCashOut(c)) continue;
    const cands = debits.filter((d) => {
      if (used.has(id(d))) return false;
      const gap = daysBetween(d.date, c.date);
      if (gap < 0 || gap > days) return false;
      if (abs(c.amount) > abs(d.amount) + 0.5) return false;   // a refund never exceeds the charge
      return sameMerchant(d, c);
    });
    if (!cands.length) continue;
    if (cands.length > 1) {
      // "If two or more earlier debits could match": ask, do not guess.
      ask.push({
        kind: 'refund_which',
        creditId: id(c),
        choices: cands
          .sort((x, y) => daysBetween(y.date, c.date) - daysBetween(x.date, c.date))
          .map((d) => ({ transactionId: id(d), amount: round2(abs(d.amount)), date: d.date, description: d.description })),
      });
      continue;
    }
    const d = cands[0];
    used.add(id(d));
    links.push(link('refund', c, d, 'refund_same_merchant', {
      reason: 'money back from the same place you paid',
      category: d.category || '',
    }));
  }
  return { links, ask };
}

// ── Cash (brief 3.4) ──────────────────────────────────────────────────────────
// An ATM or POS-agent withdrawal is an Own move into a Cash account; the manual
// cash spends broken out of it (the C4 flow, cashParentId) draw it down. Every
// child is linked to its withdrawal, and the leftover is what is still to log.
function detectCashLinks(txns) {
  const withdrawals = txns.filter(looksLikeCashOut);
  const byId = new Map(withdrawals.map((w) => [id(w), w]));
  const links = [];
  for (const t of txns) {
    const parentId = t.cashParentId ? String(t.cashParentId) : '';
    if (!parentId || !byId.has(parentId)) continue;
    links.push(link('cash', t, byId.get(parentId), 'cash_spend_of_withdrawal', {
      reason: 'spending logged against this cash withdrawal',
      amount: round2(abs(t.amount)),
    }));
  }
  return links;
}

// What is still unaccounted for on a cash withdrawal.
function cashRemaining(withdrawal, children) {
  const spent = (children || []).reduce((s, c) => s + abs(c.amount), 0);
  return round2(Math.max(0, abs(withdrawal.amount) - spent));
}

// ── Everything, in the order that keeps them from fighting ────────────────────
// Fees first, so the ₦10 and ₦50 beside a ₦15,000 transfer are charges and never
// mistaken for a move. Then reversals (a credit that gives money back is not a
// refund or an own move), then own moves, then refunds, then cash.
function detectLinks(txns, opts) {
  const rows = (txns || []).filter((t) => t && t.date != null);
  const o = opts || {};
  const feeLinks = detectFeeLinks(rows, o);
  const feeIds = new Set(feeLinks.map((l) => l.fromId));
  const afterFees = rows.filter((t) => !feeIds.has(id(t)));

  const reversalLinks = detectReversalLinks(afterFees, o);
  const reversalIds = new Set();
  reversalLinks.forEach((l) => { reversalIds.add(l.fromId); reversalIds.add(l.toId); });
  const afterReversals = afterFees.filter((t) => !reversalIds.has(id(t)));

  const own = detectOwnMoveLinks(afterReversals, o);
  const ownIds = new Set();
  own.links.forEach((l) => { ownIds.add(l.fromId); ownIds.add(l.toId); });
  const afterOwn = afterReversals.filter((t) => !ownIds.has(id(t)));

  const refund = detectRefundLinks(afterOwn, o);
  const cashLinks = detectCashLinks(rows);

  return {
    links: [].concat(feeLinks, reversalLinks, own.links, refund.links, cashLinks),
    ask: [].concat(own.ask, refund.ask),
  };
}

// The effect each link forces on the rows it touches, so the caller applies one
// rule rather than re-deciding per endpoint. 'type' is this codebase's existing
// Transaction.type, kept so nothing downstream has to change.
function effectOfLink(kind, side) {
  if (kind === 'ownMove') return { type: 'internal_transfer', countedIn: 'none' };
  if (kind === 'reversal') return { type: 'reversal', countedIn: 'none' };
  if (kind === 'fee') return side === 'from' ? { type: 'expense', category: 'Bank Charges', countedIn: 'spending' } : null;
  if (kind === 'refund') return side === 'from' ? { type: 'reversal', countedIn: 'none' } : null;
  if (kind === 'cash') return side === 'to' ? { type: 'cash_withdrawal', countedIn: 'none' } : null;
  return null;
}

// The copy shown on Transaction detail for a link, and the copy on its undo
// button. The brief fixes two of these; the rest follow the same voice.
const LINK_COPY = {
  ownMove: { title: 'Move between your accounts', undo: 'Not a move between my accounts' },
  reversal: { title: 'Reversed', undo: 'This was not reversed' },
  refund: { title: 'Refund', undo: 'This was not a refund' },
  fee: { title: 'Bank charge on this', undo: 'Not a charge on this' },
  cash: { title: 'Cash spending from this', undo: 'Not from this withdrawal' },
  merge: { title: 'Same transaction', undo: 'Not the same' },
};

module.exports = {
  KINDS, LINK_COPY,
  detectLinks, detectFeeLinks, detectReversalLinks, detectOwnMoveLinks, detectRefundLinks, detectCashLinks,
  feeSummary, cashRemaining, effectOfLink,
  buildFeeTable, feeTableFromEnv, inFeeTable, DEFAULT_FEE_TABLE, SEED_FEES, VAT_RATE,
  looksLikeFee, looksLikeReversal, looksLikeCashOut, namesWallet, isWalletFunding,
  sameAccount, differentAccount, sameMerchant, moveLabel, routeKeyOf, direction,
};
