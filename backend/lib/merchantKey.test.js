'use strict';
// Run: node backend/lib/merchantKey.test.js
const assert = require('assert');
const { deriveCategoryKey, subscriptionKey } = require('./merchantKey');

let passed = 0;
const eq = (a, b, label) => { assert.strictEqual(a, b, label); passed += 1; };

// The same service under any spelling gets one key, so a dismissal covers them all.
eq(subscriptionKey('POSWEB PURCHASE N FLX AMSTERDAM'), 'brand:netflix', 'N FLX');
eq(subscriptionKey('NETFLIX.COM LAGOS NG'), 'brand:netflix', 'NETFLIX.COM');
eq(subscriptionKey('Netflix'), 'brand:netflix', 'the display name dismisses the same service');

// Unknown merchants key on their first meaningful words, ignoring refs and noise.
eq(deriveCategoryKey('POS PURCHASE 0012345 KILIMANJARO RESTAURANT LEKKI'), 'kilimanjaro restaurant lekki', 'merchant words');
eq(subscriptionKey('WEB PAY GYMSHARK MONTHLY FEE'), 'gymshark monthly fee', 'unbranded recurring charge');

// Bug 2.3: the detector shows a shortened name (40 chars), and a name cut mid-word
// can key differently from the charges themselves. That's why "Not one" sends the
// detector's own key, never just the name it displayed.
const desc = 'WEB PAYMENT ACMESTREAMINGSERVICES PREMIUMANNUAL PLATINUMPLAN';
const shown = desc.slice(0, 40).trim();
assert.notStrictEqual(subscriptionKey(shown), subscriptionKey(desc), 'a shortened name can drift');
passed += 1;

eq(subscriptionKey(''), '', 'empty');

console.log(`\n${passed} passed, 0 failed`);
