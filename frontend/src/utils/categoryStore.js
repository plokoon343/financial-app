// User-defined categories, persisted in localStorage and merged with the fixed
// lists in constants/categories.js. Lets the add/edit forms and Budget offer
// custom categories the user types in.
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants/categories';

const KEY = 'automonie_custom_categories';
// Sentinel option value that means "let me type a new category".
export const ADD_NEW = '__add_category__';

const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { expense: Array.isArray(v.expense) ? v.expense : [], income: Array.isArray(v.income) ? v.income : [] };
  } catch {
    return { expense: [], income: [] };
  }
};
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* ignore */ } };
const baseFor = (type) => (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
const slot = (type) => (type === 'income' ? 'income' : 'expense');

export const getCustomCategories = (type) => read()[slot(type)];

// Fixed categories + the user's custom ones (de-duped, case-insensitive).
export const allCategoriesFor = (type) => {
  const base = baseFor(type);
  const custom = read()[slot(type)].filter((c) => !base.some((b) => b.toLowerCase() === c.toLowerCase()));
  return [...base, ...custom];
};

// Add a custom category (no-op if blank or already present). Returns the trimmed
// name so callers can select it immediately.
export const addCustomCategory = (type, nameRaw) => {
  const name = (nameRaw || '').trim();
  if (!name) return '';
  const t = slot(type);
  const store = read();
  const exists = [...baseFor(type), ...store[t]].some((c) => c.toLowerCase() === name.toLowerCase());
  if (!exists) {
    store[t] = [...store[t], name];
    write(store);
    window.dispatchEvent(new Event('categories-updated'));
  }
  return name;
};

// Convenience for select onChange handlers: if the user picked "Add new…",
// prompt for a name, persist it, and return it; otherwise return the value.
export const resolveCategoryChoice = (type, value) => {
  if (value !== ADD_NEW) return value;
  const name = (typeof window !== 'undefined' ? window.prompt('New category name:') : '') || '';
  return addCustomCategory(type, name);
};
