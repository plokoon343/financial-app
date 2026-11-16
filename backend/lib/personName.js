'use strict';
// Is this counterparty name plausibly a PERSON? Used before asking "Who is {name}?",
// whose answers are Family, Friend and Work: asked about a bank or a shop, that is a
// nonsense question the user can only answer wrongly (phone check, build 1799244d:
// "Who is ACCESS?", "Who is UBA?", "Who is ZBN?", "Who is FROZO FOOD SUPER STORE?").
//
// Unknown beats wrong, so this only says yes to a name that is positively shaped like
// a person (two or more real words) and is neither a bank or wallet nor a business.
//
// Pure and dependency-light: the bank list is data/banks.json through bankRegistry,
// the business words are cleanName's own (the ones that already stop a shop being
// offered as an ajo).

const { resolveBank } = require('./bankRegistry');
const { hasBusinessWords, looksLikePerson } = require('./cleanName');
const { normalizeName, extractCounterparty, isSelf } = require('./counterparty');

// Words that only qualify a bank's name ("Access Bank", "Sterling MFB").
const BANK_FILLER = new Set(['BANK', 'MFB', 'MICROFINANCE', 'PLC', 'LTD', 'LIMITED', 'NG', 'NIGERIA', 'OF', 'THE']);

// True when every word of the name is a bank/wallet alias or a filler word, so
// "ACCESS", "ZBN", "Access Bank" and "OPay" are banks but "Zenith Okafor" is not.
function isBankOrWalletName(name) {
  const words = String(name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  if (!words.length) return false;
  let sawBank = false;
  for (const w of words) {
    if (BANK_FILLER.has(w)) continue;
    if (resolveBank(w, '')) { sawBank = true; continue; }
    return false;
  }
  return sawBank;
}

function isPlausiblePerson(name) {
  const s = String(name || '').trim();
  if (!s) return false;
  if (isBankOrWalletName(s)) return false;
  if (hasBusinessWords(s)) return false;
  return looksLikePerson(s);
}

// ── The account holder's full name ──────────────────────────────────────────────
// Some accounts store only one word ("Chidumebi"), and every own-name check needs two
// name parts, so a narration naming the holder in full was never recognised as self.
// The narration itself settles it when it names the SAME person on both sides ("from
// X to X") or writes one name twice ("to X X"): that is the holder's own name, and it is
// only trusted when it contains the stored word.

// The name a narration names on both sides or twice in a row, else ''.
function selfSignalName(description) {
  const d = String(description || '').replace(/\s+/g, ' ').trim();
  if (!d) return '';
  const segs = [...d.matchAll(/\b(to|from)\b\s*[:\-|]?\s*(.+?)(?=\s+\b(?:to|from)\b|$)/gi)]
    .map((m) => ({ dir: m[1].toLowerCase(), name: normalizeName(m[2]) }));
  const to = segs.find((s) => s.dir === 'to' && s.name);
  const from = segs.find((s) => s.dir === 'from' && s.name);
  if (to && from && to.name === from.name && to.name.split(' ').length >= 2) return to.name;
  const cp = extractCounterparty(d);
  if (cp && cp.name) {
    // normalizeName has already folded "A B A B" into "A B"; a repeat is visible only
    // in the raw text, so compare the raw tail's word count with the folded name's.
    const raw = d.replace(/^.*?\b(?:to|from)\b\s*[:\-|]?\s*/i, '').replace(/[^A-Za-z .'-]/g, ' ').trim().split(/\s+/);
    const folded = cp.name.split(' ').length;
    if (folded >= 2 && raw.length >= folded * 2 && raw.slice(0, folded * 2).join(' ').toUpperCase() === `${cp.name} ${cp.name}`) return cp.name;
  }
  return '';
}

const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);

/**
 * inferHolderName(storedName, descriptions) -> the best full name for the account holder.
 * Returns the stored name unchanged when it already has two name parts.
 */
function inferHolderName(storedName, descriptions = []) {
  if (tokens(storedName).length >= 2) return storedName;
  const mine = tokens(storedName);
  if (!mine.length) return storedName || '';
  const counts = new Map();
  for (const d of descriptions) {
    const n = selfSignalName(d);
    if (!n) continue;
    if (!tokens(n).some((t) => mine.includes(t))) continue;
    counts.set(n, (counts.get(n) || 0) + 1);
  }
  const best = [...counts.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : storedName;
}

// Does this narration pay the account holder's own name? (Needs the full name.)
function paysHolder(description, holderName) {
  const cp = extractCounterparty(description);
  if (cp && cp.name && isSelf(holderName, cp.name)) return true;
  return !!(holderName && selfSignalName(description) && isSelf(holderName, selfSignalName(description)));
}

module.exports = { isPlausiblePerson, isBankOrWalletName, selfSignalName, inferHolderName, paysHolder };
