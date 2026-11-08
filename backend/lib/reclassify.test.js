// Tests for re-running classification over already-saved rows (round 6, B1).
// The guardrail that matters here is what it REFUSES to change: a user's own
// category, a row they have confirmed, and anything it is not sure about.

const assert = require('assert');
const { reclassifyRow, narrationIsSelfTransfer } = require('./reclassify');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass += 1; };
const same = (name, got, want) => { assert.deepStrictEqual(got, want, `${name}: got ${JSON.stringify(got)}`); pass += 1; };

// --- B1: the Apple charges that were filed as cash out ----------------------
same('apple bill leaves cash and becomes a subscription',
  reclassifyRow({ type: 'cash_withdrawal', amount: -510, description: 'Web Pur @ -APPLE.COM/BILL 866-712-7753 CAUS', category: 'ATM/POS' }),
  { type: 'expense', category: 'Subscriptions' });
same('the second Apple charge too',
  reclassifyRow({ type: 'cash_withdrawal', amount: -1326, description: 'WEB PUR APPLE.COM/BILL', category: 'ATM/POS' }),
  { type: 'expense', category: 'Subscriptions' });
same('a POS purchase goes back to spending',
  reclassifyRow({ type: 'cash_withdrawal', amount: -4500, description: 'POS PUR 11 PLC FESTAC 23RD', category: 'ATM/POS' }),
  { type: 'expense' });

// --- a real withdrawal is left exactly as it is ------------------------------
check('ATM withdrawal stays cash', reclassifyRow({ type: 'cash_withdrawal', amount: -20000, description: 'ATM WITHDRAWAL LAGOS', category: 'ATM/POS' }) === null);
check('POS agent cash stays cash', reclassifyRow({ type: 'cash_withdrawal', amount: -10000, description: 'POS CASH AGENT 0012', category: 'ATM/POS' }) === null);

// --- never overwrite what the user decided -----------------------------------
same('a user category survives the type fix',
  reclassifyRow({ type: 'cash_withdrawal', amount: -510, description: 'WEB PUR APPLE.COM/BILL', category: 'Entertainment' }),
  { type: 'expense' });
check('a reviewed row is untouched', reclassifyRow({ type: 'cash_withdrawal', amount: -510, description: 'WEB PUR APPLE.COM/BILL', category: 'ATM/POS', reviewedAt: new Date() }) === null);
check('cash already broken down is untouched', reclassifyRow({ type: 'cash_withdrawal', amount: -20000, description: 'WEB PUR APPLE.COM/BILL', category: 'ATM/POS', cashAllocated: true }) === null);
check('a child of a cash withdrawal is untouched', reclassifyRow({ type: 'expense', amount: -3000, description: 'WEB PUR APPLE.COM/BILL', category: 'ATM/POS', cashParentId: 'abc' }) === null);

// --- scope: it only ever undoes a kind, never invents one --------------------
check('a plain expense is never promoted to cash', reclassifyRow({ type: 'expense', amount: -20000, description: 'ATM WITHDRAWAL LAGOS', category: 'Food' }) === null);
check('an internal transfer is left to the linker', reclassifyRow({ type: 'internal_transfer', amount: -84000, description: 'Moved to OPay', category: 'Transfer' }) === null);
check('an untouched ordinary row returns null', reclassifyRow({ type: 'expense', amount: -1200, description: 'CHOWDECK ORDER', category: 'Food' }) === null);

// --- phone check P1/finding 2: self-transfer stated by the row's own narration ---
same('a row whose narration names the user on both sides becomes an own move',
  reclassifyRow({ type: 'expense', amount: -100000, description: 'Transfer from CHIDUMEBI VINCENT ONUKOGU to CHIDUMEBI VINCENT ONUKOGU', category: 'Transfer' }, { userName: 'Chidumebi Vincent Onukogu' }),
  { type: 'internal_transfer' });
check('no userName means no self-transfer check at all', reclassifyRow({ type: 'expense', amount: -100000, description: 'Transfer from CHIDUMEBI ONUKOGU to CHIDUMEBI ONUKOGU', category: 'Transfer' }) === null);
check('one side only is never enough', !narrationIsSelfTransfer('Transfer to CHIDUMEBI ONUKOGU', 'Chidumebi Onukogu'));
check('a different name on the other side is never a self-transfer', !narrationIsSelfTransfer('Transfer from CHIDUMEBI ONUKOGU to ADA OKAFOR', 'Chidumebi Onukogu'));
same('a user-chosen category is never overridden by the self-transfer promotion',
  reclassifyRow({ type: 'expense', amount: -100000, description: 'Transfer from CHIDUMEBI ONUKOGU to CHIDUMEBI ONUKOGU', category: 'Housing' }, { userName: 'Chidumebi Onukogu' }),
  null);
check('a reviewed self-transfer row is still untouched', reclassifyRow({ type: 'expense', amount: -100000, description: 'Transfer from CHIDUMEBI ONUKOGU to CHIDUMEBI ONUKOGU', category: 'Transfer', reviewedAt: new Date() }, { userName: 'Chidumebi Onukogu' }) === null);

// --- an empty category still gets a real one when the rules know one ---------
same('a machine-default category is refreshed',
  reclassifyRow({ type: 'expense', amount: -2500, description: 'CHOWDECK ORDER LAGOS', category: 'Other' }),
  { category: 'Food' });
check('no guess means no change', reclassifyRow({ type: 'expense', amount: -2500, description: 'ZZZ 123', category: 'Other' }) === null);

console.log(`\n${pass} passed, 0 failed`);
