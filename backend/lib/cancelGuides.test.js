'use strict';
// Run: node backend/lib/cancelGuides.test.js
const { guideFor, verifyCancellation, cancelWindowDays } = require('./cancelGuides');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// --- guide matching ---
check('netflix matched', guideFor('NETFLIX.COM').matched === true && guideFor('netflix').name === 'Netflix');
check('netflix method online', guideFor('netflix').method === 'online');
check('apple in_app', guideFor('APPLE.COM/BILL').method === 'in_app');
check('dstv matched', guideFor('DSTV SUBSCRIPTION').name === 'DStv');
check('spotify has steps', guideFor('spotify premium').steps.length >= 2);
check('unknown -> generic bank', (() => { const g = guideFor('Jollof Monthly Box'); return g.matched === false && g.method === 'bank' && g.steps.length >= 2; })());
check('generic keeps name', guideFor('Jollof Box').name === 'Jollof Box');

// --- verify: not started ---
check('no requestedAt -> none', verifyCancellation({}).state === 'none');

// --- verify: charged again after request -> still charging ---
check('charged after -> still_charging', verifyCancellation({ requestedAt: '2026-06-01', chargedAfter: true, now: '2026-06-20' }).state === 'still_charging');

// --- verify: pending (within window) ---
const pending = verifyCancellation({ requestedAt: '2026-06-01', frequency: 'monthly', chargedAfter: false, now: '2026-06-10' });
check('within window -> pending', pending.state === 'pending' && /confirm/i.test(pending.message));

// --- verify: confirmed (past window, no charge) ---
const confirmed = verifyCancellation({ requestedAt: '2026-06-01', frequency: 'monthly', chargedAfter: false, now: '2026-07-20' });
check('past window, no charge -> confirmed', confirmed.state === 'confirmed');

// yearly needs a longer window
check('yearly window 375', cancelWindowDays('yearly') === 375);
check('monthly window 40', cancelWindowDays('monthly') === 40);
check('yearly still pending at 60d', verifyCancellation({ requestedAt: '2026-01-01', frequency: 'yearly', now: '2026-03-02' }).state === 'pending');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
