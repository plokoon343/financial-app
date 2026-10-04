// Background capture (Android bank-app notifications, iPhone Shortcuts on bank SMS,
// and the quiet share target). Devices authenticate with a per-user capture key
// instead of a login session, so a phone can post alerts without opening the app.
// Pure and dependency-free (node:crypto only) so it can be unit-tested.
const crypto = require('crypto');

// A capture key is shown to the user once (and stored on their phone); we keep only
// its SHA-256, so a database leak doesn't hand out working keys.
const newCaptureKey = () => `amk_${crypto.randomBytes(24).toString('base64url')}`;
const hashCaptureKey = (key) => crypto.createHash('sha256').update(String(key || '')).digest('hex');
const looksLikeCaptureKey = (key) => /^amk_[A-Za-z0-9_-]{32}$/.test(String(key || ''));

// Android package names of bank and wallet apps, verified on Google Play. Used to name
// the bank when a notification doesn't say it; other apps are approved per device.
const BANK_APPS = {
  'team.opay.pay': 'OPay',
  'com.moniepoint.personal': 'Moniepoint',
  'com.moniepoint.business': 'Moniepoint',
  'com.transsnet.palmpay': 'PalmPay',
  'com.transsnet.palmpartner': 'PalmPay',
  'com.wemabank.alat.prod': 'Wema',
};
const bankForApp = (pkg) => BANK_APPS[String(pkg || '').toLowerCase()] || '';

const MAX_CAPTURE_CHARS = 4000;

// Normalise a captured payload into the text the alert parser reads. A notification
// arrives as title + text (the title often carries "Debit Alert" or the bank name).
function captureText({ title = '', text = '', bigText = '' } = {}) {
  const body = String(bigText || text || '').trim();
  const head = String(title || '').trim();
  const joined = head && !body.startsWith(head) ? `${head}\n${body}` : body;
  return joined.slice(0, MAX_CAPTURE_CHARS);
}

// The day a capture happened, in Lagos time, from the device's posted timestamp
// (ms since epoch or an ISO string). Null when absent or nonsense.
function captureDay(postedAt, now = Date.now()) {
  if (postedAt == null || postedAt === '') return null;
  const t = typeof postedAt === 'number' ? postedAt : Date.parse(postedAt);
  if (!Number.isFinite(t)) return null;
  // Reject clock-skewed devices: nothing from the future, nothing older than 60 days.
  if (t > now + 5 * 60 * 1000 || t < now - 60 * 86400000) return null;
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
}

module.exports = { newCaptureKey, hashCaptureKey, looksLikeCaptureKey, BANK_APPS, bankForApp, captureText, captureDay, MAX_CAPTURE_CHARS };
