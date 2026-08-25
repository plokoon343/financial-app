// Transaction "kind" classification (V1 categorisation must-haves). Some rows in a
// statement/SMS feed are NOT discretionary spending or real income — they just move
// or reshape money the user already had. Like `internal_transfer`, these get their
// own type so every `type:'expense'` / `type:'income'` aggregation excludes them
// automatically, keeping the numbers honest:
//   cash_withdrawal — cash out at an ATM: a conversion to cash, not spent yet
//   loan_in         — a loan/credit disbursement received: not real income
//   debt_repayment  — repaying a loan/debt: not discretionary spend
//   reversal        — a refund/reversal credit: not income
//   failed          — a failed/declined transaction: it never happened
// Conservative keyword rules — when unsure, we leave the row as ordinary
// income/expense (a misclassify here would hide a real number, so we err toward
// keeping it).

const lc = (s) => (s || '').toString().toLowerCase();

const FAILED = /\b(failed|declined|unsuccessful|not successful|timed out|transaction expired)\b/;
const REVERSAL = /\b(reversal|rvsl|reversed|refund|chargeback|charge ?back|returned)\b/;
const CASH_OUT = /\b(atm|cash wdl|cash withdrawal|cardless|cash-?out|cash out)\b/;
const LOAN_IN = /\b(loan|disburse(?:ment)?|credit facility|pay ?later|okash|fairmoney|palmcredit|carbon loan|renmoney|quickcheck|aella|branch loan)\b/;
const DEBT_REPAY = /\b(loan repayment|debt repayment|loan deduction|repayment|pay ?back|instal?lment)\b/;

// Returns an override type string for a special kind, or null to keep the row as
// its ordinary income/expense. `type` is the row's current 'income'|'expense'.
function classifyKind({ type, description, category } = {}) {
  const text = `${lc(description)} ${lc(category)}`.trim();
  if (!text) return null;

  if (FAILED.test(text)) return 'failed';

  if (type === 'income') {
    if (REVERSAL.test(text)) return 'reversal';
    if (LOAN_IN.test(text)) return 'loan_in';
    return null;
  }
  // expense
  if (DEBT_REPAY.test(text)) return 'debt_repayment';
  if (CASH_OUT.test(text)) return 'cash_withdrawal';
  return null;
}

// The kinds this module produces (for enum/validation reuse).
const KIND_TYPES = ['cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal', 'failed'];

module.exports = { classifyKind, KIND_TYPES };
