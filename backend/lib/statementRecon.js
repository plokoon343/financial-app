'use strict';

// Statement import and reconciliation (Round 6, brief 3.5).
//
// A statement is not a new set of transactions. It is a second account of money we
// have mostly already seen by SMS, by forwarded email or by a shared alert, so
// importing it must RECONCILE, not duplicate:
//
//   1. Balance gate first: opening + credits - debits = closing, or the file is
//      rejected with the gap named (lib/reconcile is that oracle, unchanged).
//   2. Match every row against what we already hold, using the merge ladder
//      (lib/mergeLadder, Block 2a), so a matched row becomes another source on an
//      existing transaction instead of a second transaction.
//   3. Rows that match nothing become new transactions, marked "Added from
//      statement".
//   4. Alerts inside the statement period with no row get flagged "Not on your
//      statement". That is the urgent one: it can be a fake credit alert.
//
// Pure and dependency-free. No per-bank knowledge lives here: the hybrid parser
// (deterministic, then LLM fallback, then the reconciliation oracle) has already
// turned the file into rows by the time this runs, and the ladder, not a second
// opinion of our own, decides what matches what.

const { reconcile } = require('./reconcile');
const { makeObservation, toNaira } = require('./observation');
const { mergeDecision } = require('./mergeLadder');

const ms = (d) => new Date(d).getTime();
const abs = (n) => Math.abs(Number(n) || 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const id = (t) => String(t._id != null ? t._id : t.id);
const money = (n) => '₦' + abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Sources that are a live alert about money moving. One of these with no statement
// row behind it is what step 4 flags.
const ALERT_SOURCES = ['sms', 'notification', 'email', 'share'];

// ── Step 1: the balance gate ──────────────────────────────────────────────────
// Returns { ok, verified, reconcile, detail } where `detail` is the user-facing
// copy. A file that does not balance is rejected with the gap named, and the caller
// offers "Try another file" rather than importing rows we know to be wrong.
function balanceGate(parsed) {
  const p = parsed || {};
  const result = reconcile({
    transactions: p.transactions || p.rows || [],
    openingBalance: p.openingBalance != null ? p.openingBalance : null,
    closingBalance: p.closingBalance != null ? p.closingBalance : null,
  });
  if (!result.checked) {
    // No balances to check against is not a failure: plenty of statements print
    // none. We import, and say plainly that we could not double-check it.
    return {
      ok: true, verified: false, reconcile: result,
      detail: 'This file does not print opening and closing balances, so we could not double-check it.',
    };
  }
  if (result.ok) {
    return {
      ok: true, verified: true, reconcile: result,
      detail: 'Checked: the transactions add up to the closing balance.',
    };
  }
  const gap = money(result.difference);
  const where = result.firstDivergenceIndex != null
    ? ' The first row that does not add up is row ' + (result.firstDivergenceIndex + 1) + '.'
    : '';
  return {
    ok: false, verified: true, reconcile: result,
    detail: 'This statement does not add up: it is out by ' + gap + '.' + where
      + ' A transaction is probably missing or printed twice, so we have not imported it.',
    action: 'Try another file',
  };
}

// Which ladder source a saved transaction counts as. The ladder reasons about where
// a record came from; this codebase stores that on `source` plus `channel`.
function observationSourceOf(t) {
  const s = (t.source || '').toString().toLowerCase();
  const ch = (t.channel || '').toString().toLowerCase();
  if (s === 'import') return ch === 'sms' ? 'sms' : 'statement';
  if (s === 'receipt') return 'share';
  if (['sms', 'notification', 'email', 'share', 'manual', 'mono', 'statement'].indexOf(s) !== -1) return s;
  if (['sms', 'notification', 'email', 'share', 'statement'].indexOf(ch) !== -1) return ch;
  return 'manual';
}

const directionOf = (t) => (t.type === 'income' || Number(t.amount) >= 0 ? 'credit' : 'debit');

// A saved transaction, as the one Observation we hold for it. Once Block 2a's
// observation ledger is storing them, the caller passes the real ones instead and
// this stays the fallback for rows saved before the ledger existed.
function observationOf(t) {
  return makeObservation({
    id: id(t),
    source: observationSourceOf(t),
    direction: directionOf(t),
    amount: abs(t.amount),
    eventTime: t.date,
    receivedAt: t.createdAt || t.date,
    balanceAfter: t.balance != null && t.balance !== '' ? t.balance : null,
    reference: t.reference || '',
    bankReference: t.bankReference || '',
    counterpartyRaw: t.counterparty || t.description || '',
    bank: t.bank || '',
    bankCode: t.bankCode || '',
    accountMask: t.accountMask || '',
    raw: t.raw || '',
  });
}

// A statement row, as an Observation.
function rowObservation(row, ctx) {
  const c = ctx || {};
  return makeObservation({
    id: 'row' + row._rowIndex,
    source: 'statement',
    direction: row.direction || (row.type === 'income' ? 'credit' : 'debit'),
    amount: abs(row.amount),
    eventTime: row.date,
    receivedAt: c.importedAt || row.date,
    balanceAfter: row.balance != null && row.balance !== '' ? row.balance : null,
    reference: row.reference || '',
    counterpartyRaw: row.counterparty || row.description || '',
    bank: row.bank || c.bank || '',
    bankCode: row.bankCode || c.bankCode || '',
    accountMask: row.accountMask || c.accountMask || '',
    raw: row.raw || row.rawText || '',
  });
}

// The ladder's `target` may come back as the transaction object, or as its id or
// index. Resolve it to the transaction we passed in, so this file does not care.
function resolveTarget(target, transactions) {
  if (target == null) return null;
  if (typeof target === 'object') {
    if (target.observations) return target;
    return transactions.find((t) => t === target) || null;
  }
  if (typeof target === 'number') return transactions[target] || null;
  const key = String(target);
  return transactions.find((t) => String(t.id) === key
    || (t.observations || []).some((o) => String(o.id) === key)) || null;
}

function txnIdOf(tx) {
  if (!tx) return '';
  if (tx.id) return String(tx.id);
  const first = (tx.observations || [])[0];
  return first ? String(first.id) : '';
}

// ── Steps 2 and 3: match the rows ─────────────────────────────────────────────
// matchRows({ rows, existing, bank, bankCode, accountMask }) ->
//   { matched: [{ row, transactionId, step, rule, reason }], added: [row], ask: [...] }
//
// `rows` are the statement's parsed rows; `existing` are the transactions already
// saved for this user in and around the period, whatever source they came from.
// Every decision is the ladder's: a statement row and an alert merge on the same
// value date plus or minus one day, which is step 4's own window for that pair.
function matchRows(input) {
  const o = input || {};
  const ctx = { bank: o.bank || '', bankCode: o.bankCode || '', accountMask: o.accountMask || '', importedAt: o.importedAt };
  const rows = (o.rows || []).map((r, i) => Object.assign({}, r, { _rowIndex: i }));
  const existing = o.existing || [];

  // Shape what we hold the way the ladder wants it: transactions, each made of its
  // observations. A transaction already claimed by one row is dropped from the pool,
  // so one statement row can never answer for two transactions.
  let pool = existing.map((t) => ({ id: id(t), observations: [observationOf(t)], source: observationSourceOf(t), _txn: t }));

  const matched = [];
  const added = [];
  const ask = [];

  for (const row of rows) {
    const obs = rowObservation(row, ctx);
    const decision = mergeDecision(obs, pool) || { action: 'new' };
    const action = decision.action;

    if (action === 'drop') {
      // The same statement row twice in one file. Nothing to add, nothing to ask.
      const target = resolveTarget(decision.target, pool);
      matched.push({
        row, transactionId: txnIdOf(target), step: decision.step || 1,
        rule: decision.reason || 'redelivery', reason: decision.reason || 'this row is already here',
        source: 'statement', dropped: true,
      });
      continue;
    }

    if (action === 'merge') {
      const target = resolveTarget(decision.target, pool);
      if (target) {
        pool = pool.filter((t) => t !== target);
        matched.push({
          row, transactionId: txnIdOf(target), step: decision.step || 4,
          rule: decision.reason || 'window', reason: decision.reason || 'the same transaction, already here',
          source: 'statement',
        });
        continue;
      }
      added.push(row);
      continue;
    }

    // The ladder's two questions are different questions, so they are two cards.
    // 'ask' is "two or more saved transactions could be this row". 'conflict' is
    // "the bank says this IS that one, and the two disagree about the amount or the
    // direction": one named transaction, no ambiguity about which.
    if (action === 'ask' || action === 'conflict') {
      const describe = (tx) => {
        const first = tx ? (tx.observations || [])[0] : null;
        return {
          transactionId: txnIdOf(tx),
          amount: first ? round2(toNaira(first.amountKobo)) : null,
          date: first ? new Date(first.eventTime) : null,
          description: first ? first.counterpartyRaw : '',
          source: first ? first.source : '',
          step: decision.step,
          rule: decision.reason || '',
        };
      };
      const statement = { amount: round2(abs(row.amount)), date: row.date, description: row.description || '' };
      if (action === 'conflict') {
        const target = resolveTarget(decision.target, pool);
        const c = decision.conflict || {};
        ask.push({
          kind: 'which_is_right', rowIndex: row._rowIndex, statement,
          transactionId: txnIdOf(target), saved: describe(target),
          field: c.field || '',
          // Kobo for an amount, 'debit'/'credit' for a direction; saved first.
          values: c.values || [], sources: c.sources || [],
          reason: conflictCopy(c, decision.reason),
        });
      } else {
        const choices = (decision.candidates || [])
          .map((c) => describe(resolveTarget(c && c.target != null ? c.target : c, pool)))
          .filter((c) => c.transactionId);
        ask.push({ kind: 'same_as', rowIndex: row._rowIndex, statement, choices });
      }
      // The row still enters the ledger, flagged, so the statement's own total stays
      // right. Merging it later is one tap; losing it would be a silent gap.
      added.push(Object.assign({}, row, { _needsReview: true, _ask: ask[ask.length - 1].kind }));
      continue;
    }

    added.push(row);
  }
  return { matched, added, ask };
}

// The words on a "Which is right?" card. The ladder gives kobo for an amount and
// 'debit'/'credit' for a direction, saved value first, so the copy can be exact
// rather than vague about what actually disagrees.
function conflictCopy(conflict, fallback) {
  const c = conflict || {};
  const vals = c.values || [];
  if (c.field === 'amount' && vals.length === 2) {
    return 'Same reference, two amounts: we have ' + money(toNaira(vals[0])) + ' and your statement says ' + money(toNaira(vals[1])) + '.';
  }
  if (c.field === 'direction' && vals.length === 2) {
    const word = (d) => (d === 'credit' ? 'money in' : 'money out');
    return 'Same reference, two directions: we have it as ' + word(vals[0]) + ' and your statement says ' + word(vals[1]) + '.';
  }
  return fallback || 'This row and what we already have disagree.';
}

// The second path to the same card. The ladder catches a disagreement BEFORE
// merging; lib/fieldWinners catches one AFTER, among observations already attached
// to one transaction. Both are the same question to the user, so both come out of
// one function and look identical on screen.
// fieldConflictCard(transactionId, resolved) -> card or null
function fieldConflictCard(transactionId, resolved) {
  const c = resolved && resolved.conflict;
  if (!c) return null;
  return {
    kind: 'which_is_right',
    transactionId: String(transactionId),
    field: c.field || '',
    values: c.values || [],
    sources: c.sources || [],
    reason: conflictCopy(c, 'The sources for this transaction disagree.'),
    from: 'field_winners',
  };
}

// ── Step 4: alerts with no statement row ──────────────────────────────────────
// Every alert-sourced transaction inside the statement period that no row matched.
// This is the fake-credit-alert check, so it is deliberately only raised for the
// account the statement covers, and only when the balance gate actually verified
// the file: an unverified statement is not evidence that a transaction did not happen.
function missingFromStatement(input) {
  const o = input || {};
  const existing = o.existing || [];
  const matchedIds = new Set((o.matched || []).map((m) => String(m.transactionId)));
  const from = o.periodStart != null ? ms(o.periodStart) : null;
  const to = o.periodEnd != null ? ms(o.periodEnd) : null;
  const bank = (o.bank || '').toString().toLowerCase();
  const bankCode = (o.bankCode || '').toString().toLowerCase();
  const mask = (o.accountMask || '').toString().replace(/\D/g, '');

  const out = [];
  for (const t of existing) {
    if (matchedIds.has(id(t))) continue;
    const src = observationSourceOf(t);
    if (ALERT_SOURCES.indexOf(src) === -1) continue;      // only a live alert can be a fake alert
    const when = ms(t.date);
    if (from != null && when < from) continue;
    if (to != null && when > to) continue;
    // The same account as the statement, as far as we can tell.
    const tMask = (t.accountMask || '').toString().replace(/\D/g, '');
    if (mask && tMask && mask !== tMask) continue;
    if (bankCode && t.bankCode && bankCode !== (t.bankCode || '').toLowerCase()) continue;
    if (!bankCode && bank && t.bank && bank !== (t.bank || '').toLowerCase()) continue;
    const dir = directionOf(t);
    out.push({
      transactionId: id(t),
      amount: round2(abs(t.amount)),
      date: t.date,
      description: t.description || '',
      direction: dir,
      source: src,
      // An unbacked CREDIT is the scam shape: an alert saying money arrived when the
      // bank's own statement says it never did.
      urgent: dir === 'credit',
      reason: 'This alert is not on your statement',
    });
  }
  return out;
}

// ── The whole of 3.5 in one call ──────────────────────────────────────────────
// reconcileStatement({ parsed, existing, bank, bankCode, accountMask, periodStart, periodEnd })
//   -> { gate, matched, added, missing, ask, period, rejected, summary }
//
// The caller applies it: `matched` rows are attached to their transaction as another
// source (with the rule recorded, so it is undoable), `added` rows are inserted
// marked "Added from statement", and `missing` becomes the urgent Action Center card.
function reconcileStatement(input) {
  const o = input || {};
  const parsed = o.parsed || {};
  const rows = parsed.transactions || parsed.rows || o.rows || [];
  const gate = balanceGate(Object.assign({}, parsed, { transactions: rows }));
  if (!gate.ok) {
    return { gate, matched: [], added: [], missing: [], ask: [], period: statementPeriod(rows, o), rejected: true, summary: gate.detail };
  }
  const period = statementPeriod(rows, o);
  const r = matchRows({
    rows, existing: o.existing || [], bank: o.bank, bankCode: o.bankCode,
    accountMask: o.accountMask, importedAt: o.importedAt,
  });
  const missing = gate.verified
    ? missingFromStatement({
      existing: o.existing || [], matched: r.matched,
      periodStart: period.start, periodEnd: period.end,
      bank: o.bank, bankCode: o.bankCode, accountMask: o.accountMask,
    })
    : [];
  return {
    gate, matched: r.matched, added: r.added, missing, ask: r.ask, period,
    rejected: false,
    summary: summaryLine({ matched: r.matched, added: r.added, missing, ask: r.ask }),
  };
}

// The period the statement covers: whatever it stated, else the span of its rows.
function statementPeriod(rows, o) {
  const opts = o || {};
  if (opts.periodStart != null && opts.periodEnd != null) {
    return { start: new Date(opts.periodStart), end: new Date(opts.periodEnd) };
  }
  const times = (rows || []).map((r) => ms(r.date)).filter((n) => !isNaN(n));
  if (!times.length) return { start: null, end: null };
  // Give the ends a day of slack, the same slack the ladder gives a value date.
  return {
    start: new Date(Math.min.apply(null, times) - 86400000),
    end: new Date(Math.max.apply(null, times) + 86400000),
  };
}

function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

function summaryLine(r) {
  const parts = [];
  if (r.added.length) parts.push(plural(r.added.length, 'transaction', 'transactions') + ' added from your statement');
  if (r.matched.length) parts.push(plural(r.matched.length, 'row', 'rows') + ' matched what you already had');
  if (r.ask.length) parts.push(plural(r.ask.length, 'row needs', 'rows need') + ' a quick look');
  if (r.missing.length) parts.push(plural(r.missing.length, 'alert is', 'alerts are') + ' not on your statement');
  return parts.length ? parts.join(', ') : 'Nothing new on this statement.';
}

// The label a row added by a statement carries, so the list can say where it came
// from rather than leaving the user to work it out.
const ADDED_FROM_STATEMENT = 'Added from statement';
const NOT_ON_STATEMENT = 'Not on your statement';

module.exports = {
  balanceGate, matchRows, missingFromStatement, reconcileStatement, statementPeriod,
  observationSourceOf, observationOf, rowObservation, summaryLine, conflictCopy, fieldConflictCard,
  ADDED_FROM_STATEMENT, NOT_ON_STATEMENT, ALERT_SOURCES,
};
