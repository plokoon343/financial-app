'use strict';
// Run: node backend/lib/trackingSummary.test.js
const { appCounts, pushAlert, MAX_LOG } = require('./trackingSummary');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date('2026-10-16T12:00:00Z');
const ago = (d) => new Date(now.getTime() - d * 86400000);

const log = [{ app: 'team.opay.pay', at: ago(1) }, { app: 'team.opay.pay', at: ago(10) }, { app: 'team.opay.pay', at: ago(40) }, { app: 'com.kudabank.app', at: ago(2) }];
const c = appCounts(log, now);
check('counts the last 30 days only', c['team.opay.pay'] === 2 && c['com.kudabank.app'] === 1, c);
check('empty log is empty', Object.keys(appCounts([], now)).length === 0);
check('ignores rows without an app', Object.keys(appCounts([{ at: ago(1) }], now)).length === 0);

check('push appends', pushAlert([], 'a', ago(0)).length === 1);
check('push ignores an empty app', pushAlert([{ app: 'a', at: ago(0) }], '', ago(0)).length === 1);
let big = [];
for (let i = 0; i < MAX_LOG + 25; i++) big = pushAlert(big, 'a', ago(0));
check('push keeps only the newest MAX_LOG', big.length === MAX_LOG);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
