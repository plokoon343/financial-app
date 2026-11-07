// The category catalogue (round 6, Block 3, section 5.1). This did not exist as a
// single file before this round: the valid-category list was duplicated by hand in
// backend/server.js (GLOBAL_ELIGIBLE_CATEGORIES), frontend/src/constants/categories.js
// and finpilot-mobile/src/constants/categories.ts, none of which carried a group,
// icon, colour token, effect or budgetable flag. This file is the one source for
// that metadata; the three plain-string lists stay as they are (each already keeps
// itself in sync by hand, per their own comments) and this adds to them rather than
// replacing them, so nothing that already reads a bare category string breaks.
//
// `id` is the STABLE identifier. For every category that already has live data
// under its current name, id === name: Transaction.category is a free-text field
// with no enum (checked: no schema-level category validation exists anywhere in
// server.js), so the stored string IS the id today, and changing that for existing
// rows would be the kind of blind, unverified migration this round's own rules warn
// against. "Rename keeps the id" is implemented as a presentation-layer lookup
// (displayNameFor, below) rather than a rewrite of every Transaction row: the stored
// id never changes, only what a user sees for it can.
//
// `colorToken` is a key, not a colour: each client resolves it against its own theme
// file (mobile's constants/colors.ts `featureColors`, a future web equivalent), so
// this file never holds a hex literal.
'use strict';

const GROUPS = ['Daily life', 'Home', 'People', 'You', 'Money', 'Work', 'Income', 'Fallback'];

// Every one of today's real category strings, now with the structure 5.1 asks for.
// Existing names and values are UNCHANGED - this is metadata added on top, not a
// rename. New categories (marked below) are genuinely new, so they get new ids.
const CATEGORIES = [
  // ── Spending: already live ──
  { id: 'Food', name: 'Food', group: 'Daily life', icon: 'restaurant', colorToken: 'food', effect: 'Spending', budgetable: true },
  { id: 'Groceries', name: 'Groceries', group: 'Daily life', icon: 'cart', colorToken: 'groceries', effect: 'Spending', budgetable: true },
  { id: 'Transport', name: 'Transport', group: 'Daily life', icon: 'car', colorToken: 'transport', effect: 'Spending', budgetable: true },
  { id: 'Fuel', name: 'Fuel', group: 'Daily life', icon: 'car-sport', colorToken: 'fuel', effect: 'Spending', budgetable: true },
  { id: 'Housing', name: 'Housing', group: 'Home', icon: 'home', colorToken: 'housing', effect: 'Spending', budgetable: true },
  { id: 'Utilities', name: 'Utilities', group: 'Home', icon: 'bulb', colorToken: 'utilities', effect: 'Spending', budgetable: true },
  { id: 'Airtime & Data', name: 'Airtime & Data', group: 'Daily life', icon: 'phone-portrait', colorToken: 'airtimeData', effect: 'Spending', budgetable: true },
  { id: 'Shopping', name: 'Shopping', group: 'You', icon: 'bag-handle', colorToken: 'shopping', effect: 'Spending', budgetable: true },
  { id: 'Healthcare', name: 'Healthcare', group: 'You', icon: 'medkit', colorToken: 'healthcare', effect: 'Spending', budgetable: true },
  { id: 'Entertainment', name: 'Entertainment', group: 'You', icon: 'game-controller', colorToken: 'entertainment', effect: 'Spending', budgetable: true },
  { id: 'Subscriptions', name: 'Subscriptions', group: 'You', icon: 'repeat', colorToken: 'subscriptions', effect: 'Spending', budgetable: true },
  { id: 'Education', name: 'Education', group: 'You', icon: 'school', colorToken: 'education', effect: 'Spending', budgetable: true },
  { id: 'Insurance', name: 'Insurance', group: 'Money', icon: 'shield-checkmark', colorToken: 'insurance', effect: 'Spending', budgetable: true },
  // Bank Charges and ATM/POS keep effect: 'Spending' and budgetable: true even
  // though neither is a category most people would put a budget on - today's
  // GLOBAL_ELIGIBLE_CATEGORIES in server.js already trusts a global-consensus vote
  // for both, and this file's GLOBAL_ELIGIBLE derivation (below) must reproduce that
  // exact membership, not a new opinion about what "budgetable" should mean here.
  { id: 'Bank Charges', name: 'Bank Charges', group: 'Money', icon: 'card', colorToken: 'bankCharges', effect: 'Spending', budgetable: true },
  { id: 'ATM/POS', name: 'ATM/POS', group: 'Money', icon: 'cash', colorToken: 'atmPos', effect: 'Spending', budgetable: true },
  { id: 'Transfer', name: 'Transfer', group: 'People', icon: 'swap-horizontal', colorToken: 'transfer', effect: 'Own move', budgetable: false },
  { id: 'Savings', name: 'Savings', group: 'Money', icon: 'lock-closed', colorToken: 'savings', effect: 'Own move', budgetable: false },
  { id: 'Family & Friends', name: 'Family & Friends', group: 'People', icon: 'people', colorToken: 'familyFriends', effect: 'Spending', budgetable: true },
  { id: 'Other', name: 'Other', group: 'Fallback', icon: 'pricetag', colorToken: 'other', effect: 'Spending', budgetable: true },

  // ── Spending: new (section 13's proposed list named a real gap; none of these
  //    replace or rename an existing category, so no existing row is affected) ──
  { id: 'Giving', name: 'Giving', group: 'People', icon: 'heart', colorToken: 'giving', effect: 'Spending', budgetable: true, isNew: true },
  { id: 'Betting', name: 'Betting', group: 'Money', icon: 'dice', colorToken: 'betting', effect: 'Spending', budgetable: true, isNew: true },
  { id: 'Gifts & Events', name: 'Gifts & Events', group: 'People', icon: 'gift-outline', colorToken: 'giftsEvents', effect: 'Spending', budgetable: true, isNew: true },

  // ── Income: already live ──
  { id: 'Salary', name: 'Salary', group: 'Income', icon: 'briefcase', colorToken: 'salary', effect: 'Income', budgetable: false },
  { id: 'Business', name: 'Business', group: 'Income', icon: 'business', colorToken: 'business', effect: 'Income', budgetable: false },
  { id: 'Freelance', name: 'Freelance', group: 'Income', icon: 'laptop', colorToken: 'freelance', effect: 'Income', budgetable: false },
  { id: 'Investment', name: 'Investment', group: 'Income', icon: 'trending-up', colorToken: 'investment', effect: 'Income', budgetable: false },
  // Deliberately not renamed/merged into the research doc's generic "Interest":
  // OWealth Interest already has its own detection rules (round 6, Block 4 section
  // 14) and a second, overlapping "Interest" category would just split one signal
  // into two for no gain.
  { id: 'OWealth Interest', name: 'OWealth Interest', group: 'Income', icon: 'trending-up', colorToken: 'owealthInterest', effect: 'Income', budgetable: false },
  { id: 'Gift', name: 'Gift', group: 'Income', icon: 'gift', colorToken: 'gift', effect: 'Income', budgetable: false },
  { id: 'Refund', name: 'Refund', group: 'Income', icon: 'return-down-back', colorToken: 'refund', effect: 'Income', budgetable: false },
  { id: 'Other Income', name: 'Other Income', group: 'Income', icon: 'ellipsis-horizontal', colorToken: 'otherIncome', effect: 'Income', budgetable: false },

  // ── Income: new ──
  { id: 'Allowance', name: 'Allowance', group: 'Income', icon: 'wallet', colorToken: 'allowance', effect: 'Income', budgetable: false, isNew: true },
  { id: 'Money from People', name: 'Money from People', group: 'Income', icon: 'people-circle', colorToken: 'moneyFromPeople', effect: 'Income', budgetable: false, isNew: true },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

const EXPENSE_CATEGORY_IDS = CATEGORIES.filter((c) => c.effect !== 'Income').map((c) => c.id);
const INCOME_CATEGORY_IDS = CATEGORIES.filter((c) => c.effect === 'Income').map((c) => c.id);

// The categories a global consensus vote may be trusted for (today's
// GLOBAL_ELIGIBLE_CATEGORIES in server.js, now derived from one list instead of
// typed out a second time). Never a person-to-person, own-move or catch-all
// category - the reasons are in server.js's own comment, unchanged by this file.
// New categories (Giving, Betting, Gifts & Events) start outside consensus trust
// on purpose: they have no history of real votes yet, and that is a product call
// for later, not something this file should decide by just existing in the list.
const GLOBAL_ELIGIBLE = CATEGORIES
  .filter((c) => c.budgetable && c.effect === 'Spending' && !c.isNew && c.id !== 'Other' && c.id !== 'Family & Friends')
  .map((c) => c.id);

function categoryById(id) { return BY_ID.get(id) || null; }

// The category's current display name for this user: their own rename if they have
// one, else the catalogue default. Pure - the caller supplies the rename map (from
// wherever it is stored) rather than this file knowing about Mongo.
function displayNameFor(id, renames) {
  const r = renames && typeof renames === 'object' ? renames[id] : null;
  if (r) return r;
  const c = BY_ID.get(id);
  return c ? c.name : id;
}

// The id a category's transactions should move to (merge/delete). Delete is "merge
// into Other" per 5.1 rule 4, with income's own fallback so an income row is never
// moved into a spending catch-all.
function fallbackFor(id) {
  const c = BY_ID.get(id);
  return c && c.effect === 'Income' ? 'Other Income' : 'Other';
}

module.exports = {
  GROUPS, CATEGORIES, EXPENSE_CATEGORY_IDS, INCOME_CATEGORY_IDS, GLOBAL_ELIGIBLE,
  categoryById, displayNameFor, fallbackFor,
};
