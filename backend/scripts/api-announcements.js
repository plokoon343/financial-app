// API checks for announcements (Round 10 Part D), run against a local API on a throwaway
// database that the script creates and drops. Email must be OFF (no BREVO_API_KEY).
//
//   BREVO_API_KEY= MONGODB_URI=mongodb://localhost:27017/automonie_test PORT=5098 node server.js
//   API_URL=http://localhost:5098 TEST_DB=mongodb://localhost:27017/automonie_test node scripts/api-announcements.js
'use strict';
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:5098';
const DB = process.env.TEST_DB || 'mongodb://localhost:27017/automonie_test';
if (!/_test(\?|$)/.test(DB)) { console.error('TEST_DB must name a *_test database.'); process.exit(1); }
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

async function main() {
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();
  const users = mongoose.connection.db.collection('users');
  const mk = async (name, extra = {}) => {
    const { insertedId } = await users.insertOne({ name, email: `${name}@example.test`, password: 'x', createdAt: new Date(), isActive: true, plan: 'free', ...extra });
    return { id: insertedId, H: { Authorization: `Bearer ${jwt.sign({ userId: insertedId }, process.env.JWT_SECRET, { expiresIn: '1h' })}`, 'Content-Type': 'application/json' } };
  };
  const call = async (u, method, path, body) => {
    const r = await fetch(API + path, { method, headers: u.H, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, body: j };
  };
  const adminA = await mk('adminA', { role: 'superadmin' });
  const adminB = await mk('adminB', { role: 'superadmin' });
  const editor = await mk('editor', { newsletterEditor: true });
  const alice = await mk('alice', { productEmails: true, lastClient: 'android-play', lastAppVersion: '1.5.0' });
  const bob = await mk('bob', { productEmails: false, lastClient: 'ios', lastAppVersion: '1.2.0', plan: 'pro' });
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  // Non-admins are refused.
  check('a normal user cannot list announcements', (await call(alice, 'GET', '/api/admin/announcements')).status === 403);
  check('a normal user cannot approve', (await call(alice, 'POST', '/api/admin/announcements/000000000000000000000000/approve')).status === 403);

  // Audience count is the same resolver the send path uses.
  const cnt = async (aud, kind) => (await call(adminA, 'GET', `/api/admin/announcements/audience-count?kind=${kind || 'feature'}&audience=${encodeURIComponent(JSON.stringify(aud))}`)).body;
  check('count: everyone', (await cnt({})).count === 5, JSON.stringify(await cnt({})));
  check('count: pro plan only', (await cnt({ plans: ['pro'] })).count === 1);
  check('count: android only', (await cnt({ platforms: ['android'] })).count === 1);
  check('count: version max 1.4', (await cnt({ maxVersion: '1.4.0' })).count === 4); // bob plus the three that never reported a version... admins and editor
  const c = await cnt({ platforms: ['android', 'ios'] });
  check('count: feature email only reaches consented users', c.count === 2 && c.email === 1, JSON.stringify(c));
  const cs = await cnt({ platforms: ['android', 'ios'] }, 'outage');
  check('count: a service kind emails everyone in the audience', cs.email === 2, JSON.stringify(cs));

  // Creating, validation, editor access.
  const card = { title: 'New feature', body: 'Look at this', kind: 'feature', channels: ['card'], startsAt: past, endsAt: future, audience: {} };
  const bad = await call(adminA, 'POST', '/api/admin/announcements', { ...card, endsAt: null });
  check('a card without an end date is refused', bad.status === 400 && /end date/.test(bad.body?.message || ''), JSON.stringify(bad.body));
  const bad2 = await call(adminA, 'POST', '/api/admin/announcements', { ...card, channels: ['card', 'fullscreen'] });
  check('full-screen on a feature is refused', bad2.status === 400);
  const made = await call(editor, 'POST', '/api/admin/announcements', card);
  check('a newsletter editor can create a draft', made.status === 201 && made.body.status === 'draft', JSON.stringify(made.body));
  const id = made.body.id;
  check('a draft is not served', !(await call(alice, 'GET', '/api/announcements/active')).body.card);
  const sched = await call(editor, 'PATCH', `/api/admin/announcements/${id}`, { status: 'scheduled' });
  check('a card with no approval need schedules', sched.status === 200 && sched.body.status === 'scheduled', JSON.stringify(sched.body));
  const a1 = await call(alice, 'GET', '/api/announcements/active');
  check('alice sees the card', a1.body.card && a1.body.card.id === id, JSON.stringify(a1.body));
  const bell = await call(alice, 'GET', '/api/notifications');
  check('it is also in the bell', (bell.body.items || []).some((n) => n.title === 'New feature'));
  // Never a push: the bell entry is created without touching push tokens (no push code path), asserted by code review.
  await call(alice, 'POST', `/api/announcements/${id}/dismiss`);
  check('dismissed never returns', !(await call(alice, 'GET', '/api/announcements/active')).body.card);
  check('bob still sees it', (await call(bob, 'GET', '/api/announcements/active')).body.card?.id === id);

  // End now removes it on the next fetch.
  await call(editor, 'POST', `/api/admin/announcements/${id}/end`);
  check('End now removes it on the next fetch', !(await call(bob, 'GET', '/api/announcements/active')).body.card);

  // A card past endsAt never shows (stored as scheduled but expired).
  await mongoose.connection.db.collection('announcements').insertOne({ title: 'Old', body: 'x', kind: 'feature', channels: ['card'], audience: {}, status: 'scheduled', startsAt: new Date(Date.now() - 3 * 86400000), endsAt: new Date(Date.now() - 86400000), createdAt: new Date() });
  check('a card past endsAt never shows', !(await call(bob, 'GET', '/api/announcements/active')).body.card);

  // Approval: security and full-screen need a second superadmin.
  const fsDraft = await call(adminA, 'POST', '/api/admin/announcements', { title: 'Outage', body: 'We are down', kind: 'outage', channels: ['card', 'fullscreen'], startsAt: past, endsAt: future });
  check('full-screen outage draft saved', fsDraft.status === 201, JSON.stringify(fsDraft.body));
  const fid = fsDraft.body.id;
  check('cannot schedule without a test', (await call(adminA, 'PATCH', `/api/admin/announcements/${fid}`, { status: 'scheduled' })).status === 400);
  const t = await call(adminA, 'POST', `/api/admin/announcements/${fid}/test`);
  check('Send me a test works for a card-only preview', t.status === 200 && t.body.ok, JSON.stringify(t.body));
  const s1 = await call(adminA, 'PATCH', `/api/admin/announcements/${fid}`, { status: 'scheduled' });
  check('cannot schedule without a second superadmin', s1.status === 400 && /second superadmin/.test(s1.body.message), JSON.stringify(s1.body));
  const own = await call(adminA, 'POST', `/api/admin/announcements/${fid}/approve`);
  check('the creator cannot approve their own', own.status === 403, JSON.stringify(own.body));
  check('an editor cannot approve', (await call(editor, 'POST', `/api/admin/announcements/${fid}/approve`)).status === 403);
  const ok = await call(adminB, 'POST', `/api/admin/announcements/${fid}/approve`);
  check('a second superadmin can approve', ok.status === 200 && ok.body.approvedBy, JSON.stringify(ok.body));
  const s2 = await call(adminA, 'PATCH', `/api/admin/announcements/${fid}`, { status: 'scheduled' });
  check('now it schedules', s2.status === 200, JSON.stringify(s2.body));

  // Full-screen shows once.
  const f1 = await call(bob, 'GET', '/api/announcements/active');
  check('full-screen is served', f1.body.fullscreen?.length === 1 && f1.body.card?.id === fid, JSON.stringify(f1.body));
  await call(bob, 'POST', `/api/announcements/${fid}/seen`);
  const f2 = await call(bob, 'GET', '/api/announcements/active');
  check('full-screen shows once', (f2.body.fullscreen || []).length === 0);
  check('the card is still there until dismissed', f2.body.card?.id === fid);

  // Editing clears the test and approval.
  const draft2 = await call(adminA, 'POST', '/api/admin/announcements', { title: 'Sec', body: 'b', kind: 'security', channels: ['card'], startsAt: future, endsAt: new Date(Date.now() + 3 * 86400000).toISOString() });
  await call(adminB, 'POST', `/api/admin/announcements/${draft2.body.id}/approve`);
  const edited = await call(adminA, 'PATCH', `/api/admin/announcements/${draft2.body.id}`, { title: 'Sec changed' });
  check('editing clears approval', edited.status === 200 && !edited.body.approvedBy, JSON.stringify(edited.body));
  const del = await call(adminA, 'DELETE', `/api/admin/announcements/${draft2.body.id}`);
  check('a draft can be deleted', del.status === 200);

  // Stats.
  const st = await call(adminA, 'GET', `/api/admin/announcements/${id}`);
  check('stats count delivered, seen, dismissed', st.body.stats.delivered >= 2 && st.body.stats.dismissed === 1 && st.body.stats.emailOpened === null, JSON.stringify(st.body.stats));

  // Profile consent round trip.
  await call(alice, 'PUT', '/api/me', { productEmails: false });
  check('product emails can be turned off in the profile', (await call(alice, 'GET', '/api/me')).body.productEmails === false);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
