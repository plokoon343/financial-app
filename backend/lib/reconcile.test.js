'use strict';
// Run: node backend/lib/reconcile.test.js
const { reconcile, extractBalances, findLabeledBalance } = require('./reconcile');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const tx = (type, amount, balance) => ({ type, amount, balance });

// --- the equation check ---
// opening 1000, +5000 credit, -2000 debit -> closing 4000. Balances.
const balanced = reconcile({
  transactions: [tx('income', 5000, 6000), tx('expense', 2000, 4000)],
  openingBalance: 1000, closingBalance: 4000,
});
check('balanced -> checked', balanced.checked === true);
check('balanced -> ok', balanced.ok === true);
check('balanced -> computedClosing 4000', balanced.computedClosing === 4000);
check('balanced -> difference 0', balanced.difference === 0);

// A dropped transaction: closing says 4000 but we only parsed the credit -> off by 2000.
const dropped = reconcile({
  transactions: [tx('income', 5000, 6000)],
  openingBalance: 1000, closingBalance: 4000,
});
check('dropped -> not ok', dropped.checked === true && dropped.ok === false);
check('dropped -> difference +2000', dropped.difference === 2000);

// A misread amount: debit parsed as 200 instead of 2000 -> off by 1800.
const misread = reconcile({
  transactions: [tx('income', 5000, 6000), tx('expense', 200, 4000)],
  openingBalance: 1000, closingBalance: 4000,
});
check('misread -> not ok', misread.ok === false);
// under-read the debit (200 vs 2000) -> we subtracted too little -> computed is higher
check('misread -> difference +1800', misread.difference === 1800);

// --- error localisation via running balance ---
// Second row's stated balance (9999) doesn't match the running balance (4000).
const diverge = reconcile({
  transactions: [tx('income', 5000, 6000), tx('expense', 2000, 9999)],
  openingBalance: 1000, closingBalance: 4000,
});
check('diverge -> row index 1', diverge.firstDivergenceIndex === 1);

// No divergence when every running balance lines up.
check('no diverge on clean rows', balanced.firstDivergenceIndex === null);

// --- honest "cannot verify" when balances are missing ---
const noInfo = reconcile({ transactions: [tx('expense', 500, null)], openingBalance: null, closingBalance: null });
check('no balances -> not checked', noInfo.checked === false && noInfo.ok === null);

// kobo rounding tolerance
const kobo = reconcile({
  transactions: [tx('income', 100.10, 1100.10), tx('expense', 0.10, 1100.00)],
  openingBalance: 1000, closingBalance: 1100,
});
check('kobo rounding -> ok', kobo.ok === true);

// --- balance extraction from raw text ---
const stmtText = `
Account Statement
Opening Balance NGN 12,500.00
03-Jul-2026  NIP TRF FROM X  5,000.00  17,500.00
04-Jul-2026  POS PURCHASE    2,000.00  15,500.00
Closing Balance NGN 15,500.00
`;
const bals = extractBalances(stmtText);
check('extract opening', bals.openingBalance === 12500);
check('extract closing', bals.closingBalance === 15500);

// closing keeps the LAST labelled figure (summaries sometimes repeat it)
check('closing takes last', findLabeledBalance('closing balance 100.00 ... closing balance 250.00', ['closing balance'], { last: true }) === 250);
check('opening takes first', findLabeledBalance('opening balance 100.00 ... opening balance 250.00', ['opening balance'], { last: false }) === 100);
check('missing label -> null', extractBalances('no balances here').closingBalance === null);

// end-to-end: parse-shaped ledger reconciles against extracted balances
const e2e = reconcile({
  transactions: [tx('income', 5000, 17500), tx('expense', 2000, 15500)],
  ...extractBalances(stmtText),
});
check('e2e -> ok', e2e.ok === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
