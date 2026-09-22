// Dedicated parser for OPay / OWealth wallet statements.
//
// OPay statements don't look like a normal bank PDF: dates are space-separated
// "DD Mon YYYY HH:MM:SS", each record spans several text lines, and the money sits
// on one glued line "<debit>|-- <credit>|-- <balance><channel>". Crucially, the
// running BALANCE is NOT a reliable ledger here — an OWealth-funded payment debits
// the account without moving the wallet balance (the money flows straight from the
// OWealth savings pocket), so the generic balance-aware parser can't read these and
// the old generic fallback turned timestamps into 500+ garbage rows. This parser
// reads the explicit debit/credit columns instead (unambiguous), and tags the huge
// volume of OWealth auto-save/withdrawal churn and own-name transfers as internal so
// they don't pollute real income/spending.

const MONTHS = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

// A record starts on a line beginning "DD Mon YYYY HH:MM:SS" (the value date is
// glued on after, e.g. "25 Jul 2026 22:22:0125 Jul 2026").
const DATE_TIME_RE = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\s+\d{2}:\d{2}:\d{2}/i;
// The money line: debit, credit, balance (each a 2dp figure or "--"), then channel.
const AMOUNT_LINE_RE = /^(--|[\d,]+\.\d{2})(--|[\d,]+\.\d{2})([\d,]+\.\d{2})([A-Za-z]+)/;

const num = (s) => (s === '--' || s == null) ? 0 : parseFloat(String(s).replace(/,/g, '')) || 0;
const norm = (s) => (s || '').replace(/ /g, ' ').trim();

// Is this an OPay/OWealth wallet statement? Needs the OPay wallet fingerprint AND
// the space+time date format, so we never hijack an ordinary bank PDF.
function looksLikeOpay(rawText = '') {
  const t = rawText || '';
  const opayish = /\bOWealth\b/i.test(t) || (/\bOPay\b/i.test(t) && /Wallet Account/i.test(t))
    || (/Wallet Account/i.test(t) && /Trans\.?\s*Time/i.test(t));
  if (!opayish) return false;
  // At least a couple of real date-time transaction lines.
  const hits = (t.match(/\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\s+\d{2}:\d{2}:\d{2}/gi) || []).length;
  return hits >= 2;
}

// Pull the account holder's name from the header ("Account Name" then the name on
// the next line) so we can recognise the user's own-name (self) transfers.
function extractAccountName(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^account name$/i.test(lines[i])) {
      const cand = lines[i + 1];
      if (/^[A-Z][A-Z' .-]{3,}$/.test(cand)) return cand.trim();
    }
  }
  return '';
}

function extractAccountNumber(lines) {
  for (let i = 0; i < lines.length - 1; i++) {
    if (/^account number$/i.test(lines[i]) && /^\d{6,}$/.test(lines[i + 1])) return lines[i + 1].trim();
  }
  const m = (lines.join(' ').match(/\b(\d{10,})\b/) || [])[1];
  return m || '';
}

// OWealth is OPay's savings pocket; auto-save/withdrawal/deposit are internal churn
// that nets to zero. "Interest Earned" is real (small) income, so it's excluded here.
const OWEALTH_INTERNAL_RE = /\bauto-?save\b|\bowealth\s+(withdrawal|deposit|balance)\b|\bowealth\b(?!.*interest)/i;

function isInternal(description, holderName) {
  const d = (description || '');
  if (/\binterest\b/i.test(d)) return false;
  if (OWEALTH_INTERNAL_RE.test(d)) return true;
  // Own-name transfer = moving money between the user's own accounts.
  if (holderName && /transfer\s+(from|to)/i.test(d) && d.toUpperCase().includes(holderName.toUpperCase())) return true;
  return false;
}

// Parse raw extracted text into transaction rows. Returns null when it isn't an
// OPay statement, so the caller can fall through to other parsers.
function parseOpayStatement(rawText = '') {
  if (!looksLikeOpay(rawText)) return null;
  const lines = rawText.split('\n').map(norm).filter(Boolean);
  const holderName = extractAccountName(lines);
  const accountNumber = extractAccountNumber(lines);

  // Group lines into records, each starting at a date-time line.
  const records = [];
  let cur = null;
  for (const line of lines) {
    if (DATE_TIME_RE.test(line)) { if (cur) records.push(cur); cur = [line]; }
    else if (cur) cur.push(line);
  }
  if (cur) records.push(cur);

  const rows = [];
  for (const rec of records) {
    const dm = rec[0].match(DATE_TIME_RE);
    if (!dm) continue;
    const date = `${dm[3]}-${MONTHS[dm[2].toLowerCase()]}-${String(dm[1]).padStart(2, '0')}`;

    // Locate the money line within the record.
    let amtIdx = -1, am = null;
    for (let i = 1; i < rec.length; i++) {
      const m = rec[i].match(AMOUNT_LINE_RE);
      if (m) { amtIdx = i; am = m; break; }
    }
    if (!am) continue; // a header/summary block that happened to start with a date

    const debit = num(am[1]);
    const credit = num(am[2]);
    const balance = num(am[3]);
    // Exactly one side should carry a value; if not, we're unsure — flag it.
    const clean = (debit > 0) !== (credit > 0);
    const amount = credit > 0 ? credit : debit;
    if (!amount || amount < 0.005) continue;

    const description = rec.slice(1, amtIdx).join(' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Transaction';
    // Keep the TRUE direction (income/expense) so the amount sign is set correctly on
    // import; `internal` is a separate flag the importer uses to re-type the row as an
    // internal_transfer (excluded from spend/income) while preserving that sign.
    const type = credit > 0 ? 'income' : 'expense';
    const internal = isInternal(description, holderName);

    rows.push({
      date,
      description,
      amount: +amount.toFixed(2),
      type,
      balance,
      reference: null,
      confidenceLevel: clean ? 'high' : 'low',
      internal,
      // A hint the UI/importer can show: why this row won't count as income/spend.
      internalReason: internal ? (/owealth|auto-?save/i.test(description) ? 'OWealth savings movement' : 'Transfer between your own accounts') : '',
    });
  }

  if (!rows.length) return null;
  rows.holderName = holderName;
  rows.accountNumber = accountNumber;
  return rows;
}

module.exports = { parseOpayStatement, looksLikeOpay, isInternal, extractAccountName };
