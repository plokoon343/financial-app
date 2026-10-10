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

// Android package names of bank and wallet apps, each checked against the Nigerian
// Play Store (2026-10-10); keys lowercase. Used to name the bank when a notification
// doesn't say it; other apps are approved per device.
const BANK_APPS = {
  'team.opay.pay': 'OPay',
  'com.moniepoint.personal': 'Moniepoint',
  'com.moniepoint.business': 'Moniepoint',
  'com.transsnet.palmpay': 'PalmPay',
  'com.transsnet.palmpartner': 'PalmPay',
  'com.wemabank.alat.prod': 'Wema (ALAT)',
  'com.kudabank.app': 'Kuda',
  'com.kuda.business': 'Kuda',
  'com.gtbank.gtworldv1': 'GTBank',
  'com.zenithbank.eazymoney': 'Zenith',
  'com.accessbank.nextgen': 'Access',
  'com.accessbank.accessbankapp': 'Access',
  'com.ubanquity.redd.uba': 'UBA',
  'com.firstbank.firstmobile': 'First Bank',
  'com.appzonegroup.fcmb': 'FCMB',
  'com.interswitchng.www': 'Fidelity',
  'com.ceva.ubmobile.stallion': 'Union',
  'com.ubn.union360mobilerevamp': 'Union',
  'com.sterlingng.sterlingmobile': 'Sterling',
  'com.ecobank.mobileapp5': 'Ecobank',
  'com.stanbicmobile': 'Stanbic IBTC',
  'ng.com.fairmoney.fairmoney': 'FairMoney',
  'com.lenddo.mobile.paylater': 'Carbon',
  'com.mypaga.customer': 'Paga',
  'com.providus.providusbank': 'Providus',
  'com.vulte.app': 'Polaris',
  'com.qucoon.keystonemobilebankingapp': 'Keystone',
  'com.jaizbank.app': 'Jaiz',
  'com.teamapt.unitymobile': 'Unity',
  'com.nero.globus_mobile': 'Globus',
  'com.parallex.mobileapp': 'Parallex',
  'com.taj.taj_mobile': 'TAJ Bank',
  'com.ptb.mobile': 'Premium Trust',
  'com.africa.smartcash': 'SmartCash PSB',
  'com.psbcustomer': '9PSB',
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
