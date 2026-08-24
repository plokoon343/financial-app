'use strict';
// Run: node backend/lib/amount.test.js
const { normalizeAmount } = require('./amount');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { pass++; }
  else { fail++; console.log(`FAIL  ${label}\n      got  ${g}\n      want ${w}`); };
};
const val = (label, input, want) => eq(label, normalizeAmount(input).value, want);

// --- acceptance table: these all equal the target value ---
[['2k', 2000], ['2K', 2000], ['two thousand', 2000], ['2,000', 2000],
 ['₦2000', 2000], ['N2000', 2000], ['NGN 2000', 2000], ['naira 2000', 2000],
 ['2.5k', 2500], ['two point five k', 2500], ['two thousand five hundred', 2500],
 ['1.5m', 1500000], ['one point five million', 1500000],
 ['50', 50], ['1,234.56', 1234.56], ['1234.56', 1234.56],
 ['₦ 5,000', 5000], ['10k', 10000], ['1.5b', 1500000000 > 1e8 ? null : 1500000000],
 ['three hundred', 300], ['twenty five thousand', 25000], ['1,000,000', 1000000],
].forEach(([inp, want]) => val(`value("${inp}")`, inp, want));

// 1.5b is above the 100m ceiling -> null
val('value("1.5b") over ceiling', '1.5b', null);

// --- must return null (ambiguous / malformed / out of bounds) ---
[['1.500', 'ambiguous dot-thousands'], ['1,50', 'ambiguous comma'],
 ['', 'empty'], ['abc', 'words'], ['1.2.3', 'multiple dots'],
 ['0.5', 'below floor'], ['500000000', 'above ceiling'],
 ['k', 'bare multiplier'], ['n', 'bare currency'], ['..', 'junk'],
].forEach(([inp, note]) => {
  const r = normalizeAmount(inp);
  if (r.value === null) pass++;
  else { fail++; console.log(`FAIL  null("${inp}") [${note}]  got ${JSON.stringify(r)}`); }
});

// --- shape + flags ---
eq('shape high', normalizeAmount('2,000'), { value: 2000, confidence: 'high', ambiguous: false, original: '2,000', reason: null });
eq('ambiguous flag', normalizeAmount('1.500').ambiguous, true);
eq('word medium confidence', normalizeAmount('two thousand').confidence, 'medium');
eq('numeric input', normalizeAmount(2500.5).value, 2500.5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
