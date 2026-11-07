'use strict';
// Run: node backend/lib/appVersion.test.js
// Test V1 from research doc 13.12's acceptance table.

const { compareVersions, versionStatus, shouldShowUpdateCard } = require('./appVersion');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── V1: App below minimum version opens ───────────────────────────────────────
// Expected: update screen only.
{
  const config = { minVersion: '2.4.0', recommendedVersion: '2.6.0' };
  check('V1: a version below minimum is blocked', versionStatus('2.3.9', config) === 'blocked');
  check('V1: the minimum version itself is not blocked', versionStatus('2.4.0', config) === 'ok' || versionStatus('2.4.0', config) === 'update_available');
}

// ── compareVersions ────────────────────────────────────────────────────────────
{
  check('compare: equal versions', compareVersions('1.2.3', '1.2.3') === 0);
  check('compare: a lower patch is less', compareVersions('1.2.3', '1.2.4') === -1);
  check('compare: a lower minor is less even with a higher patch', compareVersions('1.2.9', '1.3.0') === -1);
  check('compare: a higher major wins', compareVersions('2.0.0', '1.9.9') === 1);
  check('compare: missing segments count as zero', compareVersions('1.2', '1.2.0') === 0);
}

// ── versionStatus ───────────────────────────────────────────────────────────────
{
  const config = { minVersion: '2.0.0', recommendedVersion: '2.5.0' };
  check('status: below minimum is blocked', versionStatus('1.9.0', config) === 'blocked');
  check('status: at minimum but below recommended needs an update card', versionStatus('2.0.0', config) === 'update_available');
  check('status: at or above recommended is ok', versionStatus('2.5.0', config) === 'ok');
  check('status: with no config at all, nothing is ever blocked', versionStatus('0.0.1', {}) === 'ok');
}

// ── shouldShowUpdateCard: at most once a week ───────────────────────────────────
{
  const now = new Date('2026-11-06T12:00:00Z');
  check('card: never shown yet', shouldShowUpdateCard(null, now) === true);
  check('card: shown yesterday, not again yet', shouldShowUpdateCard('2026-11-05T12:00:00Z', now) === false);
  check('card: shown 8 days ago, due again', shouldShowUpdateCard('2026-10-29T12:00:00Z', now) === true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
