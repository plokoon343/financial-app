// Which bank a statement or alert came from (moved from server.js).
const { resolveBank: resolveBankRegistry, extractAccountMask } = require('./bankRegistry');

// Best-effort detection of the issuing bank from statement text. List order is the
// priority (so a statement that merely *mentions* another bank in a narration still
// resolves to its real issuer). Keywords are specific phrases to avoid false hits
// (e.g. bare "uba" would match "Abuja"). The user confirms/overrides on review.
const BANK_SIGNATURES = [
  ['Union Bank', ['union bank']],
  ['GTBank', ['gtbank', 'guaranty trust', 'gtworld', 'gt bank']],
  ['Kuda', ['kuda']],
  ['Access Bank', ['access bank', 'diamond bank']],
  ['Zenith Bank', ['zenith bank']],
  ['First Bank', ['first bank', 'firstbank']],
  ['UBA', ['united bank for africa']],
  ['Wema Bank', ['wema bank', 'alat']],
  ['Fidelity Bank', ['fidelity bank']],
  ['FCMB', ['fcmb', 'first city monument']],
  ['Sterling Bank', ['sterling bank']],
  ['Stanbic IBTC', ['stanbic']],
  ['Polaris Bank', ['polaris bank']],
  ['Ecobank', ['ecobank']],
  ['Keystone Bank', ['keystone bank']],
  ['Unity Bank', ['unity bank']],
  ['Providus Bank', ['providus']],
  ['Opay', ['opay']],
  ['PalmPay', ['palmpay']],
  ['Moniepoint', ['moniepoint']],
  ['Paystack-Titan', ['titan-paystack', 'paystack titan']],
];
const detectBank = (text = '') => {
  // Registry cascade first (resolves truncated sender IDs like PREMIUMTRST, and email
  // domains), then the legacy keyword signatures as a fallback.
  const m = resolveBankRegistry(text);
  if (m) return m.name;
  const l = (text || '').toLowerCase();
  for (const [name, kws] of BANK_SIGNATURES) {
    if (kws.some(kw => l.includes(kw))) return name;
  }
  return '';
};

// Account fingerprint from an alert/statement (spec Addendum A, slice 2): the
// registry bank code + name (so multiple sender-ID spellings collapse to one code)
// and the masked account tail. Returns empty strings when unknown: never guesses.
// An explicit sender ID (SMS address / email from) is fed to the resolver's fuzzy
// path and, when the bank is still unknown, kept as senderKey for the learn-unknown
// -senders flywheel (Addendum A slice 3).
const normalizeSenderKey = (s = '') => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
const fingerprintAccount = (text = '', sender = '') => {
  const m = resolveBankRegistry(text, sender || undefined);
  const key = normalizeSenderKey(sender);
  return {
    bankCode: m ? m.code : '',
    bankName: m ? m.name : detectBank(text),
    accountMask: extractAccountMask(text) || '',
    // Only a meaningful (≥4 char) sender is worth learning; skip shortcodes/blanks.
    senderKey: !m && key.length >= 4 ? key : '',
  };
};

module.exports = { BANK_SIGNATURES, detectBank, normalizeSenderKey, fingerprintAccount };
