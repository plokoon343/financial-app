// Clean names (round 6, Block 3, section 5.3; research 13.2). Turns a raw bank
// narration into the title rule 4 of this round requires ("No raw narration as a
// title. Raw text only on Transaction detail under 'Original alert.'"). Pure and
// dependency-free: every external signal (a user's own rename, a learned merchant,
// the catalogue) is passed in by the caller rather than read from a database here,
// same as every other lib this round.
//
// Match order (13.2): user's own rule -> learned merchant (confirmed twice) ->
// catalogue exact/alias match -> close-spelling suggestion (never auto-applied,
// never a logo) -> generic strip -> "Card payment" if nothing readable is left.
'use strict';

const { extractCounterparty } = require('./counterparty');
const { catalogueMatch, allEntries } = require('./merchantCatalogue');
const { jaroWinkler } = require('./dedupe');

// ── Generic strip: channel words, terminal IDs, long digits, references, bank
//    codes (13.2 rule 1). Deliberately mirrors (does not re-derive) the noise words
//    finpilot-mobile/src/lib/txnDisplay.ts already strips on the client, so a
//    narration reads the same whichever side cleans it. ──
const CHANNEL_WORDS = /\b(NIP|NXG|NEFT|RTGS|TRF|TRANSFER|TRANSFERTO|TRFTO|TO|FRM|FROM|REF|USSD|POS|PUR|PURCHASE|WEB|MOB|MOBILE|VISA|MC|MASTERCARD|VERVE|ATM|CASH|WD|DR|CR|PLC|LTD|LIMITED|NG|NGN)\b/gi;
const BANK_WORDS = /\b(GTB|GTBANK|KUDA|UBA|ACCESS|ZENITH|FIRSTBANK|FBN|OPAY|PALMPAY|MONIEPOINT|WEMA|FIDELITY|STANBIC|UNION|POLARIS|FCMB|STERLING|ECOBANK|JAIZ|KEYSTONE|PROVIDUS|BANK|MFB)\b/gi;
const LONG_DIGITS = /\b[\d*]{4,}\b/g;
// Either the word glued straight onto its own number ("REF99881234", no boundary
// between the letters and the digit so a bare \b...\b pair would miss it), or the
// bare word on its own ("REF", "APPROVED"). Never matches a real word that merely
// starts the same way ("REFUND": no digit follows "REF", and "U" blocks the
// standalone boundary).
const REFERENCE_WORDS = /\b(?:SESSION ?ID|SESSION|RRN|REFERENCE|REF)\s*[:#]?\s*\d[\dA-Z-]*\b|\b(?:SESSION|SESSIONID|RRN|REFERENCE|REF|APPROVED|SUCCESSFUL|TXN|TRANSACTION)\b/gi;
const ORDINAL_NOISE = /\b\d{1,2}(?:ST|ND|RD|TH)\b/gi; // "23RD" - a date fragment, not a name
const PUNCT = /[|/\\:._-]+/g;

// Known charge/levy wording (mirrors backend/lib/merchants.js's "Charges / duties /
// levies" group exactly, so a transaction categorised Bank Charges and a transaction
// named here agree with each other) -> the short, human label instead of the bank's
// own shouty narration ("STAMP DUTY CHARGE FOR TRXN...", "VAT").
const CHARGE_LABELS = [
  [/stamp ?dut(?:y|ies)/i, 'Stamp duty'],
  [/\bvat\b/i, 'VAT'],
  [/\be-?levy\b|electronic ?money ?transfer ?levy|\bemtl\b/i, 'E-levy'],
  [/nip ?fee|transfer ?fee/i, 'Transfer fee'],
  [/maintenance ?fee|account ?maintenance|\bamf\b/i, 'Account maintenance fee'],
  [/sms ?(?:alert|charge)/i, 'SMS alert charge'],
  [/\bcot\b/i, 'Commission on turnover'],
  [/card ?(?:fee|maintenance)/i, 'Card fee'],
  [/commission ?on/i, 'Commission'],
];

// Phone check finding 1, 8 Nov 2026: the catalogue can never cover every Nigerian
// business, and counterpartyType used to fall through anything extractCounterparty
// found straight to 'person' - "EKO Pharmacy", "Groovemall" and any other business
// not yet in the catalogue read as a person, which is exactly what fired the ajo
// card on Chowdeck before the catalogue had it (P6). Two independent signals a name
// is a business rather than a person, checked before ever assuming 'person':
//   - a business keyword no personal name uses.
//   - shape: a single word with no space. Real Nigerian personal names are
//     virtually always two or more words (first + surname, at least); a single
//     unspaced word ("Groovemall", "Jumia") is far more often a trading name.
const BUSINESS_WORDS = /\b(pharmacy|mall|stores?|ltd|limited|enterprises?|ventures?|services?|foods?|motors?|global|technolog(?:y|ies)|solutions?|nigeria|plaza|supermarket|hotel|restaurant|clinic|hospital|academy|schools?|company|industries|logistics|concepts?|group|international)\b/i;
function looksLikeBusiness(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (BUSINESS_WORDS.test(s)) return true;
  return !/\s/.test(s);
}

// The positive shape of an ordinary Nigerian personal name: two or more words, each
// alphabetic and long enough to be a real name part. Checked only once a business
// match has already been ruled out, so a name that is neither clearly a business nor
// clearly shaped like a person's (one real word plus noise, three single letters,
// and so on) is left unflagged rather than guessed as a person.
function looksLikePerson(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((w) => /^[A-Za-z'-]{2,}$/.test(w));
}

// Acronyms that must not be Title-Cased into "Pos"/"Atm"/"Nip".
const ACRONYMS = new Set(['POS', 'ATM', 'NIP', 'USSD', 'VAT', 'GTB', 'UBA', 'MTN', 'DSTV', 'GOTV']);
const titleCase = (s) => s.toLowerCase().split(' ').filter(Boolean).map((w) => {
  const up = w.toUpperCase();
  return ACRONYMS.has(up) ? up : w[0].toUpperCase() + w.slice(1);
}).join(' ');

function stripNoise(raw) {
  let s = String(raw || '')
    .replace(PUNCT, ' ')
    .replace(REFERENCE_WORDS, ' ')
    .replace(ORDINAL_NOISE, ' ')
    .replace(LONG_DIGITS, ' ')
    .replace(CHANNEL_WORDS, ' ')
    .replace(BANK_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

// Is what's left actually a readable name (letters, not just leftover punctuation
// or a 1-2 letter fragment)?
function isReadable(s) {
  const letters = (s || '').replace(/[^a-zA-Z]/g, '');
  return letters.length >= 3;
}

const SUGGEST_THRESHOLD = 0.88; // close but not exact - suggest, never auto-apply
const MIN_CATALOGUE_WORD = 4;   // don't fuzzy-match on short fragments ("pur", "trf")

// Closest catalogue brand name to a cleaned fragment, for M4's suggestion-only path.
// Exact matches are handled by catalogueMatch() before this is ever reached, so
// anything found here is, by construction, NOT exact - never returned as the name,
// never given a logo (5.2's hard rule). Compared word by word: a multi-word
// narration like "SHOPRTIE IKEJA" must be checked against "shoprite" one token at a
// time, since the whole-phrase strings are different lengths and would never score
// as close no matter how close the one misspelled word actually is.
function closeSpellingSuggestion(fragment, entries) {
  const words = (fragment || '').toLowerCase().split(/\s+/).filter((w) => w.length >= MIN_CATALOGUE_WORD);
  if (!words.length) return null;
  let best = null, bestScore = 0;
  for (const e of entries) {
    for (const serviceWord of e.service.toLowerCase().split(/\s+/)) {
      if (serviceWord.length < MIN_CATALOGUE_WORD) continue;
      for (const w of words) {
        const score = jaroWinkler(w, serviceWord);
        if (score > bestScore) { bestScore = score; best = e; }
      }
    }
  }
  if (best && bestScore >= SUGGEST_THRESHOLD && bestScore < 1) {
    return { name: best.service, slug: best.slug, score: bestScore };
  }
  return null;
}

/**
 * cleanName({ raw, type, merchantKey, userRule, learnedMerchant, catalogueEntries })
 *   raw              - the bank's own narration (Transaction.description).
 *   type             - 'income' | 'expense', for the "Card payment" vs generic
 *                       fallback wording.
 *   userRule         - this merchantKey's rename, if the user has set one (13.2
 *                       rule 1 / "the user's own rule").
 *   learnedMerchant  - { name, confirmations } if a close-spelling suggestion for
 *                       this key has already been accepted twice (13.2 rule 2).
 *   catalogueEntries - override for catalogueMatch()'s source list; tests only.
 *
 * Returns { name, source, category, logo, counterpartyType, suggestion }.
 * `suggestion` is only ever set alongside a non-catalogue `source`, and a
 * suggestion NEVER carries a logo - the caller must not show one until the
 * suggestion is confirmed (then it becomes a `learnedMerchant` on the next charge).
 */
function cleanName({ raw, type = 'expense', userRule = '', learnedMerchant = null } = {}) {
  const text = String(raw || '');

  // 1. The user's own rule - applies everywhere, no further matching needed.
  if (userRule && userRule.trim()) {
    return { name: userRule.trim(), source: 'user_rule', category: null, logo: null, counterpartyType: null, suggestion: null };
  }

  // 2. Learned merchant - the same close-spelling suggestion accepted twice.
  if (learnedMerchant && learnedMerchant.name && (learnedMerchant.confirmations || 0) >= 2) {
    return { name: learnedMerchant.name, source: 'learned', category: null, logo: learnedMerchant.logo || null, counterpartyType: null, suggestion: null };
  }

  // 3. Catalogue exact/alias match - the brand's own spelling, a real logo allowed.
  const hit = catalogueMatch(text);
  if (hit) {
    return { name: hit.service, source: 'catalogue', category: hit.category, logo: hit.logo, counterpartyType: null, suggestion: null };
  }

  // Known charge/levy wording: a fixed, short label, agreeing with merchants.js's
  // Bank Charges categorisation of the same trigger words.
  for (const [re, label] of CHARGE_LABELS) {
    if (re.test(text)) {
      return { name: label, source: 'charge_label', category: 'Bank Charges', logo: null, counterpartyType: null, suggestion: null };
    }
  }

  // A person/business the transfer names - Title Case (13.2 rule 3), never the bank's
  // own SHOUTED spelling. Flagged counterpartyType: 'person' so the caller applies
  // "Sent to people" rather than a spending category (round 6 rule 3) - but only
  // when the name is actually shaped like one. A business not in the catalogue
  // ("EKO Pharmacy", "Groovemall") gets 'business' instead, and anything genuinely
  // ambiguous gets neither (null) rather than a guessed 'person' (phone check
  // finding 1, 8 Nov 2026).
  const cp = extractCounterparty(text);
  if (cp && cp.name) {
    const name = titleCase(cp.name);
    const counterpartyType = looksLikeBusiness(cp.name) ? 'business' : (looksLikePerson(cp.name) ? 'person' : null);
    return { name, source: 'person', category: null, logo: null, counterpartyType, suggestion: null };
  }

  // 4. Close-spelling: suggest only, never apply, never a logo.
  const stripped = stripNoise(text);
  const suggestion = closeSpellingSuggestion(stripped, allEntries());

  if (isReadable(stripped)) {
    return {
      name: titleCase(stripped.toLowerCase()),
      source: 'stripped',
      category: null,
      logo: null,
      counterpartyType: null,
      suggestion,
    };
  }

  // 5. Nothing readable left: the brief's own fallback, never digits, raw text
  // stays on Transaction detail only.
  return {
    name: type === 'income' ? 'Money in' : 'Card payment',
    source: 'fallback',
    category: null,
    logo: null,
    counterpartyType: null,
    suggestion,
  };
}

module.exports = { cleanName, stripNoise, titleCase, closeSpellingSuggestion, CHARGE_LABELS, looksLikeBusiness, looksLikePerson };
