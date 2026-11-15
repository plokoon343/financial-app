'use strict';
// Run: node backend/lib/categoryAccuracy.test.js
// Round 10, A6. Runs every labelled narration in test/fixtures/categories.json through
// the single categoriser (no user maps: this measures the shipped rules) and FAILS
// below 90% correct, so CI catches a keyword or catalogue edit that makes things worse.
// The labels are written by hand, not produced by the categoriser.
const fs = require('fs');
const path = require('path');
const { categorise } = require('./categorise');

const THRESHOLD = 0.9;
const { rows } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'test', 'fixtures', 'categories.json'), 'utf8'));

let right = 0;
const wrong = [];
const per = new Map();
for (const r of rows) {
  const got = categorise({ txn: { description: r.narration, type: r.type } }).category;
  const p = per.get(r.expected) || { n: 0, ok: 0 };
  p.n += 1;
  if (got === r.expected) { right += 1; p.ok += 1; } else wrong.push(`  '${r.narration}' (${r.type}): got '${got}', want '${r.expected}'`);
  per.set(r.expected, p);
}

const acc = right / rows.length;
if (wrong.length) console.log(`Misses (${wrong.length}):\n${wrong.join('\n')}`);
for (const [c, p] of [...per].sort((a, b) => a[1].ok / a[1].n - b[1].ok / b[1].n).slice(0, 5)) {
  console.log(`weakest: ${c} ${p.ok}/${p.n}`);
}
const ok = acc >= THRESHOLD && rows.length >= 250;
console.log(`\n${right}/${rows.length} correct (${(acc * 100).toFixed(1)}%), need ${(THRESHOLD * 100).toFixed(0)}%. ${ok ? 'PASS' : 'FAIL'}`);
process.exit(ok ? 0 : 1);
