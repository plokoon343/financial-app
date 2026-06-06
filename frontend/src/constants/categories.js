// Single source of truth for transaction & budget categories.
// The backend categorizer (server.js) must output category names from these lists
// so that budgets, manual entries, and imported transactions all cross-check.

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
  'Other',
];

export const INCOME_CATEGORIES = [
  'Salary',
  'Business',
  'Freelance',
  'Investment',
  'Gift',
  'Refund',
  'Other Income',
];

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

// Categories offered for a given transaction type.
export const categoriesFor = (type) =>
  type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
