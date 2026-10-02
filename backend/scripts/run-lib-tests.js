// Runs every dependency-free library test in lib/*.test.js and fails if any fails.
// Used by `npm test` and CI, so a new test file is picked up without editing either.
const { readdirSync } = require('fs');
const { join } = require('path');
const { spawnSync } = require('child_process');

const libDir = join(__dirname, '..', 'lib');
const tests = readdirSync(libDir).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;

for (const file of tests) {
  const run = spawnSync(process.execPath, [join(libDir, file)], { encoding: 'utf8' });
  const ok = run.status === 0;
  if (!ok) failed += 1;
  const summary = (run.stdout || '').trim().split('\n').pop();
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  ${summary}`);
  if (!ok) process.stdout.write(run.stdout + run.stderr);
}

console.log(`\n${tests.length - failed}/${tests.length} test files passed`);
process.exit(failed ? 1 : 0);
