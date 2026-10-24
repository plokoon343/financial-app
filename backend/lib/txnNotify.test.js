'use strict';
// Run: node backend/lib/txnNotify.test.js
const t = require('./txnNotify');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date('2026-10-24T12:00:00Z');
const ago = (m) => new Date(now.getTime() - m * 60000);

// message wording
const one = [{ description: 'Chicken Republic', amount: -4500, type: 'expense', category: 'Food' }];
check('one, amounts shown', t.describe(one, { showAmounts: true }).body === 'Chicken Republic, ₦4,500 added to Food.', t.describe(one, { showAmounts: true }));
check('one, amounts hidden', t.describe(one).body === 'New spend added to Food.');
check('one income, amounts hidden', t.describe([{ ...one[0], type: 'income' }]).body === 'New income added.');
const look = t.describe([{ ...one[0], needsLook: true }]);
check('one that needs a look opens the review stack', /needs a quick look/.test(look.body) && look.nav === '/review-transactions', look);
const many = [one[0], one[0], { ...one[0], needsLook: true }];
check('several with one to look at', t.describe(many).body === '3 new transactions added. 1 needs a quick look.', t.describe(many));
check('several, two to look at', t.describe([{ ...one[0], needsLook: true }, { ...one[0], needsLook: true }]).body === '2 new transactions added. 2 need a quick look.');
check('several, none to look at opens Money', t.describe([one[0], one[0]]).nav === '/(tabs)/transactions' && t.describe([one[0], one[0]]).body === '2 new transactions added.');
check('no amounts leak when hidden', !/₦|4,500/.test(t.describe(many).body + t.describe(one).body));
check('no emoji or em dash in any copy', !/[—\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify([t.describe(one), t.describe(many)])));

// modes and quiet hours
check('default mode is daily', t.modeOf({}) === 'daily' && t.modeOf({ newTxnNotify: 'junk' }) === 'daily' && t.modeOf({ newTxnNotify: 'off' }) === 'off');
check('default quiet 22 to 7', t.quietOf({}).from === 22 && t.quietOf({}).to === 7);
check('quiet is editable and validated', t.quietOf({ notifQuietFrom: 23, notifQuietTo: 6 }).from === 23 && t.quietOf({ notifQuietFrom: 99 }).from === 22);
const q = t.DEFAULT_QUIET;
check('23:00 and 03:00 are quiet, 07:00 and 21:00 are not', t.inQuiet(23, q) && t.inQuiet(3, q) && !t.inQuiet(7, q) && !t.inQuiet(21, q));
check('from equal to means no quiet hours', !t.inQuiet(2, { from: 5, to: 5 }));

const p = (m) => [{ addedAt: ago(m) }];
check('batched waits 2 minutes after the last one', !t.dueNow({ mode: 'batched', pending: p(1), now, hour: 12, quiet: q }) && t.dueNow({ mode: 'batched', pending: p(3), now, hour: 12, quiet: q }));
check('a newer arrival restarts the wait', !t.dueNow({ mode: 'batched', pending: [{ addedAt: ago(10) }, { addedAt: ago(1) }], now, hour: 12, quiet: q }));
check('batched holds through quiet hours', !t.dueNow({ mode: 'batched', pending: p(30), now, hour: 23, quiet: q }));
check('daily sends from 8 pm, not before', !t.dueNow({ mode: 'daily', pending: p(300), now, hour: 19, quiet: q }) && t.dueNow({ mode: 'daily', pending: p(300), now, hour: 20, quiet: q }));
check('daily is held in quiet hours', !t.dueNow({ mode: 'daily', pending: p(300), now, hour: 22, quiet: q }));
check('off never sends', !t.dueNow({ mode: 'off', pending: p(300), now, hour: 12, quiet: q }));
check('nothing pending, nothing sent', !t.dueNow({ mode: 'batched', pending: [], now, hour: 12, quiet: q }));

// test accounts
check('test and demo accounts are skipped', ['playreview@automonie.com', 'ada+test@gmail.com', 'qa@example.com', 'dev_test@x.io', 'test@y.com'].every((email) => t.isTestAccount({ email })));
check('real accounts are not', ['ada.obi@gmail.com', 'contest.winner@gmail.com', 'tobe@automonie.com'].every((email) => !t.isTestAccount({ email })));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
