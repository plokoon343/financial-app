// Category rename, hide, merge and delete (round 6, Block 3, section 5.1 rules 1-6).
// Pure and dependency-free: every function here takes plain data in and returns a
// plan or a new piece of state out. The caller (server.js) does the actual Mongo
// reads/writes from the plan; nothing here touches a database, so the rules can be
// tested without one, same as every other lib this round.
'use strict';

const { categoryById, displayNameFor, fallbackFor } = require('../constants/categories');

// ---- 5.1 rule 1: rename keeps the id -------------------------------------------
// A rename never touches a stored Transaction/Budget/Rule row: it only changes what
// `displayNameFor` returns for that id from now on. Returns the new renames map
// (immutable: the caller persists it), or throws on a bad name.
function renamePatch(renames, id, newName) {
  const name = String(newName || '').trim();
  if (!name) throw new Error('A category needs a name.');
  if (name.length > 40) throw new Error('That name is too long.');
  return { ...(renames || {}), [id]: name };
}

// ---- 5.1 rule 2: hide removes it from pickers; history keeps it -----------------
function hidePatch(hidden, id, isHidden) {
  const set = new Set(hidden || []);
  if (isHidden) set.add(id); else set.delete(id);
  return [...set];
}

// Decorate any row (a transaction, a budget, a rule - anything carrying a plain
// `category` id string) with the display name this user currently sees for it.
// This is the one place "rename keeps the id" actually takes effect: callers never
// read `row.category` for display, only `decorate(row).categoryName`.
function decorateWithDisplayName(row, renames) {
  return { ...row, categoryName: displayNameFor(row.category, renames) };
}

// ---- 5.1 rules 3 and 4: merge and delete ----------------------------------------
// A plan, not an action: {fromId, intoId, matchesEffect} so the caller's Mongo
// update, and the undo record it should keep, both read off the same thing rather
// than two call sites quietly drifting apart on what "the merge" was.
function mergePlan(fromId, intoId) {
  if (!fromId || !intoId) throw new Error('Pick both categories.');
  if (fromId === intoId) throw new Error('Pick two different categories.');
  const from = categoryById(fromId);
  const into = categoryById(intoId);
  if (!from || !into) throw new Error('Unknown category.');
  if (from.effect === 'Income' && into.effect !== 'Income') {
    throw new Error('An income category can only merge into another income category.');
  }
  if (from.effect !== 'Income' && into.effect === 'Income') {
    throw new Error('A spending category can only merge into another spending category.');
  }
  return { op: 'merge', fromId, intoId };
}

// Delete is merge into Other / Other Income (5.1 rule 4), decided by the category's
// own effect so an income row never lands in the spending catch-all.
function deletePlan(id) {
  return mergePlan(id, fallbackFor(id));
}

// The undo record to keep for 24 hours (5.1 rules 3 and 4 both carry one). Takes the
// plan plus whatever ids the caller actually touched (transactions, and the budget/
// rule docs it moved), so the undo reverts exactly those rows and nothing added to
// the target category naturally in the meantime.
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
function undoRecord(plan, { transactionIds = [], budgetIds = [], ruleIds = [] } = {}, now = Date.now()) {
  return {
    op: plan.op, fromId: plan.fromId, intoId: plan.intoId,
    transactionIds: [...transactionIds], budgetIds: [...budgetIds], ruleIds: [...ruleIds],
    createdAt: new Date(now), expiresAt: new Date(now + UNDO_WINDOW_MS),
  };
}

function canUndo(record, now = Date.now()) {
  return !!record && new Date(record.expiresAt).getTime() > now;
}

// ---- 5.1 rule 6: "Other is eating your month" read, once --------------------
// Pure decision: given this month's Other share and whether it has already fired
// this calendar month, should the Automonie read show the card now? The month-key
// guard is what makes "never repeated" (C3) possible without this file knowing how
// the caller stores "already shown".
const OTHER_THRESHOLD = 0.15;
function shouldShowOtherReadCard({ otherShare, monthKey, lastShownMonthKey }) {
  if (otherShare < OTHER_THRESHOLD) return false;
  if (monthKey && lastShownMonthKey === monthKey) return false;
  return true;
}
function otherReadCardCopy(otherAmountNaira) {
  const amt = Math.round(otherAmountNaira).toLocaleString('en-NG');
  return `₦${amt} is in Other this month. Sort a few?`;
}

module.exports = {
  renamePatch, hidePatch, decorateWithDisplayName,
  mergePlan, deletePlan, undoRecord, canUndo, UNDO_WINDOW_MS,
  shouldShowOtherReadCard, otherReadCardCopy, OTHER_THRESHOLD,
};
