// Hand-rolled tests for the transaction-kind classifier (dep-free, run in CI via
// .github/workflows/lib-tests.yml). classifyKind decides whether a parsed row is
// ordinary income/expense or one of the special kinds that every income/expense
// aggregation must EXCLUDE. A wrong answer here silently hides or invents a number,
// so the rule is conservative: when unsure, return null (keep the row as-is).

const assert = require('assert');
const { classifyKind, KIND_TYPES } = require('./txnKinds');

let passed = 0;
const check = (name, got, want) => {
  assert.strictEqual(got, want, `${name}: expected ${want}, got ${got}`);
  passed += 1;
};
// Convenience: classify an expense/income row from just its description.
const kind = (type, description, category = '') => classifyKind({ type, description, category });

// --- failed / declined: never happened, either direction ---------------------
check('failed debit', kind('expense', 'Transaction failed - POS purchase at SHOPRITE'), 'failed');
check('declined', kind('expense', 'Your card was declined'), 'failed');
check('unsuccessful credit', kind('income', 'Transfer unsuccessful, not credited'), 'failed');
check('insufficient funds', kind('expense', 'Debit declined: insufficient funds'), 'failed');
check('was not successful', kind('expense', 'Payment was not successful'), 'failed');

// --- reversal / refund: a credit that gives money back, not income -----------
check('reversal', kind('income', 'REVERSAL of POS transaction'), 'reversal');
check('refund', kind('income', 'Refund from JUMIA order'), 'reversal');
check('refunded', kind('income', 'Your payment was refunded'), 'reversal');
check('chargeback', kind('income', 'Chargeback processed'), 'reversal');
// A reversal on the debit side is a credit-back too; failed takes precedence only
// when the row literally says failed. A plain "reversal" debit stays null (rare).

// --- loan_in: borrowed money received, not real income -----------------------
check('loan disbursement', kind('income', 'Loan disbursement from RenMoney'), 'loan_in');
check('okash credit', kind('income', 'OKash: NGN 20,000 has been credited'), 'loan_in');
check('fairmoney', kind('income', 'FairMoney loan approved and disbursed'), 'loan_in');
check('overdraft', kind('income', 'Overdraft advance credited'), 'loan_in');
check('paylater', kind('income', 'Carbon PayLater credit'), 'loan_in');

// --- debt_repayment: paying down a loan, not discretionary spend -------------
check('loan repayment', kind('expense', 'Loan repayment to Carbon'), 'debt_repayment');
check('loan deduction', kind('expense', 'Auto-debit for loan deduction'), 'debt_repayment');
check('okash repay', kind('expense', 'OKash loan repayment debited'), 'debt_repayment');
check('installment', kind('expense', 'Monthly instalment paid'), 'debt_repayment');
check('loan due', kind('expense', 'FairMoney loan due - repaid'), 'debt_repayment');

// --- cash_withdrawal: cash out, converted not spent --------------------------
check('atm', kind('expense', 'ATM withdrawal at GTB Ikeja'), 'cash_withdrawal');
check('cardless', kind('expense', 'Cardless withdrawal'), 'cash_withdrawal');
check('cash out', kind('expense', 'Cash-out at agent'), 'cash_withdrawal');

// --- ordinary rows must stay null (the honest-number guardrail) --------------
check('normal expense', kind('expense', 'POS purchase at SPAR'), null);
check('normal income', kind('income', 'Salary from ACME LTD'), null);
check('airtime is spend', kind('expense', 'Airtime purchase MTN'), null);
check('transfer to person', kind('expense', 'Transfer to JOHN DOE'), null);
check('empty text', kind('expense', ''), null);
check('no args', classifyKind(), null);
// A person named with a bank-ish token must not be misread as a special kind.
check('payee not lender', kind('expense', 'Transfer to ADVANCE ENTERPRISES', 'Shopping'), null);

// --- KIND_TYPES surface ------------------------------------------------------
check('kind types count', KIND_TYPES.length, 5);
assert.ok(KIND_TYPES.includes('loan_in') && KIND_TYPES.includes('debt_repayment'), 'KIND_TYPES complete');
passed += 1;

console.log(`txnKinds.test.js: ${passed} assertions passed`);
