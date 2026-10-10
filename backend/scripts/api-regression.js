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

  // ── 2.2: share to Automonie ──
  const share = (sharedText) => call('POST', '/api/ingest/share', { source: 'share', platform: 'android', sharedText, clientIdempotencyKey: `t-${Math.random()}` });
  const s1 = await share('You have received NGN 7,500.00 from ADA OBI. Ref: 5566. Bal: NGN 40,000.00');
  check('2.2 shared credit pre-fills as money in', s1.body?.candidate?.direction === 'credit' && s1.body.candidate.amount === 7500, JSON.stringify(s1.body));
  const s2 = await share('Debit Alert\nAcct: 22*****555\nAmt: NGN2,000.00\nDesc: POS PURCHASE MAMA PUT\nAvail Bal: NGN8,000.00');
  check('2.2 an alert already captured is flagged as a duplicate', s2.body?.candidate?.dedupe?.verdict === 'duplicate_suspected', JSON.stringify(s2.body?.candidate));
  const s3 = await share('OPay: NGN 3,100.00 at 14:02. Ref 77812');
  check('2.2 unclear direction is left for the user', s3.status === 200 && s3.body.candidate.direction === null, JSON.stringify(s3.body));
  const s4 = await share('Your OTP is 482913. Do not share it.');
  check('2.2 an OTP is not a transaction', s4.status === 422);

  // ── 3: accounts, full create / edit / merge ──
  const add = await call('POST', '/api/accounts', { bankCode: 'gtbank', label: 'Salary', type: 'current', accountMask: '0123456789' });
  check('3 add an account by hand (keeps the last 4 digits)', add.status === 201, JSON.stringify(add.body));
  accts = (await call('GET', '/api/accounts')).body.accounts;
  const gt = accts.find((a) => a.id === add.body.id);
  check('3 it is listed with its type', gt && gt.accountMask === '6789' && gt.type === 'current' && gt.label === 'Salary', JSON.stringify(gt));
  check('3 adding it twice is refused', (await call('POST', '/api/accounts', { bankCode: 'gtbank', accountMask: '6789' })).status === 409);
  check('3 a bank not on the list can be added by name', (await call('POST', '/api/accounts', { bankName: 'Mainstreet MFB' })).status === 201);
  await call('PATCH', `/api/accounts/${gt.id}`, { type: 'savings' });
  accts = (await call('GET', '/api/accounts')).body.accounts;
  check('3 changing the type keeps the name', accts.some((a) => a.id === gt.id && a.type === 'savings' && a.label === 'Salary'));
  // The same GTBank account detected again under other digits, then merged in.
  await cap('Debit Alert\nGTBank\nAcct: 01*****111\nAmt: NGN3,000.00\nDesc: POS PURCHASE ICE CREAM\nAvail Bal: NGN9,000.00', 'com.gtbank.gtworldv1');
  accts = (await call('GET', '/api/accounts')).body.accounts;
  const dup = accts.find((a) => a.bankCode === 'gtbank' && a.accountMask === '111');
  check('3 second GTBank fingerprint detected', !!dup, JSON.stringify(accts.map((a) => `${a.bankCode}:${a.accountMask}`)));
  const mg = await call('POST', `/api/accounts/${dup.id}/merge`, { into: gt.id });
  accts = (await call('GET', '/api/accounts')).body.accounts;
  check('3 merge moves its transactions over', mg.body?.moved === 1 && !accts.some((a) => a.id === dup.id) && (await txns()).some((t) => /ICE CREAM/.test(t.description) && t.accountMask === '6789'), JSON.stringify(mg.body));
  await cap('Debit Alert\nGTBank\nAcct: 01*****111\nAmt: NGN1,500.00\nDesc: POS PURCHASE SUYA SPOT\nAvail Bal: NGN7,500.00', 'com.gtbank.gtworldv1');
  check('3 later alerts for the merged account follow it', (await txns()).some((t) => /SUYA/.test(t.description) && t.accountMask === '6789'));
  check('3 a merged account cannot be "restored" over its new home', (await call('POST', `/api/accounts/${dup.id}/restore`)).status === 404);
  const noDigits = (await call('GET', '/api/accounts')).body.accounts.find((a) => a.bankName === 'Mainstreet MFB');
  check('3 an account without digits never deletes other rows', (await call('DELETE', `/api/accounts/${noDigits.id}?withTransactions=1`)).status === 400);

  // ── 4: people folded into transactions and insights; Shared Expenses off ──
  const feats = (await call('GET', '/api/features')).body;
  check('4.1 Shared Expenses is off by default', feats.sharedExpenses === false, JSON.stringify(feats));
  const t1 = (await call('POST', '/api/transactions', { date: day(8), description: 'NIP TRANSFER TO ADA OBI', amount: -15000, category: 'Transfer', type: 'expense' })).body;
  await call('POST', '/api/transactions', { date: day(9), description: 'NIP TRANSFER TO ADA OBI', amount: -5000, category: 'Transfer', type: 'expense' });
  await call('POST', '/api/contacts/rebuild');
  const pr = await call('GET', `/api/transactions/${t1._id}/person`);
  check('4.3 a transfer knows its person', pr.body?.person?.name && /ADA OBI/i.test(pr.body.person.name), JSON.stringify(pr.body));
  const ln = (await call('GET', '/api/contacts/links')).body.links || {};
  check('4.3 both transfers link to the same person', ln[t1._id] && Object.values(ln).filter((v) => v === ln[t1._id]).length === 2, JSON.stringify(ln));
  const lab = await call('PATCH', `/api/contacts/${pr.body.person.id}`, { relationship: 'family', applyToPast: true });
  check('4.3 labelling a person recategorises their transfers', lab.body?.recategorized === 2 && (await txns()).filter((t) => /ADA OBI/.test(t.description)).every((t) => t.category === 'Family & Friends'), JSON.stringify(lab.body));
  check('4.3 the family question starts unanswered', (await call('GET', '/api/contacts')).body.familyPromptDone === false);
  await call('POST', '/api/contacts/family-prompt/done');
  check('4.3 and is only asked once', (await call('GET', '/api/contacts')).body.familyPromptDone === true);

  // ── 8: newsletter signup ──
  const NO_AUTH = { 'Content-Type': 'application/json' };
  check('8 newsletter needs a real email', (await call('POST', '/api/newsletter/subscribe', { email: 'nope' }, NO_AUTH)).status === 400);
  const ns = await call('POST', '/api/newsletter/subscribe', { email: 'Reader@Example.test', name: 'Ngozi Eze' }, NO_AUTH);
  await call('POST', '/api/newsletter/subscribe', { email: 'reader@example.test' }, NO_AUTH);
  const wl = mongoose.connection.db.collection('waitlists');
  const readers = await wl.find({ email: 'reader@example.test' }).toArray();
  check('8 subscribing twice keeps one subscriber, flagged for the newsletter', ns.status === 200 && readers.length === 1 && readers[0].newsletter === true, JSON.stringify(readers));
  await wl.updateOne({ email: 'reader@example.test' }, { $set: { unsubscribed: true } });
  await call('POST', '/api/newsletter/subscribe', { email: 'reader@example.test' }, NO_AUTH);
  check('8 subscribing again after unsubscribing turns it back on', (await wl.findOne({ email: 'reader@example.test' })).unsubscribed === false);

  // ── 7: onboarding by bank, tips, help ──
  const bm = (await call('GET', '/api/banks/methods?platform=android')).body.banks;
  check('7 OPay on Android starts with app notifications', bm.find((b) => b.code === 'opay')?.best === 'notifications');
  check('7 a bank with no alert-email domain never offers email', !bm.find((b) => b.code === 'suntrust').methods.some((m) => m.method === 'email'));
  const pb = (await call('PUT', '/api/me/banks', { codes: ['gtbank', 'kuda', 'not-a-bank'], other: ['Mainstreet MFB'] })).body;
  check('7 unknown codes are dropped, Other kept', pb.codes.join() === 'gtbank,kuda' && pb.other[0] === 'Mainstreet MFB', JSON.stringify(pb));
  const mb = (await call('GET', '/api/me/banks?platform=web')).body;
  check('7 banks used come back with best method and connected state', mb.banks.length === 2 && mb.banks.find((b) => b.code === 'gtbank').connected === true && mb.banks.find((b) => b.code === 'kuda').connected === false, JSON.stringify(mb.banks.map((b) => [b.code, b.best, b.connected])));
  check('7 a tip id is validated', (await call('POST', '/api/me/tips', { id: 'bad id!' })).status === 400);
  await call('POST', '/api/me/tips', { id: 'screen:home' });
  check('7 a seen tip is kept on the account', (await call('GET', '/api/me')).body.seenTips.includes('screen:home'));
  await call('DELETE', '/api/me/tips');
  check('7 tips can be reset', (await call('GET', '/api/me')).body.seenTips.length === 0);
  const help = (await call('GET', '/api/help', null, {})).body;
  check('7 help has the Gmail and Outlook guides', help.sections.some((s) => s.id === 'email-gmail') && help.sections.some((s) => s.id === 'email-outlook'));

  // ── 6: push nudges (run with CRON_SECRET and PUSH_DISABLED=true on the API) ──
  if (process.env.CRON_SECRET) {
    const CRON = { 'x-cron-secret': process.env.CRON_SECRET, 'Content-Type': 'application/json' };
    const runAt = async (lagosIso) => {
      const at = new Date(new Date(`${lagosIso}Z`).getTime() - 3600000).toISOString(); // Lagos is UTC+1
      return (await call('POST', `/api/cron/nudges?wait=1&at=${encodeURIComponent(at)}`, null, CRON)).body;
    };
    const users = mongoose.connection.db.collection('users');
    await users.updateOne({ _id: insertedId }, { $set: { pushTokens: ['ExponentPushToken[test-device]'], createdAt: new Date('2026-01-01') } });
    const nlogs = () => mongoose.connection.db.collection('nudgelogs').find({ userId: insertedId }).sort({ sentAt: 1 }).toArray();
    const ps = (await call('GET', '/api/push/settings')).body;
    check('6 settings: all categories on, amounts off by default', Object.values(ps.categories).every(Boolean) && ps.showAmounts === false, JSON.stringify(ps));
    // A bill due in 3 days.
    await call('POST', '/api/bills', { name: 'Rent', amount: 150000, dueDate: 17, frequency: 'monthly', category: 'Housing' });
    await mongoose.connection.db.collection('recurringbills').updateOne({ userId: insertedId }, { $set: { nextDue: new Date('2026-10-17T09:00:00Z') } });
    check('6 nothing during quiet hours', (await runAt('2026-10-14T23:30:00')).sent === 0);
    const r1 = await runAt('2026-10-14T09:00:00');
    let L = await nlogs();
    check('6 bill due in 3 days is sent first', r1.sent === 1 && L[0]?.trigger === 'bill_due', JSON.stringify(L.map((l) => l.trigger)));
    check('6 at most every 3 hours', (await runAt('2026-10-14T10:00:00')).sent === 0);
    check('6 the same bill is never sent twice', (await runAt('2026-10-14T13:00:00')).sent === 0 || (await nlogs()).filter((l) => l.trigger === 'bill_due').length === 1);
    const bell = await mongoose.connection.db.collection('notifications').find({ userId: insertedId, title: 'Bill reminder' }).toArray();
    check('6 the text is in the bell, with no amount', bell.length === 1 && !/₦|NGN|150/.test(bell[0].message), JSON.stringify(bell.map((b) => b.message)));
    await call('POST', `/api/nudges/${L[0]._id}/opened`);
    check('6 a tap is recorded as opened', !!(await nlogs())[0].openedAt);
    // Switching the category off stops it.
    await call('POST', '/api/push/settings', { categories: { bills: false, recap: false } });
    await mongoose.connection.db.collection('recurringbills').updateOne({ userId: insertedId }, { $set: { nextDue: new Date('2026-10-20T09:00:00Z') } });
    const before = (await nlogs()).length;
    await runAt('2026-10-17T10:00:00');
    check('6 a category switched off is not sent', (await nlogs()).filter((l) => l.trigger === 'bill_due').length === 1 && (await nlogs()).length >= before);
    check('6 the old address still runs the job', (await call('POST', '/api/cron/insights?wait=1', null, CRON)).status === 200);
    check('6 cron needs the secret', (await call('POST', '/api/cron/nudges?wait=1', null, { 'Content-Type': 'application/json' })).status === 401);
    // The admin report and editing the copy.
    check('6 the report is admin-only', (await call('GET', '/api/admin/nudges')).status === 403);
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const rep = (await call('GET', '/api/admin/nudges?days=30')).body;
    const billLines = rep.triggers.find((t) => t.trigger === 'bill_due').variants;
    check('6 report counts sends and opens per line', billLines.reduce((a, v) => a + v.sent, 0) === 1 && billLines.reduce((a, v) => a + v.opened, 0) === 1 && billLines.some((v) => v.openRate === 100), JSON.stringify(billLines));
    check('6 a line with an amount is refused', (await call('PUT', '/api/admin/nudges/bill_due/bill-1', { text: 'Pay ₦5,000 now' })).status === 400);
    check('6 an emoji is refused', (await call('PUT', '/api/admin/nudges/bill_due/bill-1', { text: 'Pay up 🙏' })).status === 400);
    await call('PUT', '/api/admin/nudges/bill_due/bill-3', { text: 'Heads up: {bill} is coming on {date}.' });
    check('6 a new line can be added without a release', (await call('GET', '/api/admin/nudges')).body.triggers.find((t) => t.trigger === 'bill_due').variants.some((v) => v.id === 'bill-3'));
  } else {
    console.log('skip 6: start the API with CRON_SECRET and PUSH_DISABLED=true, and pass CRON_SECRET here');
  }

  // ── 9: plans, trial, Student verification ──
  {
    const users = mongoose.connection.db.collection('users');
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user', createdAt: new Date(), plan: 'free' }, $unset: { planExpiry: 1 } });
    let bs = (await call('GET', '/api/billing/status')).body;
    check('9 a new account is on a 14-day Plus trial', bs.tier === 'pro' && bs.source === 'trial' && bs.trialDaysLeft === 14 && bs.tierName === 'Plus', JSON.stringify({ tier: bs.tier, source: bs.source, d: bs.trialDaysLeft }));
    check('9 the catalog shows Plus, Student and Power', ['Plus', 'Student', 'Power'].every((n) => bs.plans.some((p) => p.name === n)));
    await users.updateOne({ _id: insertedId }, { $set: { createdAt: new Date(Date.now() - 20 * 86400000) } });
    bs = (await call('GET', '/api/billing/status')).body;
    check('9 after the trial, Free, with a clear flag for the app', bs.tier === 'free' && bs.trialEnded === true);
    const gated = await call('GET', '/api/reports/income-summary?format=html');
    check('9 a Plus feature asks for an upgrade on Free', gated.status === 402 && gated.body?.upgrade === true && gated.body.message.includes('Plus'), `${gated.status} ${JSON.stringify(gated.body)}`);
    // School email: only allow-listed institutions.
    check('9 a Gmail address is not a school email', (await call('POST', '/api/student/email', { email: 'ada@gmail.com' })).status === 400);
    check('9 can’t start Student unverified', (await call('POST', '/api/student/start')).status === 403);
    // Campaign code (admin-created) verifies straight away.
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const cc = await call('POST', '/api/admin/campaign-codes', { code: 'cds-ikeja', label: 'CDS Ikeja', maxUses: 1 });
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
    check('9 admin creates a campaign code', cc.status === 201 && cc.body.code === 'CDS-IKEJA', JSON.stringify(cc.body));
    const used = await call('POST', '/api/student/code', { code: 'cds-ikeja' });
    check('9 the code verifies the student', used.body?.status === 'verified' && used.body.method === 'code', JSON.stringify(used.body));
    const st = (await call('POST', '/api/student/start')).body;
    check('9 Student starts with the free months', st.free === true && st.plan === 'student' && Math.round((new Date(st.planExpiry) - Date.now()) / 86400000) === 90, JSON.stringify(st));
    bs = (await call('GET', '/api/billing/status')).body;
    check('9 Student plan in force', bs.tier === 'student' && bs.tierName === 'Student');
    check('9 the free months only once', (await call('POST', '/api/student/start')).body.checkout === true);
    // Codes have usage limits.
    const { insertedId: other } = await users.insertOne({ name: 'Other Student', email: 'other@example.test', password: 'x', createdAt: new Date() });
    const OH = { Authorization: `Bearer ${jwt.sign({ userId: other }, process.env.JWT_SECRET, { expiresIn: '1h' })}`, 'Content-Type': 'application/json' };
    check('9 a used-up code is refused', (await call('POST', '/api/student/code', { code: 'CDS-IKEJA' }, OH)).status === 400);
    // NYSC: state code + call-up letter, checked by an admin.
    const up = async (headers, stateCode) => {
      const fd = new FormData();
      fd.append('stateCode', stateCode);
      fd.append('image', new Blob([Buffer.from('fake-image-bytes')], { type: 'image/png' }), 'callup.png');
      const r = await fetch(`${API}/api/student/nysc`, { method: 'POST', headers: { Authorization: headers.Authorization }, body: fd });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    check('9 a bad state code is refused', (await up(OH, 'XX/99Z/1')).status === 400);
    const pending = await up(OH, 'la/25a/1234');
    check('9 a good upload waits for review', pending.status === 200 && pending.body.status === 'pending', JSON.stringify(pending.body));
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const queue = (await call('GET', '/api/admin/student-reviews')).body.items;
    const item = queue.find((q) => q.stateCode === 'LA/25A/1234');
    check('9 the admin queue shows it', !!item && item.user?.email === 'other@example.test', JSON.stringify(queue));
    const img = await fetch(`${API}/api/admin/student-reviews/${item.id}/image`, { headers: { Authorization: H.Authorization } });
    check('9 the admin can see the upload', img.status === 200);
    check('9 a rejection needs a reason', (await call('POST', `/api/admin/student-reviews/${item.id}/decision`, { approve: false })).status === 400);
    await call('POST', `/api/admin/student-reviews/${item.id}/decision`, { approve: true });
    const after = await fetch(`${API}/api/admin/student-reviews/${item.id}/image`, { headers: { Authorization: H.Authorization } });
    check('9 the image is deleted once decided', after.status === 404);
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
    const os = (await call('GET', '/api/student/status', null, OH)).body;
    check('9 approved corps member is verified', os.status === 'verified' && /NYSC LA\/25A\/1234/.test(os.institution), JSON.stringify(os));
  }

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
