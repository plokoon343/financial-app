'use strict';
// Run: node backend/lib/receipt.test.js
const { parseReceipt, redactForAi, validateSuggestion, suggestReceiptLLM, amountsIn } = require('./receipt');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date('2026-10-10T12:00:00Z');
const CATS = ['Food', 'Groceries', 'Transport', 'Shopping'];

const shoprite = `SHOPRITE
Lekki Mall, Lekki Lagos
Tel: 0803 123 4567
RECEIPT
Peak Milk 400g      2,450.00
Indomie x5          1,500.00
SUBTOTAL            3,950.00
VAT 7.5%              296.25
TOTAL               4,246.25
CASH              5,000.00
CHANGE                753.75
12/09/2026 14:03`;
const r1 = parseReceipt(shoprite, now);
check('supermarket: total is TOTAL, not subtotal, cash or change', r1.total === 4246.25, r1);
check('supermarket: day-first date', r1.date === '2026-09-12', r1);
check('supermarket: merchant is the first name-like line', r1.merchant === 'Shoprite', r1);
check('supermarket: a bare TOTAL line is medium confidence', r1.confidence === 'medium', r1);

const chicken = `Chicken Republic
Ikeja City Mall
Order #4471
Date: 03-Oct-2026
Refuel Max           2,800
Grand Total (incl. VAT)   ₦3,010
Paid by card`;
const r2 = parseReceipt(chicken, now);
check('grand total wins, even next to VAT', r2.total === 3010, r2);
check('dd-Mon-yyyy date', r2.date === '2026-10-03', r2);
check('grand total + date is high confidence', r2.confidence === 'high', r2);
check('mixed-case merchant kept as written', r2.merchant === 'Chicken Republic', r2);

const below = `FILLING STATION
AMOUNT DUE
N 15,000.00
2026-10-08`;
const r3 = parseReceipt(below, now);
check('amount printed on the line under the label', r3.total === 15000, r3);
check('ISO date', r3.date === '2026-10-08', r3);

const multi = `MART\nTotal 1,000\nTotal 2,500\n05/10/26`;
check('the last total line wins', parseReceipt(multi, now).total === 2500);
check('two-digit year', parseReceipt(multi, now).date === '2026-10-05');

check('no total: null, low confidence', (() => { const r = parseReceipt('Thanks for shopping\nItems 3', now); return r.total === null && r.confidence === 'low'; })());
check('a future date is ignored', parseReceipt('X SHOP\nTOTAL 100\n12/12/2026', now).date === null);
check('an impossible date is ignored', parseReceipt('X SHOP\nTOTAL 100\n31/02/2026', now).date === null);
check('a date more than a year back is ignored', parseReceipt('X SHOP\nTOTAL 100\n01/01/2024', now).date === null);
check('"Total items 4" is not the total', parseReceipt('X SHOP\nTotal items 4\nTotal 900', now).total === 900);
check('"Sub Total" with a space is not the total', parseReceipt('X SHOP\nSub Total 800\nTotal 860', now).total === 860);
check('"Oct 5, 2026" date', parseReceipt('X SHOP\nOct 5, 2026\nTOTAL 1', now).date === '2026-10-05');

check('times and dates never read as amounts', amountsIn('12/09/2026 14:03').length === 0);
check('thousands separators and kobo', amountsIn('TOTAL ₦12,450.50')[0] === 12450.5);
check('merchant skips address/phone/heading lines', parseReceipt('RECEIPT\nTel 0803\n12 Allen Avenue\nMama Put Kitchen\nTOTAL 1,200', now).merchant === 'Mama Put Kitchen');

const red = redactForAi(shoprite + '\nemail: shop@example.com\nCard ****1234');
check('redaction leaves no digits', !/\d/.test(red), red);
check('redaction drops emails', !/@/.test(red), red);
check('redaction drops the naira sign', !/₦/.test(redactForAi('TOTAL ₦3,010')));
check('redaction keeps the words', red.includes('SHOPRITE') && red.includes('Peak Milk'));
check('redaction drops number-only lines', redactForAi('SHOP\n12/09/2026 14:03') === 'SHOP');

check('suggestion: merchant must appear in the text', validateSuggestion({ merchant: 'Shoprite', category: 'Groceries' }, red, CATS).merchant === 'Shoprite');
check('suggestion: invented merchant dropped', validateSuggestion({ merchant: 'Spar', category: 'Groceries' }, red, CATS).merchant === '');
check('suggestion: unknown category dropped', validateSuggestion({ merchant: 'Shoprite', category: 'Loans' }, red, CATS).category === '');
check('suggestion: digits in a merchant are refused', validateSuggestion({ merchant: 'Shop 24', category: 'Food' }, 'Shop 24', CATS).merchant === '');
check('suggestion: junk input is safe', validateSuggestion(null, red, CATS).merchant === '' && validateSuggestion('x', red, CATS).category === '');
check('suggestion never carries an amount', !('total' in validateSuggestion({ merchant: 'Shoprite', total: 5 }, red, CATS)));

// The AI request carries only the redacted text, and a bad reply is survivable.
(async () => {
  let sent = '';
  const fakeFetch = async (_url, opts) => { sent = opts.body; return { ok: true, json: async () => ({ choices: [{ message: { content: '```json\n{"merchant":"Shoprite","category":"Groceries"}\n```' } }] }) }; };
  const cfg = { baseURL: 'x', apiKey: 'k', model: 'm', name: 'gemini' };
  const got = await suggestReceiptLLM(red, CATS, cfg, fakeFetch);
  check('AI request body has no digits from the receipt', !/4,246|0803|2026/.test(sent), sent);
  check('fenced JSON reply is read', got && got.merchant === 'Shoprite' && got.category === 'Groceries', got);
  const junk = await suggestReceiptLLM(red, CATS, cfg, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'sorry' } }] }) }));
  check('a non-JSON reply gives null', junk === null);
  let threw = false;
  try { await suggestReceiptLLM(red, CATS, cfg, async () => ({ ok: false, status: 429 })); } catch { threw = true; }
  check('an HTTP error throws so the caller keeps the rules result', threw);

  console.log(`receipt: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
