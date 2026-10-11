/*
 * Fill the Google Play reviewer's account with sample data (Launch Ops Pack, 1.3).
 *
 * Create the account yourself first (in the app, with a password only you and Play
 * Console know). This script never creates accounts or touches passwords. It finds the
 * account by email and adds, all fictional:
 *   - two accounts: Sample Bank (salary) and Sample Wallet (spending)
 *   - about 40 transactions over the last ~6 weeks: 2 salaries, 3 transfers in from
 *     friends, food delivery, groceries, transport, airtime and data, electricity, two
 *     subscriptions, transfers to 3 people, bank fees and stamp duty, and one move
 *     between the two accounts (not spending)
 *   - budgets (Food ₦40,000, Transport ₦25,000), a "Laptop fund" goal at 35%, two bills
 *   - 3 alerts waiting in the review stack (Action Center)
 * and sets the plan to Plus with no expiry and turns two-step email verification off
 * for this account only, so the reviewer isn't stuck at a code screen.
 *
 *   MONGODB_URI=... node backend/scripts/seed-play-review.js --email playreview@automonie.com --yes
 *   (optional) --end 2026-11-20   dates end on this day instead of today
 *
 * Re-running replaces the seeded transactions and review items (and only those).
 */
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i !== -1 ? args[i + 1] : undefined; };
const EMAIL = (opt('--email') || '').toLowerCase().trim();
const SEED = 'play-review-seed';

if (!EMAIL || !args.includes('--yes')) {
  console.error('Usage: node scripts/seed-play-review.js --email <reviewer account email> --yes [--end YYYY-MM-DD]');
  process.exit(1);
}

const end = opt('--end') ? new Date(`${opt('--end')}T12:00:00Z`) : new Date();
const daysAgo = (n, hour = 10) => { const d = new Date(end); d.setUTCDate(d.getUTCDate() - n); d.setUTCHours(hour, 0, 0, 0); return d; };

const BANK = { code: 'custom-sample-bank', name: 'Sample Bank', type: 'bank', mask: '1234', label: 'Salary account' };
const WALLET = { code: 'custom-sample-wallet', name: 'Sample Wallet', type: 'fintech', mask: '5678', label: 'Spending wallet' };

// [days ago, account, type, amount, description, category]
const ROWS = [
  [41, BANK, 'income', 150000, 'Salary: Brightpath Logistics', 'Salary'],
  [11, BANK, 'income', 150000, 'Salary: Brightpath Logistics', 'Salary'],
  [36, WALLET, 'income', 5000, 'Transfer from Tolu Ade', 'Family & Friends'],
  [22, WALLET, 'income', 3000, 'Transfer from Ngozi Eze', 'Family & Friends'],
  [6, WALLET, 'income', 7500, 'Transfer from Musa Ibrahim', 'Family & Friends'],
  [39, WALLET, 'expense', 4800, 'QuickChop Delivery order', 'Food'],
  [31, WALLET, 'expense', 6200, 'QuickChop Delivery order', 'Food'],
  [24, WALLET, 'expense', 3900, 'Mama Titi Kitchen delivery', 'Food'],
  [15, WALLET, 'expense', 5500, 'QuickChop Delivery order', 'Food'],
  [8, WALLET, 'expense', 4200, 'Mama Titi Kitchen delivery', 'Food'],
  [2, WALLET, 'expense', 6800, 'QuickChop Delivery order', 'Food'],
  [38, BANK, 'expense', 18500, 'FreshMart Supermarket', 'Groceries'],
  [27, BANK, 'expense', 12300, 'FreshMart Supermarket', 'Groceries'],
  [16, BANK, 'expense', 21700, 'FreshMart Supermarket', 'Groceries'],
  [4, BANK, 'expense', 9800, 'FreshMart Supermarket', 'Groceries'],
  [40, WALLET, 'expense', 2500, 'RideGo trip', 'Transport'],
  [35, WALLET, 'expense', 3100, 'RideGo trip', 'Transport'],
  [29, WALLET, 'expense', 1800, 'RideGo trip', 'Transport'],
  [23, WALLET, 'expense', 2700, 'RideGo trip', 'Transport'],
  [17, WALLET, 'expense', 3400, 'RideGo trip', 'Transport'],
  [12, WALLET, 'expense', 2200, 'RideGo trip', 'Transport'],
  [7, WALLET, 'expense', 2900, 'RideGo trip', 'Transport'],
  [1, WALLET, 'expense', 3600, 'RideGo trip', 'Transport'],
  [37, WALLET, 'expense', 1000, 'Airtime top-up', 'Airtime & Data'],
  [33, WALLET, 'expense', 3500, 'Data bundle 5GB', 'Airtime & Data'],
  [21, WALLET, 'expense', 1000, 'Airtime top-up', 'Airtime & Data'],
  [9, WALLET, 'expense', 3500, 'Data bundle 5GB', 'Airtime & Data'],
  [3, WALLET, 'expense', 500, 'Airtime top-up', 'Airtime & Data'],
  [34, BANK, 'expense', 15000, 'Prepaid electricity token', 'Utilities'],
  [30, BANK, 'expense', 2900, 'TuneBox Music subscription', 'Subscriptions'],
  [26, BANK, 'expense', 4400, 'StreamPlus subscription', 'Subscriptions'],
  [32, BANK, 'expense', 20000, 'Transfer to Chidi Okonkwo', 'Family & Friends'],
  [19, BANK, 'expense', 10000, 'Transfer to Amina Bello', 'Sent to people'],
  [10, BANK, 'expense', 15000, 'Transfer to Kemi Adebayo', 'Sent to people'],
  [32, BANK, 'expense', 10.75, 'NIP transfer fee', 'Bank Charges'],
  [32, BANK, 'expense', 50, 'FGN stamp duty', 'Bank Charges'],
  [19, BANK, 'expense', 10.75, 'NIP transfer fee', 'Bank Charges'],
  [10, BANK, 'expense', 10.75, 'NIP transfer fee', 'Bank Charges'],
  [5, BANK, 'expense', 4, 'SMS alert charge', 'Bank Charges'],
  [5, BANK, 'expense', 0.81, 'VAT on transfer fee', 'Bank Charges'],
];

const REVIEW = [
  'DR Alert: NGN2,500.00 POS PURCHASE SHOPRITE LEKKI. Bal: NGN45,320.50.',
  'NGN 6,000 sent to JOHN DOE via app',
  'Sample Bank: your account was charged NGN 1,200.00. Ref 88231.',
];

(async () => {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app');
  const db = mongoose.connection.db;
  const user = await db.collection('users').findOne({ email: EMAIL });
  if (!user) { console.error(`No account with ${EMAIL}. Create it in the app first.`); process.exit(1); }
  const userId = user._id;

  await db.collection('users').updateOne({ _id: userId }, {
    $set: {
      plan: 'pro', planExpiry: new Date('2099-12-31T00:00:00Z'), twoFactorEnabled: false,
      monthlyIncome: 150000, onboarded: true, emailVerified: true,
      customBanks: [BANK, WALLET].map((b) => ({ code: b.code, name: b.name, type: b.type })),
    },
    $unset: { loginOtpHash: 1, loginOtpExpiry: 1 },
  });

  for (const a of [BANK, WALLET]) {
    await db.collection('useraccounts').updateOne(
      { userId, bankCode: a.code, accountMask: a.mask },
      { $set: { bankName: a.name, label: a.label, active: true, hidden: false, deleted: false, addedByUser: true, lastSeen: new Date() }, $setOnInsert: { userId, bankCode: a.code, accountMask: a.mask, firstSeen: daysAgo(45), txnCount: 0 } },
      { upsert: true },
    );
  }

  const txns = db.collection('transactions');
  await txns.deleteMany({ userId, importBatch: SEED });
  const now = new Date();
  const doc = ([ago, acct, type, amount, description, category], extra = {}) => ({
    userId, date: daysAgo(ago), description, amount: type === 'income' ? amount : -amount, category, type,
    source: 'import', channel: 'statement', bank: acct.name, bankCode: acct.code, accountMask: acct.mask,
    importBatch: SEED, importedAt: now, createdAt: now, updatedAt: now, ...extra,
  });
  const docs = ROWS.map((r) => doc(r));
  // One move between the two accounts: both sides marked internal, so it's not spending.
  const pair = `seed-${userId}`;
  docs.push(doc([14, BANK, 'expense', 25000, 'Transfer to own Sample Wallet', 'Transfer'], { type: 'internal_transfer', transferPairId: pair }));
  docs.push(doc([14, WALLET, 'income', 25000, 'Transfer from own Sample Bank', 'Transfer'], { type: 'internal_transfer', transferPairId: pair, amount: 25000 }));
  await txns.insertMany(docs);
  for (const a of [BANK, WALLET]) {
    await db.collection('useraccounts').updateOne({ userId, bankCode: a.code, accountMask: a.mask }, { $set: { txnCount: docs.filter((d) => d.bankCode === a.code).length } });
  }

  const ym = (d) => d.toISOString().slice(0, 7);
  for (const month of [...new Set([ym(daysAgo(41)), ym(end)])]) {
    for (const [category, amount] of [['Food', 40000], ['Transport', 25000]]) {
      await db.collection('budgets').updateOne({ userId, month, category }, { $set: { amount, updatedAt: now }, $setOnInsert: { userId, month, category, createdAt: now } }, { upsert: true });
    }
  }
  const deadline = new Date(end); deadline.setUTCMonth(deadline.getUTCMonth() + 5);
  await db.collection('goals').updateOne({ userId, name: 'Laptop fund' }, { $set: { target: 500000, current: 175000, deadline, category: 'Electronics' }, $setOnInsert: { userId, name: 'Laptop fund', createdAt: now, notifiedMilestone: 25 } }, { upsert: true });
  const nextDue = (day) => { const d = new Date(end); d.setUTCDate(day); if (d < end) d.setUTCMonth(d.getUTCMonth() + 1); return d; };
  for (const [name, amount, day, category] of [['Electricity', 15000, 5, 'Utilities'], ['Internet', 18000, 20, 'Utilities']]) {
    await db.collection('recurringbills').updateOne({ userId, name }, { $set: { amount, dueDate: day, frequency: 'monthly', category, nextDue: nextDue(day), status: 'active' }, $setOnInsert: { userId, name, createdAt: now } }, { upsert: true });
  }

  const pending = db.collection('pendingalerts');
  await pending.deleteMany({ userId, reason: SEED });
  await pending.insertMany(REVIEW.map((raw, i) => ({
    userId, source: 'sms', raw, reason: SEED, createdAt: now,
    parsed: [
      { date: daysAgo(1).toISOString().slice(0, 10), description: 'POS PURCHASE SHOPRITE LEKKI', amount: 2500, type: 'expense', bank: '', directionKnown: true },
      { date: daysAgo(2).toISOString().slice(0, 10), description: 'JOHN DOE', amount: 6000, type: 'expense', bank: '', directionKnown: false },
      { date: daysAgo(3).toISOString().slice(0, 10), description: 'Sample Bank charge', amount: 1200, type: 'expense', bank: 'Sample Bank', directionKnown: true },
    ][i],
  })));

  console.log(`Seeded ${EMAIL}: ${docs.length} transactions, 2 accounts, 2 budgets a month, 1 goal, 2 bills, ${REVIEW.length} review items. Plan Plus (no expiry), two-step email off.`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
