'use strict';
// Numbers for the Automatic tracking screen. Pure so it can be tested.

const DAY = 86400000;
const MAX_LOG = 300;   // alerts remembered per user: enough for a month of counts, bounded in size

// Count alerts per app inside the last `days` days from a [{ app, at }] log.
function appCounts(log = [], now = new Date(), days = 30) {
  const since = now.getTime() - days * DAY;
  const out = {};
  for (const e of log) {
    if (!e || !e.app) continue;
    if (new Date(e.at).getTime() >= since) out[e.app] = (out[e.app] || 0) + 1;
  }
  return out;
}

// Append one alert to a log, keeping only the newest MAX_LOG.
function pushAlert(log = [], app, at = new Date()) {
  const clean = String(app || '').slice(0, 120);
  if (!clean) return log.slice(-MAX_LOG);
  return [...log, { app: clean, at }].slice(-MAX_LOG);
}

module.exports = { appCounts, pushAlert, MAX_LOG };
