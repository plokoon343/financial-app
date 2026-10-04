'use strict';
// Run: node backend/lib/capture.test.js
const assert = require('assert');
const { newCaptureKey, hashCaptureKey, looksLikeCaptureKey, bankForApp, captureText, captureDay, MAX_CAPTURE_CHARS } = require('./capture');

let passed = 0;
const ok = (name, cond) => { assert.ok(cond, name); passed += 1; };

const k = newCaptureKey();
ok('key shape', looksLikeCaptureKey(k));
ok('keys are unique', newCaptureKey() !== k);
ok('hash is stable', hashCaptureKey(k) === hashCaptureKey(k));
ok('hash is not the key', hashCaptureKey(k) !== k && hashCaptureKey(k).length === 64);
ok('junk is not a key', !looksLikeCaptureKey('amk_short') && !looksLikeCaptureKey('') && !looksLikeCaptureKey(null));

ok('opay package', bankForApp('team.opay.pay') === 'OPay');
ok('case-insensitive package', bankForApp('COM.TRANSSNET.PALMPAY') === 'PalmPay');
ok('unknown package', bankForApp('com.whatsapp') === '');

ok('title + text joined', captureText({ title: 'Debit Alert', text: 'NGN5,000 sent to JOHN' }) === 'Debit Alert\nNGN5,000 sent to JOHN');
ok('bigText preferred', captureText({ title: 'OPay', text: 'short', bigText: 'You sent NGN5,000 to JOHN DOE' }).endsWith('JOHN DOE'));
ok('title not doubled', captureText({ title: 'Credit', text: 'Credit NGN2,000 received' }) === 'Credit NGN2,000 received');
ok('length capped', captureText({ text: 'x'.repeat(MAX_CAPTURE_CHARS + 50) }).length === MAX_CAPTURE_CHARS);

const now = Date.parse('2026-10-04T12:00:00Z');
ok('posted ms -> Lagos day', captureDay(Date.parse('2026-10-03T23:30:00Z'), now) === '2026-10-04');
ok('posted iso', captureDay('2026-10-02T10:00:00Z', now) === '2026-10-02');
ok('future rejected', captureDay(now + 3600000, now) === null);
ok('ancient rejected', captureDay(now - 90 * 86400000, now) === null);
ok('missing -> null', captureDay(undefined, now) === null && captureDay('nonsense', now) === null);

console.log(`\n${passed} passed, 0 failed`);
