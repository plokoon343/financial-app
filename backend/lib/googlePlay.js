'use strict';

// Google Play Billing, server side. The Android app (Play Store build) buys Plus or
// Student through Google Play; the server never trusts the phone's word for it: it
// looks the purchase token up with the Google Play Developer API, ties it to one
// account, sets the plan and expiry from Google's answer, and acknowledges it (an
// unacknowledged purchase is refunded by Google after 3 days).
//
// Config (env):
//   GOOGLE_PLAY_SERVICE_ACCOUNT  the service account's JSON key (granted in Play Console)
//   ANDROID_PACKAGE              defaults to com.plokoon343.finpilot
//   PLAY_PRODUCT_PLUS / PLAY_PRODUCT_STUDENT   subscription ids (plus_monthly / student_monthly)
//   PLAY_RTDN_SECRET             shared secret on the Pub/Sub push URL for renewals

const crypto = require('crypto');

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function config(env = process.env) {
  let account = null;
  try { account = env.GOOGLE_PLAY_SERVICE_ACCOUNT ? JSON.parse(env.GOOGLE_PLAY_SERVICE_ACCOUNT) : null; } catch { account = null; }
  const products = {
    [env.PLAY_PRODUCT_PLUS || 'plus_monthly']: 'pro',
    [env.PLAY_PRODUCT_STUDENT || 'student_monthly']: 'student',
  };
  return {
    account: account && account.client_email && account.private_key ? account : null,
    packageName: env.ANDROID_PACKAGE || 'com.plokoon343.finpilot',
    products, // Play product id -> our plan code
    rtdnSecret: env.PLAY_RTDN_SECRET || '',
    // Tests only (never in production): point at a stand-in for Google.
    api: (env.NODE_ENV !== 'production' && env.GOOGLE_PLAY_TEST_BASE) ? `${env.GOOGLE_PLAY_TEST_BASE}/applications` : API,
    tokenUrl: (env.NODE_ENV !== 'production' && env.GOOGLE_PLAY_TEST_BASE) ? `${env.GOOGLE_PLAY_TEST_BASE}/token` : TOKEN_URL,
  };
}
const configured = (cfg = config()) => !!cfg.account;

// The id the app passes to Google with a purchase (obfuscatedAccountId), so a token
// can only ever unlock the account that bought it. Not reversible; max 64 chars.
const accountIdFor = (userId, secret) => crypto.createHmac('sha256', String(secret)).update(String(userId)).digest('hex').slice(0, 64);

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// OAuth access token for the service account (JWT bearer grant), cached until it
// is close to expiring.
let cached = { token: '', exp: 0 };
async function accessToken(cfg, fetchImpl = fetch, now = Date.now()) {
  if (cached.token && cached.exp - 60000 > now) return cached.token;
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: cfg.account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = b64url(crypto.createSign('RSA-SHA256').update(`${head}.${claims}`).sign(cfg.account.private_key));
  const res = await fetchImpl(cfg.tokenUrl || TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${sig}` }).toString(),
  });
  if (!res.ok) throw new Error(`google token ${res.status}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) * 1000 };
  return cached.token;
}

// purchases.subscriptionsv2.get: the subscription behind a purchase token.
async function getSubscription(token, cfg, fetchImpl = fetch) {
  const at = await accessToken(cfg, fetchImpl);
  const res = await fetchImpl(`${cfg.api || API}/${encodeURIComponent(cfg.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`, {
    headers: { Authorization: `Bearer ${at}` },
  });
  if (res.status === 404 || res.status === 410) return null; // unknown or long expired
  if (!res.ok) throw new Error(`google subscription ${res.status}`);
  return res.json();
}

async function acknowledge(productId, token, cfg, fetchImpl = fetch) {
  const at = await accessToken(cfg, fetchImpl);
  const res = await fetchImpl(`${cfg.api || API}/${encodeURIComponent(cfg.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, {
    method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' }, body: '{}',
  });
  if (!res.ok && res.status !== 400) throw new Error(`google acknowledge ${res.status}`); // 400: already acknowledged
}

// Google's states that still give access. CANCELED means "won't renew": the user
// keeps the plan until it expires. ON_HOLD and PAUSED mean payment has stopped.
const ENTITLED = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'SUBSCRIPTION_STATE_CANCELED']);

// Turn Google's answer into what we store: { plan, expiry, entitled, autoRenew,
// accountId, productId, needsAck, pending, test }, or null when it isn't one of ours.
function readSubscription(sub, cfg, now = new Date()) {
  if (!sub || !Array.isArray(sub.lineItems)) return null;
  const item = sub.lineItems.find((l) => cfg.products[l.productId]);
  if (!item) return null;
  const expiry = item.expiryTime ? new Date(item.expiryTime) : null;
  const state = sub.subscriptionState || '';
  const entitled = ENTITLED.has(state) && !!expiry && expiry > now;
  return {
    plan: cfg.products[item.productId],
    productId: item.productId,
    // Access ends at expiry while entitled; on hold / paused / expired it ends now.
    expiry: entitled ? expiry : (expiry && expiry < now ? expiry : now),
    entitled,
    pending: state === 'SUBSCRIPTION_STATE_PENDING',
    autoRenew: !!item.autoRenewingPlan?.autoRenewEnabled,
    accountId: sub.externalAccountIdentifiers?.obfuscatedExternalAccountId || '',
    needsAck: sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING',
    linkedToken: sub.linkedPurchaseToken || '',
    test: !!sub.testPurchase,
  };
}

// Real-time developer notification (Pub/Sub push body) -> the purchase token, or ''.
function rtdnToken(body) {
  try {
    const data = JSON.parse(Buffer.from(body?.message?.data || '', 'base64').toString('utf8'));
    return data?.subscriptionNotification?.purchaseToken || '';
  } catch { return ''; }
}

const resetTokenCache = () => { cached = { token: '', exp: 0 }; };

module.exports = { config, configured, accountIdFor, accessToken, getSubscription, acknowledge, readSubscription, rtdnToken, resetTokenCache };
