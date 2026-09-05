// Neutral display for transaction KINDS that are neither income nor expense and are
// excluded from the money math (mirrors the mobile app's KIND_META). Gives each a
// plain-language label + the symbol shown in the amount column, so the row reads
// honestly ("not counted") instead of masquerading as a red expense.
const KIND_META = {
  internal_transfer: { label: 'Transfer between your accounts', symbol: '⇄' },
  cash_withdrawal:   { label: 'Cash out · not counted as spending', symbol: '⤴' },
  loan_in:           { label: 'Loan received · not counted as income', symbol: '↩' },
  debt_repayment:    { label: 'Debt repayment · not discretionary', symbol: '↪' },
  reversal:          { label: 'Reversed · nets to zero, not counted', symbol: '↺' },
  failed:            { label: 'Failed · didn’t go through', symbol: '⊘' },
};

// Returns the meta for an excluded kind, or null for plain income/expense.
export const kindMeta = (type) => KIND_META[type] || null;

// True when a row is excluded from income/expense totals.
export const isExcludedKind = (type) => !!KIND_META[type];
