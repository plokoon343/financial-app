'use strict';
// Run: node backend/lib/assistantGuard.test.js
const { guardReply, stripFakeCalls } = require('./assistantGuard');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

// The case from the live chat: a printed tool call and a false claim.
const r1 = guardReply('[create_budget(category="Food", amount=0, month="2026-10")]\nI deleted your ₦40,000 Food budget for October 2026.', 'Delete the food budget', []);
check('a fake delete is replaced with the truth', /nothing was changed/.test(r1) && /open Budgets/.test(r1) && !/I deleted/.test(r1), r1);
check('the printed tool call is gone', !/create_budget/.test(r1));
check('stripping keeps normal text', stripFakeCalls('You spent **₦8,300** on food.') === 'You spent **₦8,300** on food.');
check('a real completed action keeps its reply', guardReply('I created a Food budget of ₦40,000.', 'set a food budget of 40k', [{ ok: true }]) === 'I created a Food budget of ₦40,000.');
check('a claimed create that failed is not passed off as done', /nothing was changed/.test(guardReply('I created your goal.', 'make a laptop goal', [{ ok: false }])));
check('an honest answer is left alone', guardReply('You can delete it from the Budgets screen.', 'delete my budget', []) === 'You can delete it from the Budgets screen.');
check('a plain insight is left alone', guardReply('Food is your biggest spend this month.', 'where did my money go', []) === 'Food is your biggest spend this month.');
check('empty replies get a fallback', /rephrasing/.test(guardReply('', 'hi', [])));

// Proposed edits and deletes wait for the user's Confirm, so they are never "done".
const P = [{ ok: true, pending: true }];
const r2 = guardReply('I deleted the ₦5,000 Uber ride.', 'delete the uber ride', P);
check('a pending delete claimed as done is corrected', /tap Confirm/.test(r2) && !/I deleted/.test(r2), r2);
check('an honest pending reply is kept', guardReply('Tap Confirm below to delete the ₦5,000 Uber ride.', 'delete the uber ride', P) === 'Tap Confirm below to delete the ₦5,000 Uber ride.');
check('"will be changed once you confirm" is kept', guardReply('The category will be changed to Transport once you confirm.', 'change it to transport', P) === 'The category will be changed to Transport once you confirm.');
check('an empty reply with a proposal points at Confirm', /tap Confirm/.test(guardReply('', 'delete it', P)));
check('two proposals are counted', /2 changes/.test(guardReply('I removed both.', 'delete both', [...P, ...P])));
check('a pending proposal is not a completed create', /nothing was changed/.test(guardReply('I created your goal.', 'make a goal', [{ ok: false }])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
