'use strict';

// Cross-source dedupe scoring (Spec 2). Different sources describe the same
// transaction differently, so we can't match on exact IDs — we build a fuzzy
// fingerprint and score candidate pairs.
//
//   matchScore(fingerprint(a), fingerprint(b)) -> 0..110
//   >= 85  auto-merge (silent)
//   70-84  probable duplicate -> confirm in the preview gate
//   < 70   distinct
//
// Mandatory: amount must match exactly and direction must match, else score 0.

// Noise tokens that describe the rail, not the payee. Stripped when normalising a
// counterparty so "NIP TRF FRM SAMUEL OLAMIDE/REF:0091823" -> "SAMUEL OLAMIDE".
const NOISE = new Set([
  'NIP', 'NXG', 'NEFT', 'RTGS', 'TRF', 'TFR', 'TRANSFER', 'FROM', 'FRM', 'TO', 'REF', 'REFERENCE',
  'POS', 'WEB', 'USSD', 'MOB', 'MOBILE', 'ATM', 'CASH', 'PUR', 'PURCHASE', 'PYMT', 'PAYMENT', 'PMT',
  'VIA', 'FIP', 'UIP', 'BILLS', 'BILL', 'SELF', 'INWARD', 'OUTWARD', 'DR', 'CR', 'DEBIT', 'CREDIT',
  'THE', 'AND', 'FOR', 'LTD', 'PLC', 'NG', 'NGN',
]);

const MERGE = 85;   // >= auto-merge
const PROBABLE = 70; // >= flag to user

// Uppercase, strip punctuation and rail noise, drop ref/terminal/date fragments,
// keep the significant name tokens (up to 4).
function normalizeCounterparty(raw) {
  if (!raw) return '';
  let s = String(raw).toUpperCase();
  s = s.replace(/[\/|\\:,._-]+/g, ' ');            // punctuation -> space
  s = s.replace(/\b\d{1,2}[\s\/-]\d{1,2}[\s\/-]\d{2,4}\b/g, ' '); // date fragments
  const tokens = s.split(/\s+/).filter((t) => {
    if (!t) return false;
    if (NOISE.has(t)) return false;
    if (/\d/.test(t)) return false;                 // ref codes, terminal IDs, acct numbers
    if (t.length < 2) return false;
    return true;
  });
  return tokens.slice(0, 4).join(' ').trim();
}

const dayDiff = (a, b) => Math.abs(Math.round((new Date(a) - new Date(b)) / 86400000));

// Jaro-Winkler similarity (0..1) — no dependency.
function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const m = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1m = new Array(s1.length).fill(false);
  const s2m = new Array(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - m), hi = Math.min(i + m + 1, s2.length);
    for (let j = lo; j < hi; j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true; matches++; break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;
  const jaro = (matches / s1.length + matches / s2.length + (matches - t) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) { if (s1[i] === s2[i]) prefix++; else break; }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// Build the fields we match on from a transaction ({ amount, type, date, bank, description }).
function fingerprint(t) {
  const direction = t.direction || (t.type === 'income' ? 'credit' : (t.type === 'expense' ? 'debit' : (Number(t.amount) >= 0 ? 'credit' : 'debit')));
  return {
    amount: Math.round(Math.abs(Number(t.amount)) * 100) / 100,
    direction,
    date: t.date,
    account: (t.accountId || t.bank || '').toString().toUpperCase().trim(),
    cp: normalizeCounterparty(t.counterparty || t.description || ''),
  };
}

// Score two fingerprints. Amount + direction are mandatory (else 0).
function matchScore(a, b) {
  if (a.amount !== b.amount) return 0;
  if (a.direction !== b.direction) return 0;
  // Date is near-mandatory: copies of the same transaction land on the same day or
  // within a day or two (posting vs value date). Beyond a few days it's a distinct
  // transaction that merely shares an amount — never merge those.
  const dd = (a.date && b.date) ? dayDiff(a.date, b.date) : 99;
  if (dd > 3) return 0;
  let score = 60; // 50 amount + 10 direction
  if (a.account && b.account && a.account === b.account) score += 15;
  if (dd === 0) score += 15;
  else if (dd <= 1) score += 8;
  if (a.cp && b.cp) {
    if (a.cp === b.cp) score += 20;
    else if (jaroWinkler(a.cp, b.cp) > 0.8) score += 12;
  }
  return score;
}

function classify(score) {
  if (score >= MERGE) return 'duplicate';
  if (score >= PROBABLE) return 'probable';
  return 'distinct';
}

// Richest-source priority for merges: keep the most structured record.
const SOURCE_RANK = { mono: 4, statement: 3, statement_pdf: 3, statement_csv: 3, sms: 2, email: 2, import: 2, voice: 1, manual: 1 };
const richer = (a, b) => (SOURCE_RANK[a] || 0) >= (SOURCE_RANK[b] || 0);

module.exports = { normalizeCounterparty, fingerprint, matchScore, classify, jaroWinkler, richer, MERGE, PROBABLE };
