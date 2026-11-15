'use strict';
// The one entry point that decides a transaction's category (round 10, A2).
//
// Before this, every ingestion path called the keyword categoriser directly, so the
// user's own rules, contact labels and learned merchants applied on some paths and
// not others. Every path now calls categorise(), and it answers in one fixed order,
// first hit wins:
//
//   1. user rule (merchant or person)         source 'rule'
//   2. contact label (relationship or category)           'contact'
//   3. special kinds (own move, cash, reversal, fee)      'default', never a guess
//   4. learned merchant (name accepted twice)             'learned'
//   5. approved global consensus for the key              'consensus'
//   6. merchant catalogue                                 'catalogue'
//   7. whole-word keyword rules                           'keyword'
//   8. person detection (Sent to people / Money from People)  'person'
//   9. channel default (unknown card/web purchase, Other)     'default', guessed
//  10. AI suggestion (stripped data only), when one is supplied  'ai', guessed
//
// AI never decides an amount or a direction: the direction comes in with the row and
// is only ever read here, and step 10 can only name a category for that direction.
//
// Pure: the caller loads the maps once per request/scan (never per row) and passes
// them in. With no maps it still runs steps 3 and 6 to 9, which is what the
// statement parsers use before the route layers the user's own maps on top.
//
// Returns { category, source, guessed, kind }. The category is never 'Transfer' or
// 'ATM/POS': those stopped being categories in round 10 (A3).

const { matchMerchant } = require('./merchants');
const { catalogueMatch } = require('./merchantCatalogue');
const { keywordMatch } = require('./categorize');
const { classifyKind, KIND_TYPES } = require('./txnKinds');
const { extractCounterparty, contactKey } = require('./counterparty');
const { deriveCategoryKey } = require('./merchantKey');
const { cleanName, looksLikeBusiness, looksLikePerson } = require('./cleanName');
const categories = require('../constants/categories');

const SOURCES = ['rule', 'contact', 'learned', 'consensus', 'catalogue', 'keyword', 'person', 'default', 'ai'];
// Sources the machine decided on its own. The rest ('rule', 'contact', 'learned')
// came from something the user said, and a backfill must never move them.
const MACHINE_SOURCES = ['consensus', 'catalogue', 'keyword', 'person', 'default', 'ai'];
const GUESS_SOURCES = ['keyword', 'person', 'default', 'ai'];

const SENT_TO_PEOPLE = 'Sent to people';
const MONEY_FROM_PEOPLE = 'Money from People';

// Banks and wallets that appear next to a name in a transfer narration ("TO OPAY - ADA
// OBI", "ADA OBI/PALMPAY", "ADA OBI Moniepoint"). They are the rail, not the person.
const RAIL_WORDS = /\b(?:opay|palmpay|moniepoint|kuda|gtbank|gtb|gtworld|uba|zenith|access|first ?bank|fcmb|sterling|wema|fidelity|union|stanbic|polaris|ecobank|keystone|providus|mfb|bank|wallet|nip|ft)\b/gi;

// A person on the far end of a transfer when cleanName could not say (the name is glued
// to a wallet name, or the narration says FT). Needs a transfer word and a to/from, and
// the name left after the rail words are dropped must be person-shaped and not business-
// shaped. Returns true only then, so an unclear narration stays an honest guess.
// Words that name a relationship, not a business: "Family Support", "Mum", "Big Brother".
const RELATION = /\b(?:family|friends?|mum|mummy|mom|dad|daddy|parents?|brother|bro|sister|sis|uncle|aunty|auntie|cousin|wife|husband|son|daughter|boo)\b/i;
// Words that make a two-word label a purpose or a business, not a person.
const NOT_A_NAME = /\b(?:income|payment|repayment|salary|loan|savings?|rent|rental|business|partner|investment|interest|refund|fee|fees|charges?|bill|bills|purchase|subscription|allowance)\b/i;
// "Ada Obi", "Chukwuemeka O.": at least one full name word plus another name word or an initial.
function nameShaped(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  if (!words.every((w) => /^[A-Za-z'-]{2,}$/.test(w) || /^[A-Za-z]\.$/.test(w))) return false;
  return words.some((w) => /^[A-Za-z'-]{3,}$/.test(w));
}

// Noise a wallet glues onto the name: masked account numbers, reference blobs, the
// leftover stars from "OPay *****1234". Dropped before the name is judged, because
// "GABRIEL UDOKA EDWARD *****" is a person and "*****" is not a name word.
const NAME_NOISE = /[*#]+\d*|\b\d[\d*]{2,}\b|\b[A-Za-z]*\d+[A-Za-z0-9]*\b/g;

// "ONUKOGU CHIDUMEBI VINCENT has sent you", "ADA OBI sent you ₦5,000": OPay and
// Moniepoint put the sender BEFORE the verb, with no to/from anywhere, so the to/from
// reader below never saw it. Measured on a real account, 15 Nov 2026: the commonest
// shape among credits that fell through to Other.
function personBeforeSentYou(description) {
  const d = String(description || '');
  const m = d.match(/(?:^|[\n.:])\s*([A-Za-z'.\- ]{4,60}?)\s+(?:has\s+)?sent\s+you\b/i);
  if (!m) return null;
  const name = m[1].replace(NAME_NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (!name || RAIL_WORDS.test(name)) { RAIL_WORDS.lastIndex = 0; return null; }
  RAIL_WORDS.lastIndex = 0;
  if (looksLikeBusiness(name) || NOT_A_NAME.test(name)) return null;
  return looksLikePerson(name) || nameShaped(name) ? name : null;
}

function personFromTransfer(description) {
  const d = String(description || '');
  if (personBeforeSentYou(d)) return true;
  if (!/\b(?:transfer|trf|nip|ft|sent)\b/i.test(d)) return false;
  // "NIP Transfer In - Ada Obi", "Transfer Out - Mum": the name follows a dash.
  const dashed = d.match(/\btransfer\s+(?:in|out)\b\s*[-\u2013:]\s*(.+)$/i);
  const m = dashed || d.match(/\b(?:to|from)\b[\s:\-|/]*(.+)$/i);
  if (!m) return false;
  const segment = m[1].split(/[|/]/)[0].replace(/\b\d[\d*]{3,}\b.*$/, '');
  const name = segment.replace(RAIL_WORDS, ' ').replace(NAME_NOISE, ' ').replace(/[-\u2013:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return false;
  if (dashed && RELATION.test(name)) return true;
  if (looksLikeBusiness(name) || NOT_A_NAME.test(name)) return false;
  return looksLikePerson(name) || nameShaped(name);
}

function directionOf(txn) {
  const t = txn && txn.type;
  if (t === 'income' || t === 'expense') return t;
  if (txn && (txn.baseType === 'income' || txn.baseType === 'expense')) return txn.baseType;
  const n = Number(txn && txn.amount);
  if (Number.isFinite(n) && n !== 0) return n > 0 ? 'income' : 'expense';
  return 'expense';
}

// A category is usable for this row only if it still exists as a visible category
// and is on the right side of the money (an income label never lands on a spend).
function usable(category, base) {
  if (!category) return false;
  const c = categories.categoryById(category);
  if (!c || c.retired) return false;
  return (c.effect === 'Income') === (base === 'income');
}

const result = (category, source, extra = {}) => ({
  category, source, guessed: GUESS_SOURCES.includes(source), kind: null, ...extra,
});

function categorise({ txn = {}, user = null, maps = null } = {}) {
  void user;
  const m = maps || {};
  const description = (txn.description || '').toString();
  const base = directionOf(txn);
  const isExpense = base === 'expense';
  const fallback = isExpense ? 'Other' : 'Other Income';
  const key = deriveCategoryKey(description);

  // 1. The user's own rule for this merchant or person.
  const ruled = key && m.userRules ? m.userRules.get(key) : null;
  if (usable(ruled, base)) return result(ruled, 'rule');

  // 2. A labelled contact: an explicit category on them, else the relationship.
  const cp = extractCounterparty(description);
  const ck = cp ? contactKey(cp) : null;
  const contact = ck && m.contacts ? m.contacts.get(ck) : null;
  if (contact) {
    if (usable(contact.category, base)) return result(contact.category, 'contact');
    if (contact.relationship === 'family' || contact.relationship === 'friend') {
      return result(isExpense ? 'Family & Friends' : MONEY_FROM_PEOPLE, 'contact');
    }
  }

  // 3. Special kinds. They set the kind, not a spending category, and are decided
  // by the existing linking and kind rules, never by a guess here.
  if (txn.isFee) return result('Bank Charges', 'keyword', { kind: 'fee', guessed: false });
  const own = txn.type === 'internal_transfer' || !!txn.internal;
  const kind = KIND_TYPES.includes(txn.type) ? txn.type : classifyKind({ type: base, description });
  if (kind === 'cash_withdrawal') {
    // An ATM fee reads like a withdrawal but is a bank charge, not cash.
    const fee = keywordMatch(description, true);
    if (fee && fee.category === 'Bank Charges') return result('Bank Charges', 'keyword', { kind });
    return result(fallback, 'default', { kind, guessed: false });
  }
  if (kind === 'reversal' && !isExpense) return result('Refund', 'default', { kind, guessed: false });
  const kindExtra = own ? { kind: 'internal_transfer' } : (kind ? { kind } : {});

  // 4. A merchant name the user has accepted twice maps to the category that
  // merchant has in the catalogue.
  const nameRule = key && m.nameRules ? m.nameRules.get(key) : null;
  if (isExpense && nameRule && nameRule.learnedName && (nameRule.confirmations || 0) >= 2) {
    const hit = matchMerchant(nameRule.learnedName) || catalogueMatch(nameRule.learnedName);
    if (hit && usable(hit.category, base)) return result(hit.category, 'learned', kindExtra);
  }

  // 5. The approved global consensus for this merchant key.
  const agreed = key && m.consensus ? m.consensus.get(key) : null;
  if (usable(agreed, base)) return result(agreed, 'consensus', kindExtra);

  // 6. The merchant catalogue. Merchants are expense-side.
  if (isExpense) {
    const hit = matchMerchant(description) || catalogueMatch(description);
    if (hit && usable(hit.category, base)) return result(hit.category, 'catalogue', kindExtra);
  }

  // 7. Whole-word keyword rules.
  const kw = keywordMatch(description, isExpense);
  if (kw && usable(kw.category, base)) return result(kw.category, 'keyword', kindExtra);

  // 8. A person on the other end of a transfer.
  let person = false;
  try {
    const cn = cleanName({ raw: description, type: base });
    person = cn.counterpartyType === 'person' && !NOT_A_NAME.test(cn.name || '');
  } catch { person = false; }
  if (!person) person = personFromTransfer(description);
  if (person && !own) return result(isExpense ? SENT_TO_PEOPLE : MONEY_FROM_PEOPLE, 'person', kindExtra);

  // 10 (before the plain fallback). An AI suggestion the caller already validated,
  // from stripped data only. It may name a category for THIS direction, nothing else.
  if (txn.aiSuggestion && usable(txn.aiSuggestion, base)) return result(txn.aiSuggestion, 'ai', kindExtra);

  // 9. Channel default: an unknown card or web purchase, or anything else nothing
  // above could place. Other, and honest that it is a guess.
  return result(fallback, 'default', kindExtra);
}

module.exports = { categorise, SOURCES, MACHINE_SOURCES, GUESS_SOURCES, SENT_TO_PEOPLE, MONEY_FROM_PEOPLE };
