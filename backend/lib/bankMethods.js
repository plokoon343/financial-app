// Which ways of getting transactions in work for each bank, built from what the code
// actually supports, so onboarding never offers a method we can't handle:
//   email          the bank's alert-email domain is on the forwarding allow-list
//   notifications  its app is on the Android notification-capture list (Android only)
//   statement      any bank (general statement reader; OPay has its own)
//   share          any bank (the general alert reader)
//   mono           bank linking, Pro only, and only once Mono is switched on
// `tested` records where the method has been checked against real alerts or
// statements from that bank. Pure; tested in bankMethods.test.js.
'use strict';

const { BANKS } = require('./bankRegistry');
const { BANK_EMAIL_DOMAINS } = require('./inboundEmail');
const { BANK_APPS } = require('./capture');

// Real data each channel has been checked against (corpus and fixtures).
const TESTED = {
  email: ['gtbank'],
  statement: ['gtbank', 'opay'],
  share: ['gtbank', 'opay', 'fcmb', 'uba', 'union', 'premiumtrust'],
  notifications: [],
};

// App-first banks and wallets: their alerts mostly arrive as app notifications, so on
// Android that beats email.
const APP_FIRST = new Set(['opay', 'palmpay', 'kuda', 'moniepoint', 'carbon', 'fairmoney', 'vfd', '9psb', 'smartcash', 'momo', 'rubies', 'sparkle', 'eyowo']);

// Banks the app knows by name that aren't in the alert registry yet.
const EXTRA = [{ code: 'paga', name: 'Paga' }, { code: 'parallex', name: 'Parallex' }];

const appNames = Object.entries(BANK_APPS).reduce((m, [, name]) => m.add(name), new Set());
const emailOk = (bank) => (bank.domains || []).some((d) => BANK_EMAIL_DOMAINS.includes(d));
const appOk = (bank) => appNames.has(bank.name);

const METHOD_INFO = {
  email: { label: 'Forward alert emails', detail: 'Set a Gmail or Outlook rule once; every alert email lands automatically.', automatic: true },
  notifications: { label: 'Read bank app notifications', detail: 'Turn on notification access; payments are logged as the bank app notifies you.', automatic: true },
  statement: { label: 'Upload a statement', detail: 'Download a PDF or Excel statement from the bank app and upload it. Good for history.', automatic: false },
  share: { label: 'Share alerts to Automonie', detail: 'Share a bank text or notification to Automonie and confirm it.', automatic: false },
  mono: { label: 'Link the bank', detail: 'Connect the account through Mono for automatic imports (Pro).', automatic: true },
};

// Every bank the app knows, with its methods in the order to recommend them.
// platform: 'android' | 'ios' | 'web'; monoEnabled: Mono keys are set.
function bankMethods({ platform = 'web', monoEnabled = false } = {}) {
  const banks = [...BANKS.map((b) => ({ code: b.code, name: b.name, domains: b.domains || [] })), ...EXTRA];
  return banks.map((b) => {
    const has = {
      email: emailOk(b),
      notifications: platform === 'android' && appOk(b),
      statement: true,
      share: true,
      mono: monoEnabled,
    };
    // The brief's order (email, statement, share, Mono), with app notifications first
    // for app-first wallets and second for everyone else, on Android.
    let order = ['email', 'notifications', 'statement', 'share', 'mono'];
    if (APP_FIRST.has(b.code)) order = ['notifications', 'email', 'statement', 'share', 'mono'];
    const methods = order.filter((m) => has[m]).map((m) => ({
      method: m, ...METHOD_INFO[m], tested: TESTED[m]?.includes(b.code) || false, proOnly: m === 'mono',
    }));
    return { code: b.code, name: b.name, best: methods[0].method, methods };
  });
}

// The bank × method table for the report: what each method supports per bank.
function methodTable() {
  const rows = bankMethods({ platform: 'android', monoEnabled: true });
  const cell = (r, m) => {
    const x = r.methods.find((y) => y.method === m);
    if (!x) return 'no';
    return x.tested ? 'yes, tested' : 'yes';
  };
  return rows.map((r) => ({
    bank: r.name, email: cell(r, 'email'), notifications: cell(r, 'notifications'),
    statement: cell(r, 'statement'), share: cell(r, 'share'), mono: 'when switched on', best: METHOD_INFO[r.best].label,
  }));
}

module.exports = { bankMethods, methodTable, METHOD_INFO, TESTED };
