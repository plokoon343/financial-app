// The server's alert parser (web paste, email forwarding, share, bank-app
// notifications), moved out of server.js so it can be tested against the anonymised
// alert corpus (corpus/alerts, scripts/parser-coverage.js).
//
// 1. classifyAlert decides what the alert is (lib/alertClassify): non-transactions are
//    dropped, fees become Bank Charges, unclear ones go to review.
// 2. The bank's entry in data/alertRules.json (if any) supplies field patterns; the
//    shared patterns cover every other bank.
// 3. The amount is never the balance: balance figures are blanked before we look.
const { normalizeAmount } = require('./amount');
const { normalizeAnyDate } = require('./dates');
const { detectDirection, parseLabeledAlert, parseTransferReceipt, blockStripPattern, alertDescription } = require('./alertParse');
const { classifyAlert, isFeeText, bankRule, withoutBalance } = require('./alertClassify');
const { fingerprintAccount, detectBank } = require('./bankDetect');
const { categorizeTransaction } = require('./categorize');

// Money in an alert: "NGN 5,000.00" / "₦5,000" / "N5000" (N only when it directly
// precedes a digit, so the 'n' in "on"/"in" isn't mistaken for naira) / a bare 2dp
// figure. Groups 1|2|3 hold the number.
const SMS_MONEY_RE = /(?:ngn|naira|₦)\s*([\d,]+(?:\.\d{1,2})?)|\bn(\d[\d,]*(?:\.\d{1,2})?)|\b([\d,]+\.\d{2})\b/gi;
const SMS_DATE_RE = /\b(\d{1,2}[\/-][A-Za-z]{3}[\/-]\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const longDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})$/);
  if (!m || !MON[m[2].toLowerCase()]) return null;
  return normalizeAnyDate(`${m[1]}-${m[2]}-${m[3].length === 2 ? `20${m[3]}` : m[3]}`);
};
const toISO = (s) => normalizeAnyDate(String(s || '').trim()) || longDate(String(s || '').trim());

function firstMoney(text, opts) {
  SMS_MONEY_RE.lastIndex = 0;
  let m;
  while ((m = SMS_MONEY_RE.exec(text)) !== null) {
    const norm = normalizeAmount(m[1] || m[2] || m[3], opts);
    if (norm.value != null && norm.value > 0) return norm;
  }
  return null;
}

// Parse one alert. Returns a row, or null when it isn't a transaction. A row carries
// `kind` ('transaction' | 'fee' | 'unsure') and `needsReview` when a person should look.
function parseAlert(msg, { source = 'sms', sender = '', today = new Date() } = {}) {
  const raw = String(msg || '').trim();
  if (!raw) return null;
  let first = classifyAlert(raw);
  if (first.kind === 'ignore') return null;

  // A transfer receipt names the OTHER side (a "Receiving bank" field, or just the
  // beneficiary/sender's name, which is often itself a wallet's registered business
  // name - "OPAY DIGITAL SERVICES LIMITED" - that would otherwise be mistaken for
  // the user's own bank). Strip whichever side is the counterparty: the beneficiary
  // on an outgoing receipt, the sender on an incoming one.
  const receipt = parseTransferReceipt(raw);
  // A labelled receipt with a readable sender/beneficiary name IS a transaction,
  // whether or not the generic classifier found a debit/credit verb to be sure of
  // it (some banks' receipts just say "Transaction Status: Successful", nothing
  // more direction-like) - round 6, part A item 2.
  if (first.kind === 'unsure' && receipt && receipt.description) first = { kind: 'transaction', reason: '' };
  let ownText = raw;
  if (receipt) {
    if (receipt.receivingBank) {
      ownText = ownText.replace(new RegExp(receipt.receivingBank.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    } else {
      const block = receipt.direction === 'income' ? receipt.senderBlock : receipt.receiverBlock;
      const pattern = blockStripPattern(block);
      if (pattern) ownText = ownText.replace(pattern, ' ');
    }
  }
  const { bankCode, bankName, accountMask, senderKey } = fingerprintAccount(ownText, sender);
  const rule = bankRule(bankCode);
  const labeled = parseLabeledAlert(raw);
  const noBal = withoutBalance(raw);

  // Amount: the bank's own pattern, then a labelled field, then the first money
  // figure that isn't the balance.
  let amount = null, amtConf = 'low', amountPath = 'none';
  // Fees can be under a naira (VAT on a ₦10.75 transfer fee is ₦0.81); other alerts keep the ₦1 floor.
  const amtOpts = isFeeText(raw) ? { floor: 0.01 } : undefined;
  const ruled = rule?.amountRe && raw.match(rule.amountRe);
  if (ruled) { const n = normalizeAmount(ruled[1], amtOpts); if (n.value != null) { amount = n.value; amtConf = 'high'; amountPath = 'bank'; } }
  if (amount == null && labeled && labeled.amount) { amount = labeled.amount; amtConf = 'high'; amountPath = 'labelled'; }
  // A labelled receipt's own "Amount" field (round 6, part A item 2) beats scanning
  // the whole text, which can snag a session id or account number by mistake.
  if (amount == null && receipt && receipt.amountText) {
    const n = firstMoney(receipt.amountText, amtOpts);
    if (n) { amount = n.value; amtConf = 'high'; amountPath = 'receipt'; }
  }
  if (amount == null) { const n = firstMoney(noBal, amtOpts); if (n) { amount = n.value; amtConf = n.confidence; amountPath = 'shared'; } }

  // Direction: the bank's pattern, then a labelled field, then the receipt's own
  // "Transaction Type" (Bank Deposit = in, everything else we've seen = out), then
  // tiered inference.
  let dir = null;
  const rd = rule?.directionRe && raw.match(rule.directionRe);
  if (rd) dir = { type: /^c/i.test(rd[1]) ? 'income' : 'expense', conf: 'high' };
  if (!dir && labeled) dir = { type: labeled.type, conf: 'high' };
  if (!dir && receipt && receipt.direction) dir = { type: receipt.direction, conf: 'high' };
  if (!dir) dir = detectDirection(raw);

  // Date: the bank's pattern, a labelled Value Date, the receipt's own date field,
  // the first date in the text, else today.
  const rdate = rule?.dateRe && raw.match(rule.dateRe);
  const dm = raw.match(SMS_DATE_RE);
  const receiptDateMatch = receipt && receipt.dateText && receipt.dateText.match(SMS_DATE_RE);
  const textDate = (rdate && toISO(rdate[1])) || (labeled && labeled.date && toISO(labeled.date))
    || (receiptDateMatch && toISO(receiptDateMatch[1])) || (dm && toISO(dm[1])) || null;
  const date = textDate || new Date(today).toISOString().slice(0, 10);

  // Narration: the bank's pattern, a labelled field, the counterparty phrase, else the
  // body with money, dates and references stripped.
  const rn = rule?.narrationRe && raw.match(rule.narrationRe);
  const description = ((rn && rn[1].trim()) || (labeled && labeled.description) || (!labeled && receipt && receipt.description) || alertDescription(raw) || raw
    .replace(SMS_MONEY_RE, ' ')
    .replace(SMS_DATE_RE, ' ')
    .replace(/\b(?:ref|txn|transaction id|receipt)[:#\s]*[A-Za-z0-9]+/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 140))
    // "DR Alert: POS PURCHASE..." reads better without the alert label.
    .replace(/^(?:dr|cr|debit|credit|txn)\s*(?:alert)?\s*[:\-.]\s*/i, '')
    .replace(/[\s.:;,-]+$/, '') || 'Bank alert';

  // Second look with the narration: a fee alert is Bank Charges, a debit.
  const kind = first.kind === 'unsure' ? 'unsure' : (isFeeText(description) ? 'fee' : 'transaction');
  const type = kind === 'fee' ? 'expense' : dir.type;
  const category = kind === 'fee' ? 'Bank Charges' : categorizeTransaction(description, type);
  const bank = bankName || detectBank(ownText);
  const confidence = kind !== 'unsure' && amount != null && dir.conf === 'high' && amtConf !== 'low' ? 'high' : (amount != null && kind !== 'unsure' ? 'medium' : 'low');
  const amt = amount != null ? +Number(amount).toFixed(2) : 0;
  return {
    date, dateFromText: !!textDate, directionKnown: dir.conf !== 'low', description, amount: amt,
    type, category, bank, bankCode, accountMask, senderKey, reference: (receipt && receipt.reference) || null, raw,
    kind, isFee: kind === 'fee',
    // Unclear alerts and low-confidence amounts wait for a person (spec A6).
    needsReview: confidence === 'low',
    confidence,
    rulePath: { bank: !!rule, amount: amountPath },
    _parse: {
      rawText: raw, source, bank, parserVersion: 'backend-alert-v2', parserPath: 'deterministic',
      amount: amount != null ? amt : null,
      direction: type === 'income' ? 'credit' : 'debit',
      date, counterparty: description, category, confidence,
    },
  };
}

module.exports = { parseAlert, SMS_MONEY_RE, SMS_DATE_RE };
