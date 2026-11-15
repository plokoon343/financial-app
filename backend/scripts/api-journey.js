// API checks for the first-month journey (Round 10 Part E), against a local API on a throwaway
// database (emptied before and after; start the server on it first so its indexes exist). Push and email must be OFF so nothing real is sent.
//
//   PUSH_DISABLED=true CRON_SECRET=localsecret BREVO_API_KEY= MONGODB_URI=mongodb://localhost:27017/automonie_test PORT=5097 node server.js
//   CRON_SECRET=localsecret API_URL=http://localhost:5097 TEST_DB=mongodb://localhost:27017/automonie_test node scripts/api-journey.js
'use strict';
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:5097';
const DB = process.env.TEST_DB || 'mongodb://localhost:27017/automonie_test';
if (!/_test(\?|$)/.test(DB)) { console.error('TEST_DB must name a *_test database.'); process.exit(1); }
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };
const DAY = 86400000;
const lagosKey = (d) => new Date(d.getTime() + 3600000).toISOString().slice(0, 10);

async function main() {
  await mongoose.connect(DB);
  // Empty every collection but keep the indexes the running server built (the unique ones are part of what is tested).
  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const mk = async (name, createdDaysAgo, extra = {}) => {
    const createdAt = new Date(Date.now() - createdDaysAgo * DAY);
    const { insertedId } = await users.insertOne({ name, email: `${name}@sandbox.dev`, password: 'x', createdAt, isActive: true, plan: 'free', lastActiveAt: new Date(), monthlyIncome: 100000, ...extra });
    return { id: insertedId, H: { Authorization: `Bearer ${jwt.sign({ userId: insertedId }, process.env.JWT_SECRET, { expiresIn: '1h' })}`, 'Content-Type': 'application/json' } };
  };
  const call = async (u, method, path, body) => {
    const r = await fetch(API + path, { method, headers: u.H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, body: j };
  };
  const cron = async (at) => (await fetch(`${API}/api/cron/nudges?at=${encodeURIComponent(at.toISOString())}&wait=1`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } })).json();
  const txn = (u, extra) => db.collection('transactions').insertOne({ userId: u.id, date: new Date(), amount: -2500, type: 'expense', category: 'Food', description: 'Chicken Republic', bank: 'GTBank', ...extra });

  const admin = await mk('admin', 400, { role: 'superadmin' });
  // A rule made keeps the earlier "teach it once" moment (day 2, grace 1) out of day 3's way.
  const withRule = async (u) => { await db.collection('merchantnamerules').insertOne({ userId: u.id, merchantKey: 'k', name: 'K' }); return u; };
  const day3 = await withRule(await mk('day3', 3));            // no budget yet
  const day3b = await mk('day3b', 3);          // already has a budget
  await db.collection('budgets').insertOne({ userId: day3b.id, month: '2099-01', category: 'Food', amount: 50000 });
  await db.collection('merchantnamerules').insertOne({ userId: day3b.id, merchantKey: 'x', name: 'X' });
  const old = await mk('old', 200);

  // The Home card, on demand.
  const a = await call(day3, 'GET', '/api/journey/today');
  check('day 3 user gets the budget card', a.body?.moment?.id === 'day3_budget' && a.body.moment.nav === '/(tabs)/grow', JSON.stringify(a.body));
  const again = await call(day3, 'GET', '/api/journey/today');
  check('asking again the same day gives the same one', again.body?.moment?.id === 'day3_budget');
  const b = await call(day3b, 'GET', '/api/journey/today');
  check('a user who already set a budget never gets the day 3 card', !b.body?.moment, JSON.stringify(b.body));
  check('an established account gets nothing', !(await call(old, 'GET', '/api/journey/today')).body?.moment);

  // Dismissed: silence for the rest of the day, never back.
  await call(day3, 'POST', '/api/journey/day3_budget/dismiss');
  check('dismissed card does not return', !(await call(day3, 'GET', '/api/journey/today')).body?.moment);
  const st = await db.collection('journeystates').find({ userId: day3.id }).toArray();
  check('one row, one day, dismissed', st.length === 1 && st[0].status === 'dismissed' && st[0].claimDay === lagosKey(new Date()));

  // A service announcement holds the journey card (different slots, never both on a service day).
  const held = await withRule(await mk('held', 3));
  await db.collection('announcements').insertOne({ title: 'Outage', body: 'We are on it.', kind: 'outage', channels: ['card'], status: 'scheduled', startsAt: new Date(Date.now() - 3600000), endsAt: new Date(Date.now() + DAY), audience: {}, createdBy: 'a', approvedBy: '', createdAt: new Date(), updatedAt: new Date() });
  const h = await call(held, 'GET', '/api/journey/today');
  check('a live outage announcement holds the journey card', !h.body?.moment && h.body?.held === 'announcement', JSON.stringify(h.body));
  check('held does not consume the moment', (await db.collection('journeystates').countDocuments({ userId: held.id })) === 0);
  await db.collection('announcements').deleteMany({});
  check('the moment is there once the announcement ends', (await call(held, 'GET', '/api/journey/today')).body?.moment?.id === 'day3_budget');

  // Skip is only for moments with a phone-side check.
  check('a plain moment cannot be skipped', (await call(day3, 'POST', '/api/journey/day3_budget/skip')).status === 400);

  // Server-side configuration, no release.
  check('a normal user cannot read the journey config', (await call(day3, 'GET', '/api/admin/journey')).status === 403);
  const bad = await call(admin, 'PUT', '/api/admin/journey', { moments: { day3_budget: { card: { body: 'Do it — now' } } } });
  check('copy with an em dash is refused', bad.status === 400, JSON.stringify(bad.body));
  const put = await call(admin, 'PUT', '/api/admin/journey', { moments: { day3_budget: { card: { title: 'Budget time' } } } });
  check('an override is saved', put.status === 200 && put.body.moments.find((m) => m.id === 'day3_budget').card.title === 'Budget time');
  check('and Home uses it at once', (await call(held, 'GET', '/api/journey/today')).body?.moment?.title === 'Budget time');
  await call(admin, 'PUT', '/api/admin/journey', { moments: {} });
  await call(admin, 'PUT', '/api/admin/journey', { enabled: false });
  const off = await mk('off', 3);
  check('journey switched off: no cards', !(await call(off, 'GET', '/api/journey/today')).body?.moment);
  await call(admin, 'PUT', '/api/admin/journey', { enabled: true });

  // Push: off by default, then one a day across the app, never in quiet hours.
  const lagosAt = (h) => { const d = new Date(Date.now() + 3600000); d.setUTCHours(h, 0, 0, 0); return new Date(d.getTime() - 3600000); };
  const pushU = await mk('pushu', 3, { pushTokens: ['ExponentPushToken[test-journey]'] });
  const pu = await withRule(await mk('pushv', 3, { pushTokens: ['ExponentPushToken[test-journey2]'] }));
  await txn(pu);   // has transactions and no budget: the old setup_budget nudge would also want to push
  check('journey push is off by default', (await call(admin, 'GET', '/api/admin/journey')).body?.pushEnabled === false);
  let r;
  await call(admin, 'PUT', '/api/admin/journey', { pushEnabled: true });
  r = await cron(lagosAt(23));
  check('nothing at 11 pm (quiet hours)', (await db.collection('pushdays').countDocuments({ userId: pushU.id })) === 0, JSON.stringify(r));
  r = await cron(lagosAt(5));
  check('nothing at 5 am (quiet hours)', (await db.collection('pushdays').countDocuments({ userId: pushU.id })) === 0);
  await db.collection('users').updateOne({ _id: pushU.id }, { $set: { pushTokens: [] } });   // pushU only existed for the quiet-hours checks
  r = await cron(lagosAt(10));
  const rows = await db.collection('pushdays').find({ userId: pu.id }).toArray();
  check('one push lands for the day 3 user, from the journey', rows.length === 1 && rows[0].source === 'journey:day3_budget', JSON.stringify(rows));
  await cron(lagosAt(11)); await cron(lagosAt(14)); await cron(lagosAt(19));
  check('later runs the same day add no second push', (await db.collection('pushdays').countDocuments({ userId: pu.id })) === 1);
  check('the nudge engine did not also push (the day was spent)', (await db.collection('nudgelogs').countDocuments({ userId: pu.id })) === 0);
  check('the push is recorded on the moment', !!(await db.collection('journeystates').findOne({ userId: pu.id, momentId: 'day3_budget' }))?.pushedAt);
  check('the same moment is the card', (await call(pu, 'GET', '/api/journey/today')).body?.moment?.id === 'day3_budget');
  // Tomorrow, a moment that already pushed once is not pushed again, and day 4 is a fresh day.
  const tomorrow = new Date(lagosAt(10).getTime() + DAY);
  await db.collection('users').updateOne({ _id: pu.id }, { $set: { createdAt: new Date(tomorrow.getTime() - 4 * DAY) } });
  await cron(tomorrow);
  check('next day: at most one more push, a different day row', (await db.collection('pushdays').countDocuments({ userId: pu.id })) <= 2 && (await db.collection('pushdays').distinct('day', { userId: pu.id })).length === (await db.collection('pushdays').countDocuments({ userId: pu.id })));

  for (const c of await mongoose.connection.db.collections()) await c.deleteMany({});
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
