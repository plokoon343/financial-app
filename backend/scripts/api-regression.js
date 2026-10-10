// API regression checks (bugs found in the Oct 2026 brief, workstream 2), run against
// a local API on a throwaway database that the script creates and drops.
//
//   MONGODB_URI=mongodb://localhost:27017/automonie_test PORT=5099 node server.js
//   API_URL=http://localhost:5099 TEST_DB=mongodb://localhost:27017/automonie_test node scripts/api-regression.js
'use strict';
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const API = process.env.API_URL || 'http://localhost:5099';
const DB = process.env.TEST_DB || 'mongodb://localhost:27017/automonie_test';
// It drops the database it uses, so it refuses anything that isn't clearly a test one.
if (!/_test(\?|$)/.test(DB)) { console.error('TEST_DB must name a *_test database.'); process.exit(1); }
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) { pass++; console.log('ok  ', label); } else { fail++; console.log('FAIL', label, extra); } };

async function main() {
  await mongoose.connect(DB);
  await mongoose.connection.db.dropDatabase();
  const users = mongoose.connection.db.collection('users');
  const { insertedId } = await users.insertOne({ name: 'Test User', email: 'ws2@example.test', password: 'x', createdAt: new Date() });
  const token = jwt.sign({ userId: insertedId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const call = async (method, path, body, headers = H) => {
    const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, body: j };
  };
  const txns = () => mongoose.connection.db.collection('transactions').find({ userId: insertedId }).toArray();

  // ── 2.1: bank-app notifications ──
  const { body: k } = await call('POST', '/api/capture/key');
  const CH = { 'x-capture-key': k.key, 'Content-Type': 'application/json' };
  const cap = (text, app = 'team.opay.pay') => call('POST', '/api/ingest/capture', { source: 'notification', app, text, postedAt: Date.now() }, CH);
  const r1 = await cap('Debit Alert\nAcct: 11*****865\nAmt: NGN5,000.00\nDesc: POS PURCHASE SHOPRITE IKEJA\nAvail Bal: NGN12,000.00');
  check('2.1 debit saved as expense', r1.body?.saved && r1.body.type === 'expense', JSON.stringify(r1.body));
  const r2 = await cap('You have received NGN 20,000.00 from JOHN DOE. Ref: 123456789. Bal: NGN 28,000.00');
  check('2.1 credit saved as income', r2.body?.saved && r2.body.type === 'income', JSON.stringify(r2.body));
  const r3 = await cap('Your OTP to authorise a debit of NGN 5,000.00 on account 012***45 is 482913. Do not share it.');
  check('2.1 OTP ignored', r3.body?.ignored, JSON.stringify(r3.body));
  const r4 = await cap('Get a loan of up to N500,000 credited to your account in 5 minutes. Apply now!');
  check('2.1 loan offer ignored', r4.body?.ignored, JSON.stringify(r4.body));
  const r5 = await cap('OWealth update: acct bal NGN 52,000.00 at 08:00');
  check('2.1 balance-only push ignored', r5.body?.ignored, JSON.stringify(r5.body));
  const r6 = await cap('Your available balance is NGN 12,450.00 as at 03-Oct-2026');
  check('2.1 balance enquiry ignored', r6.body?.ignored, JSON.stringify(r6.body));
  const r7 = await cap('Reversal: NGN 3,000.00 has been credited back to your account. Ref: 99812');
  const rev = (await txns()).find((t) => /Reversal/i.test(t.description) || t.amount === 3000);
  check('2.1 reversal is not counted as income', r7.body?.saved && rev && rev.type === 'reversal', JSON.stringify(rev && rev.type));
  const all = await txns();
  check('2.1 exactly 3 rows in the ledger', all.length === 3, all.map((t) => `${t.type} ${t.amount}`).join(', '));

  // ── 2.3: "Not one" sticks ──
  const day = (m) => new Date(Date.UTC(2026, m, 5)).toISOString();
  for (const m of [6, 7, 8]) await call('POST', '/api/transactions', { date: day(m), description: 'WEB PAY GYMSHARK MONTHLY FEE', amount: -9000, category: 'Fitness', type: 'expense' });
  let ac = await call('GET', '/api/action-center');
  const det = ac.body.items.find((i) => i.type === 'track_subscription');
  check('2.3 recurring charge suggested, with its key', det && det.key, JSON.stringify(det));
  await call('POST', '/api/subscriptions/dismiss-detected', { key: det.key, name: det.name });
  ac = await call('GET', '/api/action-center');
  check('2.3 gone after Not one', !ac.body.items.some((i) => i.type === 'track_subscription' && i.key === det.key));
  await call('POST', '/api/transactions', { date: day(9), description: 'WEB PAY GYMSHARK MONTHLY FEE', amount: -9000, category: 'Fitness', type: 'expense' });
  ac = await call('GET', '/api/action-center');
  const det2 = await call('GET', '/api/subscriptions/detect');
  check('2.3 still gone after a new charge', !ac.body.items.some((i) => i.key === det.key) && !det2.body.some((d) => d.key === det.key));
  // A charge auto-linked as a subscription, deleted, then charged again.
  await call('POST', '/api/transactions', { date: day(8), description: 'POSWEB PURCHASE N FLX AMSTERDAM', amount: -4400, category: 'Subscriptions', type: 'expense' });
  let subs = (await call('GET', '/api/subscriptions')).body;
  const nf = (Array.isArray(subs) ? subs : subs.subscriptions || []).find((s) => /netflix/i.test(s.name));
  check('2.3 Netflix auto-tracked', !!nf, JSON.stringify(subs).slice(0, 200));
  await call('DELETE', `/api/subscriptions/${nf._id || nf.id}`);
  await call('POST', '/api/transactions', { date: day(9), description: 'NETFLIX.COM LAGOS NG', amount: -4400, category: 'Subscriptions', type: 'expense' });
  subs = (await call('GET', '/api/subscriptions')).body;
  check('2.3 deleted Netflix does not come back on the next charge', !(Array.isArray(subs) ? subs : subs.subscriptions || []).some((s) => /netflix/i.test(s.name)));

  // ── 2.4: delete a bank ──
  let accts = (await call('GET', '/api/accounts')).body.accounts;
  const opay = accts.find((a) => a.accountMask);
  check('2.4 account detected from alerts', !!opay, JSON.stringify(accts));
  const del = await call('DELETE', `/api/accounts/${opay.id}`);
  accts = (await call('GET', '/api/accounts')).body.accounts;
  check('2.4 deleted (kept transactions)', del.status === 200 && !accts.some((a) => a.id === opay.id));
  check('2.4 its transactions are kept', (await txns()).some((t) => t.accountMask === opay.accountMask));
  await cap('Debit Alert\nAcct: 11*****865\nAmt: NGN1,200.00\nDesc: POS PURCHASE SPAR LEKKI\nAvail Bal: NGN10,800.00');
  accts = (await call('GET', '/api/accounts')).body.accounts;
  check('2.4 a new alert does not bring it back', !accts.some((a) => a.id === opay.id));
  await call('POST', `/api/accounts/${opay.id}/restore`);
  accts = (await call('GET', '/api/accounts')).body.accounts;
  check('2.4 restore (undo) brings it back', accts.some((a) => a.id === opay.id));
  const before = (await txns()).filter((t) => t.accountMask === opay.accountMask).length;
  const del2 = await call('DELETE', `/api/accounts/${opay.id}?withTransactions=1`);
  check('2.4 delete with transactions removes them', del2.body.transactionsDeleted === before && !(await txns()).some((t) => t.accountMask === opay.accountMask), `${before} vs ${JSON.stringify(del2.body)}`);
  // Unknown sender, then 'Not a bank'.
  await call('POST', '/api/ingest/capture', { source: 'sms', sender: 'XYZMFB', text: 'Debit Alert\nAmt: NGN2,000.00\nDesc: POS PURCHASE MAMA PUT\nAvail Bal: NGN8,000.00' }, CH);
  let un = (await call('GET', '/api/senders/unknown')).body.senders;
  check('2.4 unknown sender listed', un.some((u) => u.senderKey === 'XYZMFB'), JSON.stringify(un));
  await call('POST', '/api/senders/dismiss', { senderKey: 'XYZMFB' });
  un = (await call('GET', '/api/senders/unknown')).body.senders;
  ac = await call('GET', '/api/action-center');
  check('2.4 Not a bank removes it everywhere', !un.some((u) => u.senderKey === 'XYZMFB') && !ac.body.items.some((i) => i.type === 'tag_sender' && i.senderKey === 'XYZMFB'));
  await call('POST', '/api/senders/undismiss', { senderKey: 'XYZMFB' });
  un = (await call('GET', '/api/senders/unknown')).body.senders;
  check('2.4 undo brings the sender back', un.some((u) => u.senderKey === 'XYZMFB'));

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
