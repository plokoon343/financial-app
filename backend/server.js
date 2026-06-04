const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --------------------------
// MongoDB Connection
// --------------------------
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ MongoDB connected'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// --------------------------
// Schemas (Models)
// --------------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'superadmin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  bankDetails: {
    bankName:        { type: String, default: '' },
    bankCode:        { type: String, default: '' },
    accountNumber:   { type: String, default: '' },
    accountName:     { type: String, default: '' },
    verified:        { type: Boolean, default: false }
  },
  // Wallet payout destination. One active method at a time: 'card' or 'titan'.
  // For cards we deliberately store only the last 4 digits (never the full PAN or CVV).
  payout: {
    method: { type: String, enum: ['card', 'titan', ''], default: '' },
    card: {
      last4:      { type: String, default: '' },
      expiry:     { type: String, default: '' },   // MM/YY
      holderName: { type: String, default: '' },
    },
    titan: {
      accountNumber: { type: String, default: '' },
      accountName:   { type: String, default: '' },
      bankCode:      { type: String, default: '' },
      bankName:      { type: String, default: 'Titan-Paystack' },
    },
  },
  resetToken: String,
  resetTokenExpiry: Date,
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  category: { type: String, required: true },
  type: { type: String, enum: ['income', 'expense'], required: true }
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  month: { type: String, required: true },
}, { timestamps: true });
const Budget = mongoose.model('Budget', budgetSchema);

const goalSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:     { type: String, required: true },
  target:   { type: Number, required: true, min: 0 },
  current:  { type: Number, default: 0, min: 0 },
  deadline: { type: Date, required: true },
  category: { type: String, default: 'General' },
  scheduledPayment: {
    enabled:    { type: Boolean, default: false },
    amount:     { type: Number, default: 0 },
    dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
  },
  createdAt: { type: Date, default: Date.now }
});
const Goal = mongoose.model('Goal', goalSchema);

const walletSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  balance: { type: Number, default: 0, min: 0 },
  savingsBalance: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'NGN' }
}, { timestamps: true });
const Wallet = mongoose.model('Wallet', walletSchema);

const walletTransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['deposit', 'withdrawal', 'savings_transfer'], required: true },
  amount: { type: Number, required: true },
  description: { type: String, required: true },
  reference: { type: String, sparse: true },
  status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' }
}, { timestamps: true });
const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

const savingsRuleSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // 'fixed'   → save a flat naira amount from each income
  // 'roundup' → round each expense up to the nearest step and save the difference
  // 'percentage' kept only so legacy rules still read without error
  type: { type: String, enum: ['fixed', 'roundup', 'percentage'], required: true },
  value: { type: Number, required: true },
  active: { type: Boolean, default: true },
  targetGoalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Goal', default: null },
  createdAt: { type: Date, default: Date.now }
});
const SavingsRule = mongoose.model('SavingsRule', savingsRuleSchema);

// Learn-from-correction categorization: maps a per-user merchant "key" (a distilled
// signature of a transaction description) to the category the user assigned. Future
// imports look these up first, so categorization improves the more the app is used.
const learnedCategorySchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key:      { type: String, required: true },
  category: { type: String, required: true },
  updatedAt:{ type: Date, default: Date.now },
});
learnedCategorySchema.index({ userId: 1, key: 1 }, { unique: true });
const LearnedCategory = mongoose.model('LearnedCategory', learnedCategorySchema);

// UPDATED: Added bank fields + recipient
const recurringBillSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  dueDate: { type: Number, required: true },
  frequency: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  category: { type: String, default: 'Bills' },
  autoPay: { type: Boolean, default: false },
  nextDue: { type: Date, required: true },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  bankName: { type: String, default: '' },
  bankCode: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },
  recipient: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const RecurringBill = mongoose.model('RecurringBill', recurringBillSchema);

// UPDATED: Added bank fields (subscription)
const subscriptionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:      { type: String, required: true },
  cost:      { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  category:  { type: String, default: 'Entertainment' },
  status:    { type: String, enum: ['active', 'cancelled'], default: 'active' },
  nextPayment: { type: Date },
  scheduledPayment: {
    enabled:    { type: Boolean, default: false },
    dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
  },
  bankName: { type: String, default: '' },
  bankCode: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },
  recipient: { type: String, default: '' },
}, { timestamps: true });
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// UPDATED: Added bank fields (debt)
const debtSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  balance: { type: Number, required: true, min: 0 },
  interest: { type: Number, default: 0, min: 0 },
  minPayment: { type: Number, required: true, min: 0 },
  scheduledPayment: {
    enabled:    { type: Boolean, default: false },
    amount:     { type: Number, default: 0 },
    dayOfMonth: { type: Number, min: 1, max: 31, default: 1 },
  },
  bankName: { type: String, default: '' },
  bankCode: { type: String, default: '' },
  accountNumber: { type: String, default: '' },
  accountName: { type: String, default: '' },
  recipient: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Debt = mongoose.model('Debt', debtSchema);

// --------------------------
// Helper Functions
// --------------------------
const getOrCreateWallet = async (userId) => {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = new Wallet({ userId, balance: 0, savingsBalance: 0 });
    await wallet.save();
  }
  return wallet;
};

const applySavingsRule = async (userId, transactionAmount, transactionType) => {
  try {
    const rule = await SavingsRule.findOne({ userId, active: true });
    if (!rule) return;

    let saveAmount = 0;
    let description = '';

    if (rule.type === 'fixed' && transactionType === 'income') {
      saveAmount = rule.value;
      description = `Auto‑savings (₦${rule.value} per income)`;
    } else if (rule.type === 'percentage' && transactionType === 'income') {
      // Legacy percentage rules still work for users who set one previously.
      saveAmount = (Math.abs(transactionAmount) * rule.value) / 100;
      description = `Auto‑savings (${rule.value}% of income)`;
    } else if (rule.type === 'roundup' && transactionType === 'expense') {
      const amount = Math.abs(transactionAmount);
      const remainder = amount % rule.value;
      if (remainder !== 0) {
        saveAmount = rule.value - remainder;
        description = `Round‑up savings (rounded ₦${amount} → ₦${amount + saveAmount})`;
      }
    }

    if (saveAmount > 0) {
      const wallet = await getOrCreateWallet(userId);
      if (wallet.balance >= saveAmount) {
        wallet.balance -= saveAmount;
        wallet.savingsBalance += saveAmount;
        await wallet.save();

        const savingsTx = new WalletTransaction({
          userId,
          type: 'savings_transfer',
          amount: saveAmount,
          description,
          status: 'completed'
        });
        await savingsTx.save();

        if (rule.targetGoalId) {
          const goal = await Goal.findOne({ _id: rule.targetGoalId, userId });
          if (goal) {
            goal.current = Math.min(goal.current + saveAmount, goal.target);
            await goal.save();
          }
        }
        console.log(`✅ Auto‑saved ₦${saveAmount} for user ${userId}`);
      }
    }
  } catch (err) {
    console.error('Auto‑savings error:', err);
  }
};

// --------------------------
// File Parsing Helpers (same as before)
// --------------------------
const isPdfPasswordError = (err) => {
  const msg = (err.message || '').toLowerCase();
  const name = (err.name || '').toLowerCase();
  return (
    msg.includes('password') ||
    msg.includes('encrypted') ||
    msg.includes('no password given') ||
    name.includes('passwordexception') ||
    msg.includes('passwordexception')
  );
};

const isPdfWrongPassword = (err) => {
  const msg = (err.message || '').toLowerCase();
  return (
    msg.includes('incorrect password') ||
    msg.includes('wrong password') ||
    msg.includes('invalid password') ||
    (isPdfPasswordError(err) && msg.includes('incorrect'))
  );
};

const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    let rawContent;
    try { rawContent = fs.readFileSync(filePath, 'utf-8'); }
    catch { rawContent = fs.readFileSync(filePath, 'latin1'); }

    const allLines = rawContent.split('\n').map(l => l.trim()).filter(Boolean);
    const HEADER_KEYWORDS = ['date', 'description', 'narration', 'particulars', 'details'];
    const AMOUNT_KEYWORDS = ['credit', 'debit', 'amount', 'cr', 'dr'];

    let headerLineIdx = -1;
    for (let i = 0; i < Math.min(30, allLines.length); i++) {
      const lower = allLines[i].toLowerCase();
      const hasDate   = lower.includes('date');
      const hasDesc   = HEADER_KEYWORDS.slice(1).some(k => lower.includes(k));
      const hasAmount = AMOUNT_KEYWORDS.some(k => lower.includes(k));
      if (hasDate && hasDesc && hasAmount) { headerLineIdx = i; break; }
    }

    if (headerLineIdx === -1) {
      console.warn('[parseCSV] Could not find header row. First 5 lines:', allLines.slice(0, 5));
      return resolve([]);
    }

    const csvFromHeader = allLines.slice(headerLineIdx).join('\n');
    const stream = Readable.from([csvFromHeader]);
    const rows = [];

    stream.pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', () => {
        const transactions = [];
        for (const row of rows) {
          const r = {};
          for (const [k, v] of Object.entries(row)) r[k.toLowerCase().trim()] = (v || '').toString().trim();

          const rawDate = r['date'] || r['transaction date'] || r['trans date'] ||
                          r['value date'] || r['txn date'] || r['posting date'] || '';
          if (!rawDate || !/\d/.test(rawDate)) continue;

          const description = (r['description'] || r['narration'] || r['details'] ||
                               r['particulars'] || r['remarks'] || r['narrative'] || '').trim();
          if (!description) continue;

          const toNum = (raw) => {
            if (!raw) return 0;
            const n = parseFloat(raw.replace(/[₦,\s]/g, ''));
            return isNaN(n) ? 0 : Math.abs(n);
          };

          const credit  = toNum(r['credit'] || r['credit amount'] || r['cr'] || r['amount (cr)'] || r['credit (ngn)']);
          const debit   = toNum(r['debit']  || r['debit amount']  || r['dr'] || r['amount (dr)'] || r['debit (ngn)']);
          const single  = toNum(r['amount'] || r['transaction amount'] || '');
          const balance = toNum(r['balance'] || r['running balance'] || '');

          let amount, type;
          if (credit > 0 && debit === 0)      { amount = credit; type = 'income'; }
          else if (debit > 0 && credit === 0)  { amount = debit;  type = 'expense'; }
          else if (single > 0) {
            type = /credit|salary|deposit|inflow/i.test(description) ? 'income' : 'expense';
            amount = single;
          } else continue;

          let formattedDate = rawDate;
          const parts = rawDate.split(/[\/\-]/);
          if (parts.length === 3 && parts[2].length === 4)
            formattedDate = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
          else if (parts.length === 3 && parts[0].length === 4)
            formattedDate = rawDate;

          const reference = (r['reference'] || r['ref'] || r['ref no'] || r['cheque no'] || '').trim() || null;
          transactions.push({ date: formattedDate, description, amount, type,
            category: categorizeTransaction(description, type), reference, balance: balance || null });
        }
        console.log(`[parseCSV] Header at line ${headerLineIdx}, parsed ${transactions.length} transactions`);
        resolve(transactions);
      })
      .on('error', reject);
  });
};

const parseExcel = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const HEADER_KEYWORDS = ['date', 'description', 'narration', 'particulars', 'details', 'remarks'];
  const AMOUNT_KEYWORDS = ['credit', 'debit', 'amount', 'cr', 'dr'];

  let headerIdx = -1, headers = [];
  for (let i = 0; i < Math.min(30, rows.length); i++) {
    const rowLower = rows[i].map(c => c.toString().toLowerCase().trim());
    const hasDate   = rowLower.some(c => c === 'date' || c.includes('date'));
    const hasDesc   = rowLower.some(c => HEADER_KEYWORDS.slice(1).some(k => c.includes(k)));
    const hasAmount = rowLower.some(c => AMOUNT_KEYWORDS.some(k => c.includes(k)));
    if (hasDate && hasDesc && hasAmount) { headerIdx = i; headers = rows[i].map(c => c.toString().trim()); break; }
  }
  if (headerIdx === -1) { console.warn('[parseExcel] No header row found. First 3 rows:', rows.slice(0,3)); return []; }

  const findCol = (...aliases) => headers.findIndex(h => aliases.some(a => h.toLowerCase().includes(a.toLowerCase())));
  const dateIdx    = findCol('date', 'trans date', 'value date', 'txn date');
  const descIdx    = findCol('description', 'narration', 'particulars', 'details', 'remarks', 'narrative');
  const creditIdx  = findCol('credit', 'cr amount', 'amount (cr)', 'credit (ngn)');
  const debitIdx   = findCol('debit', 'dr amount', 'amount (dr)', 'debit (ngn)');
  const amountIdx  = findCol('amount', 'transaction amount');
  const refIdx     = findCol('reference', 'ref', 'cheque', 'session id');
  const balanceIdx = findCol('balance', 'running balance', 'ledger balance');

  if (dateIdx === -1 || descIdx === -1) { console.warn('[parseExcel] Could not map columns. Headers:', headers); return []; }

  const toNum = (val) => {
    if (!val) return 0;
    const n = parseFloat(val.toString().replace(/[₦,\s]/g, ''));
    return isNaN(n) ? 0 : Math.abs(n);
  };

  const transactions = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(c => !c.toString().trim())) continue;

    const rawDate = (row[dateIdx] || '').toString().trim();
    if (!rawDate || !/\d/.test(rawDate)) continue;

    const description = (row[descIdx] || '').toString().trim();
    if (!description) continue;

    const credit  = creditIdx  !== -1 ? toNum(row[creditIdx])  : 0;
    const debit   = debitIdx   !== -1 ? toNum(row[debitIdx])   : 0;
    const single  = amountIdx  !== -1 ? toNum(row[amountIdx])  : 0;
    const balance = balanceIdx !== -1 ? toNum(row[balanceIdx]) : null;

    let amount, type;
    if (credit > 0 && debit === 0)     { amount = credit; type = 'income'; }
    else if (debit > 0 && credit === 0) { amount = debit;  type = 'expense'; }
    else if (single > 0) {
      type = /credit|salary|deposit|inflow/i.test(description) ? 'income' : 'expense';
      amount = single;
    } else continue;

    let formattedDate = rawDate;
    const parts = rawDate.split(/[\/\-]/);
    if (parts.length === 3 && parts[2].length === 4)
      formattedDate = `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
    else if (parts.length === 3 && parts[0].length === 4)
      formattedDate = rawDate;

    const reference = refIdx !== -1 ? (row[refIdx] || '').toString().trim() || null : null;
    transactions.push({ date: formattedDate, description, amount, type,
      category: categorizeTransaction(description, type), reference, balance });
  }

  console.log(`[parseExcel] Header at row ${headerIdx}, parsed ${transactions.length} transactions`);
  return transactions;
};

// Load pdf.js directly (it ships bundled inside pdf-parse) so we can forward a
// password to encrypted PDFs. pdf-parse@1.1.1 calls getDocument(buffer) and never
// passes the password option, so password-protected statements can only be
// decrypted by talking to pdf.js ourselves.
const PDFJS_LIB = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');

// Re-implements pdf-parse's per-page text extraction.
const renderPdfPage = (pageData) =>
  pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
    .then((textContent) => {
      let lastY, text = '';
      for (const item of textContent.items) {
        if (lastY === item.transform[5] || !lastY) text += item.str;
        else text += '\n' + item.str;
        lastY = item.transform[5];
      }
      return text;
    });

// Extract raw text from a (possibly encrypted) PDF buffer. The password is
// forwarded to pdf.js, which decrypts the document. When the PDF is encrypted and
// the password is missing or wrong, pdf.js rejects with a PasswordException —
// callers detect that via isPdfPasswordError().
const extractPdfText = async (buffer, password = '') => {
  PDFJS_LIB.disableWorker = true;
  const params = { data: new Uint8Array(buffer) };
  if (password) params.password = password;

  const doc = await PDFJS_LIB.getDocument(params);
  let text = '';
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      text += '\n\n' + (await renderPdfPage(page));
    }
  } finally {
    doc.destroy();
  }
  return text;
};

// Month map for DD-Mon-YYYY dates used by most Nigerian banks.
const MONTH_MAP = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
// Money: 1,234.56 / 50.00 / .75  (comma thousands optional, leading digits optional)
const STMT_MONEY_RE = /(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d{2}/g;
// A line that *starts* a transaction record begins with a date in one of these forms:
//   30-APR-2026 / 01-Apr-2026   (DD-Mon-YYYY, Union/GTBank)
//   09/05/26 / 09/05/2026 / 30-04-2026   (DD/MM/YY[YY], Kuda etc.)
//   2026-05-09   (YYYY-MM-DD)
const STMT_DATE_START_RE = /^(\d{1,2}[\/-][A-Za-z]{3}[\/-]\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2})/;

// Normalise any supported date token to YYYY-MM-DD (returns null if unrecognised).
const normalizeAnyDate = (raw) => {
  const s = (raw || '').trim();
  let m;
  // DD-Mon-YYYY (also DD/Mon/YYYY)
  if ((m = s.match(/^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{2,4})$/))) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (!mon) return null;
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    else if (y.length === 4 && y.startsWith('0')) y = '20' + y.slice(2); // repair "0026" -> 2026
    return `${y}-${mon}-${m[1].padStart(2, '0')}`;
  }
  // YYYY-MM-DD
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD/MM/YY or DD/MM/YYYY (also DD-MM-YYYY)
  if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/))) {
    let y = m[3];
    if (y.length === 2) y = '20' + y;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
};

// Balance-aware parser for Nigerian bank statement PDFs (Union Bank, GTBank, etc.).
// These statements have no delimiters between columns, so the debit/credit columns
// are unreliable. Instead we read the running BALANCE at the end of each record and
// derive the transaction amount and direction from the balance change. This makes
// the extracted ledger reconcile exactly with the statement's opening/closing balance.
const parseStatementByBalance = (rawText) => {
  const lines = rawText.split('\n').map(l => l.replace(/ /g, ' ').trim()).filter(Boolean);

  // Opening balance = first money figure appearing after the words "opening balance".
  // Collapse all whitespace first so tab-separated labels ("Opening\tBalance") match.
  let prevBalance = null;
  const joined = lines.join(' ').replace(/\s+/g, ' ');
  const oi = joined.toLowerCase().indexOf('opening balance');
  if (oi !== -1) {
    const m = joined.slice(oi + 'opening balance'.length).match(/(?:\d{1,3}(?:,\d{3})+|\d+)?\.\d{2}/);
    if (m) prevBalance = parseFloat(m[0].replace(/,/g, ''));
  }

  // Group lines into records; each record starts on a line beginning with a date.
  const records = [];
  let cur = null;
  for (const line of lines) {
    if (STMT_DATE_START_RE.test(line)) {
      if (cur) records.push(cur);
      cur = [line];
    } else if (cur) {
      cur.push(line);
    }
  }
  if (cur) records.push(cur);

  const transactions = [];
  for (const rec of records) {
    const block = rec.join(' ').replace(/\s+/g, ' ');
    const dm = block.match(STMT_DATE_START_RE);
    if (!dm) continue;
    const date = normalizeAnyDate(dm[1]);
    if (!date) continue;

    // Skip summary/header blocks that merely start with a date (e.g. the statement
    // period line "03/05/2026 - 01/06/2026" followed by the opening/closing summary).
    if (/opening balance|closing balance/i.test(block)) continue;

    const monies = (block.match(STMT_MONEY_RE) || [])
      .map(s => parseFloat(s.replace(/,/g, '')))
      .filter(n => !isNaN(n));
    if (monies.length === 0) continue;
    const balance = monies[monies.length - 1]; // last money on the record is the balance

    let type, amount;
    if (prevBalance !== null && Math.abs(balance - prevBalance) > 0.005) {
      // Derive amount + direction from how the running balance moved.
      amount = Math.abs(balance - prevBalance);
      type = balance >= prevBalance ? 'income' : 'expense';
    } else {
      // No usable balance baseline — fall back to the amount column + keywords.
      amount = monies.length >= 2 ? monies[monies.length - 2] : monies[0];
      type = inferTransactionType(block);
    }
    prevBalance = balance;
    if (!amount || amount < 0.005) continue;

    // Build a readable description: drop dates, times, money, long refs, footers.
    const description = (block
      .replace(/\d{1,2}[\/-][A-Za-z]{3}[\/-]\d{2,4}/g, ' ')
      .replace(/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/g, ' ')
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, ' ')   // timestamps
      .replace(STMT_MONEY_RE, ' ')
      .replace(/₦|NGN/gi, ' ')
      .replace(/'?\b\d{6,}\b/g, ' ')
      .replace(/\*{2,}\d*/g, ' ')
      .replace(/\bPage\s+\d+\s+of\s+\d+\b/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[-'\s]+/, '')
      .trim()
      .slice(0, 140)
      .trim()) || 'Transaction';

    transactions.push({
      date,
      description,
      amount: +amount.toFixed(2),
      type,
      category: categorizeTransaction(description, type),
      reference: null,
      balance,
    });
  }
  return transactions;
};

const parsePDF = async (filePath, password = '') => {
  const buffer = fs.readFileSync(filePath);

  let rawText;
  try {
    rawText = await extractPdfText(buffer, password);
  } catch (pdfErr) {
    // Encrypted PDF with a missing or incorrect password — re-throw so the upload
    // route can prompt for a password or report that it was wrong.
    if (isPdfPasswordError(pdfErr)) {
      throw pdfErr;
    }
    // Otherwise the PDF may be a scanned image or corrupt.
    console.error('[parsePDF] pdf.js error:', pdfErr.message);
    return [];
  }

  console.log(`[parsePDF] Extracted ${rawText.length} chars of text`);
  
  // If very little text was extracted, the PDF is likely a scanned image
  if (rawText.length < 50) {
    console.warn('[parsePDF] Very little text extracted – PDF may be a scanned image');
    return [];
  }

  // Primary strategy: balance-aware parser for delimiter-less Nigerian bank PDFs.
  const balanceParsed = parseStatementByBalance(rawText);
  if (balanceParsed.length > 0) {
    console.log(`[parsePDF] Balance-aware parser found ${balanceParsed.length} transactions`);
    return balanceParsed;
  }
  console.log('[parsePDF] Balance-aware parser found nothing — trying generic strategies…');

  const transactions = [];
  
  // ── More flexible date regex ──
  const DATE_PATTERNS = [
    /\b(\d{2}[\/\-]\d{2}[\/\-]\d{4})\b/,           // 02/05/2024 or 02-05-2024
    /\b(\d{4}[\/\-]\d{2}[\/\-]\d{2})\b/,           // 2024/05/02 or 2024-05-02
    /\b(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})\b/i, // 2 May 2024
    /\b(\d{2}\.\d{2}\.\d{4})\b/,                   // 02.05.2024
  ];

  // ── Flexible amount regex ──
  const AMOUNT_PATTERN = /(?:₦|NGN)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:₦|NGN)?/;
  
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  console.log(`[parsePDF] Processing ${lines.length} lines`);

  // ── Strategy 1: Look for lines that contain both a date and an amount ──
  for (const line of lines) {
    // Try each date pattern
    let dateMatch = null;
    for (const pattern of DATE_PATTERNS) {
      dateMatch = line.match(pattern);
      if (dateMatch) break;
    }
    if (!dateMatch) continue;

    // Find all amounts in the line
    const amountMatches = [...line.matchAll(new RegExp(AMOUNT_PATTERN.source, 'g'))];
    if (amountMatches.length === 0) continue;

    // Extract numeric amounts
    const amounts = amountMatches
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(n => !isNaN(n) && n > 0);
    
    if (amounts.length === 0) continue;

    // Build description by removing the date and amounts
    let description = line
      .replace(dateMatch[0], '')
      .replace(AMOUNT_PATTERN, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    
    // If description is too short, try the next line
    if (description.length < 2 && lines.indexOf(line) + 1 < lines.length) {
      description = lines[lines.indexOf(line) + 1];
    }

    if (!description || description.length < 2) continue;

    // Determine transaction amount and balance
    let txnAmount, balance;
    if (amounts.length >= 2) {
      txnAmount = amounts[0];
      balance = amounts[amounts.length - 1];
    } else {
      txnAmount = amounts[0];
      balance = null;
    }

    // Format the date
    let formattedDate = dateMatch[1] || dateMatch[0];
    const parts = formattedDate.split(/[\/\-\.]/);
    if (parts.length === 3 && parts[2].length === 4) {
      // DD/MM/YYYY or DD-MM-YYYY
      formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    } else if (parts.length === 3 && parts[0].length === 4) {
      // YYYY-MM-DD
      formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }

    const type = inferTransactionType(description);
    transactions.push({
      date: formattedDate,
      description,
      amount: txnAmount,
      type,
      category: categorizeTransaction(description, type),
      reference: null,
      balance
    });
  }

  // ── Strategy 2: If Strategy 1 found nothing, try line‑pair matching ──
  if (transactions.length === 0) {
    console.log('[parsePDF] Strategy 1 found nothing, trying line‑pair matching...');
    for (let i = 0; i < lines.length - 1; i++) {
      const line1 = lines[i];
      const line2 = lines[i + 1];
      
      // Check if line1 has a date
      let dateMatch = null;
      for (const pattern of DATE_PATTERNS) {
        dateMatch = line1.match(pattern);
        if (dateMatch) break;
      }
      if (!dateMatch) continue;

      // Check if line2 has an amount
      const amountMatch = line2.match(AMOUNT_PATTERN);
      if (!amountMatch) continue;

      const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) continue;

      const description = line1.replace(dateMatch[0], '').trim() || line2.replace(AMOUNT_PATTERN, '').trim();
      if (description.length < 2) continue;

      let formattedDate = dateMatch[1] || dateMatch[0];
      const parts = formattedDate.split(/[\/\-\.]/);
      if (parts.length === 3 && parts[2].length === 4) {
        formattedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      } else if (parts.length === 3 && parts[0].length === 4) {
        formattedDate = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      }

      const type = inferTransactionType(description);
      transactions.push({
        date: formattedDate,
        description,
        amount,
        type,
        category: categorizeTransaction(description, type),
        reference: null,
        balance: null
      });
      
      i++; // skip the next line since we used it
    }
  }

  console.log(`[parsePDF] Parsed ${transactions.length} transactions`);
  return transactions;
};
const inferTransactionType = (description) => {
  const lower = description.toLowerCase();
  const incomeWords  = ['credit','salary','deposit','inflow','nip cr','transfer in','received','refund','reversal','dividend','interest credit'];
  const expenseWords = ['debit','withdrawal','purchase','payment','charge','fee','atm','pos','transfer out','nip dr','subscription'];
  for (const w of incomeWords)  if (lower.includes(w)) return 'income';
  for (const w of expenseWords) if (lower.includes(w)) return 'expense';
  return 'expense';
};

// Categorise a transaction by its description. The returned category names must stay
// in sync with frontend/src/constants/categories.js so budgets cross-check correctly.
// Rules are ordered specific -> general; the first keyword match wins.
const categorizeTransaction = (description, typeOrAmount) => {
  const lower = description.toLowerCase();
  const isExpense = typeof typeOrAmount === 'string' ? typeOrAmount === 'expense' : typeOrAmount < 0;
  const rules = [
    // ── Income ──
    { for: 'income',  keywords: ['salary','wage','payroll','monthly pay','stipend'], category: 'Salary' },
    { for: 'income',  keywords: ['freelance','consulting','contract pay','upwork','fiverr'], category: 'Freelance' },
    { for: 'income',  keywords: ['sales','invoice','business income','customer payment'], category: 'Business' },
    { for: 'income',  keywords: ['dividend','interest credit','investment return','maturity','roi'], category: 'Investment' },
    { for: 'income',  keywords: ['gift','present'], category: 'Gift' },
    { for: 'income',  keywords: ['refund','reversal','returned','chargeback'], category: 'Refund' },

    // ── Expense (specific first) ──
    { for: 'expense', keywords: ['airtime','recharge','mobile data','data bundle','data plan','mtn','airtel','9mobile','globacom','spectranet',' smile','swift network'], category: 'Airtime & Data' },
    { for: 'expense', keywords: ['netflix','spotify','apple music','youtube premium','showmax','prime video','dstv','gotv','startimes','icloud','google one','canva','chatgpt','openai','adobe','subscription'], category: 'Subscriptions' },
    { for: 'expense', keywords: ['fuel','petrol','petroleum','filling station','nnpc','conoil','ardova','mobil','total energies','diesel',' pms'], category: 'Fuel' },
    { for: 'expense', keywords: ['uber','bolt','taxify','lagride','rida','danfo','keke','transport',' brt','flight','air peace','arik','ibom air','train','trip','toll'], category: 'Transport' },
    { for: 'expense', keywords: ['shoprite','spar','supermarket','grocery','groceries','justrite','ebeano','hubmart','addide','market'], category: 'Groceries' },
    { for: 'expense', keywords: ['restaurant','eatery','bukka','buka','kfc','chicken republic','dominos','pizza','coldstone','cafe','food','kitchen','jollof','the place','chowdeck','glovo','suya'], category: 'Food' },
    { for: 'expense', keywords: ['rent','landlord','property','estate','accommodation','service charge','lease'], category: 'Housing' },
    { for: 'expense', keywords: ['electricity','nepa','phcn','ikedc','ibedc','ekedc','aedc','eedc','kaduna electric','eko electric','ibadan electric','prepaid','water bill','lawma','waste','utility'], category: 'Utilities' },
    { for: 'expense', keywords: ['pharmacy','hospital','clinic','medplus','health','chemist','hmo','drugs','medical','dental'], category: 'Healthcare' },
    { for: 'expense', keywords: ['school fees','tuition','waec','jamb','neco','coursera','udemy','university','college','exam','lecture','textbook'], category: 'Education' },
    { for: 'expense', keywords: ['insurance','assurance','leadway','aiico','axa mansard','cornerstone'], category: 'Insurance' },
    { for: 'expense', keywords: ['amazon','jumia','konga','slot','pos purchase','pos debit','purchase','boutique','fashion','clothing','shopping','mall','aliexpress','temu','shein'], category: 'Shopping' },
    { for: 'expense', keywords: ['cinema','bet9ja','nairabet','sportybet','1xbet','betking','merrybet','gaming','event','ticket','lounge','concert','movie'], category: 'Entertainment' },
    { for: 'expense', keywords: ['piggyvest','cowrywise','risevest','target savings',' ajo','esusu','thrift','vault'], category: 'Savings' },
    { for: 'expense', keywords: ['atm withdrawal','atm cash','cash withdrawal',' atm '], category: 'ATM' },
    { for: 'expense', keywords: ['stamp dut','stamp duty','vat','bank fee','maintenance fee','sms alert','commission','cot','levy','account maintenance','charge'], category: 'Bank Charges' },

    // ── Catch-all transfer (either direction) ──
    { for: 'both',    keywords: ['transfer','nip','neft',' trf','send money','pos transfer','opay','palmpay','moniepoint',' kuda','paystack'], category: 'Transfer' },
  ];
  for (const rule of rules) {
    if (rule.for !== 'both' && ((rule.for === 'expense') !== isExpense)) continue;
    if (rule.keywords.some(kw => lower.includes(kw))) return rule.category;
  }
  return isExpense ? 'Other' : 'Other Income';
};

// Words too generic to identify a merchant — stripped when building a learning key.
const CATEGORY_KEY_STOPWORDS = new Set([
  'transfer','transaction','nip','neft','trf','to','from','pos','pur','purchase','payment',
  'pay','ref','via','self','the','for','and','inward','outward','debit','credit','value',
  'date','bank','plc','ltd','limited','nigeria','mobile','app','online','web','intl','txn',
  'session','charges','charge','vat','reversal','instant','outward','www','com',
]);

// Build a stable per-merchant signature from a description, used both when LEARNING a
// correction and when LOOKING UP a learned category (so they match symmetrically).
const deriveCategoryKey = (description) => {
  const tokens = (description || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')          // drop digits & punctuation
    .split(/\s+/)
    .filter(w => w.length >= 3 && !CATEGORY_KEY_STOPWORDS.has(w));
  return tokens.slice(0, 3).join(' ');
};

// Override categories using what this user has taught the app previously.
const applyLearnedCategories = async (userId, transactions) => {
  const rules = await LearnedCategory.find({ userId }).lean();
  if (!rules.length) return transactions;
  const map = new Map(rules.map(r => [r.key, r.category]));
  return transactions.map(t => {
    const key = deriveCategoryKey(t.description);
    return key && map.has(key) ? { ...t, category: map.get(key), learned: true } : t;
  });
};

// Persist description -> category mappings so future imports auto-apply them.
const learnCategories = async (userId, transactions) => {
  const byKey = new Map(); // dedupe within this batch (last choice wins)
  for (const t of transactions) {
    if (!t.description || !t.category) continue;
    const key = deriveCategoryKey(t.description);
    if (key) byKey.set(key, t.category);
  }
  if (!byKey.size) return;
  const ops = [...byKey].map(([key, category]) => ({
    updateOne: {
      filter: { userId, key },
      update: { $set: { category, updatedAt: new Date() } },
      upsert: true,
    },
  }));
  try { await LearnedCategory.bulkWrite(ops, { ordered: false }); }
  catch (e) { console.error('[learnCategories]', e.message); }
};

// --------------------------
// Middleware
// --------------------------
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');
    req.user = await User.findById(decoded.userId);
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    next();
  } catch (error) { res.status(401).json({ message: 'Token invalid' }); }
};

const superAdminAuth = async (req, res, next) => {
  try {
    if (req.user.role !== 'superadmin') return res.status(403).json({ message: 'Access denied. Superadmin only.' });
    next();
  } catch (error) { res.status(403).json({ message: 'Access denied' }); }
};

// --------------------------
// Multer configuration
// --------------------------
const upload = multer({ dest: 'uploads/' });

// --------------------------
// API Routes
// --------------------------

// Health & test
app.get('/api/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'OK', database: 'Connected', timestamp: new Date().toISOString() });
  } catch (error) { res.status(503).json({ status: 'Error', database: 'Disconnected', error: error.message }); }
});
app.get('/api/test', (req, res) => res.json({ message: 'Backend is working!' }));

// Auth
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({ name, email, password: hashedPassword });
    await user.save();
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'fallback_secret');
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'fallback_secret');
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Transactions
app.get('/api/transactions', auth, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user._id }).sort({ date: -1 });
  res.json(transactions);
});
app.post('/api/transactions', auth, async (req, res) => {
  const { date, description, amount, category, type } = req.body;
  if (!date || !description || !amount || !category || !type) return res.status(400).json({ message: 'All fields required' });
  const transaction = new Transaction({ userId: req.user._id, date: new Date(date), description: description.trim(), amount: type === 'expense' ? -Math.abs(amount) : Math.abs(amount), category: category.trim(), type });
  await transaction.save();
  await applySavingsRule(req.user._id, transaction.amount, transaction.type);
  res.status(201).json(transaction);
});
app.delete('/api/transactions/:id', auth, async (req, res) => {
  const transaction = await Transaction.findOne({ _id: req.params.id, userId: req.user._id });
  if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
  await Transaction.findByIdAndDelete(req.params.id);
  res.json({ message: 'Transaction deleted' });
});

// Budgets
app.get('/api/budgets', auth, async (req, res) => {
  // Optional ?month=YYYY-MM filter; defaults to the current month.
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '')
    ? req.query.month
    : new Date().toISOString().slice(0, 7);
  const budgets = await Budget.find({ userId: req.user._id, month });
  res.json(budgets);
});
app.post('/api/budgets', auth, async (req, res) => {
  const { category, amount, month } = req.body;
  if (!category || !amount) return res.status(400).json({ message: 'Category and amount required' });
  const currentMonth = month || new Date().toISOString().slice(0, 7);
  const existing = await Budget.findOne({ userId: req.user._id, category: category.trim(), month: currentMonth });
  if (existing) return res.status(400).json({ message: `Budget for ${category} already exists for ${currentMonth}` });
  const budget = new Budget({ userId: req.user._id, category: category.trim(), amount: Math.abs(amount), month: currentMonth });
  await budget.save();
  res.status(201).json(budget);
});
app.delete('/api/budgets/:id', auth, async (req, res) => {
  const budget = await Budget.findOne({ _id: req.params.id, userId: req.user._id });
  if (!budget) return res.status(404).json({ message: 'Budget not found' });
  await Budget.findByIdAndDelete(req.params.id);
  res.json({ message: 'Budget deleted' });
});

// Financial health
app.get('/api/financial-health', auth, async (req, res) => {
  const transactions = await Transaction.find({ userId: req.user._id });
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const netIncome = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;
  res.json({ totalIncome, totalExpenses, netIncome, savingsRate: parseFloat(savingsRate.toFixed(1)) });
});

// Wallet
app.get('/api/wallet', auth, async (req, res) => {
  const wallet = await getOrCreateWallet(req.user._id);
  const transactions = await WalletTransaction.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(20);
  res.json({ balance: wallet.balance, savingsBalance: wallet.savingsBalance, transactions });
});
app.post('/api/wallet/deposit', auth, async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });
  const wallet = await getOrCreateWallet(req.user._id);
  wallet.balance += amount;
  await wallet.save();
  const transaction = new WalletTransaction({ userId: req.user._id, type: 'deposit', amount, description: description || 'Manual deposit' });
  await transaction.save();
  res.json({ balance: wallet.balance, transaction });
});
app.post('/api/wallet/withdraw', auth, async (req, res) => {
  const { amount, description } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ message: 'Amount must be positive' });
  const wallet = await getOrCreateWallet(req.user._id);
  if (wallet.balance < amount) return res.status(400).json({ message: 'Insufficient balance' });
  wallet.balance -= amount;
  await wallet.save();
  const transaction = new WalletTransaction({ userId: req.user._id, type: 'withdrawal', amount, description: description || 'Manual withdrawal' });
  await transaction.save();
  res.json({ balance: wallet.balance, transaction });
});

// Savings rules
app.get('/api/savings/rules', auth, async (req, res) => {
  const rule = await SavingsRule.findOne({ userId: req.user._id });
  res.json(rule || null);
});
app.post('/api/savings/rules', auth, async (req, res) => {
  const { type, value, active, targetGoalId } = req.body;
  if (!type || !value) return res.status(400).json({ message: 'Type and value required' });
  if (type === 'fixed' && value <= 0) return res.status(400).json({ message: 'Amount must be greater than 0' });
  if (type === 'roundup' && value <= 0) return res.status(400).json({ message: 'Round‑up step must be >0' });
  await SavingsRule.deleteOne({ userId: req.user._id });
  const rule = new SavingsRule({ userId: req.user._id, type, value, active: active !== false, targetGoalId: targetGoalId || null });
  await rule.save();
  res.json(rule);
});
app.delete('/api/savings/rules', auth, async (req, res) => {
  await SavingsRule.deleteOne({ userId: req.user._id });
  res.json({ message: 'Rule removed' });
});

// Goals
app.get('/api/goals', auth, async (req, res) => {
  const goals = await Goal.find({ userId: req.user._id }).sort({ deadline: 1 });
  res.json(goals);
});
app.post('/api/goals', auth, async (req, res) => {
  const { name, target, current, deadline, category } = req.body;
  const goal = new Goal({ userId: req.user._id, name, target, current: current || 0, deadline, category: category || 'General' });
  await goal.save();
  res.status(201).json(goal);
});
app.put('/api/goals/:id', auth, async (req, res) => {
  const { current, name, target, deadline, category } = req.body;
  const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
  if (!goal) return res.status(404).json({ message: 'Goal not found' });
  if (current !== undefined) goal.current = Math.min(current, goal.target);
  if (name) goal.name = name;
  if (target) goal.target = target;
  if (deadline) goal.deadline = deadline;
  if (category) goal.category = category;
  await goal.save();
  res.json(goal);
});
app.delete('/api/goals/:id', auth, async (req, res) => {
  await Goal.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  res.json({ message: 'Goal deleted' });
});
app.post('/api/goals/:id/contribute', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ message: 'Invalid amount' });

    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    if (goal.current >= goal.target) return res.status(400).json({ message: 'Goal already achieved' });

    const wallet = await getOrCreateWallet(req.user._id);
    if (wallet.balance < amount) return res.status(400).json({ message: 'Insufficient wallet balance' });

    wallet.balance -= amount;
    await wallet.save();

    goal.current = Math.min(goal.current + amount, goal.target);
    await goal.save();

    const tx = new WalletTransaction({
      userId: req.user._id,
      type: 'withdrawal',
      amount,
      description: `Contribution to goal: ${goal.name}`,
      status: 'completed'
    });
    await tx.save();

    res.json({ goal, newBalance: wallet.balance });
  } catch (error) {
    console.error('Goal contribute error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Recurring Bills (updated PUT to accept new fields)
app.get('/api/bills', auth, async (req, res) => {
  try {
    const bills = await RecurringBill.find({ userId: req.user._id }).sort({ nextDue: 1 });
    res.json(bills);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/bills', auth, async (req, res) => {
  try {
    const { name, amount, dueDate, frequency, category, autoPay } = req.body;
    const now = new Date();
    let nextDue = new Date(now.getFullYear(), now.getMonth(), dueDate);
    if (nextDue < now) nextDue = new Date(now.getFullYear(), now.getMonth() + 1, dueDate);
    const bill = new RecurringBill({ userId: req.user._id, name, amount, dueDate, frequency, category, autoPay, nextDue, status: 'active' });
    await bill.save();
    res.status(201).json(bill);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/bills/:id', auth, async (req, res) => {
  try {
    const { name, amount, dueDate, frequency, category, autoPay, status, recipient, bankName, bankCode, accountNumber, accountName } = req.body;
    const bill = await RecurringBill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (name !== undefined) bill.name = name;
    if (amount !== undefined) bill.amount = amount;
    if (dueDate !== undefined) bill.dueDate = dueDate;
    if (frequency !== undefined) bill.frequency = frequency;
    if (category !== undefined) bill.category = category;
    if (autoPay !== undefined) bill.autoPay = autoPay;
    if (status !== undefined) bill.status = status;
    if (recipient !== undefined) bill.recipient = recipient;
    if (bankName !== undefined) bill.bankName = bankName;
    if (bankCode !== undefined) bill.bankCode = bankCode;
    if (accountNumber !== undefined) bill.accountNumber = accountNumber;
    if (accountName !== undefined) bill.accountName = accountName;
    const now = new Date();
    let nextDue = new Date(now.getFullYear(), now.getMonth(), bill.dueDate);
    if (nextDue < now) nextDue = new Date(now.getFullYear(), now.getMonth() + 1, bill.dueDate);
    bill.nextDue = nextDue;
    await bill.save();
    res.json(bill);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/bills/:id', auth, async (req, res) => {
  try {
    await RecurringBill.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ message: 'Bill deleted' });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/bills/process', auth, async (req, res) => {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    const dueBills = await RecurringBill.find({ userId: req.user._id, status: 'active', nextDue: { $gte: startOfDay, $lte: endOfDay } });
    const results = [];
    for (const bill of dueBills) {
      if (bill.autoPay) {
        const wallet = await getOrCreateWallet(req.user._id);
        if (wallet.balance >= bill.amount) {
          wallet.balance -= bill.amount; await wallet.save();
          const tx = new WalletTransaction({ userId: req.user._id, type: 'withdrawal', amount: bill.amount, description: `Auto-pay: ${bill.name}`, status: 'completed' });
          await tx.save();
          results.push({ bill: bill.name, status: 'paid', amount: bill.amount });
        } else { results.push({ bill: bill.name, status: 'insufficient_funds', amount: bill.amount }); }
      } else { results.push({ bill: bill.name, status: 'reminder', amount: bill.amount }); }
      if (bill.frequency === 'monthly') bill.nextDue = new Date(bill.nextDue.getFullYear(), bill.nextDue.getMonth() + 1, bill.dueDate);
      else bill.nextDue = new Date(bill.nextDue.getFullYear() + 1, bill.nextDue.getMonth(), bill.dueDate);
      await bill.save();
    }
    res.json({ processed: dueBills.length, results });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Alerts
app.get('/api/alerts', auth, async (req, res) => {
  try {
    const alerts = [];
    const userId = req.user._id;
    // Only alert on the current month's budgets, scoped to that exact month.
    const thisMonth = new Date().toISOString().slice(0, 7);
    const budgets = await Budget.find({ userId, month: thisMonth });
    const transactions = await Transaction.find({ userId, type: 'expense' });
    const txMonth = (t) => new Date(t.date).toISOString().slice(0, 7);
    for (const budget of budgets) {
      const spent = transactions.filter(t => t.category === budget.category && txMonth(t) === budget.month).reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const percentage = (spent / budget.amount) * 100;
      if (percentage >= 100) alerts.push({ id: `budget_over_${budget._id}`, type: 'danger', message: `Budget overrun: ${budget.category} exceeded by ₦${(spent - budget.amount).toFixed(2)}`, category: budget.category, amount: spent, timestamp: new Date() });
      else if (percentage >= 80) alerts.push({ id: `budget_warning_${budget._id}`, type: 'warning', message: `Budget warning: ${budget.category} is at ${percentage.toFixed(0)}%`, category: budget.category, amount: spent, timestamp: new Date() });
    }
    const bills = await RecurringBill.find({ userId, status: 'active' });
    const today = new Date();
    const nextWeek = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    for (const bill of bills) {
      if (bill.nextDue <= nextWeek && bill.nextDue >= today) alerts.push({ id: `bill_${bill._id}`, type: 'warning', message: `Upcoming bill: ${bill.name} (₦${bill.amount}) due on ${bill.nextDue.toLocaleDateString()}`, category: bill.category, amount: bill.amount, timestamp: bill.nextDue });
    }
    const goals = await Goal.find({ userId });
    for (const goal of goals) {
      const progress = (goal.current / goal.target) * 100;
      if (progress >= 25 && progress < 30)   alerts.push({ id: `goal_25_${goal._id}`,       type: 'success', message: `🎉 Goal progress: ${goal.name} is 25% complete!`,      category: goal.name, amount: goal.current, timestamp: new Date() });
      else if (progress >= 50 && progress < 55) alerts.push({ id: `goal_50_${goal._id}`,    type: 'success', message: `🎉 Halfway there! ${goal.name} is 50% complete.`,        category: goal.name, amount: goal.current, timestamp: new Date() });
      else if (progress >= 75 && progress < 80) alerts.push({ id: `goal_75_${goal._id}`,    type: 'success', message: `🎉 Almost done! ${goal.name} is 75% complete.`,          category: goal.name, amount: goal.current, timestamp: new Date() });
      else if (progress >= 100 && progress < 105) alerts.push({ id: `goal_complete_${goal._id}`, type: 'success', message: `🏆 Congratulations! You achieved ${goal.name}!`, category: goal.name, amount: goal.current, timestamp: new Date() });
    }
    res.json(alerts);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Bank statement upload
app.post('/api/upload-statement', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const filePath = req.file.path;
  const ext = req.file.originalname.split('.').pop().toLowerCase();
  const pdfPassword = (req.body.pdfPassword || '').trim();
  let transactions = [];

  try {
    if (ext === 'csv' || req.file.mimetype === 'text/csv') {
      transactions = await parseCSV(filePath);
    } else if (ext === 'xlsx' || ext === 'xls') {
      transactions = parseExcel(filePath);
    // Inside POST /api/upload-statement, in the PDF branch:
} else if (ext === 'pdf') {
  try {
    console.log(`[upload-statement] Processing PDF: ${filePath}, password provided: ${!!pdfPassword}`);
    transactions = await parsePDF(filePath, pdfPassword);
  } catch (pdfErr) {
    console.error('[PDF error]', pdfErr.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    if (isPdfPasswordError(pdfErr)) {
      if (pdfPassword) {
        return res.status(401).json({ 
          wrongPassword: true, 
          message: 'Incorrect password. Please check and try again.' 
        });
      }
      return res.status(401).json({ 
        passwordRequired: true, 
        message: 'This PDF is password protected. Please enter the password to continue.' 
      });
    }
    
    return res.status(422).json({ 
      message: 'Could not read this PDF. It may be a scanned image or an unsupported format. Try downloading a digital statement from your bank app.',
      error: pdfErr.message 
    });
  }
} else {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ message: 'Unsupported file type. Please upload CSV, Excel, or PDF.' });
    }

    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    if (transactions.length === 0) {
      return res.status(422).json({ message: 'No transactions found in this file. For PDFs, make sure the text is selectable (not a scanned image).', transactions: [] });
    }

    // Apply categories the user has taught the app from previous corrections.
    transactions = await applyLearnedCategories(req.user._id, transactions);

    const existing = await Transaction.find({ userId: req.user._id }, { date: 1, amount: 1, description: 1 }).lean();
    const existingKeys = new Set(existing.map(t => `${new Date(t.date).toISOString().split('T')[0]}|${Math.abs(t.amount)}|${t.description}`));
    const tagged = transactions.map(t => ({ ...t, duplicate: existingKeys.has(`${t.date}|${t.amount}|${t.description}`) }));
    const dupCount = tagged.filter(t => t.duplicate).length;
    return res.json({
      transactions: tagged,
      meta: { totalFound: tagged.length, duplicateCount: dupCount, warnings: dupCount > 0 ? [`${dupCount} transaction(s) already exist and are pre‑marked.`] : [] },
    });
  } catch (error) {
    console.error('Upload error:', error);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(500).json({ message: 'Error processing file: ' + error.message });
  }
});

// Import selected transactions
app.post('/api/import-transactions', auth, async (req, res) => {
  try {
    const { transactions } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) return res.status(400).json({ message: 'No transactions to import' });
    const valid = transactions.filter(t => t.date && t.amount && t.description && t.type);
    if (valid.length === 0) return res.status(400).json({ message: 'All transactions are missing required fields' });
    const docs = valid.map(t => new Transaction({
      userId: req.user._id, date: new Date(t.date), description: t.description,
      amount: t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount),
      category: t.category || 'Other', type: t.type,
    }));
    const inserted = await Transaction.insertMany(docs, { ordered: false });
    // Learn description -> category from what the user chose to import (incl. any
    // edits they made on the review screen), so future imports auto-apply them.
    await learnCategories(req.user._id, valid);
    return res.json({ message: `Imported ${inserted.length} transaction(s) successfully.`, count: inserted.length });
  } catch (error) {
    if (error.result) return res.json({ message: `Imported ${error.result.nInserted} transaction(s).`, count: error.result.nInserted });
    console.error('Import error:', error);
    return res.status(500).json({ message: 'Error importing transactions' });
  }
});

// --------------------------
// Debts CRUD (updated to accept new fields)
// --------------------------
app.get('/api/debts', auth, async (req, res) => {
  try {
    const debts = await Debt.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(debts);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/debts', auth, async (req, res) => {
  try {
    const { name, balance, interest, minPayment, scheduledPayment } = req.body;
    if (!name || balance === undefined || !minPayment) return res.status(400).json({ message: 'Missing required fields' });
    const debt = new Debt({
      userId: req.user._id,
      name,
      balance: parseFloat(balance),
      interest: parseFloat(interest || 0),
      minPayment: parseFloat(minPayment),
      scheduledPayment: {
        enabled:    scheduledPayment?.enabled || false,
        amount:     scheduledPayment?.amount  || 0,
        dayOfMonth: scheduledPayment?.dayOfMonth || 1,
      },
    });
    await debt.save();
    res.status(201).json(debt);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.put('/api/debts/:id', auth, async (req, res) => {
  try {
    const debt = await Debt.findOne({ _id: req.params.id, userId: req.user._id });
    if (!debt) return res.status(404).json({ message: 'Debt not found' });
    const { name, balance, interest, minPayment, scheduledPayment, recipient, bankName, bankCode, accountNumber, accountName } = req.body;
    if (name !== undefined) debt.name = name;
    if (balance !== undefined) debt.balance = parseFloat(balance);
    if (interest !== undefined) debt.interest = parseFloat(interest);
    if (minPayment !== undefined) debt.minPayment = parseFloat(minPayment);
    if (recipient !== undefined) debt.recipient = recipient;
    if (bankName !== undefined) debt.bankName = bankName;
    if (bankCode !== undefined) debt.bankCode = bankCode;
    if (accountNumber !== undefined) debt.accountNumber = accountNumber;
    if (accountName !== undefined) debt.accountName = accountName;
    if (scheduledPayment !== undefined) {
      debt.scheduledPayment.enabled = scheduledPayment.enabled ?? debt.scheduledPayment.enabled;
      debt.scheduledPayment.amount = scheduledPayment.amount ?? debt.scheduledPayment.amount;
      debt.scheduledPayment.dayOfMonth = scheduledPayment.dayOfMonth ?? debt.scheduledPayment.dayOfMonth;
    }
    await debt.save();
    res.json(debt);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

app.delete('/api/debts/:id', auth, async (req, res) => {
  try {
    await Debt.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ message: 'Debt deleted' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Subscriptions (updated PUT to accept new fields)
app.get('/api/subscriptions', auth, async (req, res) => {
  try {
    const subs = await Subscription.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(subs);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/subscriptions', auth, async (req, res) => {
  try {
    const { name, cost, frequency, category, scheduledPayment } = req.body;
    if (!name || !cost) return res.status(400).json({ message: 'Name and cost required' });
    const now = new Date();
    let nextPayment;
    if (scheduledPayment?.enabled && scheduledPayment?.dayOfMonth) {
      nextPayment = new Date(now.getFullYear(), now.getMonth(), scheduledPayment.dayOfMonth);
      if (nextPayment <= now) nextPayment = new Date(now.getFullYear(), now.getMonth() + 1, scheduledPayment.dayOfMonth);
    } else {
      nextPayment = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
    const sub = new Subscription({
      userId: req.user._id, name, cost: parseFloat(cost),
      frequency: frequency || 'monthly', category: category || 'Entertainment',
      status: 'active', nextPayment,
      scheduledPayment: { enabled: scheduledPayment?.enabled || false, dayOfMonth: scheduledPayment?.dayOfMonth || 1 },
    });
    await sub.save();
    res.status(201).json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/subscriptions/:id', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Not found' });
    const { name, cost, frequency, category, status, scheduledPayment, recipient, bankName, bankCode, accountNumber, accountName } = req.body;
    if (name !== undefined) sub.name = name;
    if (cost !== undefined) sub.cost = parseFloat(cost);
    if (frequency !== undefined) sub.frequency = frequency;
    if (category !== undefined) sub.category = category;
    if (status !== undefined) sub.status = status;
    if (recipient !== undefined) sub.recipient = recipient;
    if (bankName !== undefined) sub.bankName = bankName;
    if (bankCode !== undefined) sub.bankCode = bankCode;
    if (accountNumber !== undefined) sub.accountNumber = accountNumber;
    if (accountName !== undefined) sub.accountName = accountName;
    if (scheduledPayment !== undefined) {
      sub.scheduledPayment.enabled = scheduledPayment.enabled ?? sub.scheduledPayment.enabled;
      sub.scheduledPayment.dayOfMonth = scheduledPayment.dayOfMonth ?? sub.scheduledPayment.dayOfMonth;
      if (sub.scheduledPayment.enabled) {
        const now = new Date();
        let next = new Date(now.getFullYear(), now.getMonth(), sub.scheduledPayment.dayOfMonth);
        if (next <= now) next = new Date(now.getFullYear(), now.getMonth() + 1, sub.scheduledPayment.dayOfMonth);
        sub.nextPayment = next;
      }
    }
    await sub.save();
    res.json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/subscriptions/:id', auth, async (req, res) => {
  try {
    await Subscription.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Goal scheduled payment patch
app.patch('/api/goals/:id/scheduled-payment', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    const { enabled, amount, dayOfMonth } = req.body;
    goal.scheduledPayment = {
      enabled: enabled ?? goal.scheduledPayment?.enabled ?? false,
      amount: amount ?? goal.scheduledPayment?.amount ?? 0,
      dayOfMonth: dayOfMonth ?? goal.scheduledPayment?.dayOfMonth ?? 1,
    };
    await goal.save();
    res.json(goal);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Process all scheduled payments (existing)
app.post('/api/process-scheduled-payments', auth, async (req, res) => {
  const userId = req.user._id;
  const today = new Date();
  const todayDay = today.getDate();
  const results = { goals: [], subscriptions: [], debts: [], errors: [] };

  try {
    const debts = await Debt.find({ userId, 'scheduledPayment.enabled': true });
    for (const debt of debts) {
      if (debt.balance <= 0) continue;
      if (debt.scheduledPayment.dayOfMonth !== todayDay) continue;
      const amount = debt.scheduledPayment.amount;
      if (!amount || amount <= 0) continue;
      try {
        const wallet = await getOrCreateWallet(userId);
        if (wallet.balance < amount) {
          results.errors.push({ type: 'debt', name: debt.name, reason: 'Insufficient wallet balance' });
          continue;
        }
        wallet.balance -= amount;
        await wallet.save();
        debt.balance = Math.max(0, debt.balance - amount);
        await debt.save();
        await new WalletTransaction({ userId, type: 'withdrawal', amount,
          description: `Scheduled debt payment: ${debt.name}`, status: 'completed' }).save();
        results.debts.push({ name: debt.name, amount, newBalance: debt.balance });
      } catch (err) { results.errors.push({ type: 'debt', name: debt.name, reason: err.message }); }
    }

    const goals = await Goal.find({ userId, 'scheduledPayment.enabled': true });
    for (const goal of goals) {
      if (goal.current >= goal.target) continue;
      if (goal.scheduledPayment.dayOfMonth !== todayDay) continue;
      const amount = goal.scheduledPayment.amount;
      if (!amount || amount <= 0) continue;
      try {
        const wallet = await getOrCreateWallet(userId);
        if (wallet.balance < amount) {
          results.errors.push({ type: 'goal', name: goal.name, reason: 'Insufficient wallet balance' });
          continue;
        }
        wallet.balance -= amount;
        await wallet.save();
        goal.current = Math.min(goal.current + amount, goal.target);
        await goal.save();
        await new WalletTransaction({ userId, type: 'withdrawal', amount,
          description: `Scheduled goal payment: ${goal.name}`, status: 'completed' }).save();
        results.goals.push({ name: goal.name, amount, newProgress: goal.current });
      } catch (err) { results.errors.push({ type: 'goal', name: goal.name, reason: err.message }); }
    }

    const subs = await Subscription.find({ userId, status: 'active', 'scheduledPayment.enabled': true });
    for (const sub of subs) {
      if (sub.scheduledPayment.dayOfMonth !== todayDay) continue;
      try {
        const wallet = await getOrCreateWallet(userId);
        if (wallet.balance < sub.cost) {
          results.errors.push({ type: 'subscription', name: sub.name, reason: 'Insufficient wallet balance' });
          continue;
        }
        wallet.balance -= sub.cost;
        await wallet.save();
        const next = new Date(today.getFullYear(), today.getMonth() + (sub.frequency === 'monthly' ? 1 : 12), sub.scheduledPayment.dayOfMonth);
        sub.nextPayment = next;
        await sub.save();
        await new WalletTransaction({ userId, type: 'withdrawal', amount: sub.cost,
          description: `Subscription: ${sub.name}`, status: 'completed' }).save();
        await new Transaction({ userId, date: today, description: `${sub.name} subscription`,
          amount: -Math.abs(sub.cost), category: sub.category, type: 'expense' }).save();
        results.subscriptions.push({ name: sub.name, amount: sub.cost });
      } catch (err) { results.errors.push({ type: 'subscription', name: sub.name, reason: err.message }); }
    }

    res.json({ message: `Processed ${results.debts.length} debt(s), ${results.goals.length} goal(s) and ${results.subscriptions.length} subscription(s)`, results });
  } catch (e) {
    console.error('Scheduled payments error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});

// NEW: Pay All Due (debts, subscriptions, bills) – the “Refresh to pay all” button
app.post('/api/payments/pay-all-due', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const wallet = await getOrCreateWallet(userId);
    const today = new Date();
    const todayDay = today.getDate();
    let totalPaid = 0;
    const errors = [];

    // 1. Debts with enabled scheduledPayment and due today
    const debts = await Debt.find({ userId, 'scheduledPayment.enabled': true });
    for (const debt of debts) {
      if (debt.balance <= 0 || debt.scheduledPayment.dayOfMonth !== todayDay) continue;
      const amount = debt.scheduledPayment.amount || debt.minPayment;
      if (wallet.balance < amount) {
        errors.push(`Insufficient funds for debt: ${debt.name}`);
        continue;
      }
      wallet.balance -= amount;
      debt.balance = Math.max(0, debt.balance - amount);
      await debt.save();
      totalPaid += amount;
      await new WalletTransaction({ userId, type: 'withdrawal', amount,
        description: `Scheduled debt payment: ${debt.name}`, status: 'completed' }).save();
    }

    // 2. Subscriptions (only those with scheduledPayment enabled and day matches)
    const subs = await Subscription.find({ userId, status: 'active', 'scheduledPayment.enabled': true });
    for (const sub of subs) {
      if (sub.scheduledPayment.dayOfMonth !== todayDay) continue;
      const amount = sub.cost;
      if (wallet.balance < amount) {
        errors.push(`Insufficient funds for subscription: ${sub.name}`);
        continue;
      }
      wallet.balance -= amount;
      // Advance next payment date
      const next = new Date(today.getFullYear(), today.getMonth() + (sub.frequency === 'monthly' ? 1 : 12), sub.scheduledPayment.dayOfMonth);
      sub.nextPayment = next;
      await sub.save();
      totalPaid += amount;
      await new WalletTransaction({ userId, type: 'withdrawal', amount,
        description: `Subscription: ${sub.name}`, status: 'completed' }).save();
      // Also record a transaction (optional)
      await new Transaction({ userId, date: today, description: `${sub.name} subscription`,
        amount: -Math.abs(amount), category: sub.category, type: 'expense' }).save();
    }

    // 3. Recurring Bills (due today based on dueDate day of month)
    const bills = await RecurringBill.find({ userId, status: 'active' });
    for (const bill of bills) {
      if (bill.dueDate !== todayDay) continue;
      const amount = bill.amount;
      if (wallet.balance < amount) {
        errors.push(`Insufficient funds for bill: ${bill.name}`);
        continue;
      }
      wallet.balance -= amount;
      // Advance next due
      if (bill.frequency === 'monthly') {
        bill.nextDue = new Date(bill.nextDue.getFullYear(), bill.nextDue.getMonth() + 1, bill.dueDate);
      } else {
        bill.nextDue = new Date(bill.nextDue.getFullYear() + 1, bill.nextDue.getMonth(), bill.dueDate);
      }
      await bill.save();
      totalPaid += amount;
      await new WalletTransaction({ userId, type: 'withdrawal', amount,
        description: `Bill payment: ${bill.name}`, status: 'completed' }).save();
    }

    await wallet.save();

    res.json({
      message: `Paid ₦${totalPaid.toLocaleString()} in total. ${errors.length > 0 ? 'Some items failed: ' + errors.join('; ') : ''}`,
      totalPaid,
      errors
    });
  } catch (err) {
    console.error('Pay all due error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Superadmin routes (unchanged)
app.get('/api/admin/users', auth, superAdminAuth, async (req, res) => {
  try {
    const users = await User.find({}).select('-password -resetToken -resetTokenExpiry').sort({ createdAt: -1 });
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const transactionCount = await Transaction.countDocuments({ userId: user._id });
      const incomeAgg = await Transaction.aggregate([{ $match: { userId: user._id, type: 'income' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
      const expenseAgg = await Transaction.aggregate([{ $match: { userId: user._id, type: 'expense' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
      return { ...user.toObject(), stats: { transactionCount, totalIncome: incomeAgg[0]?.total || 0, totalExpenses: Math.abs(expenseAgg[0]?.total || 0) } };
    }));
    res.json(usersWithStats);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.patch('/api/admin/users/:id/role', auth, superAdminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'superadmin'].includes(role)) return res.status(400).json({ message: 'Invalid role' });
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'Cannot change your own role' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: 'Role updated', user });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.patch('/api/admin/users/:id/status', auth, superAdminAuth, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'Cannot change your own status' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isActive = !user.isActive;
    await user.save();
    res.json({ message: `User ${user.isActive ? 'activated' : 'deactivated'}`, user: { id: user._id, name: user.name, isActive: user.isActive } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/admin/users/:id', auth, superAdminAuth, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) return res.status(400).json({ message: 'Cannot delete your own account' });
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    await Transaction.deleteMany({ userId: req.params.id });
    await Budget.deleteMany({ userId: req.params.id });
    await Wallet.deleteOne({ userId: req.params.id });
    await Goal.deleteMany({ userId: req.params.id });
    await SavingsRule.deleteOne({ userId: req.params.id });
    await Debt.deleteMany({ userId: req.params.id });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User and all associated data deleted' });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.get('/api/admin/stats', auth, superAdminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const activeUsers = await User.countDocuments({ role: 'user', isActive: true });
    const totalTransactions = await Transaction.countDocuments();
    const totalBudgets = await Budget.countDocuments();
    const recentUsers = await User.find({ role: 'user' }).select('-password').sort({ createdAt: -1 }).limit(5);
    const incomeAgg = await Transaction.aggregate([{ $match: { type: 'income' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const expenseAgg = await Transaction.aggregate([{ $match: { type: 'expense' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    res.json({ totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers, totalTransactions, totalBudgets, platformIncome: incomeAgg[0]?.total || 0, platformExpenses: Math.abs(expenseAgg[0]?.total || 0), recentUsers });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/admin/setup', async (req, res) => {
  try {
    const { setupKey, name, email, password } = req.body;
    if (setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(403).json({ message: 'Invalid setup key' });
    const existing = await User.findOne({ role: 'superadmin' });
    if (existing) return res.status(400).json({ message: 'Superadmin already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const superAdmin = new User({ name, email, password: hashedPassword, role: 'superadmin' });
    await superAdmin.save();
    res.status(201).json({ message: 'Superadmin created', email: superAdmin.email });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Bank & Profile routes
// --------------------------
app.get('/api/banks', auth, async (req, res) => {
  try {
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });
    res.json(response.data.data);
  } catch (err) {
    console.error('Error fetching banks from Paystack:', err.message);
    res.status(500).json({ message: 'Failed to fetch bank list' });
  }
});

// Resolve account name from Paystack
app.get('/api/bank/resolve', auth, async (req, res) => {
  const { account_number, bank_code } = req.query;

  if (!account_number || !bank_code) {
    return res.status(400).json({ message: 'account_number and bank_code are required' });
  }
  if (account_number.length !== 10) {
    return res.status(400).json({ message: 'Account number must be exactly 10 digits' });
  }

  try {
    const response = await axios.get('https://api.paystack.co/bank/resolve', {
      params: { account_number, bank_code },
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      },
    });

    if (response.data.status) {
      return res.json({
        account_name:   response.data.data.account_name,
        account_number: response.data.data.account_number,
      });
    }

    return res.status(422).json({ message: 'Could not resolve account. Please check the details.' });

  } catch (err) {
    if (err.response?.status === 422) {
      return res.status(422).json({ message: 'Account number not found at this bank.' });
    }
    if (err.response?.status === 401) {
      return res.status(500).json({ message: 'Paystack key not configured. Check PAYSTACK_SECRET_KEY in .env' });
    }
    console.error('Paystack resolve error:', err.response?.data || err.message);
    return res.status(500).json({ message: 'Account verification failed. Please try again.' });
  }
});

// Get user bank details
app.get('/api/user/bank-details', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('payout');
    res.json(user.payout || { method: '', card: {}, titan: {} });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Save the user's wallet payout method (card OR Paystack-Titan account).
// Only one method is active at a time; saving one clears the other.
app.post('/api/user/bank-details', auth, async (req, res) => {
  try {
    const { method, card, titan } = req.body;

    if (method === 'card') {
      const digits = (card?.number || '').replace(/\D/g, '');
      if (digits.length < 12) return res.status(400).json({ message: 'Enter a valid card number' });
      if (!card?.expiry) return res.status(400).json({ message: 'Card expiry is required' });
      await User.findByIdAndUpdate(req.user._id, {
        payout: {
          method: 'card',
          // Store only the last 4 digits — never the full PAN or CVV.
          card: { last4: digits.slice(-4), expiry: card.expiry, holderName: card.holderName || '' },
          titan: { accountNumber: '', accountName: '', bankCode: '', bankName: 'Titan-Paystack' },
        },
      });
      return res.json({ message: 'Card saved' });
    }

    if (method === 'titan') {
      const acct = (titan?.accountNumber || '').replace(/\D/g, '');
      if (acct.length !== 10) return res.status(400).json({ message: 'Enter a valid 10-digit account number' });
      await User.findByIdAndUpdate(req.user._id, {
        payout: {
          method: 'titan',
          card: { last4: '', expiry: '', holderName: '' },
          titan: {
            accountNumber: acct,
            accountName: titan.accountName || '',
            bankCode: titan.bankCode || '',
            bankName: titan.bankName || 'Titan-Paystack',
          },
        },
      });
      return res.json({ message: 'Paystack-Titan account saved' });
    }

    return res.status(400).json({ message: 'Choose a payout method (card or titan)' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

// 404 handler
app.use('*', (req, res) => res.status(404).json({ message: 'Route not found' }));

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ message: 'Internal server error', error: process.env.NODE_ENV === 'development' ? error.message : undefined });
});

// --------------------------
// Start server
// --------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 MongoDB: ${process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app'}`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/health`);
});