'use strict';
// Run: node backend/lib/aiOutput.test.js
const { cleanAiText } = require('./aiOutput');
let pass = 0, fail = 0;
const check = (label, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL  ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); } };

check('plain text is untouched', cleanAiText('You spent ₦12,400 on food in September.'), 'You spent ₦12,400 on food in September.');
check('emoji removed', cleanAiText('Nice work \u{1F389} you saved more \u{1F4B0}!'), 'Nice work you saved more!');
check('emoji with variation selector removed', cleanAiText('Careful ⚠️ food is up'), 'Careful food is up');
check('flag and zwj sequences removed', cleanAiText('Hi \u{1F1F3}\u{1F1EC} and \u{1F468}‍\u{1F4BB}'), 'Hi and');
check('em dash with spaces becomes a comma', cleanAiText('Food is high — about half your budget'), 'Food is high, about half your budget');
check('em dash without spaces becomes a comma', cleanAiText('Food—again'), 'Food, again');
check('hyphens and en dashes are kept', cleanAiText('A well-known 2026–27 plan'), 'A well-known 2026–27 plan');
check('naira sign and bold markers survive', cleanAiText('**₦5,000** left'), '**₦5,000** left');
check('bullets and newlines survive', cleanAiText('- one\n- two'), '- one\n- two');
check('null becomes empty', cleanAiText(null), '');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
