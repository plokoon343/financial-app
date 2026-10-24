// API regression checks (bugs found in the Oct 2026 brief, workstream 2), run against
// a local API on a throwaway database that the script creates and drops.
// Start the API with PAYWALL_ENABLED=true: several checks below are about the Plus paywall
// (402 for Free), which is off by default while Automonie is in beta.
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

    // 9.3 receipts: rules read the total and date; Plus-gated; saved as a cash receipt row.
    const me = (await call('GET', '/api/me', null, OH)).body;
    check('9 /api/me carries the tier and trial days', me.tier === 'pro' && me.tierName === 'Plus' && me.trialDaysLeft === 14, JSON.stringify(me));
    const text = 'SHOPRITE\nLekki Mall\nSUBTOTAL 3,950.00\nTOTAL 4,246.25\nCHANGE 753.75\n12/09/2026 14:03';
    const rp = await call('POST', '/api/receipts/parse', { text }, OH);
    check('9 receipt: total, date and merchant by rules', rp.status === 200 && rp.body.total === 4246.25 && rp.body.date === '2026-09-12' && rp.body.merchant === 'Shoprite', JSON.stringify(rp.body));
    check('9 receipt: no text is refused', (await call('POST', '/api/receipts/parse', { text: '  ' }, OH)).status === 400);
    await users.updateOne({ _id: other }, { $set: { createdAt: new Date(Date.now() - 30 * 86400000) } });
    check('9 receipt: Free after the trial is asked to upgrade', (await call('POST', '/api/receipts/parse', { text }, OH)).status === 402);
    const saved = await call('POST', '/api/transactions', { date: '2026-09-12', description: 'Shoprite', amount: 4246.25, category: 'Groceries', type: 'expense', source: 'receipt', paymentMethod: 'cash' }, OH);
    check('9 receipt: saved as a cash receipt expense', saved.status === 201 && saved.body.source === 'receipt' && saved.body.paymentMethod === 'cash' && saved.body.amount === -4246.25, JSON.stringify(saved.body));
    check('9 receipt: an unknown payment method is dropped', (await call('POST', '/api/transactions', { date: '2026-09-12', description: 'X', amount: 1, category: 'Food', type: 'expense', paymentMethod: 'crypto' }, OH)).body.paymentMethod === '');
  }

  // ── 12: core metrics ──
  {
    const days = mongoose.connection.db.collection('activitydays');
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' }, $unset: { lastActiveAt: 1 } });
    await days.deleteMany({ userId: insertedId });
    await call('GET', '/api/me');
    await new Promise((r) => setTimeout(r, 300)); // the write is fire-and-forget
    const lagosToday = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
    check('12 using the app records today as an active day (Lagos)', !!(await days.findOne({ userId: insertedId, day: lagosToday })));
    await call('GET', '/api/me');
    await new Promise((r) => setTimeout(r, 300));
    check('12 one row per user per day', (await days.countDocuments({ userId: insertedId })) === 1);
    check('12 metrics are admin only', (await call('GET', '/api/admin/metrics')).status === 403);
    const reg = await fetch(`${API}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'android-play' }, body: JSON.stringify({ name: 'Metric Person', email: 'metric@example.test', phone: '08030000000', password: 'Str0ng!pass' }) });
    const rb = await reg.json().catch(() => ({}));
    if (rb.token) check('12 signup records the app it came from', (await users.findOne({ email: 'metric@example.test' }))?.signupClient === 'android-play');
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const mt = await call('GET', '/api/admin/metrics?weeks=4');
    check('12 metrics: shape', mt.status === 200 && mt.body.signups.length === 4 && mt.body.retention.length === 4 && mt.body.active.series.length === 30, JSON.stringify(mt.body).slice(0, 300));
    check('12 metrics: admins are not counted as users', mt.body.totals.users === await users.countDocuments({ role: 'user' }), `${mt.body.totals.users}`);
    check('12 metrics: imports and money present', typeof mt.body.imports.total === 'number' && typeof mt.body.money.mrr === 'number');
    if (rb.token) check('12 metrics: this week\'s signups include the new account', mt.body.signups[3].total >= 1 && (mt.body.signups[3].byClient['android-play'] || 0) >= 1, JSON.stringify(mt.body.signups[3]));
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
  }

  // ── 15: airtime and bills (run the API with FEATURE_BILL_PAYMENTS=true, test VTPASS_*
  // and PAYSTACK_SECRET_KEY, and VTPASS_TEST_BASE / PAYSTACK_TEST_BASE pointing here) ──
  if (process.env.BILLPAY_TEST_PORT) {
    const http = require('http');
    const crypto = require('crypto');
    const charges = {};          // paystack reference -> { amount, metadata, status }
    const vt = { pays: [], refunds: [], requery: {} };
    let n = 0;
    const fake = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const j = body ? JSON.parse(body) : {};
        const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const u = req.url;
        if (u === '/ps/transaction/initialize') { const ref = `ref-${++n}`; charges[ref] = { amount: j.amount, metadata: j.metadata, status: 'success', currency: 'NGN' }; return send(200, { data: { authorization_url: `http://pay/${ref}`, reference: ref } }); }
        if (u.startsWith('/ps/transaction/verify/')) { const c = charges[decodeURIComponent(u.split('/').pop())]; return send(200, { data: c ? { ...c, reference: u.split('/').pop() } : null }); }
        if (u === '/ps/refund') { vt.refunds.push(j.transaction); return send(200, { status: true }); }
        if (u.startsWith('/vt/service-variations')) return send(200, { content: { varations: [{ variation_code: 'mtn-1gb', name: '1GB 30 days', variation_amount: '1000' }] } });
        if (u === '/vt/pay') {
          vt.pays.push(j);
          if (j.phone === '08030000002') return send(200, { code: '016', response_description: 'TRANSACTION FAILED', content: { transactions: { status: 'failed' } } });
          if (j.phone === '08030000003') { vt.requery[j.request_id] = { code: '099' }; return req.socket.destroy(); }
          return send(200, { code: '000', content: { transactions: { status: 'delivered', transactionId: 'T1' } } });
        }
        if (u === '/vt/requery') return send(200, vt.requery[j.request_id] || { code: '099' });
        return send(404, {});
      });
    });
    await new Promise((r) => fake.listen(Number(process.env.BILLPAY_TEST_PORT), r));
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
    const bills = mongoose.connection.db.collection('billpayments');
    const buy = (b) => call('POST', '/api/billpay/checkout', { billType: 'airtime', serviceID: 'mtn', amount: 500, ...b });

    check('15 the feature flag is on in this run', (await call('GET', '/api/billpay/config')).body.enabled === true);
    const c1 = await buy({ phone: '08030000001' });
    check('15 checkout opens a card payment for the exact amount', c1.status === 200 && charges[c1.body.reference]?.amount === 50000 && c1.body.bill.status === 'awaiting_payment', JSON.stringify(c1.body));
    const f1 = await call('POST', '/api/billpay/confirm', { reference: c1.body.reference });
    check('15 a confirmed card payment buys the airtime', f1.body.bill?.status === 'completed' && vt.pays.length === 1, JSON.stringify(f1.body));
    const spent = await mongoose.connection.db.collection('transactions').findOne({ userId: insertedId, description: 'MTN airtime for 08030000001' });
    check('15 it is recorded as card spending on Airtime & Data', spent && spent.amount === -500 && spent.category === 'Airtime & Data' && spent.paymentMethod === 'card');
    await call('POST', '/api/billpay/confirm', { reference: c1.body.reference });
    const sig = (b) => crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(b).digest('hex');
    const hook = async (ref) => { const b = JSON.stringify({ event: 'charge.success', data: { ...charges[ref], reference: ref } }); return fetch(`${API}/api/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': sig(b) }, body: b }); };
    await hook(c1.body.reference);
    check('15 a repeat confirm or webhook never buys twice', vt.pays.length === 1);

    const c2 = await buy({ phone: '08030000002' });
    const f2 = await call('POST', '/api/billpay/confirm', { reference: c2.body.reference });
    check('15 a declined purchase is refunded to the card', f2.body.bill?.status === 'refunded' && vt.refunds.includes(c2.body.reference), JSON.stringify(f2.body));

    const c3 = await buy({ phone: '08030000001' });
    charges[c3.body.reference].status = 'abandoned';
    const pays = vt.pays.length;
    const f3 = await call('POST', '/api/billpay/confirm', { reference: c3.body.reference });
    check('15 nothing is bought until the card payment succeeds', f3.body.bill?.status === 'awaiting_payment' && vt.pays.length === pays);

    const c4 = await buy({ phone: '08030000003' });
    const f4 = await call('POST', '/api/billpay/confirm', { reference: c4.body.reference });
    check('15 an unclear outcome stays pending, with no refund', f4.body.bill?.status === 'pending' && !vt.refunds.includes(c4.body.reference), JSON.stringify(f4.body));
    const rid = (await bills.findOne({ paystackRef: c4.body.reference })).requestId;
    vt.requery[rid] = { code: '000', content: { transactions: { status: 'delivered' } } };
    await bills.updateOne({ paystackRef: c4.body.reference }, { $set: { updatedAt: new Date(Date.now() - 10 * 60000) } });
    await fetch(`${API}/api/cron/billpay`, { method: 'POST', headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    check('15 the re-check completes it once the provider confirms', (await bills.findOne({ paystackRef: c4.body.reference })).status === 'completed');

    const c5 = await call('POST', '/api/billpay/checkout', { billType: 'data', serviceID: 'mtn-data', phone: '08030000001', variationCode: 'mtn-1gb', amount: 1 });
    check('15 data is priced by the provider, not the client', c5.status === 200 && charges[c5.body.reference]?.amount === 100000, JSON.stringify(c5.body));

    const c6 = await buy({ phone: '08030000001' });
    charges[c6.body.reference].amount = 100;
    const f6 = await call('POST', '/api/billpay/confirm', { reference: c6.body.reference });
    check('15 a payment for the wrong amount is refunded, not used', f6.body.bill?.status === 'refunded' && vt.refunds.includes(c6.body.reference));

    const c7 = await buy({ phone: '08030000001' });
    const h7 = await hook(c7.body.reference);
    check('15 the signed Paystack webhook completes a purchase', h7.status === 200 && (await bills.findOne({ paystackRef: c7.body.reference })).status === 'completed');
    const bad = JSON.stringify({ event: 'charge.success', data: charges[c7.body.reference] });
    check('15 an unsigned webhook is refused', (await fetch(`${API}/api/paystack/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-paystack-signature': 'nope' }, body: bad })).status === 401);

    check('15 a bad phone number is refused', (await buy({ phone: '123' })).status === 400);
    const hist = (await call('GET', '/api/billpay/history')).body.items;
    check('15 history lists the purchases', hist.length >= 6 && hist.every((h) => h.description && h.status));
    fake.close();
  }

  // ── 11: AI provider layer (run the API with AI_TEST_BASE=http://localhost:5097) ──
  if (process.env.AI_TEST_BASE) {
    const http = require('http');
    const seen = [];
    const fake = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const j = JSON.parse(body || '{}');
        const sys = j.messages?.find((m) => m.role === 'system')?.content || '';
        const user = j.messages?.find((m) => m.role === 'user')?.content || '';
        seen.push({ sys, user });
        let reply = '{}';
        // The chat: "delete/change the newest" makes the stand-in propose it, then claim
        // it's done (which the guard must correct).
        const ask = (user.match(/My question\/request: (.*)$/m) || [])[1] || '';
        const answered = j.messages?.some((m) => m.role === 'tool');
        const propose = { 'delete the newest': ['propose_delete_transaction', { ref: 1 }], 'change the newest': ['propose_edit_transaction', { ref: 1, category: 'Groceries' }], 'delete number 99': ['propose_delete_transaction', { ref: 99 }] }[ask];
        if (propose && !answered) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: propose[0], arguments: JSON.stringify(propose[1]) } }] } }] }));
        }
        if (propose) reply = 'I deleted it for you.';
        if (/shop and merchant names/.test(sys)) {
          const items = [...user.matchAll(/^- (.+)$/gm)].map((m) => ({ merchant: m[1], category: /SHOPRITE/i.test(m[1]) ? 'Groceries' : 'Other' }));
          reply = JSON.stringify({ items });
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
      });
    });
    await new Promise((r) => fake.listen(new URL(process.env.AI_TEST_BASE).port, r));
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user', plan: 'pro', planExpiry: new Date(Date.now() + 30 * 86400000) } });
    for (const d of ['POS PURCHASE SHOPRITE LEKKI 4500', 'POS PURCHASE SHOPRITE LEKKI 1200', 'NIP TRF TO ADEBAYO OKONKWO 0123456789']) {
      await call('POST', '/api/transactions', { date: '2026-10-01', description: d, amount: 1000, category: 'Other', type: 'expense' });
    }
    const s1 = await call('GET', '/api/ai/merchants/suggest');
    const shop = (s1.body.proposals || []).find((p) => /SHOPRITE/.test(p.merchant));
    check('11 merchants: "Other" spending gets an AI category to confirm', s1.status === 200 && shop?.category === 'Groceries' && shop.count === 2, JSON.stringify(s1.body));
    const asked = seen.filter((x) => /shop and merchant names/.test(x.sys));
    check('11 merchants: one request for all merchants', asked.length === 1);
    // The assistant keeps the conversation (run the API with AI_ASSISTANT_ENABLED=true).
    if (process.env.AI_ASSISTANT_ENABLED === 'true') {
      await call('DELETE', '/api/ai/history');
      const c1 = await call('POST', '/api/ai/chat', { message: 'Where did my money go?' });
      const h1 = (await call('GET', '/api/ai/history')).body.messages || [];
      check('11 chat: the conversation is saved for next time', c1.status === 200 && h1.length === 2 && h1[0].content === 'Where did my money go?' && h1[1].role === 'assistant', JSON.stringify(h1));
      await call('DELETE', '/api/ai/history');
      check('11 chat: "New chat" clears it', ((await call('GET', '/api/ai/history')).body.messages || []).length === 0);
      // Edits and deletes are only proposed: nothing is written until the user confirms.
      const before = (await txns()).length;
      const d1 = await call('POST', '/api/ai/chat', { message: 'delete the newest' });
      const pd = d1.body.actions?.[0];
      const target = pd?.proposal && (await txns()).find((t) => String(t._id) === pd.proposal.id);
      check('11 chat: a delete is proposed, not done', d1.status === 200 && pd?.pending && pd.proposal.kind === 'delete' && !!target && (await txns()).length === before && d1.body.changed === false, JSON.stringify(d1.body));
      check('11 chat: a false "I deleted it" becomes "tap Confirm"', /tap Confirm/.test(d1.body.reply || '') && !/I deleted/.test(d1.body.reply || ''), d1.body.reply);
      check('11 chat: the snapshot numbers the recent transactions', seen.some((x) => /^ {2}#1 {2}\d{4}-\d{2}-\d{2}/m.test(x.user)));
      const e1 = await call('POST', '/api/ai/chat', { message: 'change the newest' });
      const pe = e1.body.actions?.[0];
      const unchanged = pe?.proposal && (await txns()).find((t) => String(t._id) === pe.proposal.id);
      check('11 chat: an edit is proposed with its change, not applied', pe?.pending && pe.proposal.kind === 'edit' && pe.proposal.changes?.category === 'Groceries' && unchanged && unchanged.category !== 'Groceries', JSON.stringify(e1.body));
      const x1 = await call('POST', '/api/ai/chat', { message: 'delete number 99' });
      check('11 chat: a number outside the list is refused', x1.body.actions?.[0]?.ok === false && !x1.body.actions[0].pending, JSON.stringify(x1.body.actions));
      check('11 chat: confirming deletes through the normal route', (await call('DELETE', `/api/transactions/${pd.proposal.id}`)).status === 200 && (await txns()).length === before - 1);
      await call('DELETE', '/api/ai/history');
    }
    check('11 merchants: no digits reach the free tier', !/\d/.test(asked[0]?.user || 'x'), asked[0]?.user);
    check('11 merchants: person transfers never reach the free tier', !/ADEBAYO|OKONKWO/.test(asked[0]?.user || ''));
    await call('GET', '/api/ai/merchants/suggest');
    check('11 merchants: answers are cached (no second request)', seen.filter((x) => /shop and merchant names/.test(x.sys)).length === 1);
    const ap = await call('POST', '/api/ai/purpose/apply', { txnIds: shop.txnIds, category: 'Groceries' });
    check('11 merchants: confirming applies the category', ap.status === 200 && ap.body.updated === 2, JSON.stringify(ap.body));
    check('11 merchants: an unknown category is refused', (await call('POST', '/api/ai/purpose/apply', { txnIds: shop.txnIds, category: 'Loans' })).status === 400);
    await users.updateOne({ _id: insertedId }, { $set: { plan: 'free' }, $unset: { planExpiry: 1 } });
    check('11 merchants: a Plus feature', (await call('GET', '/api/ai/merchants/suggest')).status === 402);
    fake.close();
  }

  // ── Google Play Billing (run the API with GOOGLE_PLAY_TEST_BASE=http://localhost:5098,
  // a GOOGLE_PLAY_SERVICE_ACCOUNT test key and PLAY_RTDN_SECRET=rtdn-test) ──
  if (process.env.GOOGLE_PLAY_TEST_BASE) {
    const http = require('http');
    const { accountIdFor } = require('../lib/googlePlay');
    await users.updateOne({ _id: insertedId }, { $set: { plan: 'free', createdAt: new Date('2026-01-01'), planEverPaid: false }, $unset: { planExpiry: 1, playToken: 1 } });
    const mine = accountIdFor(insertedId, process.env.PLAY_ACCOUNT_SECRET || process.env.JWT_SECRET);
    const later = new Date(Date.now() + 30 * 86400000).toISOString();
    // A stand-in for Google: purchase tokens and their state, and what was acknowledged.
    const subs = {
      'tok-a': { state: 'SUBSCRIPTION_STATE_ACTIVE', product: 'plus_monthly', account: mine, ack: false },
      'tok-other': { state: 'SUBSCRIPTION_STATE_ACTIVE', product: 'plus_monthly', account: 'someone-else', ack: false },
      'tok-pending': { state: 'SUBSCRIPTION_STATE_PENDING', product: 'plus_monthly', account: mine, ack: false },
    };
    const acked = [];
    const fake = http.createServer((req, res) => {
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj ? JSON.stringify(obj) : ''); };
      if (req.url === '/token') return send(200, { access_token: 'fake', expires_in: 3600 });
      const m = req.url.match(/\/purchases\/subscriptionsv2\/tokens\/([^/?]+)$/);
      if (m) {
        const s = subs[decodeURIComponent(m[1])];
        if (!s) return send(404);
        return send(200, {
          subscriptionState: s.state,
          acknowledgementState: s.ack ? 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' : 'ACKNOWLEDGEMENT_STATE_PENDING',
          externalAccountIdentifiers: { obfuscatedExternalAccountId: s.account },
          lineItems: [{ productId: s.product, expiryTime: s.expiry || later, autoRenewingPlan: { autoRenewEnabled: true } }],
        });
      }
      const a = req.url.match(/\/tokens\/([^/?]+):acknowledge$/);
      if (a) { const t = decodeURIComponent(a[1]); acked.push(t); if (subs[t]) subs[t].ack = true; return send(204); }
      return send(404);
    });
    await new Promise((r) => fake.listen(new URL(process.env.GOOGLE_PLAY_TEST_BASE).port, r));

    const st = (await call('GET', '/api/billing/status')).body;
    check('play: billing status gives the product ids and this account\'s id', st.play?.products?.pro === 'plus_monthly' && st.play?.products?.student === 'student_monthly' && st.play?.accountId === mine, JSON.stringify(st.play));
    check('play: the trial is over for this user', st.tier === 'free');
    const v = await call('POST', '/api/billing/play/verify', { purchaseToken: 'tok-a' });
    check('play: a verified purchase turns on Plus until Google\'s expiry', v.status === 200 && v.body.isPro && v.body.plan === 'pro' && Math.abs(new Date(v.body.planExpiry) - new Date(later)) < 1000, JSON.stringify(v.body));
    check('play: the server acknowledged it', acked.includes('tok-a'));
    check('play: an unknown token is refused', (await call('POST', '/api/billing/play/verify', { purchaseToken: 'tok-nope' })).status === 400);
    check('play: a purchase made by another account is refused', (await call('POST', '/api/billing/play/verify', { purchaseToken: 'tok-other' })).status === 409);
    const { insertedId: thief } = await users.insertOne({ name: 'Other', email: 'play-other@example.test', password: 'x', createdAt: new Date('2026-01-01') });
    const TH = { Authorization: `Bearer ${jwt.sign({ userId: thief }, process.env.JWT_SECRET, { expiresIn: '1h' })}`, 'Content-Type': 'application/json' };
    check('play: one purchase can\'t unlock a second account', (await call('POST', '/api/billing/play/verify', { purchaseToken: 'tok-a' }, TH)).status === 409);
    const p = await call('POST', '/api/billing/play/verify', { purchaseToken: 'tok-pending' });
    check('play: a pending payment waits', p.status === 202 && p.body.pending);

    const rtdn = (t, secret = 'rtdn-test') => fetch(`${API}/api/billing/play/rtdn?secret=${secret}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { data: Buffer.from(JSON.stringify({ subscriptionNotification: { purchaseToken: t, notificationType: 4 } })).toString('base64') } }),
    });
    check('play: notifications need the secret', (await rtdn('tok-a', 'wrong')).status === 403);
    subs['tok-a'].state = 'SUBSCRIPTION_STATE_ON_HOLD';
    check('play: a notification is accepted', (await rtdn('tok-a')).status === 204);
    check('play: payment on hold ends access', (await call('GET', '/api/billing/status')).body.tier === 'free');
    subs['tok-a'].state = 'SUBSCRIPTION_STATE_ACTIVE';
    await rtdn('tok-a');
    check('play: recovered payment brings Plus back', (await call('GET', '/api/billing/status')).body.tier === 'pro');
    subs['tok-late'] = { state: 'SUBSCRIPTION_STATE_ACTIVE', product: 'plus_monthly', account: mine, ack: false };
    await users.updateOne({ _id: insertedId }, { $set: { plan: 'free' }, $unset: { planExpiry: 1, playToken: 1 } });
    await rtdn('tok-late');
    const late = (await call('GET', '/api/billing/status')).body;
    check('play: a purchase the app never reported is found by account id and acknowledged', late.tier === 'pro' && acked.includes('tok-late'), JSON.stringify(late.tier));
    check('play: a notification for a token we\'ve never seen and nobody owns is dropped', (await rtdn('tok-other')).status === 204);
    fake.close();
  }

  // ── Round 3, 2.1 and 2.3: banks as data (with MFBs), custom banks, channel is not a bank ──
  {
    const db = mongoose.connection.db;
    const list = (await call('GET', '/api/banks')).body;
    check('2.1 the bank list has banks, MFBs and fintechs', ['bank', 'mfb', 'fintech'].every((t) => list.banks.some((b) => b.type === t)) && list.banks.some((b) => b.name === 'Allworkers MFB'));
    const known = await call('POST', '/api/banks/custom', { name: 'allworkers mfb', type: 'mfb' });
    check('2.1 typing a bank we list gives back the listed one', known.body?.existing && known.body.bank.code === 'allworkers', JSON.stringify(known.body));
    const zion = await call('POST', '/api/banks/custom', { name: 'Zion  MFB', type: 'mfb' });
    check('2.1 "My bank isn\'t listed" saves a custom bank', zion.status === 201 && zion.body.bank.code === 'custom-zion-mfb' && zion.body.bank.name === 'Zion MFB', JSON.stringify(zion.body));
    await call('POST', '/api/banks/custom', { name: 'Zion MFB', type: 'mfb' });
    const reqs = await db.collection('bankrequests').find({}).toArray();
    check('2.1 it is logged once per user, without who asked', reqs.length === 1 && reqs[0].count === 1 && !('userId' in reqs[0]));
    check('2.1 the custom bank is in the user\'s list', (await call('GET', '/api/banks')).body.banks.some((b) => b.code === 'custom-zion-mfb' && b.custom));

    await db.collection('transactions').insertMany([
      { userId: insertedId, date: new Date('2026-09-02'), description: 'CR from ADA', amount: 5000, type: 'income', category: 'Transfer', source: 'sms', senderKey: 'ALLWORKRS', bank: '' },
      { userId: insertedId, date: new Date('2026-09-03'), description: 'DR POS', amount: -700, type: 'expense', category: 'Other', source: 'sms', senderKey: 'ZIONMFBNG', bank: '' },
    ]);
    const ac = (await call('GET', '/api/action-center')).body.items.filter((i) => i.type === 'tag_sender');
    check('2.1 the "Which bank" card pre-selects a likely bank', ac.find((i) => i.senderKey === 'ALLWORKRS')?.guess?.code === 'allworkers', JSON.stringify(ac));
    const tag = await call('POST', '/api/senders/tag', { senderKey: 'ZIONMFBNG', bankCode: 'custom-zion-mfb' });
    const zrow = await db.collection('transactions').findOne({ userId: insertedId, description: 'DR POS' });
    check('2.1 a sender can be tagged with a custom bank', tag.status === 200 && zrow.bank === 'Zion MFB' && zrow.senderKey === '', JSON.stringify(zrow));

    const imp = await call('POST', '/api/import-transactions', { bank: 'SMS', transactions: [
      { date: '2026-09-10', amount: 1200, description: 'POS SHOPRITE', type: 'expense', category: 'Groceries', bankCode: 'gtbank', bank: '' },
      { date: '2026-09-11', amount: 900, description: 'Zenith alert: DR 900 POS KFC', type: 'expense', category: 'Food', bank: 'SMS' },
    ] });
    const smsRows = await db.collection('transactions').find({ userId: insertedId, description: { $in: ['POS SHOPRITE', 'Zenith alert: DR 900 POS KFC'] } }).toArray();
    check('2.3 an SMS import never stores "SMS" as the bank', imp.status === 200 && smsRows.length === 2 && smsRows.every((t) => t.bank !== 'SMS' && t.channel === 'sms'), JSON.stringify(smsRows.map((t) => [t.bank, t.channel])));
    check('2.3 each row carries the bank that sent it', smsRows.find((t) => t.description === 'POS SHOPRITE').bank === 'GTBank' && smsRows.find((t) => /KFC/.test(t.description)).bank === 'Zenith');
    const stmt = await call('POST', '/api/import-transactions', { bank: 'Access', channel: 'statement', transactions: [{ date: '2026-09-12', amount: 300, description: 'ACCESS FEE', type: 'expense', category: 'Bank Charges' }] });
    const srow = await db.collection('transactions').findOne({ userId: insertedId, description: 'ACCESS FEE' });
    check('2.3 a statement upload is channel statement with its bank', stmt.status === 200 && srow.channel === 'statement' && srow.bank === 'Access');

    // Old rows saved with a channel as the bank are fixed by the migration.
    await db.collection('transactions').insertMany([
      { userId: insertedId, date: new Date('2026-08-01'), description: 'OLD GTB ROW', amount: -10, type: 'expense', category: 'Other', source: 'import', bank: 'SMS', bankCode: 'gtbank' },
      { userId: insertedId, date: new Date('2026-08-02'), description: 'Acct credited NGN 5,000 Kuda', amount: 5000, type: 'income', category: 'Other', source: 'import', bank: 'sms', bankCode: '' },
      { userId: insertedId, date: new Date('2026-08-03'), description: 'MYSTERY', amount: -20, type: 'expense', category: 'Other', source: 'import', bank: 'Email', bankCode: '' },
    ]);
    await db.collection('useraccounts').insertOne({ userId: insertedId, bankCode: 'gtbank', accountMask: '9999', bankName: 'SMS', label: '' });
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const mig = await call('POST', '/api/admin/migrate/channel-banks');
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
    const old = Object.fromEntries((await db.collection('transactions').find({ userId: insertedId, description: { $in: ['OLD GTB ROW', 'Acct credited NGN 5,000 Kuda', 'MYSTERY'] } }).toArray()).map((t) => [t.description, t]));
    check('2.3 migration: bank from the bank code', old['OLD GTB ROW'].bank === 'GTBank' && old['OLD GTB ROW'].channel === 'sms', JSON.stringify(mig.body));
    check('2.3 migration: bank from the text', old['Acct credited NGN 5,000 Kuda'].bank === 'Kuda');
    check('2.3 migration: unplaceable rows go to the "Which bank" card', old.MYSTERY.bank === '' && old.MYSTERY.senderKey === 'UNKNOWNSENDER' && old.MYSTERY.channel === 'email');
    check('2.3 migration: no bank or account is named SMS any more', !(await db.collection('transactions').findOne({ bank: /^(sms|email|share)$/i })) && (await db.collection('useraccounts').findOne({ accountMask: '9999' })).bankName === 'GTBank');
    const card = (await call('GET', '/api/action-center')).body.items.find((i) => i.senderKey === 'UNKNOWNSENDER');
    check('2.3 the card names them plainly', card?.label === 'Alerts with no sender name' && card.guess === null);
  }

  // ── Round 3, section 3: classify first, review stack, personal rules, fees, learning ──
  {
    const db = mongoose.connection.db;
    const { body: k3 } = await call('POST', '/api/capture/key');
    const C3 = { 'x-capture-key': k3.key, 'Content-Type': 'application/json' };
    const cap3 = (text) => call('POST', '/api/ingest/capture', { source: 'sms', text, sender: 'GTBANK', postedAt: Date.now() }, C3);
    const before = (await db.collection('transactions').countDocuments({ userId: insertedId }));
    const unclear = await cap3('NGN 7,250 sent to TUNDE BAKARE via app');
    check('3.1 an unclear alert waits in the review stack, not the ledger', unclear.body?.pending === true && (await db.collection('transactions').countDocuments({ userId: insertedId })) === before, JSON.stringify(unclear.body));
    let ac3 = (await call('GET', '/api/action-center')).body.items.filter((i) => i.type === 'review_alert');
    check('3.1 it shows in the Action Center with its text', ac3.length === 1 && /7,250/.test(ac3[0].raw));
    const conf = await call('POST', `/api/pending-alerts/${ac3[0].id}/confirm`, { amount: 7250, type: 'expense', description: 'Transfer to Tunde' });
    const saved3 = await db.collection('transactions').findOne({ userId: insertedId, description: 'Transfer to Tunde' });
    check('3.1 confirming it adds the transaction', conf.body?.saved && saved3 && saved3.amount === -7250, JSON.stringify(conf.body));
    check('3.3 the confirmation is logged as a correction', !!(await db.collection('correctionevents').findOne({ userId: insertedId, kind: 'confirmed' })));

    const promo = 'Hello! NGN 2,000 bonus waiting when you play today. Reply YES';
    await cap3(promo);
    const held = (await call('GET', '/api/action-center')).body.items.find((i) => i.type === 'review_alert');
    await call('POST', `/api/pending-alerts/${held.id}/not-transaction`);
    const again = await cap3(promo.replace('2,000', '5,000'));
    check('3.3 "not a transaction" becomes a personal rule for alerts like it', again.body?.ignored === true && again.body.reason === 'yours', JSON.stringify(again.body));
    check('3.3 and is logged', !!(await db.collection('correctionevents').findOne({ userId: insertedId, kind: 'not_transaction' })));

    await cap3('GTBank Debit Alert\nAcct: ******7788\nAmt: NGN25,000.00\nDesc: NIP TRANSFER TO ADA OBI\nDate: 05-10-2026\nAvail Bal: NGN40,000.00');
    await cap3('GTBank Debit Alert\nAcct: ******7788\nAmt: NGN26.88\nDesc: NIP TRANSFER FEE\nDate: 05-10-2026\nAvail Bal: NGN39,973.12');
    const fee = await db.collection('transactions').findOne({ userId: insertedId, amount: -26.88 });
    const cause = await db.collection('transactions').findOne({ userId: insertedId, amount: -25000 });
    check('3.1 a fee alert is filed as Bank Charges', fee?.category === 'Bank Charges', JSON.stringify(fee));
    check('3.1 and linked to the transfer that caused it', fee && cause && fee.feeFor === String(cause._id));

    const imp3 = await call('POST', '/api/import-transactions', { bank: '', channel: 'sms', transactions: [
      { date: '2026-10-06', amount: 1500, description: 'POS KFC', type: 'expense', category: 'Food', bank: 'GTBank', _parse: { rawText: 'Acct ****7788 debited NGN1,500.00 POS KFC. Bal NGN10,000.00' } },
      { date: '2026-10-06', amount: 482913, description: 'OTP', type: 'expense', category: 'Other', _parse: { rawText: '482913 is your one-time password. Do not share it.' } },
      { date: '2026-10-06', amount: 50, description: 'FGN Stamp Duty', type: 'expense', category: 'Other', _parse: { rawText: 'Debit\nAmt:NGN50.00\nDesc:FGN Stamp Duty\nDate:06/10/2026\nAvail Bal:NGN9,950.00' } },
    ] });
    check('3.4 the import summary counts added, fees and non-transactions', imp3.body?.summary?.added === 2 && imp3.body.summary.fees === 1 && imp3.body.summary.notTransactions === 1, JSON.stringify(imp3.body));
    check('3.4 and says it in words', /2 transactions added/.test(imp3.body?.message || '') && /1 fee found/.test(imp3.body.message), imp3.body?.message);
    check('3.1 an OTP never reaches the ledger', !(await db.collection('transactions').findOne({ userId: insertedId, amount: -482913 })));

    // 3.3: a shared rule needs 5 users and an admin.
    await db.collection('globalcategories').insertOne({ key: 'r3 test merchant', counts: { Food: 5 }, total: 5, updatedAt: new Date() });
    await users.updateOne({ _id: insertedId }, { $set: { role: 'superadmin' } });
    const rep = (await call('GET', '/api/admin/learning')).body;
    check('3.3 a rule 5 users agree on waits for review', rep.pendingRules?.some((r) => r.key === 'r3 test merchant' && r.category === 'Food'), JSON.stringify(rep.pendingRules));
    check('3.2 the report carries the test-set coverage per bank', Array.isArray(rep.corpus) && rep.corpus.length >= 7 && rep.corpus.every((r) => 'ruled' in r));
    const ok3 = await call('POST', `/api/admin/global-rules/${encodeURIComponent('r3 test merchant')}/approve`);
    const g = await db.collection('globalcategories').findOne({ key: 'r3 test merchant' });
    check('3.3 approving makes it live', ok3.status === 200 && g.status === 'approved' && g.approvedCategory === 'Food');
    check('3.3 an approved rule leaves the queue', !(await call('GET', '/api/admin/learning')).body.pendingRules.some((r) => r.key === 'r3 test merchant'));
    const setup = await call('GET', '/api/admin/setup-status');
    const flat = (setup.body?.groups || []).flatMap((g) => g.keys);
    check('6 the setup checklist lists keys by name with set or missing', flat.some((k) => k.name === 'CRON_SECRET' && k.set === true) && flat.some((k) => k.name === 'NVIDIA_API_KEY' && k.set === false));
    check('6 and never sends a value', !JSON.stringify(setup.body).includes(process.env.CRON_SECRET || 'local-test-secret') && !JSON.stringify(setup.body).includes('paystack-test-secret'));
    await users.updateOne({ _id: insertedId }, { $set: { role: 'user' } });
  }

  // ── Round 3, 1.2: account deletion from the website (email link, then confirm) ──
  {
    const db = mongoose.connection.db;
    const crypto = require('crypto');
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const { insertedId: gone } = await users.insertOne({ name: 'Leaving User', email: 'leaving@example.test', password: 'x', createdAt: new Date() });
    await db.collection('transactions').insertOne({ userId: gone, description: 'LEAVING TXN', amount: -100, type: 'expense', date: new Date() });
    await db.collection('billpayments').insertMany([
      { userId: gone, requestId: 'R3-KEEP', billType: 'airtime', amount: 100, chargeNaira: 100, status: 'completed' },
      { userId: gone, kind: 'retired-feature-row' },
    ]);
    const dreq = () => db.collection('deletionrequests').find({}).toArray();
    const ask = await call('POST', '/api/account-deletion/request', { email: 'Leaving@Example.test', reason: 'Testing' }, { 'Content-Type': 'application/json' });
    check('delete-account: a request is accepted and stores only a hashed link', ask.status === 200 && (await dreq()).length === 1 && (await dreq())[0].tokenHash.length === 64);
    const nobody = await call('POST', '/api/account-deletion/request', { email: 'nobody@example.test' }, { 'Content-Type': 'application/json' });
    check('delete-account: an unknown email gets the same answer and no link', nobody.body?.message === ask.body?.message && (await dreq()).length === 1);
    check('delete-account: a bad email is refused', (await call('POST', '/api/account-deletion/request', { email: 'nope' }, { 'Content-Type': 'application/json' })).status === 400);
    check('delete-account: the user still exists before the link is opened', !!(await users.findOne({ _id: gone })));
    const raw = 'r3-test-token-0123456789';
    await db.collection('deletionrequests').updateOne({}, { $set: { tokenHash: sha(raw) } });
    const peek = await call('GET', `/api/account-deletion/${raw}`, null, {});
    check('delete-account: the link shows a masked email', peek.body?.hasAccount === true && peek.body.email === 'le***@example.test', JSON.stringify(peek.body));
    const done = await call('POST', '/api/account-deletion/confirm', { token: raw }, { 'Content-Type': 'application/json' });
    check('delete-account: confirming deletes the user and their data', done.body?.deleted && !(await users.findOne({ _id: gone })) && !(await db.collection('transactions').findOne({ userId: gone })), JSON.stringify(done.body));
    const kept = await db.collection('billpayments').find({ userId: gone }).toArray();
    check('delete-account: bill purchase records are kept, retired-feature rows go', kept.length === 1 && kept[0].requestId === 'R3-KEEP');
    check('delete-account: the reason is kept without the email', !!(await db.collection('deletionreasons').findOne({ reason: 'Testing', hadAccount: true })) && !(await db.collection('deletionreasons').findOne({ email: { $exists: true } })));
    check('delete-account: the link works once', (await call('POST', '/api/account-deletion/confirm', { token: raw }, { 'Content-Type': 'application/json' })).status === 404);
    check('delete-account: a made-up link is refused', (await call('POST', '/api/account-deletion/confirm', { token: 'made-up' }, { 'Content-Type': 'application/json' })).status === 404);
  }

  // ── Round 5 S5: birthday (day and month only) and onboarding events ──
  {
    const set = await call('PUT', '/api/me', { birthdayDay: 14, birthdayMonth: 3 });
    check('S5 a birthday is saved as day and month only', set.status === 200 && set.body?.birthdayDay === 14 && set.body?.birthdayMonth === 3 && !('birthdayYear' in (set.body || {})), JSON.stringify(set.body));
    check('S5 /api/me returns it with the switch on by default', (await call('GET', '/api/me')).body?.birthdayEmails === true);
    check('S5 31 April is refused', (await call('PUT', '/api/me', { birthdayDay: 31, birthdayMonth: 4 })).status === 400);
    check('S5 the Birthday messages switch saves', (await call('PUT', '/api/me', { birthdayEmails: false })).body?.birthdayEmails === false);
    check('S5 clearing the birthday works', (await call('PUT', '/api/me', { birthdayDay: null, birthdayMonth: null })).body?.birthdayDay === null);
    check('S5 onboarding events are accepted', (await call('POST', '/api/events', { name: 'onboarding_step_skipped', props: { step: 'birthday' } })).status === 200);
  }

  // ── Round 4 A1: the Home "N things need a quick look" count equals the Action Center rows ──
  {
    const db = mongoose.connection.db;
    const day = (d) => new Date(Date.now() - d * 86400000);
    await db.collection('transactions').insertMany([
      { userId: insertedId, date: day(1), description: 'Mystery shop', amount: -1200, category: 'Other', type: 'expense', source: 'manual' },
      { userId: insertedId, date: day(2), description: 'ATM withdrawal', amount: -20000, category: 'Cash', type: 'cash_withdrawal', source: 'sms' },
    ]);
    await db.collection('recurringbills').insertOne({ userId: insertedId, name: 'Old rent', amount: 5000, dueDate: 1, frequency: 'monthly', category: 'Housing', nextDue: day(5), status: 'active' });
    const home = (await call('GET', '/api/home/summary')).body;
    const ac = (await call('GET', '/api/action-center')).body;
    const types = new Set((ac.items || []).map((i) => i.type));
    check('A1 home count equals action center rows', home?.actions?.total === (ac.items || []).length && ac.total === (ac.items || []).length, JSON.stringify({ h: home?.actions, n: (ac.items || []).length }));
    check('A1 to-sort, cash and overdue each have a row', types.has('sort_categories') && types.has('log_cash') && types.has('overdue_payments'), [...types].join());
    check('A1 home detail matches the rows', home?.actions?.sort >= 1 && home.actions.cashTotal === 20000 && home.actions.overdue === 1, JSON.stringify(home?.actions));
  }

  // ── Mobile overhaul phase 2: "Always put X in Y" recategorises past matches ──
  {
    const mk = (description, amount, type, category) => call('POST', '/api/transactions', { date: '2026-10-05', description, amount, type, category });
    const a = await mk('Chowdeck order 111', 3000, 'expense', 'Other');
    await mk('Chowdeck order 222', 4000, 'expense', 'Shopping');
    await mk('Chowdeck refund', 1000, 'income', 'Other Income');
    const id = a.body?._id || a.body?.id;
    const rule = await call('POST', `/api/transactions/${id}/apply-rule`, { category: 'Food' });
    check('apply-rule: reports how many past rows moved', rule.status === 200 && rule.body?.updated === 1, JSON.stringify(rule.body));
    const all = await txns();
    check('apply-rule: past spending rows with the same merchant move, income does not', all.filter((t) => /chowdeck/i.test(t.description) && t.type === 'expense').every((t) => t.category === 'Food') && all.find((t) => /refund/i.test(t.description))?.category === 'Other Income');
    check('apply-rule: a nameless row is refused', (await call('POST', `/api/transactions/${id}/apply-rule`, { category: 'Transfer' })).status === 400);
  }

  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
