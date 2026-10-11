// Plans and what each one unlocks. Pure; every gate in the server asks hasFeature().
//
//   Free     the core app
//   Plus     the paid plan (stored as plan 'pro', its original name)
//   Student  Plus features for verified students and corps members: free for the first
//            3 months, then a lower monthly price; needs a current verification
//   Pro      bank sync on top of Plus (stored as 'sync'; 'pro' is taken by Plus)
//   Power    everything in Pro, 3 banks, 12 syncs a month, priority support
//   Trial    every new account gets Plus for the first 14 days, no card needed
//
// Launch sells Free, Student and Plus. Pro and Power show as "Coming soon" until bank
// sync is switched on (BANK_SYNC_ENABLED=true) and they have a price.
// Prices and lengths come from config (env), so they change without a release:
// PLUS_PRICE_NAIRA (falls back to PRO_PRICE_NAIRA), STUDENT_PRICE_NAIRA,
// SYNC_PRICE_NAIRA (Pro), POWER_PRICE_NAIRA, STUDENT_FREE_DAYS, TRIAL_DAYS.
'use strict';

const DAY = 86400000;

// Feature keys the server gates on.
const PLUS_FEATURES = ['report', 'cancel', 'ai-purpose', 'receipts', 'ask-money'];
// Pro and Power add bank sync on top of Plus.
const SYNC_FEATURES = [...PLUS_FEATURES, 'bank-link'];
const FEATURE_LABELS = {
  report: 'Export your income and financial report as a PDF',
  cancel: 'Guided subscription cancellation, and we confirm the charge stopped',
  'ai-purpose': 'Smart suggestions for what your transfers were for',
  receipts: 'Scan receipts and cash spending',
  'bank-link': 'Link your bank for automatic imports',
  'ask-money': 'Ask questions about your money in plain words',
};

function config(env = process.env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    plusPrice: num(env.PLUS_PRICE_NAIRA, num(env.PRO_PRICE_NAIRA, 1500)),
    studentPrice: num(env.STUDENT_PRICE_NAIRA, 700),
    syncPrice: num(env.SYNC_PRICE_NAIRA, 0),
    powerPrice: num(env.POWER_PRICE_NAIRA, 7000),
    bankSync: env.BANK_SYNC_ENABLED === 'true',
    studentFreeDays: num(env.STUDENT_FREE_DAYS, 90),
    trialDays: num(env.TRIAL_DAYS, 14),
  };
}

// The plans as shown to people. code is what's stored on the user.
function catalog(cfg = config()) {
  return [
    { code: 'free', name: 'Free', priceNaira: 0, features: [] },
    { code: 'pro', name: 'Plus', priceNaira: cfg.plusPrice, features: PLUS_FEATURES },
    { code: 'student', name: 'Student', priceNaira: cfg.studentPrice, freeDays: cfg.studentFreeDays, features: PLUS_FEATURES, needsVerification: true },
    { code: 'sync', name: 'Pro', priceNaira: cfg.syncPrice, features: SYNC_FEATURES, onSale: cfg.bankSync && cfg.syncPrice > 0,
      perks: ['Everything in Plus', 'Automatic bank sync'] },
    { code: 'power', name: 'Power', priceNaira: cfg.powerPrice, features: SYNC_FEATURES, onSale: cfg.bankSync && cfg.powerPrice > 0,
      perks: ['Everything in Pro', 'Up to 3 linked banks', '12 bank syncs a month', 'Priority support'] },
  ].map((p) => ({ onSale: p.code !== 'free', ...p }));
}

const studentVerified = (user, now) => {
  const s = user.student || {};
  return s.status === 'verified' && (!s.expiresAt || new Date(s.expiresAt) > now);
};

// What the user has right now: { tier, name, source, features, until, trialEndsAt }.
// tier is the plan in force ('free', 'pro', 'student', 'power'); source says why
// ('paid', 'trial', 'admin', 'none').
function entitlement(user, now = new Date(), cfg = config()) {
  if (!user) return { tier: 'free', name: 'Free', source: 'none', features: [], until: null, trialEndsAt: null };
  const byCode = Object.fromEntries(catalog(cfg).map((p) => [p.code, p]));
  const trialEndsAt = user.createdAt ? new Date(new Date(user.createdAt).getTime() + cfg.trialDays * DAY) : null;
  if (user.role === 'superadmin') return { tier: 'power', name: 'Power', source: 'admin', features: SYNC_FEATURES, until: null, trialEndsAt };
  const plan = byCode[user.plan];
  const live = plan && plan.code !== 'free' && (!user.planExpiry || new Date(user.planExpiry) > now);
  if (live && (plan.code !== 'student' || studentVerified(user, now))) {
    return { tier: plan.code, name: plan.name, source: 'paid', features: plan.features, until: user.planExpiry || null, trialEndsAt };
  }
  // The trial: new accounts that have never had a paid plan.
  if (trialEndsAt && trialEndsAt > now && !user.planEverPaid) {
    return { tier: 'pro', name: 'Plus', source: 'trial', features: PLUS_FEATURES, until: trialEndsAt, trialEndsAt };
  }
  return { tier: 'free', name: 'Free', source: 'none', features: [], until: null, trialEndsAt };
}

const hasFeature = (user, feature, now = new Date(), cfg = config()) => entitlement(user, now, cfg).features.includes(feature);

// Whole days left until a date (0 on the last day), or null.
const daysLeft = (until, now = new Date()) => (until ? Math.max(0, Math.ceil((new Date(until) - now) / DAY)) : null);

module.exports = { PLUS_FEATURES, SYNC_FEATURES, FEATURE_LABELS, config, catalog, entitlement, hasFeature, daysLeft, studentVerified };
