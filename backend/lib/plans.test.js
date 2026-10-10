'use strict';
// Run: node backend/lib/plans.test.js
const { entitlement, hasFeature, catalog, config, daysLeft } = require('./plans');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const DAY = 86400000;
const now = new Date('2026-10-10T12:00:00Z');
const cfg = config({});
const ago = (d) => new Date(now.getTime() - d * DAY);
const ahead = (d) => new Date(now.getTime() + d * DAY);

check('defaults: Plus 1500, Student 700 after 90 free days, 14-day trial, Power not on sale', cfg.plusPrice === 1500 && cfg.studentPrice === 700 && cfg.studentFreeDays === 90 && cfg.trialDays === 14 && !catalog(cfg).find((p) => p.code === 'power').onSale);
check('PRO_PRICE_NAIRA still sets the Plus price', config({ PRO_PRICE_NAIRA: '2000' }).plusPrice === 2000);
check('Pro is shown as Plus', catalog(cfg).find((p) => p.code === 'pro').name === 'Plus');

const fresh = { createdAt: ago(3), plan: 'free' };
const e1 = entitlement(fresh, now, cfg);
check('a new account is on the Plus trial', e1.tier === 'pro' && e1.source === 'trial' && hasFeature(fresh, 'receipts', now, cfg));
check('trial shows days left', daysLeft(e1.until, now) === 11);
const expired = { createdAt: ago(15), plan: 'free' };
check('after 14 days the trial ends and features lock', entitlement(expired, now, cfg).tier === 'free' && !hasFeature(expired, 'report', now, cfg));
check('trial length is config', entitlement(expired, now, config({ TRIAL_DAYS: '30' })).source === 'trial');
check('someone who has paid before gets no second trial', entitlement({ createdAt: ago(2), plan: 'free', planEverPaid: true }, now, cfg).tier === 'free');

const plus = { createdAt: ago(100), plan: 'pro', planExpiry: ahead(20) };
check('paid Plus unlocks Plus features', entitlement(plus, now, cfg).source === 'paid' && hasFeature(plus, 'cancel', now, cfg));
check('lapsed Plus is Free', entitlement({ ...plus, planExpiry: ago(1) }, now, cfg).tier === 'free');

const student = { createdAt: ago(100), plan: 'student', planExpiry: ahead(60), student: { status: 'verified', expiresAt: ahead(200) } };
check('verified Student gets Plus features', entitlement(student, now, cfg).name === 'Student' && hasFeature(student, 'receipts', now, cfg));
check('Student with lapsed verification drops to Free', entitlement({ ...student, student: { status: 'verified', expiresAt: ago(1) } }, now, cfg).tier === 'free');
check('Student without verification is Free', entitlement({ ...student, student: { status: 'pending' } }, now, cfg).tier === 'free');

check('superadmin is never blocked', hasFeature({ role: 'superadmin', createdAt: ago(900) }, 'report', now, cfg));
check('Power includes Plus features', entitlement({ createdAt: ago(100), plan: 'power', planExpiry: ahead(5) }, now, cfg).features.includes('bank-link'));
check('no user is Free', entitlement(null).tier === 'free');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
