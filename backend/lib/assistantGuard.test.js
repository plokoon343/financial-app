'use strict';
// Run: node backend/lib/assistantGuard.test.js
const { guardReply, stripFakeCalls } = require('./assistantGuard');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

// The case from the live chat: a printed tool call and a false claim.
const r1 = guardReply('[create_budget(category="Food", amount=0, month="2026-10")]\nI deleted your ₦40,000 Food budget for October 2026.', 'Delete the food budget', []);
check('a fake delete is replaced with the truth', /can't delete or change/.test(r1) && /open Budgets/.test(r1) && !/I deleted/.test(r1), r1);
check('the printed tool call is gone', !/create_budget/.test(r1));
check('stripping keeps normal text', stripFakeCalls('You spent **₦8,300** on food.') === 'You spent **₦8,300** on food.');
check('a real completed action keeps its reply', guardReply('I created a Food budget of ₦40,000.', 'set a food budget of 40k', [{ ok: true }]) === 'I created a Food budget of ₦40,000.');
check('a claimed create that failed is not passed off as done', /nothing was changed/.test(guardReply('I created your goal.', 'make a laptop goal', [{ ok: false }])));
check('an honest answer is left alone', guardReply('You can delete it from the Budgets screen.', 'delete my budget', []) === 'You can delete it from the Budgets screen.');
check('a plain insight is left alone', guardReply('Food is your biggest spend this month.', 'where did my money go', []) === 'Food is your biggest spend this month.');
check('empty replies get a fallback', /rephrasing/.test(guardReply('', 'hi', [])));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
