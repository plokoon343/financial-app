'use strict';
// Re-running classification over rows that are already saved (round 6, B1).
//
// When a classification rule is corrected, the rows it already got wrong stay wrong
// in the database: B1's Apple charges were filed as cash_withdrawal ("cash out, not
// counted as spending") and stayed out of spending for good. This decides what one
// stored row should become under today's rules, and is deliberately narrow:
//
//   - it only ever moves a row OUT of a machine-assigned special kind, never into
//     one, so a row a person confirmed is never quietly re-typed;
//   - it only replaces a category the machine picked ('', Other, ATM/POS, Transfer),
//     so a category the user chose is never overwritten;
//   - a row the user has already acted on (reviewed, or cash they have broken down)
//     is left alone entirely.
//
// Returns the fields to set, or null when the row is already right.

const { classifyKind } = require('./txnKinds');
const { categorizeTransaction } = require('./categorize');
const { mentionsSelf } = require('./internalTransfers');

// Kinds this may undo. internal_transfer is not one of them for the classifyKind
// rule above: that pairing is a link between two rows, decided by
// lib/internalTransfers, not by one row's narration. The self-transfer check below
// is the one deliberate, narrow exception - see narrationIsSelfTransfer.
const MACHINE_KINDS = ['cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal', 'failed'];
// Categories the machine assigns when it has nothing better; anything else is either
// a user's choice or a confident merchant match, and is kept.
const MACHINE_CATEGORIES = ['', 'Other', 'Other Income', 'ATM/POS', 'Transfer'];

// income/expense underneath a special kind, from the stored sign.
const baseTypeOf = (row) => {
  if (row.type === 'income' || row.type === 'expense') return row.type;
  return Number(row.amount) > 0 ? 'income' : 'expense';
};

// A saved row's own narration states BOTH sides of a transfer as the same person
// (phone check P1/finding 2, 8 Nov 2026 - "transfer from CHIDUMEBI ONUKOGU to
// CHIDUMEBI ONUKOGU"): a self-transfer the narration itself declares, not one
// inferred by pairing with another row. Unlike internalTransfers.receiptOwnMove
// (which reads a parsed receipt's separate sender/receiver fields), this reads a
// flat, already-saved description directly - rows ingested before P1's parse-time
// fix threaded userName through the email/paste paths never got that benefit, and
// never will without a backfill. True only when the user's own name is named on
// BOTH a "to" segment and a "from" segment of the SAME narration - never guessed
// from one side alone, and never from a pairing with any other row.
function narrationIsSelfTransfer(description, userName) {
  const d = (description || '').toString();
  if (!d || !userName) return false;
  const segments = [...d.matchAll(/\b(to|from)\b\s*[:\-|]?\s*(.+?)(?=\s+\b(?:to|from)\b|$)/gi)];
  const toSelf = segments.some((m) => m[1].toLowerCase() === 'to' && mentionsSelf(m[2], userName));
  const fromSelf = segments.some((m) => m[1].toLowerCase() === 'from' && mentionsSelf(m[2], userName));
  return toSelf && fromSelf;
}

// `opts.userName`, when given, additionally checks the one own-move case above -
// optional because most callers (and most of this file's own tests) have no user
// context to pass, and the check is a no-op without a name to match against.
function reclassifyRow(row = {}, opts = {}) {
  if (!row || row.type === 'internal_transfer') return null;
  if (row.reviewedAt || row.cashAllocated || row.cashParentId) return null;
  const wasKind = MACHINE_KINDS.includes(row.type);
  if (!wasKind && row.type !== 'income' && row.type !== 'expense') return null;

  const base = baseTypeOf(row);
  const description = row.description || '';
  const category = row.category || '';
  const kind = classifyKind({ type: base, description, category });
  // Only undo a wrong kind. Promoting a plain row into a special kind here would
  // re-run every rule over the user's whole history, which this is not for - except
  // the self-transfer case, which is certain enough from the row's own text alone
  // (both "to" and "from" naming the account holder) to be the one exception, and
  // only when the row's category is still the machine's own guess, never a
  // category the user chose (the same rule the category refresh below follows).
  let nextType = wasKind ? (kind || base) : row.type;
  if (!wasKind && MACHINE_CATEGORIES.includes(category) && narrationIsSelfTransfer(description, opts.userName)) {
    nextType = 'internal_transfer';
  }

  let nextCategory = category;
  if (MACHINE_CATEGORIES.includes(category)) {
    const fresh = categorizeTransaction(description, base);
    if (fresh && !MACHINE_CATEGORIES.includes(fresh)) nextCategory = fresh;
  }

  const set = {};
  if (nextType !== row.type) set.type = nextType;
  // An own move is neither income nor spending, which is the whole reason it has
  // its own type (same rule the Action Center's own_move answer already follows) -
  // a fresh category guess for the narration that proved this would contradict that.
  if (nextCategory !== category && nextType !== 'internal_transfer') set.category = nextCategory;
  return Object.keys(set).length ? set : null;
}

module.exports = { reclassifyRow, narrationIsSelfTransfer, MACHINE_KINDS, MACHINE_CATEGORIES };
