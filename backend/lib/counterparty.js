// Counterparty extraction for the People & Family ledger. Pulls the other party out
// of a transfer narration — their name, and where possible their bank + account — so
// person-to-person transfers can be grouped into contacts, family can be suggested by
// shared surname, and labelled contacts can auto-categorise future transfers.
//
// Conservative by design: a wrong contact is worse than none, so anything that isn't
// clearly a person/business transfer (billers, internal moves, card purchases) returns
// null and is left to the merchant categoriser. Pure + dependency-free → unit-tested.

'use strict';

// Words that mean "this is a biller/utility/airtime, not a person" — never a contact.
const NON_PERSON = /\b(airtime|data|electricity|prepaid|token|dstv|gotv|startimes|betting|bet9ja|sportybet|owealth|auto-?save|stamp duty|vat|levy|commission|reversal|refund|interest earned)\b/i;
// Rail/verb noise to strip from a captured name.
const RAIL_NOISE = /\b(nip|neft|rtgs|mobile|web|ussd|trf|transfer|instant|payment|outward|inward|to|from|pay|via|ref|vnd|gtb|opay|paystack|checkout|mobile trf)\b/gi;

const clean = (s) => (s || '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

// Normalise a person/business name for display + keying: collapse whitespace, strip
// surrounding punctuation, upper-case. Returns '' when nothing usable remains.
function normalizeName(raw) {
  let n = clean(raw)
    .replace(/[|/\\].*$/, '')          // drop anything after a pipe/slash (bank/acct segment)
    .replace(/\b\d[\d*]{3,}\b/g, ' ')  // drop account numbers / long digit runs
    .replace(/[^A-Za-z .'-]/g, ' ')    // keep name characters only
    .replace(/\s+/g, ' ')
    .trim();
  // A name should be mostly letters and 1–5 words.
  if (!n || n.replace(/[^A-Za-z]/g, '').length < 3) return '';
  const words = n.split(' ').filter(Boolean).slice(0, 5);
  return words.join(' ').toUpperCase();
}

// Find an account number (masked "503****065" or a 10+ digit run) in a segment.
function findAccount(s) {
  const m = clean(s).match(/\b(\d{3}\*{2,}\d{2,}|\d{10,})\b/);
  return m ? m[1] : '';
}

// extractCounterparty(description) → { direction:'to'|'from', name, bank, account } | null
function extractCounterparty(description) {
  const d = clean(description);
  if (!d || NON_PERSON.test(d)) return null;
  // Must look like a person/business transfer: a transfer-ish verb AND a to/from.
  if (!/\b(transfer|trf|nip|instant payment|payment|sent|paid|received)\b/i.test(d)) return null;
  const m = d.match(/\b(to|from)\b\s*[:\-|]?\s*(.+)$/i);
  if (!m) return null;
  const direction = m[1].toLowerCase();
  const rest = m[2];

  let namePart = rest, bank = '', account = '';
  if (rest.includes('|')) {
    const parts = rest.split('|').map((s) => s.trim()).filter(Boolean);
    namePart = parts[0] || '';
    for (const p of parts.slice(1)) {
      const acct = findAccount(p);
      if (acct && !account) { account = acct; continue; }
      if (!bank && /[A-Za-z]{3,}/.test(p) && !/^\d/.test(p)) bank = clean(p).slice(0, 40);
    }
  } else {
    account = findAccount(rest);
    // Cut the name off at the account/ref/dash so we don't swallow the bank + digits.
    namePart = rest.replace(/\b\d[\d*]{3,}\b.*$/, '').replace(/\s[-–]\s.*$/, '');
  }

  // Strip rail-noise words that leak into non-pipe narrations, then normalise.
  const name = normalizeName(namePart.replace(RAIL_NOISE, ' '));
  if (!name) return null;
  return { direction, name, bank, account };
}

// A stable key for a contact: prefer the account number (identity survives name
// spelling differences); fall back to the normalised name.
function contactKey({ account, name }) {
  const acct = (account || '').replace(/\D/g, '');
  if (acct.length >= 6) return `acct:${acct}`;
  const masked = (account || '').includes('*') ? account.replace(/\s/g, '') : '';
  if (masked) return `acct:${masked}`;
  return name ? `name:${normalizeName(name)}` : '';
}

// Significant surname/name tokens (≥4 letters) for family matching.
const nameTokens = (name) => normalizeName(name).split(' ').filter((w) => w.replace(/[^A-Z]/g, '').length >= 4);

// Does a counterparty likely share a family name with the account holder? Nigerian
// names put the surname first OR last, so we match on ANY shared significant token.
// This only ever SUGGESTS family (never auto-asserts), so a loose match is fine.
function familySignal(holderName, contactName) {
  const a = new Set(nameTokens(holderName));
  if (!a.size) return false;
  return nameTokens(contactName).some((t) => a.has(t));
}

module.exports = { extractCounterparty, normalizeName, contactKey, familySignal, findAccount };
