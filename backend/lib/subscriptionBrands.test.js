'use strict';
// Run: node backend/lib/subscriptionBrands.test.js
const assert = require('assert');
const { brandFor } = require('./subscriptionBrands');

let passed = 0;
const is = (text, slug) => { const b = brandFor(text); assert.strictEqual(b ? b.slug : null, slug, `${text} -> ${b ? b.slug : null}, expected ${slug}`); passed += 1; };

// The same service, as different banks and channels print it.
is('NETFLIX.COM LAGOS NG', 'netflix');
is('POSWEB PURCHASE N FLX AMSTERDAM', 'netflix');
is('WEB PAY NFLX', 'netflix');
is('Netflix subscription', 'netflix');
is('SPOTIFY AB STOCKHOLM', 'spotify');
is('SPTFY P1234 PREMIUM', 'spotify');
is('GOOGLE *YouTube Premium', 'youtube');
is('GOOGLEClaudebyAnth Lagos NG', 'claude');
is('OPENAI *CHATGPT SUBSCR', 'chatgpt');
is('GOOGLE *Google One', 'google-one');
is('GOOGLE *Duolingo', 'duolingo');
is('GOOGLE *GAME COINS', 'google-play');
is('APPLE.COM/BILL', 'app-store');
is('MULTICHOICE DSTV COMPACT', 'dstv');
is('GOTV MAX RENEWAL', 'gotv');
is('MSFT *MICROSOFT 365', 'microsoft-365');

// Not subscriptions, and no false hits inside other words.
is('POS PURCHASE SHOPRITE IKEJA', null);
is('TRANSFER TO JOHN DOE', null);
is('NOTIONAL INTEREST', null);
is('CANVAS BAG STORE', null);
is('CANVA PTY LTD', 'canva');
is('NOTION LABS INC', 'notion');
is('', null);

console.log(`\n${passed} passed, 0 failed`);
