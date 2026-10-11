/*
 * Build the server's alert test set (corpus/alerts/<bank>.jsonl) from real alerts,
 * anonymised: people's names become fictional ones, account fragments, references,
 * session IDs and phone numbers get different digits of the same shape. Amounts,
 * dates and directions are left exactly as they were, since those are what we test.
 *
 *   node backend/scripts/anonymise-corpus.mjs                    # from ../finpilot-mobile/corpus/sms
 *   node backend/scripts/anonymise-corpus.mjs --from <dir>       # any folder of <bank>.jsonl
 *   node backend/scripts/anonymise-corpus.mjs --file new.jsonl --bank gtbank   # add one file
 *
 * Input lines: { "raw": "...", "expected": { amount, direction, date, counterparty?, ignore? } }.
 * Re-running is safe: cases already in the output (same anonymised text) are skipped.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'corpus', 'alerts');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] ? args[i + 1] : d; };

const FAKE = ['ADA OBI', 'TUNDE BAKARE', 'CHIOMA EZE', 'MUSA BELLO', 'FUNKE ADEYEMI', 'EMEKA NWOSU', 'HALIMA SANI', 'SEGUN OJO', 'NGOZI OKAFOR', 'IBRAHIM YUSUF', 'BOLA ALABI', 'UCHE IKE'];
const NOT_NAME = /\b(POS|PYMT|PAYMENT|PURCHASE|TRANSFER|TRF|NIP|BANK|LTD|LIMITED|PLC|VENTURES|ENTERPRISES?|STORES?|SUPERMARKET|STATION|FILLING|SERVICES?|NIGERIA|INTERNATIONAL|GLOBAL|CHARGE|FEE|DUTY|STAMP|AIRTIME|DATA|MTN|GLO|AIRTEL|ETISALAT|DSTV|GOTV|OWEALTH|SAVINGS|WALLET|ACCOUNT|TOTAL|MOBIL|OANDO|CONOIL|SHOPRITE|SPAR|JUMIA|BOLT|UBER|PAYSTACK|FLUTTERWAVE|OPAY|PALMPAY|KUDA|MONIEPOINT|REVERSAL|ATM|WEB|USSD)\b/;

const nameMap = new Map();
const fakeFor = (name) => {
  const k = name.toUpperCase().replace(/\s+/g, ' ').trim();
  if (!nameMap.has(k)) {
    const base = FAKE[nameMap.size % FAKE.length];
    const words = k.split(' ').length;
    nameMap.set(k, words >= 3 ? `${base} ${['JOHN', 'GRACE', 'PETER'][nameMap.size % 3]}` : base);
  }
  return nameMap.get(k);
};
// A name we already swapped in (so it isn't swapped a second time).
const isFake = (name) => { const n = name.toUpperCase(); return [...nameMap.values()].some((f) => n === f || n.startsWith(`${f} `) || f.startsWith(n)); };
const shift = (s) => s.replace(/\d/g, (d) => String((Number(d) * 7 + 3) % 10));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function anonymise(raw, expected) {
  let text = raw;
  let cp = expected.counterparty;
  // Names we know from the expected output.
  if (cp && /^[A-Za-z][A-Za-z .'-]+$/.test(cp) && cp.trim().split(/\s+/).length >= 2 && !NOT_NAME.test(cp.toUpperCase())) {
    const fake = fakeFor(cp);
    text = text.replace(new RegExp(escapeRe(cp), 'gi'), fake);
    cp = fake;
  }
  // Other people's names after to/from/by (two to four plain words, not a business).
  text = text.replace(/\b(to|from|by|frm|sender|beneficiary)(\s*:?\s+)([A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+){1,3})\b/g, (m, w, sp, name) =>
    (NOT_NAME.test(name) || isFake(name) ? m : `${w}${sp}${fakeFor(name)}`));
  // Phone numbers.
  text = text.replace(/\b0[789][01]\d{8}\b/g, (p) => `0800${shift(p.slice(4))}`);
  // Masked account fragments: 2XX..35X, 003******915, ****4120.
  text = text.replace(/[0-9Xx*•.]*[Xx*•]+[0-9Xx*•.]*\d[0-9Xx*•.]*|\d+[Xx*•]+[0-9Xx*•.]*/g, (t) => (/\d/.test(t) ? shift(t) : t));
  // References, session IDs, card and account numbers: 6+ digits not part of an amount.
  text = text.replace(/(?<![\d,.]|NGN|N|₦)\d{6,}(?![\d,]*\.\d{2}\b)/g, (d) => shift(d));
  return { raw: text, expected: { ...expected, ...(cp ? { counterparty: cp } : {}) }, anonymised: true };
}

function addFile(file, bank) {
  const lines = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = join(OUT, `${bank}.jsonl`);
  const have = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).raw) : []);
  let added = 0;
  const rows = [];
  for (const l of lines) {
    const c = JSON.parse(l);
    const a = anonymise(c.raw, c.expected || {});
    if (have.has(a.raw)) continue;
    have.add(a.raw); rows.push(JSON.stringify(a)); added++;
  }
  if (rows.length) writeFileSync(out, (existsSync(out) ? readFileSync(out, 'utf8') : '') + rows.join('\n') + '\n');
  return added;
}

mkdirSync(OUT, { recursive: true });
if (opt('--file')) {
  console.log(`${opt('--bank', basename(opt('--file'), '.jsonl'))}: +${addFile(opt('--file'), opt('--bank', basename(opt('--file'), '.jsonl')))}`);
} else {
  const from = opt('--from', join(HERE, '..', '..', '..', 'finpilot-mobile', 'corpus', 'sms'));
  for (const f of readdirSync(from).filter((x) => x.endsWith('.jsonl')).sort()) {
    console.log(`${basename(f, '.jsonl')}: +${addFile(join(from, f), basename(f, '.jsonl'))}`);
  }
}
