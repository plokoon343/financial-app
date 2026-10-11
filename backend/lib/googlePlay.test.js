'use strict';
// Run: node backend/lib/googlePlay.test.js
const crypto = require('crypto');
const gp = require('./googlePlay');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date('2026-10-11T12:00:00Z');
const later = '2026-11-11T12:00:00Z';
const earlier = '2026-10-01T12:00:00Z';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { client_email: 'play@automonie.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const cfg = gp.config({ GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify(account) });

check('config: defaults map plus_monthly to Plus and student_monthly to Student', cfg.products.plus_monthly === 'pro' && cfg.products.student_monthly === 'student');
check('config: package defaults to the app id', cfg.packageName === 'com.plokoon343.finpilot');
check('config: a broken key means not configured', !gp.configured(gp.config({ GOOGLE_PLAY_SERVICE_ACCOUNT: '{nope' })) && gp.configured(cfg));
check('config: the test stand-in is ignored in production', gp.config({ NODE_ENV: 'production', GOOGLE_PLAY_TEST_BASE: 'http://x' }).api.startsWith('https://androidpublisher.googleapis.com') && gp.config({ GOOGLE_PLAY_TEST_BASE: 'http://x' }).tokenUrl === 'http://x/token');
check('config: product ids come from env', gp.config({ PLAY_PRODUCT_PLUS: 'plus_m' }).products.plus_m === 'pro');

const a1 = gp.accountIdFor('user1', 's');
check('account id is stable, per user, and at most 64 chars', a1 === gp.accountIdFor('user1', 's') && a1 !== gp.accountIdFor('user2', 's') && a1.length <= 64);
check('account id depends on the secret', a1 !== gp.accountIdFor('user1', 't'));

const sub = (state, over = {}) => ({
  subscriptionState: state,
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  externalAccountIdentifiers: { obfuscatedExternalAccountId: a1 },
  lineItems: [{ productId: 'plus_monthly', expiryTime: later, autoRenewingPlan: { autoRenewEnabled: true } }],
  ...over,
});
const active = gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE'), cfg, now);
check('active: Plus until expiry, renewing, needs acknowledging', active.plan === 'pro' && active.entitled && +active.expiry === +new Date(later) && active.autoRenew && active.needsAck && active.accountId === a1, active);
check('grace period keeps access', gp.readSubscription(sub('SUBSCRIPTION_STATE_IN_GRACE_PERIOD'), cfg, now).entitled);
const canceled = gp.readSubscription(sub('SUBSCRIPTION_STATE_CANCELED', { lineItems: [{ productId: 'plus_monthly', expiryTime: later, autoRenewingPlan: { autoRenewEnabled: false } }] }), cfg, now);
check('canceled keeps access until expiry, not renewing', canceled.entitled && +canceled.expiry === +new Date(later) && !canceled.autoRenew);
const hold = gp.readSubscription(sub('SUBSCRIPTION_STATE_ON_HOLD'), cfg, now);
check('on hold: access ends now', !hold.entitled && +hold.expiry === +now);
check('paused: no access', !gp.readSubscription(sub('SUBSCRIPTION_STATE_PAUSED'), cfg, now).entitled);
const expired = gp.readSubscription(sub('SUBSCRIPTION_STATE_EXPIRED', { lineItems: [{ productId: 'plus_monthly', expiryTime: earlier }] }), cfg, now);
check('expired: no access, expiry kept as it was', !expired.entitled && +expired.expiry === +new Date(earlier));
check('active but past expiry is not entitled', !gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE', { lineItems: [{ productId: 'plus_monthly', expiryTime: earlier }] }), cfg, now).entitled);
check('pending purchase is flagged and not entitled', (() => { const p = gp.readSubscription(sub('SUBSCRIPTION_STATE_PENDING'), cfg, now); return p.pending && !p.entitled; })());
check('student product maps to the Student plan', gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE', { lineItems: [{ productId: 'student_monthly', expiryTime: later }] }), cfg, now).plan === 'student');
check('someone else\'s product is ignored', gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE', { lineItems: [{ productId: 'coins', expiryTime: later }] }), cfg, now) === null);
check('junk is ignored', gp.readSubscription(null, cfg, now) === null && gp.readSubscription({}, cfg, now) === null);
check('acknowledged purchase does not need it again', !gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE', { acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }), cfg, now).needsAck);
check('test purchases are marked', gp.readSubscription(sub('SUBSCRIPTION_STATE_ACTIVE', { testPurchase: {} }), cfg, now).test);

const push = (obj) => ({ message: { data: Buffer.from(JSON.stringify(obj)).toString('base64') } });
check('RTDN: the purchase token is read', gp.rtdnToken(push({ subscriptionNotification: { purchaseToken: 'tok-1', notificationType: 2 } })) === 'tok-1');
check('RTDN: a test notification has no token', gp.rtdnToken(push({ testNotification: { version: '1.0' } })) === '');
check('RTDN: junk is safe', gp.rtdnToken({}) === '' && gp.rtdnToken({ message: { data: '!!!' } }) === '');

(async () => {
  // A fake Google: checks the signed JWT, then answers the purchase lookups.
  const calls = [];
  const fakeFetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      const assertion = new URLSearchParams(opts.body).get('assertion');
      const [h, c, s] = assertion.split('.');
      const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      const claims = JSON.parse(Buffer.from(c, 'base64').toString());
      if (!ok || claims.iss !== account.client_email || !/androidpublisher/.test(claims.scope)) return { ok: false, status: 401 };
      return { ok: true, json: async () => ({ access_token: 'at-1', expires_in: 3600 }) };
    }
    if (opts.headers?.Authorization !== 'Bearer at-1') return { ok: false, status: 401 };
    if (url.includes('/subscriptionsv2/tokens/known')) return { ok: true, status: 200, json: async () => sub('SUBSCRIPTION_STATE_ACTIVE') };
    if (url.includes('/subscriptionsv2/tokens/')) return { ok: false, status: 404 };
    if (url.endsWith(':acknowledge')) return url.includes('/tokens/acked') ? { ok: false, status: 400 } : { ok: true, status: 204 };
    return { ok: false, status: 500 };
  };
  gp.resetTokenCache();
  const got = await gp.getSubscription('known', cfg, fakeFetch);
  check('a signed service-account token unlocks the lookup', got?.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE', JSON.stringify(calls.map((x) => x.url)));
  check('lookup url names the package and token', calls.some((x) => x.url.includes('/applications/com.plokoon343.finpilot/purchases/subscriptionsv2/tokens/known')));
  await gp.getSubscription('known', cfg, fakeFetch);
  check('the access token is cached', calls.filter((x) => x.url.startsWith('https://oauth2')).length === 1);
  check('an unknown token gives null', (await gp.getSubscription('missing', cfg, fakeFetch)) === null);
  let threw = false;
  try { await gp.acknowledge('plus_monthly', 'new', cfg, fakeFetch); } catch { threw = true; }
  check('acknowledge succeeds', !threw && calls.some((x) => x.url.endsWith('/purchases/subscriptions/plus_monthly/tokens/new:acknowledge')));
  threw = false;
  try { await gp.acknowledge('plus_monthly', 'acked', cfg, fakeFetch); } catch { threw = true; }
  check('already acknowledged is fine', !threw);
  gp.resetTokenCache();
  threw = false;
  try { await gp.getSubscription('known', gp.config({ GOOGLE_PLAY_SERVICE_ACCOUNT: JSON.stringify({ ...account, client_email: 'other@x' }) }), fakeFetch); } catch { threw = true; }
  check('a rejected service account throws', threw);

  console.log(`googlePlay: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
