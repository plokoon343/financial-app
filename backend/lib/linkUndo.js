'use strict';

// Undo (Round 6, brief 3.6).
//
// Every merge and every link is reversible from Transaction detail. "Not the
// same" splits a merge back into its observations; "Not a move between my
// accounts" unlinks a pair. Each undo is written into the correction pipeline, so
// the categoriser and the global consensus categorizer learn from it rather than
// making the same call again next week.
//
// This file is the pure part: given a transaction, its links and its merged
// sources, it says what the undo buttons are, what each one changes, and what
// correction it writes. server.js applies the result.

const { LINK_COPY, effectOfLink, direction } = require('./txnLinks');

const abs = (n) => Math.abs(Number(n) || 0);
const id = (t) => String(t._id != null ? t._id : t.id);

// The type a row goes back to once a link is undone. The sign of `amount` is kept
// true to the real direction everywhere in this codebase, so it is what restores
// income or expense without having to re-read the alert.
function restoredType(txn) {
  return direction(txn) === 'credit' ? 'income' : 'expense';
}

// ── What the user can undo on this transaction ────────────────────────────────
// undoOptions({ txn, links, sources }) -> [{ action, kind, label, linkId, otherId, correctionKind }]
//
// `links` are the link records stored on the transaction (either side of a pair);
// `sources` are its merged observations. Order is the order the buttons appear:
// the thing the system decided most recently and most visibly comes first.
function undoOptions(input) {
  const o = input || {};
  const txn = o.txn || {};
  const links = o.links || [];
  const sources = o.sources || [];
  const out = [];

  for (const l of links) {
    const copy = LINK_COPY[l.kind];
    if (!copy) continue;
    out.push({
      action: 'unlink',
      kind: l.kind,
      label: copy.undo,
      title: copy.title,
      linkId: l.id ? String(l.id) : '',
      otherId: String(String(l.fromId) === id(txn) ? l.toId : l.fromId),
      createdBy: l.createdBy || 'rule',
      rule: l.rule || '',
      correctionKind: correctionKindFor(l.kind),
    });
  }

  // A merge is undoable once there is more than one observation to split back out.
  if (sources.length > 1) {
    out.push({
      action: 'split',
      kind: 'merge',
      label: LINK_COPY.merge.undo,
      title: LINK_COPY.merge.title,
      sources: sources.map((s) => ({
        source: s.source, addedAt: s.addedAt, rule: s.rule || '', step: s.step || null,
        createdBy: s.createdBy || 'rule',
      })),
      correctionKind: 'merge',
    });
  }
  return out;
}

// The correction kind each undo writes. These are what the categoriser and the
// consensus layer read back, so they name what was wrong, not what was clicked.
function correctionKindFor(linkKind) {
  if (linkKind === 'ownMove') return 'own_move';
  if (linkKind === 'reversal') return 'reversal';
  if (linkKind === 'refund') return 'refund';
  if (linkKind === 'fee') return 'fee';
  if (linkKind === 'cash') return 'cash';
  return 'link';
}

// ── What unlinking changes ────────────────────────────────────────────────────
// planUnlink({ txn, other, link }) -> { updates: [{ id, set, unset }], deletes: [id], correction }
//
// `updates` are the rows to change and what to set on them; `deletes` are rows
// that only existed because of the link (a generated transfer-fee row). The
// correction is the record to write into the correction pipeline.
function planUnlink(input) {
  const o = input || {};
  const txn = o.txn;
  const other = o.other || null;
  const link = o.link || {};
  const updates = [];
  const deletes = [];

  const restore = (t) => ({ id: id(t), set: { type: restoredType(t) } });

  if (link.kind === 'ownMove') {
    updates.push(Object.assign(restore(txn), { unsetLink: true }));
    if (other) updates.push(Object.assign(restore(other), { unsetLink: true }));
    // A fee row generated for the pair goes with it: it was never a real alert.
    for (const g of (o.generated || [])) deletes.push(id(g));
  } else if (link.kind === 'reversal') {
    // Both sides come back: the debit is spending again and the credit is a credit.
    updates.push(Object.assign(restore(txn), { unsetLink: true }));
    if (other) updates.push(Object.assign(restore(other), { unsetLink: true }));
  } else if (link.kind === 'refund') {
    // The credit stops reducing that category and stands on its own again. It is
    // deliberately NOT turned into Income: the user said it was not a refund, not
    // that they earned it, so it goes back to the plain credit it arrived as.
    updates.push(Object.assign(restore(txn), { unsetLink: true }));
    if (other) updates.push({ id: id(other), unsetLink: true });
  } else if (link.kind === 'fee') {
    // The charge stays a charge; it just stops hanging off that parent.
    const feeSide = String(link.fromId) === id(txn) ? txn : other;
    if (feeSide) updates.push({ id: id(feeSide), unsetLink: true, set: {}, unset: { feeFor: '' } });
    const parentSide = String(link.fromId) === id(txn) ? other : txn;
    if (parentSide) updates.push({ id: id(parentSide), unsetLink: true });
  } else if (link.kind === 'cash') {
    // The spending row stops being drawn from that withdrawal, and the withdrawal
    // has cash to log again.
    const childSide = String(link.fromId) === id(txn) ? txn : other;
    const parentSide = String(link.fromId) === id(txn) ? other : txn;
    if (childSide) updates.push({ id: id(childSide), unsetLink: true, unset: { cashParentId: '' } });
    if (parentSide) updates.push({ id: id(parentSide), unsetLink: true, set: { cashAllocated: false } });
  } else {
    updates.push(Object.assign(restore(txn), { unsetLink: true }));
    if (other) updates.push({ id: id(other), unsetLink: true });
  }

  return {
    updates, deletes,
    correction: {
      kind: correctionKindFor(link.kind),
      from: link.kind + ':' + (link.rule || 'rule'),
      to: 'not_' + link.kind,
      description: txn.description || '',
      bankCode: txn.bankCode || '',
      madeBy: 'user',
      undoOf: link.createdBy || 'rule',
    },
    toast: undoToast(link.kind),
  };
}

// ── What splitting a merge changes ────────────────────────────────────────────
// planSplit({ txn, sources, keep }) -> { keepSource, newRows, correction }
//
// The transaction keeps its winning source; every other observation becomes its
// own transaction again, carrying the fields it actually stated. Nothing is
// thrown away, which is the point of keeping the observations in the first place.
function planSplit(input) {
  const o = input || {};
  const txn = o.txn || {};
  const sources = (o.sources || []).slice();
  if (sources.length < 2) {
    return { keepSource: sources[0] || null, newRows: [], correction: null, noop: true };
  }
  // Keep the one the user pointed at, else the richest source that won the amount.
  const keepIdx = o.keep != null
    ? sources.findIndex((s, i) => String(s.id || i) === String(o.keep) || s.source === o.keep)
    : 0;
  const keepAt = keepIdx >= 0 ? keepIdx : 0;
  const keepSource = sources[keepAt];
  const split = sources.filter((s, i) => i !== keepAt);
  const newRows = split.map((s) => ({
    date: s.eventTime || s.addedAt || txn.date,
    description: s.counterpartyRaw || txn.description || '',
    amount: s.direction === 'credit' ? abs(s.amountKobo / 100) : -abs(s.amountKobo / 100),
    type: s.direction === 'credit' ? 'income' : 'expense',
    category: txn.category || 'Other',
    source: s.source,
    bank: s.bank || txn.bank || '',
    bankCode: s.bankCode || txn.bankCode || '',
    accountMask: s.accountMask || txn.accountMask || '',
    reference: s.reference || '',
    splitFrom: id(txn),
  }));
  return {
    keepSource, newRows,
    correction: {
      kind: 'merge',
      from: 'merged:' + sources.map((s) => s.source).join('+'),
      to: 'split',
      description: txn.description || '',
      bankCode: txn.bankCode || '',
      madeBy: 'user',
      undoOf: (keepSource && keepSource.createdBy) || 'rule',
    },
    toast: 'Split back into ' + sources.length + ' transactions',
  };
}

function undoToast(kind) {
  if (kind === 'ownMove') return 'Back in your totals';
  if (kind === 'reversal') return 'No longer marked as reversed';
  if (kind === 'refund') return 'No longer marked as a refund';
  if (kind === 'fee') return 'No longer a charge on that transaction';
  if (kind === 'cash') return 'Back as cash to log';
  return 'Undone';
}

// ── The provenance a user actually reads ──────────────────────────────────────
// Transaction detail has to be able to say, in plain words, where this came from
// and why anything was decided for them. One function so web and mobile say the
// same thing.
function provenanceLines(input) {
  const o = input || {};
  const sources = o.sources || [];
  const links = o.links || [];
  const lines = [];
  if (sources.length) {
    lines.push({
      kind: 'sources',
      text: sources.length === 1
        ? 'Came from ' + sourceName(sources[0].source)
        : 'Came from ' + sources.map((s) => sourceName(s.source)).join(' and '),
    });
    for (const s of sources.slice(1)) {
      lines.push({
        kind: 'merge',
        text: joinedBecause(s),
        by: s.createdBy || 'rule',
        rule: s.rule || '',
      });
    }
  }
  for (const l of links) {
    const copy = LINK_COPY[l.kind];
    if (!copy) continue;
    lines.push({
      kind: 'link',
      linkKind: l.kind,
      text: copy.title + (l.reason ? ': ' + l.reason : ''),
      by: l.createdBy || 'rule',
      rule: l.rule || '',
      byText: (l.createdBy === 'user' ? 'You linked these' : 'Linked automatically')
        + (l.rule ? ' (' + ruleName(l.rule) + ')' : ''),
    });
  }
  return lines;
}

function joinedBecause(s) {
  const who = s.createdBy === 'user' ? 'You joined' : 'Joined';
  const name = sourceName(s.source);
  if (s.rule === 'reference') return who + ' the ' + name + ' record: it carries the same bank reference';
  if (s.rule === 'balance') return who + ' the ' + name + ' record: the same account at the same balance afterwards';
  if (s.rule === 'window') return who + ' the ' + name + ' record: the same account and payee, minutes apart';
  if (s.rule === 'statement') return who + ' the ' + name + ' row: the same transaction on your statement';
  return who + ' the ' + name + ' record';
}

function sourceName(s) {
  const map = {
    sms: 'a bank text', notification: 'a bank app alert', email: 'a forwarded email',
    share: 'something you shared', statement: 'your statement', import: 'your statement',
    manual: 'you', mono: 'your linked bank', receipt: 'a receipt',
  };
  return map[(s || '').toString().toLowerCase()] || 'another record';
}

function ruleName(rule) {
  const map = {
    own_move_own_name: 'the other side is your own name',
    own_move_wallet_provider: 'the other side is your wallet',
    own_move_same_reference: 'the same bank reference',
    own_move_saved_route: 'a route you confirmed before',
    own_move_ask: 'you confirmed it',
    reversal_same_reference: 'the same bank reference',
    reversal_window: 'a credit giving it back',
    refund_same_merchant: 'money back from the same place',
    fee_after_parent: 'a charge right after it',
    cash_spend_of_withdrawal: 'cash you logged',
    reference: 'the same bank reference',
    balance: 'the same balance afterwards',
    window: 'the same account, minutes apart',
  };
  return map[rule] || rule;
}

module.exports = {
  undoOptions, planUnlink, planSplit, provenanceLines, correctionKindFor,
  restoredType, sourceName, ruleName, undoToast,
};
