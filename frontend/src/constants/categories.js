// Single source of truth for transaction & budget categories.
// The backend categorizer (server.js) must output category names from these lists
// so that budgets, manual entries, and imported transactions all cross-check.
// The richer catalogue (id/group/icon/colour token/effect/budgetable) that round 6,
// Block 3 (section 5.1) added lives in backend/constants/categories.js; these two
// plain lists stay as the quick, framework-free source every component here already
// imports, widened with the same new categories rather than replaced.

export const EXPENSE_CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Fuel',
  'Housing',
  'Utilities',
  'Airtime & Data',
  'Shopping',
  'Healthcare',
  'Entertainment',
  'Subscriptions',
  'Education',
  'Insurance',
  'Bank Charges',
  'ATM/POS',
  'Transfer',
  'Savings',
  'Family & Friends',
  'Giving',
  'Betting',
  'Gifts & Events',
  'Other',
];

export const INCOME_CATEGORIES = [
  'Salary',
  'Allowance',
  'Business',
  'Freelance',
  'Investment',
  'OWealth Interest',
  'Money from People',
  'Gift',
  'Refund',
  'Other Income',
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

// Categories offered for a given transaction type.
export const categoriesFor = (type) =>
  type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
