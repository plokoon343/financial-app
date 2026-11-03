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

// Kinds this may undo. internal_transfer is not one of them: that is a link between
// two rows, decided by lib/internalTransfers, not by narration.
const MACHINE_KINDS = ['cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal', 'failed'];
// Categories the machine assigns when it has nothing better; anything else is either
// a user's choice or a confident merchant match, and is kept.
const MACHINE_CATEGORIES = ['', 'Other', 'Other Income', 'ATM/POS', 'Transfer'];

// income/expense underneath a special kind, from the stored sign.
const baseTypeOf = (row) => {
  if (row.type === 'income' || row.type === 'expense') return row.type;
  return Number(row.amount) > 0 ? 'income' : 'expense';
};

function reclassifyRow(row = {}) {
  if (!row || row.type === 'internal_transfer') return null;
  if (row.reviewedAt || row.cashAllocated || row.cashParentId) return null;
  const wasKind = MACHINE_KINDS.includes(row.type);
  if (!wasKind && row.type !== 'income' && row.type !== 'expense') return null;

  const base = baseTypeOf(row);
  const description = row.description || '';
  const category = row.category || '';
  const kind = classifyKind({ type: base, description, category });
  // Only undo a wrong kind. Promoting a plain row into a special kind here would
  // re-run every rule over the user's whole history, which this is not for.
  const nextType = wasKind ? (kind || base) : row.type;

  let nextCategory = category;
  if (MACHINE_CATEGORIES.includes(category)) {
    const fresh = categorizeTransaction(description, base);
    if (fresh && !MACHINE_CATEGORIES.includes(fresh)) nextCategory = fresh;
  }

  const set = {};
  if (nextType !== row.type) set.type = nextType;
  if (nextCategory !== category) set.category = nextCategory;
  return Object.keys(set).length ? set : null;
}

module.exports = { reclassifyRow, MACHINE_KINDS, MACHINE_CATEGORIES };
