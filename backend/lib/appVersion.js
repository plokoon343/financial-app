'use strict';
// Minimum and recommended app version (round 6, section 6.3; research doc 13.12).
//
// Below the minimum, nothing in the app works except an update screen, so nothing
// is ever counted wrong on a build too old to trust. Below the recommended
// version, the app works but shows a dismissible card at most once a week.
//
// Pure and dependency-free.

function parseVersion(v) {
  return String(v || '0').split('.').map((x) => parseInt(x, 10) || 0);
}

// -1 when a < b, 0 when equal, 1 when a > b.
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 'blocked'          below minVersion: the update screen only, nothing else works
// 'update_available' below recommendedVersion: a dismissible card, at most weekly
// 'ok'                otherwise
function versionStatus(current, { minVersion, recommendedVersion } = {}) {
  if (minVersion && compareVersions(current, minVersion) < 0) return 'blocked';
  if (recommendedVersion && compareVersions(current, recommendedVersion) < 0) return 'update_available';
  return 'ok';
}

// Whether the dismissible "please update" card may show again: at most once a
// week, and never once the app is blocked outright (blocked has its own screen).
function shouldShowUpdateCard(lastShownAt, now = new Date()) {
  if (!lastShownAt) return true;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  return now.getTime() - new Date(lastShownAt).getTime() >= WEEK_MS;
}

module.exports = { compareVersions, versionStatus, shouldShowUpdateCard };
