'use strict';
// Round 6, Block 3, section 5.1. Tests C1 to C3 exactly as the brief states them,
// plus the merge/delete/undo plumbing those tests exercise indirectly.

const {
  renamePatch, hidePatch, decorateWithDisplayName,
  mergePlan, deletePlan, undoRecord, canUndo,
  shouldShowOtherReadCard, otherReadCardCopy,
} = require('./categoryOps');
const { displayNameFor, fallbackFor, GLOBAL_ELIGIBLE } = require('../constants/categories');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── C1: Rename Food and groceries to Chop money -> all past rows, the budget and
//    the Shoprite rule show Chop money. ("Food and groceries" is the research doc's
//    proposed combined name; this app's real category is "Food", so the rename is
//    exercised on that - same mechanism, real id.) ──
{
  const renames = renamePatch({}, 'Food', 'Chop money');
  check('C1: display name is the rename', displayNameFor('Food', renames) === 'Chop money');

  const pastTxn = { _id: 't1', category: 'Food', amount: -4500 };
  const budget = { _id: 'b1', category: 'Food', amount: 20000 };
  const rule = { _id: 'r1', category: 'Food', merchantKey: 'shoprite' };
  check('C1: a past transaction shows the renamed category', decorateWithDisplayName(pastTxn, renames).categoryName === 'Chop money');
  check('C1: the budget shows the renamed category', decorateWithDisplayName(budget, renames).categoryName === 'Chop money');
  check('C1: the merchant rule (Shoprite) shows the renamed category', decorateWithDisplayName(rule, renames).categoryName === 'Chop money');
  check('C1: the stored id never changes', pastTxn.category === 'Food' && budget.category === 'Food' && rule.category === 'Food');

  check('rename: rejects an empty name', (() => { try { renamePatch({}, 'Food', '   '); return false; } catch { return true; } })());
}

// ── C2: Merge Fun and outings into Eating out, then undo within 24 hours ->
//    everything returns exactly as before. (Same substitution as above: this app's
//    categories are "Entertainment" and "Food"; the test merges Entertainment into
//    Food and undoes it, which is the identical mechanism C2 asks for.) ──
{
  const plan = mergePlan('Entertainment', 'Food');
  check('C2: merge plan names both sides', plan.fromId === 'Entertainment' && plan.intoId === 'Food');

  // Simulate the Mongo side: two transactions and one budget actually move.
  let txns = [
    { _id: 't1', category: 'Entertainment' },
    { _id: 't2', category: 'Entertainment' },
    { _id: 't3', category: 'Food' }, // already Food; untouched either way
  ];
  let budgets = [{ _id: 'b1', category: 'Entertainment' }];
  const movedTxnIds = txns.filter((t) => t.category === plan.fromId).map((t) => t._id);
  const movedBudgetIds = budgets.filter((b) => b.category === plan.fromId).map((b) => b._id);
  txns = txns.map((t) => (movedTxnIds.includes(t._id) ? { ...t, category: plan.intoId } : t));
  budgets = budgets.map((b) => (movedBudgetIds.includes(b._id) ? { ...b, category: plan.intoId } : b));
  check('C2: the two Entertainment transactions moved to Food', txns.filter((t) => t.category === 'Food').length === 3);
  check('C2: the budget moved to Food', budgets[0].category === 'Food');

  const record = undoRecord(plan, { transactionIds: movedTxnIds, budgetIds: movedBudgetIds }, Date.now());
  check('C2: undo is available right after the merge', canUndo(record));
  check('C2: undo is not available after 24 hours', !canUndo(record, Date.now() + 25 * 60 * 60 * 1000));

  // Undo: revert exactly the rows this merge moved, nothing else.
  txns = txns.map((t) => (record.transactionIds.includes(t._id) ? { ...t, category: record.fromId } : t));
  budgets = budgets.map((b) => (record.budgetIds.includes(b._id) ? { ...b, category: record.fromId } : b));
  check('C2: undo returns the two moved transactions to Entertainment', txns.filter((t) => t.category === 'Entertainment').length === 2);
  check('C2: the originally-Food transaction was never touched', txns.find((t) => t._id === 't3').category === 'Food');
  check('C2: undo returns the budget to Entertainment', budgets[0].category === 'Entertainment');

  check('merge: refuses to merge a category into itself', (() => { try { mergePlan('Food', 'Food'); return false; } catch { return true; } })());
  check('merge: refuses income into spending', (() => { try { mergePlan('Salary', 'Food'); return false; } catch { return true; } })());

  const del = deletePlan('Entertainment');
  check('delete: is a merge into Other', del.intoId === fallbackFor('Entertainment') && del.intoId === 'Other');
  const delIncome = deletePlan('Gift');
  check('delete: an income category merges into Other Income, not Other', delIncome.intoId === 'Other Income');
}

// ── C3: Other reaches 16% on the 20th -> one read card that month, never repeated ──
{
  check('C3: 16% in Other fires the card', shouldShowOtherReadCard({ otherShare: 0.16, monthKey: '2026-11', lastShownMonthKey: null }));
  check('C3: 14% does not fire it', !shouldShowOtherReadCard({ otherShare: 0.14, monthKey: '2026-11', lastShownMonthKey: null }));
  check('C3: already shown this month does not fire again', !shouldShowOtherReadCard({ otherShare: 0.20, monthKey: '2026-11', lastShownMonthKey: '2026-11' }));
  check('C3: a new month can fire it again', shouldShowOtherReadCard({ otherShare: 0.20, monthKey: '2026-12', lastShownMonthKey: '2026-11' }));
  check('C3: copy names the real amount, no emoji or em dash', otherReadCardCopy(18000) === '₦18,000 is in Other this month. Sort a few?');
}

// ── hide (5.1 rule 2) ──
{
  let hidden = hidePatch([], 'Entertainment', true);
  check('hide: adds the id', hidden.includes('Entertainment'));
  hidden = hidePatch(hidden, 'Entertainment', false);
  check('unhide: removes the id', !hidden.includes('Entertainment'));
}

// ── sanity: the derived GLOBAL_ELIGIBLE set is non-empty and holds no income or
//    person-to-person category, same as the Set this round replaced in server.js ──
{
  check('GLOBAL_ELIGIBLE: has real categories', GLOBAL_ELIGIBLE.length >= 14);
  check('GLOBAL_ELIGIBLE: excludes Transfer', !GLOBAL_ELIGIBLE.includes('Transfer'));
  check('GLOBAL_ELIGIBLE: excludes income', !GLOBAL_ELIGIBLE.includes('Salary'));
  check('GLOBAL_ELIGIBLE: excludes the new, unvoted-on categories', !GLOBAL_ELIGIBLE.includes('Betting') && !GLOBAL_ELIGIBLE.includes('Giving'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
