// User-defined categories (round 6, part B item 5): saved server-side, per
// account, so a name typed via "Other" on any screen - web or mobile - shows up
// in every category picker afterwards, not just the browser it was typed in.
// A localStorage cache keeps the same categories visible on reload before the
// server answers (and offline); GET /api/categories is the source of truth.
import axios from 'axios';
import { API_URL } from '../config';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '../constants/categories';

const KEY = 'automonie_custom_categories';
// Sentinel option value that means "let me type a new category".
export const ADD_NEW = '__add_category__';

let cache = { expense: [], income: [] };
try {
  const v = JSON.parse(localStorage.getItem(KEY) || '{}');
  cache = { expense: Array.isArray(v.expense) ? v.expense : [], income: Array.isArray(v.income) ? v.income : [] };
} catch { /* keep the empty default */ }

const persistLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* ignore */ } };
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const baseFor = (type) => (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
const slot = (type) => (type === 'income' ? 'income' : 'expense');

// Fetch the server's list once per page load (called from App on sign-in). Safe
// to call again after sign-in as a different account.
export const loadCustomCategories = async () => {
  try {
    const { data } = await axios.get(`${API_URL}/api/categories`, { headers: authHeaders() });
    cache = { expense: data.expense || [], income: data.income || [] };
    persistLocal();
    window.dispatchEvent(new Event('categories-updated'));
  } catch { /* keep whatever was cached locally */ }
};

export const getCustomCategories = (type) => cache[slot(type)];

// Fixed categories + the user's custom ones (de-duped, case-insensitive).
export const allCategoriesFor = (type) => {
  const base = baseFor(type);
  const custom = cache[slot(type)].filter((c) => !base.some((b) => b.toLowerCase() === c.toLowerCase()));
  return [...base, ...custom];
};

// Add a custom category (no-op if blank or already present). Returns the trimmed
// name immediately (optimistic - the same screen can select it right away) and
// saves it to the account in the background.
export const addCustomCategory = (type, nameRaw) => {
  const name = (nameRaw || '').trim();
  if (!name) return '';
  const t = slot(type);
  const exists = [...baseFor(type), ...cache[t]].some((c) => c.toLowerCase() === name.toLowerCase());
  if (!exists) {
    cache = { ...cache, [t]: [...cache[t], name] };
    persistLocal();
    window.dispatchEvent(new Event('categories-updated'));
    axios.post(`${API_URL}/api/categories`, { name, type }, { headers: authHeaders() }).catch(() => {});
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
