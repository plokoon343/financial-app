// statementParser.js
// Parses CSV, Excel, and PDF bank statements into structured transactions.
// Drop this file into your /utils or /helpers folder.
//
// npm packages required (run once):
//   npm install pdf-parse csv-parser xlsx multer
//
// Usage:
//   const { parseStatement } = require('./statementParser');
//   const transactions = await parseStatement(filePath, mimeType);

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const XLSX = require('xlsx');

// ─── Category keyword rules ───────────────────────────────────────────────────
// Add or edit keywords here to improve category matching for Nigerian banks.
// First match wins, so order matters.

const CATEGORY_RULES = [
  // Income
  { keywords: ['salary', 'wage', 'payroll', 'monthly pay'], category: 'Salary', type: 'income' },
  { keywords: ['freelance', 'consulting', 'contract pay', 'upwork'], category: 'Freelance', type: 'income' },
  { keywords: ['dividend', 'investment return', 'interest credit', 'fixed deposit', 'treasury'], category: 'Investment', type: 'income' },
  { keywords: ['gift received', 'gift credit'], category: 'Gift', type: 'income' },

  // Food & Drink
  { keywords: ['shoprite', 'spar', 'restaurant', 'bukka', 'eatery', 'supermarket', 'grocery',
                'chicken republic', 'kfc', 'dominos', 'pizza', 'coldstone', 'cafe', 'bakery',
                'food', 'eat'], category: 'Food' },

  // Transport
  { keywords: ['uber', 'bolt', 'taxify', 'danfo', 'keke', 'fuel', 'petrol',
                'filling station', 'nnpc', 'total', 'transport'], category: 'Transport' },

  // Utilities
  { keywords: ['dstv', 'gotv', 'startimes', 'electricity', 'nepa', 'phcn',
                'ibedc', 'ekedc', 'aedc', 'water bill', 'utility',
                'mtn', 'airtel', 'glo', '9mobile', 'airtime', 'data subscription',
                'spectranet', 'smile'], category: 'Utilities' },

  // Housing
  { keywords: ['rent', 'landlord', 'property', 'house rent', 'estate'], category: 'Housing' },

  // Shopping
  { keywords: ['pos purchase', 'pos debit', 'amazon', 'jumia', 'konga', 'slot',
                'purchase', 'market', 'fashion', 'clothing'], category: 'Shopping' },

  // Healthcare
  { keywords: ['pharmacy', 'hospital', 'clinic', 'chemist', 'medplus', 'health'], category: 'Healthcare' },

  // Entertainment
  { keywords: ['netflix', 'spotify', 'apple music', 'youtube premium', 'showmax',
                'gaming', 'bet9ja', 'nairabet', '1xbet', 'sportybet',
                'cinema', 'event ticket'], category: 'Entertainment' },

  // Education
  { keywords: ['school fees', 'tuition', 'waec', 'jamb', 'udemy',
                'coursera', 'university', 'college fee'], category: 'Education' },

  // Bank charges
  { keywords: ['charge', 'bank fee', 'vat', 'stamp duty', 'sms alert',
                'maintenance fee', 'card fee', 'commission on turnover'], category: 'Bank Charges' },

  // ATM
  { keywords: ['atm withdrawal', 'atm cash', 'cash withdrawal'], category: 'ATM' },

  // Transfers (catch-all — keep near the bottom)
  { keywords: ['transfer', 'nip transfer', 'neft', 'trf to', 'trf from', 'send money'], category: 'Transfer' },
];

/**
 * Assign a spending category based on transaction description.
 * @param {string} description
 * @param {string} type - 'income' | 'expense'
 * @returns {string} category label
 */
const categorize = (description, type) => {
  const lower = description.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    // If rule has an explicit type, only match when types align
    if (rule.type && rule.type !== type) continue;
    if (rule.keywords.some(kw => lower.includes(kw))) {
      return rule.category;
    }
  }
  return type === 'income' ? 'Other Income' : 'Other';
};

/**
 * Clean a raw amount string and return a float.
 * Handles: '12,450.00', '₦380,000', '12450', ''
 */
const parseAmount = (raw) => {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw.toString().replace(/[₦,\s]/g, '').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) || val === 0 ? null : Math.abs(val);
};

/**
 * Convert various Nigerian bank date formats to YYYY-MM-DD.
 * Handles: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, DD-Mon-YYYY, DD Mon YYYY
 */
const normalizeDate = (raw) => {
  if (!raw) return null;
  const str = raw.toString().trim();

  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }

  // DD-Mon-YYYY  e.g. 01-Apr-2025
  const dmonY = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (dmonY) {
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                     jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const m = months[dmonY[2].toLowerCase()];
    if (m) return `${dmonY[3]}-${m}-${dmonY[1].padStart(2, '0')}`;
  }

  // DD Mon YYYY  e.g. 1 Apr 2025
  const dMonY = str.match(/^(\d{1,2})\s([A-Za-z]{3})\s(\d{4})$/);
  if (dMonY) {
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                     jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const m = months[dMonY[2].toLowerCase()];
    if (m) return `${dMonY[3]}-${m}-${dMonY[1].padStart(2, '0')}`;
  }

  return str; // return as-is; frontend will display it
};


// ─── CSV Parser ───────────────────────────────────────────────────────────────

const parseCSVFile = (filePath) => {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => {
        const transactions = [];
        for (const row of rows) {
          // Normalise keys: lowercase + trim
          const r = {};
          for (const [k, v] of Object.entries(row)) {
            r[k.toLowerCase().trim()] = v;
          }

          // Find date field
          const rawDate =
            r['date'] || r['transaction date'] || r['trans date'] ||
            r['value date'] || r['txn date'] || '';

          if (!rawDate || !/\d/.test(rawDate)) continue; // skip non-date rows

          // Find description
          const description =
            (r['description'] || r['narration'] || r['details'] ||
             r['particulars'] || r['remarks'] || '').trim();

          if (!description) continue;

          // Find amounts
          const creditRaw = r['credit'] || r['credit amount'] || r['cr'] || r['amount (cr)'] || '';
          const debitRaw  = r['debit']  || r['debit amount']  || r['dr'] || r['amount (dr)']  || '';
          const amountRaw = r['amount'] || r['transaction amount'] || '';
          const balRaw    = r['balance'] || r['running balance'] || '';

          const credit = parseAmount(creditRaw);
          const debit  = parseAmount(debitRaw);
          const amount = parseAmount(amountRaw);
          const balance = parseAmount(balRaw);

          let finalAmount, type;
          if (credit && !debit) {
            finalAmount = credit; type = 'income';
          } else if (debit && !credit) {
            finalAmount = debit;  type = 'expense';
          } else if (amount) {
            // Single-column: use keywords to infer type
            type = /credit|salary|salary|deposit|inflow/i.test(description) ? 'income' : 'expense';
            finalAmount = amount;
          } else {
            continue; // no usable amount
          }

          transactions.push({
            date:        normalizeDate(rawDate),
            description,
            amount:      finalAmount,
            type,
            category:    categorize(description, type),
            reference:   (r['reference'] || r['ref'] || r['cheque no'] || '').trim() || null,
            balance:     balance || null,
          });
        }
        resolve(transactions);
      })
      .on('error', reject);
  });
};


// ─── Excel Parser ─────────────────────────────────────────────────────────────

const parseExcelFile = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Column alias groups — we find the first column matching any alias
  const ALIAS = {
    date:        ['date', 'value date', 'transaction date', 'trans date', 'txn date'],
    description: ['description', 'narration', 'details', 'particulars', 'remarks', 'narrative'],
    credit:      ['credit', 'credit amount', 'cr', 'amount (cr)', 'amount cr', 'credit (ngn)'],
    debit:       ['debit', 'debit amount', 'dr', 'amount (dr)', 'amount dr', 'debit (ngn)'],
    amount:      ['amount', 'transaction amount'],
    balance:     ['balance', 'running balance', 'ledger balance'],
    reference:   ['reference', 'ref', 'ref no', 'cheque no', 'transaction id'],
  };

  // Scan first 20 rows for a header row
  let headerIdx = -1;
  let colMap = {};

  for (let i = 0; i < Math.min(20, rows.length); i++) {
    const row = rows[i].map(c => c.toString().toLowerCase().trim());
    const candidate = {};
    for (const [key, aliases] of Object.entries(ALIAS)) {
      const idx = row.findIndex(cell => aliases.some(a => cell.includes(a)));
      if (idx !== -1) candidate[key] = idx;
    }
    // Need at least date + description + some amount column
    if (candidate.date !== undefined && candidate.description !== undefined &&
        (candidate.credit !== undefined || candidate.debit !== undefined || candidate.amount !== undefined)) {
      headerIdx = i;
      colMap = candidate;
      break;
    }
  }

  if (headerIdx === -1) return []; // couldn't find transaction table

  const transactions = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (key) => (colMap[key] !== undefined ? (row[colMap[key]] || '').toString().trim() : '');

    const rawDate = get('date');
    if (!rawDate || !/\d/.test(rawDate)) continue;

    const description = get('description');
    if (!description) continue;

    const credit  = parseAmount(get('credit'));
    const debit   = parseAmount(get('debit'));
    const amount  = parseAmount(get('amount'));
    const balance = parseAmount(get('balance'));

    let finalAmount, type;
    if (credit && !debit) {
      finalAmount = credit; type = 'income';
    } else if (debit && !credit) {
      finalAmount = debit;  type = 'expense';
    } else if (amount) {
      type = /credit|salary|deposit|inflow/i.test(description) ? 'income' : 'expense';
      finalAmount = amount;
    } else {
      continue;
    }

    transactions.push({
      date:        normalizeDate(rawDate),
      description,
      amount:      finalAmount,
      type,
      category:    categorize(description, type),
      reference:   get('reference') || null,
      balance:     balance || null,
    });
  }
  return transactions;
};


// ─── PDF Parser ───────────────────────────────────────────────────────────────

const parsePDFFile = async (filePath) => {
  // pdf-parse extracts raw text from the PDF's text layer.
  // Works on most digital (not scanned) Nigerian bank statement PDFs.
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);
  const rawText = data.text;

  return parsePDFText(rawText);
};

/**
 * Parse the raw text extracted from a PDF.
 * Strategy:
 *   1. Split into lines
 *   2. Find lines that contain a recognisable date
 *   3. Also contain a number that looks like an amount
 *   4. Attempt to reconstruct date / description / amount
 */
const parsePDFText = (rawText) => {
  const transactions = [];

  // Common date patterns found in Nigerian bank statements
  const DATE_RE = /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-[A-Za-z]{3}-\d{4}|\d{1,2}\s[A-Za-z]{3}\s\d{4})\b/;
  const AMOUNT_RE = /[\d,]+\.\d{2}/g;

  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const dateMatch = DATE_RE.exec(line);
    if (!dateMatch) continue;

    const amounts = (line.match(AMOUNT_RE) || [])
      .map(a => parseFloat(a.replace(/,/g, '')))
      .filter(n => n > 0);

    if (amounts.length === 0) continue;

    // Remove the date from the line to isolate description
    let remaining = line.replace(dateMatch[0], '').trim();

    // Remove all amount strings from remaining to get description
    let description = remaining.replace(AMOUNT_RE, '').trim();
    description = description.replace(/\s{2,}/g, ' ').replace(/^[\|\-\s]+|[\|\-\s]+$/g, '').trim();

    if (!description || description.length < 3) continue;

    // Heuristic: if there are 2+ amounts, last is usually balance, second-to-last is txn amount
    let txnAmount, balance;
    if (amounts.length >= 2) {
      txnAmount = amounts[amounts.length - 2];
      balance   = amounts[amounts.length - 1];
    } else {
      txnAmount = amounts[0];
      balance   = null;
    }

    const type = inferType(description);

    transactions.push({
      date:        normalizeDate(dateMatch[0]),
      description,
      amount:      txnAmount,
      type,
      category:    categorize(description, type),
      reference:   null,
      balance:     balance || null,
    });
  }

  return transactions;
};

/**
 * Infer income/expense from description text alone.
 * Used when there's no separate debit/credit column (e.g. PDF parsing).
 */
const inferType = (description) => {
  const lower = description.toLowerCase();
  const incomeSignals = ['credit', 'salary', 'deposit', 'inflow', 'nip cr',
                         'transfer in', 'received', 'refund', 'reversal',
                         'dividend', 'interest credit', 'cr –', 'cr-'];
  const expenseSignals = ['debit', 'withdrawal', 'purchase', 'payment',
                          'charge', 'fee', 'atm', 'pos', 'transfer out',
                          'nip dr', 'dr –', 'dr-', 'subscription', 'bet'];

  for (const kw of incomeSignals)  if (lower.includes(kw)) return 'income';
  for (const kw of expenseSignals) if (lower.includes(kw)) return 'expense';
  return 'expense'; // safe default
};


// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Parse any supported bank statement file and return transactions array.
 *
 * @param {string} filePath  - Absolute path to the uploaded temp file
 * @param {string} mimeType  - File MIME type from multer (req.file.mimetype)
 * @returns {Promise<Array>} - Array of transaction objects
 *
 * Each transaction:
 * {
 *   date:        string  (YYYY-MM-DD),
 *   description: string,
 *   amount:      number  (always positive),
 *   type:        'income' | 'expense',
 *   category:    string,
 *   reference:   string | null,
 *   balance:     number | null,
 * }
 */
const parseStatement = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();

  const isCSV  = mimeType === 'text/csv' || mimeType === 'text/plain' || ext === '.csv';
  const isXLS  = mimeType === 'application/vnd.ms-excel' || ext === '.xls';
  const isXLSX = mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === '.xlsx';
  const isPDF  = mimeType === 'application/pdf' || ext === '.pdf';

  if (isCSV)        return parseCSVFile(filePath);
  if (isXLS || isXLSX) return parseExcelFile(filePath);
  if (isPDF)        return parsePDFFile(filePath);

  throw new Error(`Unsupported file type: ${mimeType || ext}`);
};

module.exports = { parseStatement };
