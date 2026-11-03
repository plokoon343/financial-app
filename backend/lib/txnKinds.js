// Transaction "kind" classification (V1 categorisation must-haves). Some rows in a
// statement/SMS feed are NOT discretionary spending or real income: they just move
// or reshape money the user already had. Like `internal_transfer`, these get their
// own type so every `type:'expense'` / `type:'income'` aggregation excludes them
// automatically, keeping the numbers honest:
//   cash_withdrawal: cash out at an ATM: a conversion to cash, not spent yet
//   loan_in        : a loan/credit disbursement received: not real income
//   debt_repayment : repaying a loan/debt: not discretionary spend
//   reversal       : a refund/reversal credit: not income
//   failed         : a failed/declined transaction: it never happened
// Conservative keyword rules: when unsure, we leave the row as ordinary
// income/expense (a misclassify here would hide a real number, so we err toward
// keeping it).

const lc = (s) => (s || '').toString().toLowerCase();

// A failed/declined transaction never moved money, so it must not count either way.
const FAILED = /\b(failed|declined|unsuccessful|not successful|was not successful|transaction failed|timed out|transaction expired|insufficient fund(?:s)?|reversed due to)\b/;

// A credit that gives money back (refund/reversal) is not income.
const REVERSAL = /\b(reversal|reversal of|rvsl|reversed|refund(?:ed)?|charge ?back|returned)\b/;

// Cash pulled at an ATM/agent: converted to cash, not yet spent on anything.
const CASH_OUT = /\b(atm|atm withdrawal|cash wdl|cash withdrawal|cardless|cardless withdrawal|cash-?out|cash out|pos cash|cash advance)\b/;

// A card purchase is never cash, however the bank abbreviates it. Nigerian banks
// write a shop or online payment as "POS PUR", "WEB PUR", "VPOS" or "PURCHASE/POS",
// and the generic categoriser files all of those under the ATM/POS category. Reading
// cash off that category turned every card payment (apple.com/bill included) into
// "cash out, not counted as spending" - round 6, B1. Cash is now decided from the
// narration alone, and only when it does not read like a purchase.
const CARD_PURCHASE = /\b(web ?pur|pos ?pur|card ?pur|purchase|vpos|e-?commerce|web payment|online payment)\b|\b(?:apple|itunes|google|paypal)\.com\b|apple ?com ?bill/;

// Known Nigerian lending apps/products: used to recognise a disbursement received
// (loan_in) or a repayment paid (debt_repayment) even when the alert is terse.
const LENDERS = /\b(okash|fairmoney|fair ?money|palmcredit|palm ?credit|carbon|renmoney|ren ?money|quickcheck|quick ?check|aella|branch|migo|sokoloan|soko ?loan|kwikcash|kwik ?cash|newcredit|new ?credit|lendigo|creditville|specta|c24|credit ?direct)\b/;

// Money received that is borrowed, not earned.
const LOAN_IN = /\b(loan|disburse(?:ment|d)?|credit facility|pay ?later|overdraft|advance)\b/;

// Money paid back on a loan/debt (deliberately not counted as discretionary spend).
const DEBT_REPAY = /\b(loan repayment|debt repayment|loan deduction|loan due|repayment|repaid|pay ?back|instal?ment|instal?lment|auto-?debit(?: for)? loan)\b/;

// Returns an override type string for a special kind, or null to keep the row as
// its ordinary income/expense. `type` is the row's current 'income'|'expense'.
function classifyKind({ type, description, category } = {}) {
  const desc = lc(description);
  const text = `${desc} ${lc(category)}`.trim();
  if (!text) return null;

  // A failed/declined row never happened, whichever direction it claimed.
  if (FAILED.test(text)) return 'failed';

  if (type === 'income') {
    // Order matters: a refund reads as a credit but isn't income.
    if (REVERSAL.test(text)) return 'reversal';
    // A disbursement, or a credit clearly from a lending app, is borrowed money.
    if (LOAN_IN.test(text) || LENDERS.test(text)) return 'loan_in';
    return null;
  }

  // expense
  // Repayment language, or a debit to a known lender, is paying down debt, not spend.
  if (DEBT_REPAY.test(text) || (LENDERS.test(text) && /\b(loan|repay|debit|deduction|due)\b/.test(text))) return 'debt_repayment';
  // Cash from the narration only (never the category, which lumps card purchases in
  // with withdrawals), and never when the narration reads like a purchase.
  if (CASH_OUT.test(desc) && !CARD_PURCHASE.test(desc)) return 'cash_withdrawal';
  return null;
}

// The kinds this module produces (for enum/validation reuse).
const KIND_TYPES = ['cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal', 'failed'];

module.exports = { classifyKind, KIND_TYPES };
