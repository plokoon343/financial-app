'use strict';

// Receipt reading: OCR text (read on the phone) to { total, date, merchant }.
// Deterministic only: the total and the date always come from these rules, never from
// the AI. The AI may suggest the shop name and the category, and it only ever sees
// the text with every number removed (redactForAi), so it can't touch an amount.
//
//   parseReceipt('SHOPRITE\n...\nTOTAL 12,450.00\n12/09/2026 14:03')
//     -> { total: 12450, date: '2026-09-12', merchant: 'Shoprite', confidence: 'high', notes: [] }

// Total lines, strongest first. Subtotals, tax, change and tendered cash are never it.
const TOTAL_RULES = [
  /\bgrand\s*total\b/i,
  /\b(total\s*(due|payable|amount|paid|to\s*pay)|amount\s*(due|payable|paid)|balance\s*due|net\s*(total|amount))\b/i,
  /\btotal\b/i,
];
const SUBTOTAL = /sub\s*-?\s*total/i;
const NOT_TOTAL = /\b(sub\s*-?\s*total|total\s*(items?|qty|quantity|savings?|discount|vat|tax)|vat|tax|change|tendered|cash\s*paid|discount|saved|points?)\b/i;
// A money amount: optional ₦/N/NGN, thousands separators, optional kobo.
const AMOUNT = /(?:₦|\bngn\b|\bn(?=\s?\d))?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)/gi;
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
// Header lines that are never the shop's name.
const NOT_MERCHANT = /\b(receipt|invoice|welcome|thank|tel|phone|tin|vat|rc\s*no|cashier|till|terminal|pos|date|time|address|street|road|rd\b|st\b|avenue|close|lagos|abuja|nigeria|www\.|\.com|@)/i;

const lines = (text) => String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

// Every money-looking amount on a line, as numbers. Dates and times are removed
// first so "12/09/2026" or "14:03" never read as an amount.
function amountsIn(line) {
  const clean = line
    .replace(/\b\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ');
  const out = [];
  for (const m of clean.matchAll(AMOUNT)) {
    const whole = m[1].replace(/,/g, '');
    const value = Number(m[2] ? `${whole}.${m[2]}` : whole);
    if (Number.isFinite(value) && value > 0) out.push(value);
  }
  return out;
}

// The total: the last line matching the strongest rule that has an amount on it (or
// on the next line, for receipts that print the figure underneath). Receipts list
// running totals before the final one, so the last match wins.
function findTotal(ls) {
  for (let r = 0; r < TOTAL_RULES.length; r++) {
    let found = null;
    ls.forEach((l, i) => {
      if (!TOTAL_RULES[r].test(l) || SUBTOTAL.test(l)) return;
      if (r === 2 && NOT_TOTAL.test(l)) return; // a bare "total" next to tax, change, items…
      const here = amountsIn(l);
      const next = !here.length && ls[i + 1] ? amountsIn(ls[i + 1]) : [];
      const value = (here.length ? here : next).slice(-1)[0];
      if (value != null) found = { value, rule: r };
    });
    if (found) return found;
  }
  return null;
}

const pad = (n) => String(n).padStart(2, '0');
const validYmd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const fullYear = (y) => (y < 100 ? 2000 + y : y);

// The receipt's date. Nigerian receipts are day-first (12/09/2026 is 12 September).
// A date in the future, or more than a year back, is ignored.
function findDate(ls, now) {
  const cands = [];
  for (const l of ls) {
    for (const m of l.matchAll(/\b(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})\b/g)) cands.push(validYmd(+m[1], +m[2], +m[3]));
    for (const m of l.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g)) cands.push(validYmd(fullYear(+m[3]), +m[2], +m[1]));
    for (const m of l.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?[\s-]*([a-z]{3,9})[\s,-]*(\d{2}|\d{4})\b/gi)) {
      const mon = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mon) cands.push(validYmd(fullYear(+m[3]), mon, +m[1]));
    }
    for (const m of l.matchAll(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi)) {
      const mon = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon) cands.push(validYmd(+m[3], mon, +m[2]));
    }
  }
  const today = now.toISOString().slice(0, 10);
  const yearAgo = new Date(now.getTime() - 366 * 86400000).toISOString().slice(0, 10);
  return cands.find((d) => d && d <= today && d >= yearAgo) || null;
}

const titleCase = (s) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s);

// The shop: the first line near the top that reads like a name (letters, not an
// address, phone, date or "RECEIPT" heading).
function findMerchant(ls) {
  for (const l of ls.slice(0, 6)) {
    const letters = (l.match(/[a-z]/gi) || []).length;
    if (letters < 3 || letters < l.length * 0.5 || l.length > 40) continue;
    if (NOT_MERCHANT.test(l)) continue;
    return titleCase(l.replace(/[^\w&'.\- ]/g, '').trim());
  }
  return '';
}

function parseReceipt(text, now = new Date()) {
  const ls = lines(text);
  const total = findTotal(ls);
  const date = findDate(ls, now);
  const merchant = findMerchant(ls);
  const notes = [];
  if (!total) notes.push('no-total');
  if (!date) notes.push('no-date');
  if (!merchant) notes.push('no-merchant');
  // High only when a clear total line and a date were both found; the user still
  // confirms every field before anything is saved.
  const confidence = total && total.rule < 2 && date ? 'high' : total ? 'medium' : 'low';
  return { total: total ? total.value : null, date, merchant, confidence, notes };
}

// The text the AI may see: every digit run removed (amounts, dates, phone and card
// numbers), emails dropped, capped in size. Only the shape and words remain.
function redactForAi(text) {
  return lines(text).slice(0, 40)
    .map((l) => l.replace(/\S+@\S+/g, ' ').replace(/[₦]/g, ' ').replace(/\d[\d,.:/-]*/g, '#').replace(/\s+/g, ' ').trim())
    .filter((l) => /[a-z]/i.test(l))
    .join('\n')
    .slice(0, 1500);
}

// Check an AI suggestion: the merchant must appear in the text it was shown (no
// invented names) and the category must be one we offer. Anything else is dropped.
function validateSuggestion(raw, redacted, categories) {
  const out = { merchant: '', category: '' };
  if (!raw || typeof raw !== 'object') return out;
  const m = String(raw.merchant || '').replace(/\s+/g, ' ').trim();
  if (m && m.length <= 40 && !/\d/.test(m) && redacted.toLowerCase().includes(m.toLowerCase())) out.merchant = titleCase(m);
  const c = String(raw.category || '').trim();
  if (categories.includes(c)) out.category = c;
  return out;
}

// Ask the AI for the shop name and category of a redacted receipt. Returns the raw
// { merchant, category } for validateSuggestion; throws on a transport error so the
// caller keeps the deterministic result.
async function suggestReceiptLLM(redacted, categories, cfg, fetchImpl = fetch) {
  const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You read the words of a shop receipt (all numbers are removed) and name the shop and its spending category. Use the shop name exactly as it is written in the text. If unsure, leave a field empty. Reply with JSON only.' },
        { role: 'user', content: `${redacted}\n\nCategories: ${categories.join(', ')}.\nReturn JSON exactly like: {"merchant":"","category":""}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`${cfg.name} ${res.status}`);
  const data = await res.json();
  try { return JSON.parse(String(data?.choices?.[0]?.message?.content || '{}').replace(/^```(json)?|```$/g, '')); }
  catch { return null; }
}

module.exports = { parseReceipt, redactForAi, validateSuggestion, suggestReceiptLLM, amountsIn };
