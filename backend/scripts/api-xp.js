// XP engine end to end, against a local API on a throwaway database it creates and drops.
//
//   MONGODB_URI=mongodb://localhost:27017/automonie_test PORT=5099 node server.js
//   API_URL=http://localhost:5099 TEST_DB=mongodb://localhost:27017/automonie_test node scripts/api-xp.js
'use strict';
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:5099';
const DB = process.env.TEST_DB || 'mongodb://localhost:27017/automonie_test';
if (!/_test(\?|$)/.test(DB)) { console.error('TEST_DB must name a *_test database.'); process.exit(1); }
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

async function main() {
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();
  // Dropping the database drops the server's indexes too; put back the one the ledger relies on.
  await mongoose.connection.db.collection('xpevents').createIndex({ userId: 1, key: 1 }, { unique: true });
  const users = mongoose.connection.db.collection('users');
  const mk = async (name, role) => {
    const { insertedId } = await users.insertOne({ name, email: `${name}@example.test`, password: 'x', role, createdAt: new Date() });
    const token = jwt.sign({ userId: insertedId }, process.env.JWT_SECRET, { expiresIn: '1h' });
    return { id: insertedId, H: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  };
  const call = async (u, method, path, body) => {
    const r = await fetch(API + path, { method, headers: u.H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, body: j };
  };
  const admin = await mk('admin', 'superadmin');
  const u = await mk('ada', 'user');
  const xpOf = async (who) => (await call(who, 'GET', '/api/xp')).body;

  // Empty ledger: honest zero, not an error.
  let s = (await call(u, 'GET', '/api/xp')).body;
  check('empty ledger is 0 XP at Starter', s.xp === 0 && s.name === 'Starter' && s.next.name === 'Tracker' && s.dailyCap === 50);
  check('icons are locked and say how far', s.unlocks[0].id === 'app_icons' && s.unlocks[0].unlocked === false && s.unlocks[0].xpToGo === 100);

  // Check-in pays 2 once a day, however many times it is called, and ignores claimed days.
  await call(u, 'POST', '/api/checkin', { days: ['2026-01-01', '2026-01-02'] });
  await call(u, 'POST', '/api/checkin', {});
  await call(u, 'POST', '/api/checkin', {});
  check('check-in pays 2, once, and not for claimed days', (await xpOf(u)).xp === 2);

  // Budget pays 20 once per category and month; delete and recreate pays nothing more.
  const b = await call(u, 'POST', '/api/budgets', { category: 'Food', amount: 50000 });
  await call(u, 'DELETE', `/api/budgets/${b.body._id}`);
  await call(u, 'POST', '/api/budgets', { category: 'Food', amount: 60000 });
  check('budget pays 20 once even after delete and recreate', (await xpOf(u)).xp === 22);

  // Goal pays 50 once, through contribute; withdraw and re-hit does not pay again.
  const g = await call(u, 'POST', '/api/goals', { name: 'Phone', target: 1000, deadline: new Date(Date.now() + 864e5 * 30) });
  await call(u, 'POST', `/api/goals/${g.body._id}/contribute`, { amount: 1000 });
  s = await xpOf(u);
  check('goal hit pays, up to the daily cap (2 + 20 + 28 of 50)', s.xp === 50 && s.today === 50 && s.leftToday === 0, JSON.stringify(s));
  await call(u, 'POST', `/api/goals/${g.body._id}/withdraw`, {});
  await call(u, 'POST', `/api/goals/${g.body._id}/contribute`, { amount: 1000 });
  check('a goal cannot pay twice', (await xpOf(u)).xp === 50);

  // Cap: further actions today pay nothing.
  await call(u, 'POST', '/api/budgets', { category: 'Transport', amount: 20000 });
  check('past the cap nothing more is paid today', (await xpOf(u)).xp === 50);

  // The ledger, not the phone: a second caller sees only their own.
  const v = await mk('bola', 'user');
  check('another account has its own ledger', (await xpOf(v)).xp === 0);

  // Backfill: existing history the server can prove.
  const w = await mk('chi', 'user');
  const gc = mongoose.connection.db.collection('goals');
  const bc = mongoose.connection.db.collection('budgets');
  await gc.insertMany([{ userId: w.id, name: 'a', target: 100, current: 100, deadline: new Date() }, { userId: w.id, name: 'b', target: 100, current: 10, deadline: new Date() }]);
  await bc.insertMany(['Food', 'Rent', 'Data'].map((c, i) => ({ userId: w.id, category: c, amount: 10, month: '2026-10', createdAt: new Date(2026, 9, 1 + i) })));
  await users.updateOne({ _id: w.id }, { $set: { captureKeyHash: 'abc' } });

  const dry = await call(admin, 'POST', '/api/admin/xp-backfill');
  check('dry run counts and writes nothing', dry.status === 200 && dry.body.applied === false && dry.body.written === 0 && dry.body.counts.goal_hit === 1 && dry.body.counts.budget_set === 3 && dry.body.counts.tracking_on === 1, JSON.stringify(dry.body));
  check('dry run says where accounts land', dry.body.landing && dry.body.landing.Tracker >= 1, JSON.stringify(dry.body.landing));
  check('still 0 XP after a dry run', (await xpOf(w)).xp === 0);
  check('a normal user cannot run it', (await call(u, 'POST', '/api/admin/xp-backfill')).status === 403);

  const run = await call(admin, 'POST', '/api/admin/xp-backfill?apply=1');
  s = await xpOf(w);
  check('apply writes 50 + 60 + 30 = 140 for the account', run.body.applied === true && s.xp === 140 && s.name === 'Tracker', JSON.stringify(run.body));
  check('backfill is outside the daily cap', s.today === 0 && s.leftToday === 50);
  const again = await call(admin, 'POST', '/api/admin/xp-backfill?apply=1');
  check('running it again writes nothing', again.body.entries === 0 && (await xpOf(w)).xp === 140);

  // Live play after backfill cannot double it: the same budget and goal are not paid again.
  await call(w, 'POST', '/api/budgets', { category: 'Food', amount: 99, month: '2026-10' });
  check('live budget already backfilled is not paid again', (await xpOf(w)).xp === 140);

  // Tracking on, live: pays 30 once.
  const t = await mk('dayo', 'user');
  await call(t, 'POST', '/api/capture/key');
  await call(t, 'POST', '/api/capture/key');
  check('turning tracking on pays 30 once', (await xpOf(t)).xp === 30);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
