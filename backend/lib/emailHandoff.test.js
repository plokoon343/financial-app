// Run: node lib/emailHandoff.test.js
// No Mongo here, so the model is a small in-memory fake that honours exactly the filter
// shapes emailHandoff.js uses: equality, null, and { $gt: Date }.
const assert = require('assert');
const h = require('./emailHandoff');

const match = (doc, f) => Object.entries(f).every(([k, v]) => {
  if (v && typeof v === 'object' && !(v instanceof Date) && '$gt' in v) return doc[k] && doc[k] > v.$gt;
  if (v === null) return doc[k] === null || doc[k] === undefined;
  return String(doc[k]) === String(v);
});
const fakeModel = () => {
  const rows = [];
  return {
    rows,
    countDocuments: async (f) => rows.filter((r) => match(r, f)).length,
    deleteMany: async (f) => { for (let i = rows.length - 1; i >= 0; i--) if (match(rows[i], f)) rows.splice(i, 1); },
    create: async (d) => { const r = { _id: String(rows.length + 1), openedAt: null, sessionHash: null, sessionExpiresAt: null, ...d }; rows.push(r); return r; },
    findOneAndUpdate: async (f, u) => { const r = rows.find((x) => match(x, f)); if (!r) return null; Object.assign(r, u.$set); return r; },
    findOne: async (f) => rows.find((x) => match(x, f)) || null,
    updateOne: async (f, u) => { const r = rows.find((x) => match(x, f)); if (r) Object.assign(r, u.$set); },
  };
};

(async () => {
  const t0 = new Date('2026-11-15T10:00:00Z');
  const at = (ms) => new Date(t0.getTime() + ms);

  // Valid within 24 hours, tied to one user.
  let M = fakeModel();
  let { token } = await h.createHandoff(M, 'userA', t0);
  assert.ok(h.looksLikeKey(token));
  assert.strictEqual(M.rows[0].tokenHash, h.hash(token), 'only the hash is stored');
  assert.ok(!JSON.stringify(M.rows).includes(token), 'raw token is never stored');
  let r = await h.redeem(M, token, at(23 * 3600e3));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.userId, 'userA');

  // Single use: the same token cannot be redeemed again, even a second later.
  const again = await h.redeem(M, token, at(23 * 3600e3 + 1000));
  assert.deepStrictEqual([again.ok, again.reason], [false, 'used']);

  // Expires: a fresh token refused after 24 hours, and at exactly 24 hours.
  M = fakeModel();
  ({ token } = await h.createHandoff(M, 'userA', t0));
  assert.deepStrictEqual(await h.redeem(M, token, at(24 * 3600e3 + 1)), { ok: false, reason: 'expired' });
  ({ token } = await h.createHandoff(M, 'userA', t0));
  assert.strictEqual((await h.redeem(M, token, at(24 * 3600e3))).ok, false, 'boundary is closed');

  // Garbage and unknown tokens look the same as each other.
  assert.deepStrictEqual(await h.redeem(M, 'nope', t0), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(await h.redeem(M, 'A'.repeat(32), t0), { ok: false, reason: 'invalid' });
  assert.deepStrictEqual(await h.redeem(M, { $ne: null }, t0), { ok: false, reason: 'invalid' }, 'operator objects are refused');

  // Concurrent redemption: exactly one wins.
  M = fakeModel();
  ({ token } = await h.createHandoff(M, 'userA', t0));
  const results = await Promise.all([h.redeem(M, token, t0), h.redeem(M, token, t0)]);
  assert.strictEqual(results.filter((x) => x.ok).length, 1);

  // The page session belongs to one user, ends after 2 hours, and never outlives the token.
  M = fakeModel();
  ({ token } = await h.createHandoff(M, 'userA', t0));
  const b = await h.createHandoff(M, 'userB', t0);
  const ra = await h.redeem(M, token, t0);
  const rb = await h.redeem(M, b.token, t0);
  assert.strictEqual(await h.userForSession(M, ra.sessionKey, at(3600e3)), 'userA');
  assert.strictEqual(await h.userForSession(M, rb.sessionKey, at(3600e3)), 'userB');
  assert.strictEqual(await h.userForSession(M, ra.sessionKey, at(2 * 3600e3 + 1)), null, 'session ends after 2h');
  assert.strictEqual(await h.userForSession(M, token, t0), null, 'the link token is not a session key');
  assert.strictEqual(await h.userForSession(M, 'x', t0), null);
  const late = fakeModel();
  const l = await h.createHandoff(late, 'userA', t0);
  const rl = await h.redeem(late, l.token, at(23.5 * 3600e3));
  assert.strictEqual(rl.sessionExpiresAt.getTime(), t0.getTime() + 24 * 3600e3, 'capped at the token expiry');

  // Two links for one user are independent: emailing a link must not kill the QR on screen.
  M = fakeModel();
  const first = await h.createHandoff(M, 'userA', t0);
  const second = await h.createHandoff(M, 'userA', at(1000));
  assert.strictEqual((await h.redeem(M, second.token, at(2000))).ok, true);
  assert.strictEqual((await h.redeem(M, first.token, at(2000))).ok, true);
  assert.strictEqual((await h.redeem(M, first.token, at(3000))).ok, false, 'each is still single use');

  // Hourly cap, and it recovers after the hour.
  M = fakeModel();
  for (let i = 0; i < h.MAX_LINKS_PER_HOUR; i++) await h.createHandoff(M, 'userA', at(i));
  await assert.rejects(() => h.createHandoff(M, 'userA', at(100)), (e) => e.code === 'rate');
  await h.createHandoff(M, 'userA', at(3600e3 + 10));
  await h.createHandoff(M, 'userB', at(100));

  // Ticks: the same function feeds the phone and the page.
  assert.deepStrictEqual(h.ticksFor({ opened: false, user: {} }), { linkOpened: false, gmailConfirmed: false, firstBankEmail: false });
  assert.deepStrictEqual(h.ticksFor({ opened: true, user: {} }), { linkOpened: true, gmailConfirmed: false, firstBankEmail: false });
  assert.deepStrictEqual(h.ticksFor({ opened: true, user: { gmailConfirmedAt: t0 } }), { linkOpened: true, gmailConfirmed: true, firstBankEmail: false });
  // A first bank email proves Gmail forwarding works, so it also ticks confirmed.
  assert.deepStrictEqual(h.ticksFor({ opened: true, user: { inboundEmailLastAt: t0 } }), { linkOpened: true, gmailConfirmed: true, firstBankEmail: true });

  // The page view carries only the one user's fields: no ids, no names, no email.
  const view = h.pageView({
    user: { _id: 'u1', name: 'Secret Name', email: 'secret@x.com', gmailVerifyCode: '123456', gmailVerifyLink: 'https://mail-settings.google.com/x' },
    ticks: { linkOpened: true, gmailConfirmed: false, firstBankEmail: false },
    address: 'tok@automonie.app', active: true,
    filter: { filter: 'from:(a@b.com)', addresses: ['a@b.com'], missingBanks: [] },
  });
  const json = JSON.stringify(view);
  assert.ok(!/Secret|secret@|u1/.test(json), 'no personal fields on the page');
  assert.strictEqual(view.gmailVerification.code, '123456');

  console.log('emailHandoff: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
