const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const XLSX = require('xlsx');
const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Where password-reset links point (the deployed frontend).
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://financial-app-fawn-nu.vercel.app';

// Email can be sent two ways:
//   1. Brevo HTTP API (port 443) — preferred on Render, whose free/starter tiers
//      BLOCK outbound SMTP (you get ETIMEDOUT to smtp.gmail.com). HTTPS isn't blocked.
//   2. SMTP via nodemailer — fallback for local dev or hosts that allow SMTP.
// Set BREVO_API_KEY to use the API path; otherwise it falls back to EMAIL_USER/PASS.
const brevoConfigured = () => !!process.env.BREVO_API_KEY;
const smtpConfigured = () => !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
const emailConfigured = () => brevoConfigured() || smtpConfigured();

// Build the SMTP transport. Gmail app passwords are shown as "abcd efgh ijkl mnop";
// users often paste them with spaces (or stray quotes), which Gmail rejects (535).
// Strip those defensively so a correctly-generated app password always works.
const makeTransport = () => nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: Number(process.env.EMAIL_PORT) || 587,
  secure: Number(process.env.EMAIL_PORT) === 465,
  auth: {
    user: (process.env.EMAIL_USER || '').trim(),
    pass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '').replace(/^["']|["']$/g, ''),
  },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

// The "from" identity. Brevo requires a verified sender; we reuse EMAIL_USER (your
// Gmail) as both the SMTP login and the Brevo sender so one address drives both.
const senderEmail = () => (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER || '').trim();
const senderName = () => process.env.EMAIL_FROM_NAME || 'FinPilot';
const mailFrom = () => process.env.EMAIL_FROM || `${senderName()} <${senderEmail()}>`;

// Send one email via whichever transport is configured. Brevo wins if its key is set.
// Returns nothing on success; throws on failure (callers decide how to handle).
const sendEmail = async ({ to, subject, text, html }) => {
  if (brevoConfigured()) {
    await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { name: senderName(), email: senderEmail() },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: html || `<p>${text}</p>`,
      },
      {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
        timeout: 15000,
      }
    );
    return;
  }
  // SMTP fallback
  await makeTransport().sendMail({ from: mailFrom(), to, subject, text, html });
};

// Send a password-reset email if email is configured; otherwise log the link so the
// owner can still recover an account from the server logs during setup.
const sendResetEmail = async (to, link) => {
  if (!emailConfigured()) {
    console.log(`[password-reset] (email not configured) reset link for ${to}: ${link}`);
    return false;
  }
  await sendEmail({
    to,
    subject: 'Reset your FinPilot password',
    text: `Reset your password using this link (valid for 1 hour):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>Reset your FinPilot password using the link below (valid for 1 hour):</p>
           <p><a href="${link}">Reset my password</a></p>
           <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p>`,
  });
  return true;
};

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Fail fast if the JWT secret is missing — never fall back to a public default.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);             // behind Render's proxy — needed for correct client IPs
app.use(helmet());                     // standard security headers
app.use(compression());                // gzip responses

// Restrict cross-origin requests to our own frontend(s). Non-browser callers
// (curl, health checks) send no Origin and are allowed. Extra origins can be
// added via the ALLOWED_ORIGINS env var (comma-separated).
const allowedOrigins = [
  'https://financial-app-fawn-nu.vercel.app',
  'http://localhost:3000',
  ...((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
}));

app.use(express.json({ limit: '5mb' })); // allow large statement imports (was 100kb)

// Throttle auth endpoints to slow brute-force / credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many attempts. Please try again in a few minutes.' },
});

// Looser limiter for authenticated write actions (change password, support tickets).
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down and try again shortly.' },
});

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
  // Profile / onboarding
  phone:         { type: String, default: '' },
  monthlyIncome: { type: Number, default: 0 },
  primaryGoal:   { type: String, default: '' },
  emailAlerts:   { type: Boolean, default: true },
  onboarded:     { type: Boolean, default: false },
  lastLogin:     { type: Date },
  // Email-based 2-step verification (#21/#22).
  twoFactorEnabled: { type: Boolean, default: false },
  loginOtpHash:     { type: String },
  loginOtpExpiry:   { type: Date },
  // Tokens issued before this time are rejected (used by "log out of all devices").
  sessionsValidFrom: { type: Date },
  // Linked bank account via Mono (auto-import). accountId is Mono's account id.
  linkedBank: {
    provider:    { type: String, default: '' },   // 'mono'
    accountId:   { type: String, default: '' },
    institution: { type: String, default: '' },    // bank name
    accountName: { type: String, default: '' },
    lastSynced:  { type: Date },
  },
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
  type: { type: String, enum: ['income', 'expense'], required: true },
  // Origin tracking so transactions can be grouped/deleted by bank statement.
  source: { type: String, enum: ['manual', 'import'], default: 'manual' },
  bank: { type: String, default: '' },           // e.g. 'GTBank', 'Union', 'Kuda'
  importBatch: { type: String, default: '' },     // one id per uploaded statement
  importedAt: { type: Date },
}, { timestamps: true });
// Indexes for the common per-user queries (date listing & statement grouping).
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, importBatch: 1 });
const Transaction = mongoose.model('Transaction', transactionSchema);

const budgetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true },
  amount: { type: Number, required: true },
  month: { type: String, required: true },
}, { timestamps: true });
budgetSchema.index({ userId: 1, month: 1 });
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

// Support tickets submitted from the Support/FAQ page; superadmins review them.
const supportTicketSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:    { type: String, default: '' },
  email:   { type: String, default: '' },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  status:  { type: String, enum: ['open', 'resolved'], default: 'open' },
}, { timestamps: true });
const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

// In-app notifications (app alerts).
const notificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, default: 'info' }, // 'info' | 'success' | 'ticket'
  title:   { type: String, required: true },
  message: { type: String, default: '' },
  link:    { type: String, default: '' },
  read:    { type: Boolean, default: false },
}, { timestamps: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', notificationSchema);

const createNotification = async (userId, { type = 'info', title, message = '', link = '' }) => {
  try { await Notification.create({ userId, type, title, message, link }); }
  catch (e) { console.error('[createNotification]', e.message); }
};

// After spending changes, raise an in-app notification when a category crosses
// 80% ("near") or 100% ("over") of its monthly budget. De-duplicated per
// category+month+threshold (via the notification link) so it fires once, not on
// every transaction.
const checkBudgetAlert = async (userId, category, monthStr) => {
  try {
    if (!category || !/^\d{4}-\d{2}$/.test(monthStr || '')) return;
    const budget = await Budget.findOne({ userId, category, month: monthStr });
    if (!budget || budget.amount <= 0) return;
    const start = new Date(`${monthStr}-01T00:00:00.000Z`);
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
    const agg = await Transaction.aggregate([
      { $match: { userId: budget.userId, type: 'expense', category, date: { $gte: start, $lt: end } } },
      { $group: { _id: null, spent: { $sum: { $abs: '$amount' } } } },
    ]);
    const spent = agg[0]?.spent || 0;
    const pct = spent / budget.amount;
    const threshold = pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : null;
    if (!threshold) return;
    const link = `/budget?c=${encodeURIComponent(category)}&m=${monthStr}&t=${threshold}`;
    if (await Notification.findOne({ userId, link })) return; // already alerted
    const pctRound = Math.round(pct * 100);
    await createNotification(userId, {
      type: threshold === 'over' ? 'info' : 'info',
      title: threshold === 'over' ? `Over budget: ${category}` : `Budget alert: ${category}`,
      message: `You've used ${pctRound}% of your ${category} budget for ${monthStr}.`,
      link,
    });
  } catch (e) { console.error('[checkBudgetAlert]', e.message); }
};

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
        transactions.bank = detectBank(rawContent);
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
  transactions.bank = detectBank(rows.slice(0, 15).map(r => r.join(' ')).join(' '));
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

// Repair a year token to a 4-digit year. Bank-statement PDFs have no column
// delimiters, so the text extractor glues the date to the next column. A 2-digit
// year ("26") then absorbs the following day ("29") and arrives here as "2629".
// A 4-digit year ("2026") can absorb a day and arrive as "202629". Recover the
// real year for each case instead of trusting the raw digits.
const fixYear = (raw) => {
  const y = String(raw || '');
  if (y.length === 2) return '20' + y;                                  // 26 -> 2026
  if (y.length === 4) {
    if (/^(?:19|20)\d{2}$/.test(y)) return y;                           // 2026 -> 2026
    if (y.startsWith('0')) return '20' + y.slice(2);                    // 0026 -> 2026
    return '20' + y.slice(0, 2);                                        // 2629 -> 2026 (glued 2-digit yr)
  }
  if (y.length > 4) {
    if (/^(?:19|20)/.test(y)) return y.slice(0, 4);                     // 202629 -> 2026 (glued 4-digit yr)
    return '20' + y.slice(0, 2);                                        // 262912 -> 2026
  }
  return y;
};

// Reject dates that parsed to something impossible — a wrong year/month/day means
// the row was mis-read and should be skipped rather than saved with bad data.
const isSaneDate = (y, mo, dy) => {
  const yr = parseInt(y, 10), m = parseInt(mo, 10), d = parseInt(dy, 10);
  if (yr < 2000 || yr > new Date().getFullYear() + 1) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  return true;
};

// Normalise any supported date token to YYYY-MM-DD (returns null if unrecognised
// or implausible).
const normalizeAnyDate = (raw) => {
  const s = (raw || '').trim();
  let m, y, mon, day;
  // DD-Mon-YYYY (also DD/Mon/YYYY)
  if ((m = s.match(/^(\d{1,2})[\/-]([A-Za-z]{3})[\/-](\d{2,4})$/))) {
    mon = MONTH_MAP[m[2].toLowerCase()];
    if (!mon) return null;
    y = fixYear(m[3]); day = m[1].padStart(2, '0');
  // YYYY-MM-DD
  } else if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) {
    y = m[1]; mon = m[2]; day = m[3];
  // DD/MM/YY or DD/MM/YYYY (also DD-MM-YYYY)
  } else if ((m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/))) {
    y = fixYear(m[3]); mon = m[2].padStart(2, '0'); day = m[1].padStart(2, '0');
  } else {
    return null;
  }
  if (!isSaneDate(y, mon, day)) return null;
  return `${y}-${mon}-${day}`;
};

// Broader date normaliser for the generic fallback strategies, which also see
// "2 May 2024" and "02.05.2024" / "2024/05/02" forms. Returns YYYY-MM-DD or null.
const genericToISO = (token) => {
  const t = (token || '').trim();
  // Numeric / and - forms (incl. dotted, after normalising "." to "-").
  let iso = normalizeAnyDate(t.replace(/\./g, '-'));
  if (iso) return iso;
  // DD Mon YYYY (e.g. "2 May 2024")
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})$/);
  if (m) {
    const mon = MONTH_MAP[m[2].toLowerCase()];
    if (mon) {
      const y = fixYear(m[3]), day = m[1].padStart(2, '0');
      if (isSaneDate(y, mon, day)) return `${y}-${mon}-${day}`;
    }
  }
  // YYYY/MM/DD (slash form not covered above)
  m = t.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m && isSaneDate(m[1], m[2], m[3])) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
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
    balanceParsed.bank = detectBank(rawText);
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

    // Normalise + validate the date (repairs glued years, rejects bad rows).
    const formattedDate = genericToISO(dateMatch[1] || dateMatch[0]);
    if (!formattedDate) continue;

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

      const formattedDate = genericToISO(dateMatch[1] || dateMatch[0]);
      if (!formattedDate) continue;

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
  transactions.bank = detectBank(rawText);
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
    { for: 'expense', keywords: ['amazon','jumia','konga','slot','purchase','boutique','fashion','clothing','shopping','mall','aliexpress','temu','shein'], category: 'Shopping' },
    { for: 'expense', keywords: ['cinema','bet9ja','nairabet','sportybet','1xbet','betking','merrybet','gaming','event','ticket','lounge','concert','movie'], category: 'Entertainment' },
    { for: 'expense', keywords: ['piggyvest','cowrywise','risevest','target savings',' ajo','esusu','thrift','vault'], category: 'Savings' },
    { for: 'expense', keywords: ['atm withdrawal','atm cash','cash withdrawal',' atm ','pos purchase','pos debit','pos withdrawal',' pos ','point of sale'], category: 'ATM/POS' },
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

// Best-effort detection of the issuing bank from statement text. List order is the
// priority (so a statement that merely *mentions* another bank in a narration still
// resolves to its real issuer). Keywords are specific phrases to avoid false hits
// (e.g. bare "uba" would match "Abuja"). The user confirms/overrides on review.
const BANK_SIGNATURES = [
  ['Union Bank', ['union bank']],
  ['GTBank', ['gtbank', 'guaranty trust', 'gtworld', 'gt bank']],
  ['Kuda', ['kuda']],
  ['Access Bank', ['access bank', 'diamond bank']],
  ['Zenith Bank', ['zenith bank']],
  ['First Bank', ['first bank', 'firstbank']],
  ['UBA', ['united bank for africa']],
  ['Wema Bank', ['wema bank', 'alat']],
  ['Fidelity Bank', ['fidelity bank']],
  ['FCMB', ['fcmb', 'first city monument']],
  ['Sterling Bank', ['sterling bank']],
  ['Stanbic IBTC', ['stanbic']],
  ['Polaris Bank', ['polaris bank']],
  ['Ecobank', ['ecobank']],
  ['Keystone Bank', ['keystone bank']],
  ['Unity Bank', ['unity bank']],
  ['Providus Bank', ['providus']],
  ['Opay', ['opay']],
  ['PalmPay', ['palmpay']],
  ['Moniepoint', ['moniepoint']],
  ['Paystack-Titan', ['titan-paystack', 'paystack titan']],
];
const detectBank = (text = '') => {
  const l = (text || '').toLowerCase();
  for (const [name, kws] of BANK_SIGNATURES) {
    if (kws.some(kw => l.includes(kw))) return name;
  }
  return '';
};

// --------------------------
// Middleware
// --------------------------
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: 'No token', authExpired: true });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = await User.findById(decoded.userId);
    if (!req.user) return res.status(401).json({ message: 'User not found', authExpired: true });
    // "Log out of all devices": reject tokens issued before the cutoff.
    if (req.user.sessionsValidFrom && decoded.iat && decoded.iat * 1000 < req.user.sessionsValidFrom.getTime()) {
      return res.status(401).json({ message: 'Session ended. Please log in again.', authExpired: true });
    }
    next();
  } catch (error) {
    // expired or invalid token — flag it so the client can send the user to login
    const expired = error.name === 'TokenExpiredError';
    res.status(401).json({ message: expired ? 'Session expired. Please log in again.' : 'Token invalid', authExpired: true });
  }
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
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB cap
  fileFilter: (req, file, cb) => {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (['csv', 'pdf', 'xls', 'xlsx'].includes(ext)) cb(null, true);
    else cb(new Error('Unsupported file type. Please upload a CSV, Excel, or PDF file.'));
  },
});

// Run multer for a single "file" field and turn its errors into clean 400s
// (otherwise size/type errors fall through to the generic 500 handler).
const uploadSingle = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large. Maximum size is 15 MB.'
        : (err.message || 'File upload failed.');
      return res.status(400).json({ message: msg });
    }
    next();
  });
};

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
app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    // Phone is now required at sign-up.
    const cleanPhone = (phone || '').toString().trim();
    if (!name || !email || !password || !cleanPhone) {
      return res.status(400).json({ message: 'Name, email, phone and password are all required' });
    }
    if (cleanPhone.replace(/\D/g, '').length < 7) {
      return res.status(400).json({ message: 'Enter a valid phone number' });
    }
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    user = new User({ name, email, password: hashedPassword, phone: cleanPhone.slice(0, 20) });
    await user.save();
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, onboarded: user.onboarded } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    // 2-step verification: email a one-time code instead of issuing a token now.
    if (user.twoFactorEnabled) {
      if (!emailConfigured()) {
        return res.status(503).json({ message: 'Two-step verification is on but email is not configured. Contact support.' });
      }
      const otp = ('' + Math.floor(100000 + Math.random() * 900000)); // 6 digits
      user.loginOtpHash = hashToken(otp);
      user.loginOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
      await user.save();
      sendEmail({
        to: user.email,
        subject: 'Your FinPilot login code',
        text: `Your FinPilot verification code is ${otp}. It expires in 10 minutes.`,
        html: `<p>Your FinPilot verification code is <strong style="font-size:20px">${otp}</strong>.</p><p>It expires in 10 minutes. If you didn't try to sign in, change your password.</p>`,
      }).catch(e => console.error('[login-otp] email failed:', e.message));
      return res.json({ otpRequired: true, email: user.email });
    }

    user.lastLogin = new Date();
    await user.save();
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, onboarded: user.onboarded } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Step 2 of 2FA login: verify the emailed OTP and issue the token.
app.post('/api/verify-login-otp', authLimiter, async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and code are required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user || !user.loginOtpHash || !user.loginOtpExpiry) {
      return res.status(400).json({ message: 'No pending verification. Please sign in again.' });
    }
    if (user.loginOtpExpiry < new Date()) {
      return res.status(400).json({ message: 'Code expired. Please sign in again.' });
    }
    if (user.loginOtpHash !== hashToken(String(otp).trim())) {
      return res.status(400).json({ message: 'Incorrect code' });
    }
    user.loginOtpHash = undefined;
    user.loginOtpExpiry = undefined;
    user.lastLogin = new Date();
    await user.save();
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, onboarded: user.onboarded } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Current user's profile
app.get('/api/me', auth, async (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email, role: u.role,
    phone: u.phone || '', monthlyIncome: u.monthlyIncome || 0,
    primaryGoal: u.primaryGoal || '', emailAlerts: u.emailAlerts !== false,
    twoFactorEnabled: !!u.twoFactorEnabled,
    onboarded: !!u.onboarded, lastLogin: u.lastLogin || null,
  });
});

// Update profile / onboarding fields
app.put('/api/me', auth, async (req, res) => {
  try {
    const { name, phone, monthlyIncome, primaryGoal, emailAlerts, onboarded, twoFactorEnabled } = req.body;
    const u = req.user;
    if (name !== undefined && name.trim()) u.name = name.trim();
    if (phone !== undefined) u.phone = phone.toString().slice(0, 20);
    if (monthlyIncome !== undefined) u.monthlyIncome = Math.max(0, parseFloat(monthlyIncome) || 0);
    if (primaryGoal !== undefined) u.primaryGoal = primaryGoal.toString().slice(0, 100);
    if (emailAlerts !== undefined) u.emailAlerts = !!emailAlerts;
    if (twoFactorEnabled !== undefined) u.twoFactorEnabled = !!twoFactorEnabled;
    if (onboarded !== undefined) u.onboarded = !!onboarded;
    await u.save();
    res.json({ id: u._id, name: u.name, email: u.email, role: u.role, phone: u.phone, monthlyIncome: u.monthlyIncome, primaryGoal: u.primaryGoal, emailAlerts: u.emailAlerts, twoFactorEnabled: u.twoFactorEnabled, onboarded: u.onboarded });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Change password (while logged in)
app.post('/api/change-password', sensitiveLimiter, auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ message: 'Current and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ message: 'New password must be at least 6 characters' });
    const ok = await bcrypt.compare(currentPassword, req.user.password);
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    req.user.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    req.user.sessionsValidFrom = new Date(); // sign out other sessions on password change
    await req.user.save();
    res.json({ message: 'Password changed successfully.' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Change email (requires current password; enforces uniqueness)
app.post('/api/change-email', sensitiveLimiter, auth, async (req, res) => {
  try {
    const { password, newEmail } = req.body;
    const email = (newEmail || '').toLowerCase().trim();
    if (!password || !email) return res.status(400).json({ message: 'Password and new email are required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
    const ok = await bcrypt.compare(password, req.user.password);
    if (!ok) return res.status(400).json({ message: 'Password is incorrect' });
    const taken = await User.findOne({ email, _id: { $ne: req.user._id } });
    if (taken) return res.status(400).json({ message: 'That email is already in use' });
    req.user.email = email;
    await req.user.save();
    res.json({ message: 'Email updated.', email });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Log out of all devices (invalidate every existing token)
app.post('/api/logout-all', auth, async (req, res) => {
  try {
    req.user.sessionsValidFrom = new Date();
    await req.user.save();
    res.json({ message: 'Logged out of all devices.' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Export all of the user's data as JSON
app.get('/api/me/export', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const [transactions, budgets, goals, subscriptions, debts, bills, walletTx, tickets] = await Promise.all([
      Transaction.find({ userId: uid }).lean(),
      Budget.find({ userId: uid }).lean(),
      Goal.find({ userId: uid }).lean(),
      Subscription.find({ userId: uid }).lean(),
      Debt.find({ userId: uid }).lean(),
      RecurringBill.find({ userId: uid }).lean(),
      WalletTransaction.find({ userId: uid }).lean(),
      SupportTicket.find({ userId: uid }).lean(),
    ]);
    res.json({
      exportedAt: new Date().toISOString(),
      profile: { name: req.user.name, email: req.user.email, phone: req.user.phone, monthlyIncome: req.user.monthlyIncome, primaryGoal: req.user.primaryGoal },
      transactions, budgets, goals, subscriptions, debts, bills, walletTransactions: walletTx, supportTickets: tickets,
    });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Delete account and all associated data (requires current password)
app.delete('/api/me', sensitiveLimiter, auth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Password is required to delete your account' });
    const ok = await bcrypt.compare(password, req.user.password);
    if (!ok) return res.status(400).json({ message: 'Password is incorrect' });
    const uid = req.user._id;
    await Promise.all([
      Transaction.deleteMany({ userId: uid }),
      Budget.deleteMany({ userId: uid }),
      Goal.deleteMany({ userId: uid }),
      Subscription.deleteMany({ userId: uid }),
      Debt.deleteMany({ userId: uid }),
      RecurringBill.deleteMany({ userId: uid }),
      Wallet.deleteMany({ userId: uid }),
      WalletTransaction.deleteMany({ userId: uid }),
      SavingsRule.deleteMany({ userId: uid }),
      LearnedCategory.deleteMany({ userId: uid }),
      SupportTicket.deleteMany({ userId: uid }),
      Notification.deleteMany({ userId: uid }),
    ]);
    await User.deleteOne({ _id: uid });
    res.json({ message: 'Your account and all data have been deleted.' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Request a password reset link. Always responds the same way (no account
// enumeration). Stores a hashed, 1-hour token and emails the raw token's link.
app.post('/api/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    const generic = { message: 'If an account with that email exists, a reset link has been sent.' };

    if (user) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetToken = hashToken(rawToken);
      user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await user.save();
      const link = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
      // Fire-and-forget: never block the response on SMTP, never surface email
      // errors to the client (avoids slow requests / 500s when mail is slow).
      sendResetEmail(user.email, link).catch(e => console.error('[forgot-password] email send failed:', e.message));
      // Never return the link in the API response — that would let anyone reset
      // any account. If email isn't configured, sendResetEmail logs it server-side.
    }
    return res.json(generic);
  } catch (error) {
    console.error('[forgot-password]', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Complete a reset using the token from the email link.
app.post('/api/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and new password are required' });
    if (password.length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters' });
    const user = await User.findOne({
      resetToken: hashToken(token),
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });

    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();
    res.json({ message: 'Password updated. You can now log in with your new password.' });
  } catch (error) {
    console.error('[reset-password]', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// --------------------------
// Support tickets
// --------------------------
app.post('/api/support/tickets', sensitiveLimiter, auth, async (req, res) => {
  try {
    const { subject, message } = req.body;
    if (!subject || !message) return res.status(400).json({ message: 'Subject and message are required' });
    const ticket = await SupportTicket.create({
      userId: req.user._id,
      name: req.user.name,
      email: req.user.email,
      subject: subject.toString().slice(0, 150),
      message: message.toString().slice(0, 4000),
    });
    // Notify superadmins of the new ticket (in-app).
    const admins = await User.find({ role: 'superadmin' }, { _id: 1 }).lean();
    await Promise.all(admins.map(a => createNotification(a._id, {
      type: 'ticket', title: 'New support ticket',
      message: `${req.user.name}: ${ticket.subject}`, link: '/admin',
    })));
    res.status(201).json(ticket);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// A user's own tickets
app.get('/api/support/tickets', auth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Superadmin: all tickets
app.get('/api/admin/tickets', auth, superAdminAuth, async (req, res) => {
  try {
    const tickets = await SupportTicket.find({}).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Superadmin: update ticket status
app.patch('/api/admin/tickets/:id', auth, superAdminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['open', 'resolved'].includes(status)) return res.status(400).json({ message: 'Invalid status' });
    const before = await SupportTicket.findById(req.params.id);
    if (!before) return res.status(404).json({ message: 'Ticket not found' });
    before.status = status;
    await before.save();
    // App alert to the ticket owner when it's resolved.
    if (status === 'resolved') {
      await createNotification(before.userId, {
        type: 'success', title: 'Your support ticket was resolved',
        message: `"${before.subject}" has been marked resolved.`, link: '/support',
      });
    }
    res.json(before);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Notifications (in-app alerts)
// --------------------------
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const items = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
    const unread = await Notification.countDocuments({ userId: req.user._id, read: false });
    res.json({ items, unread });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.patch('/api/notifications/:id/read', auth, async (req, res) => {
  try {
    await Notification.updateOne({ _id: req.params.id, userId: req.user._id }, { read: true });
    res.json({ message: 'ok' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/notifications/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
    res.json({ message: 'ok' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/notifications/:id', auth, async (req, res) => {
  try {
    await Notification.deleteOne({ _id: req.params.id, userId: req.user._id });
    res.json({ message: 'ok' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Transactions
app.get('/api/transactions', auth, async (req, res) => {
  try {
    const { month, bank, category, type, q: search, sort, order } = req.query;
    const query = { userId: req.user._id };
    if (/^\d{4}-\d{2}$/.test(month || '')) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      query.date = { $gte: start, $lt: end };
    }
    if (bank) query.bank = bank;
    if (category) query.category = category;
    if (type === 'income' || type === 'expense') query.type = type;
    if (search) query.description = { $regex: search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const sortField = sort === 'amount' ? 'amount' : 'date';
    const sortOrder = order === 'asc' ? 1 : -1;
    const transactions = await Transaction.find(query).sort({ [sortField]: sortOrder });
    res.json(transactions);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/transactions', auth, async (req, res) => {
  const { date, description, amount, category, type } = req.body;
  if (!date || !description || !amount || !category || !type) return res.status(400).json({ message: 'All fields required' });
  const transaction = new Transaction({ userId: req.user._id, date: new Date(date), description: description.trim(), amount: type === 'expense' ? -Math.abs(amount) : Math.abs(amount), category: category.trim(), type });
  await transaction.save();
  await applySavingsRule(req.user._id, transaction.amount, transaction.type);
  if (transaction.type === 'expense') {
    checkBudgetAlert(req.user._id, transaction.category, new Date(transaction.date).toISOString().slice(0, 7));
  }
  res.status(201).json(transaction);
});
// Edit a transaction (also teaches the categorizer when the category changes).
app.put('/api/transactions/:id', auth, async (req, res) => {
  try {
    const txn = await Transaction.findOne({ _id: req.params.id, userId: req.user._id });
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    const { date, description, amount, category, type } = req.body;
    const categoryChanged = category !== undefined && category.trim() !== txn.category;
    if (date !== undefined) txn.date = new Date(date);
    if (description !== undefined) txn.description = description.trim();
    if (type !== undefined) txn.type = type;
    if (category !== undefined) txn.category = category.trim();
    const newType = type !== undefined ? type : txn.type;
    if (amount !== undefined) {
      const a = Math.abs(parseFloat(amount));
      txn.amount = newType === 'expense' ? -a : a;
    } else if (type !== undefined) {
      // Type flipped but amount unchanged — fix the sign.
      const a = Math.abs(txn.amount);
      txn.amount = newType === 'expense' ? -a : a;
    }
    await txn.save();
    if (categoryChanged) await learnCategories(req.user._id, [{ description: txn.description, category: txn.category }]);
    res.json(txn);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Batch delete by id list.
app.post('/api/transactions/batch-delete', auth, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'No transactions selected' });
    const r = await Transaction.deleteMany({ _id: { $in: ids }, userId: req.user._id });
    res.json({ message: `Deleted ${r.deletedCount} transaction(s)`, count: r.deletedCount });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Delete an entire imported statement (one upload = one importBatch).
app.delete('/api/transactions/batch/:batchId', auth, async (req, res) => {
  try {
    const r = await Transaction.deleteMany({ userId: req.user._id, importBatch: req.params.batchId });
    res.json({ message: `Deleted ${r.deletedCount} transaction(s)`, count: r.deletedCount });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
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
app.post('/api/upload-statement', auth, uploadSingle, async (req, res) => {
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

    // Bank detected from the statement text (attached by the parser); user confirms it.
    const detectedBank = (transactions && transactions.bank) || '';

    // Apply categories the user has taught the app from previous corrections.
    transactions = await applyLearnedCategories(req.user._id, transactions);

    const existing = await Transaction.find({ userId: req.user._id }, { date: 1, amount: 1, description: 1 }).lean();
    const existingKeys = new Set(existing.map(t => `${new Date(t.date).toISOString().split('T')[0]}|${Math.abs(t.amount)}|${t.description}`));
    const tagged = transactions.map(t => ({ ...t, duplicate: existingKeys.has(`${t.date}|${t.amount}|${t.description}`) }));
    const dupCount = tagged.filter(t => t.duplicate).length;
    return res.json({
      transactions: tagged,
      meta: { totalFound: tagged.length, duplicateCount: dupCount, detectedBank, warnings: dupCount > 0 ? [`${dupCount} transaction(s) already exist and are pre‑marked.`] : [] },
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
    const { transactions, bank } = req.body;
    if (!Array.isArray(transactions) || transactions.length === 0) return res.status(400).json({ message: 'No transactions to import' });
    const valid = transactions.filter(t => t.date && t.amount && t.description && t.type);
    if (valid.length === 0) return res.status(400).json({ message: 'All transactions are missing required fields' });
    // Each upload becomes one deletable group (importBatch), tagged with its bank.
    const importBatch = new mongoose.Types.ObjectId().toString();
    const importedAt = new Date();
    const bankLabel = (bank || '').toString().trim();
    const docs = valid.map(t => new Transaction({
      userId: req.user._id, date: new Date(t.date), description: t.description,
      amount: t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount),
      category: t.category || 'Other', type: t.type,
      source: 'import', bank: bankLabel, importBatch, importedAt,
    }));
    const inserted = await Transaction.insertMany(docs, { ordered: false });
    // Learn description -> category from what the user chose to import (incl. any
    // edits they made on the review screen), so future imports auto-apply them.
    await learnCategories(req.user._id, valid);
    // Raise budget alerts for each distinct expense category+month just imported.
    const pairs = new Set(valid
      .filter(t => t.type === 'expense' && t.category)
      .map(t => `${t.category}|${new Date(t.date).toISOString().slice(0, 7)}`));
    for (const pair of pairs) {
      const [cat, m] = pair.split('|');
      checkBudgetAlert(req.user._id, cat, m);
    }
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

// Auto-detect likely subscriptions from the user's transactions: recurring
// charges to the same merchant, similar amount, across multiple months.
app.get('/api/subscriptions/detect', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const [txns, existing] = await Promise.all([
      Transaction.find({ userId, type: 'expense' }, { description: 1, amount: 1, date: 1, category: 1 }).lean(),
      Subscription.find({ userId }, { name: 1 }).lean(),
    ]);
    const existingKeys = new Set(existing.map(s => deriveCategoryKey(s.name)).filter(Boolean));

    // Group transactions by merchant signature.
    const groups = new Map();
    for (const t of txns) {
      const key = deriveCategoryKey(t.description);
      if (!key) continue;
      const g = groups.get(key) || { key, amounts: [], months: new Set(), descs: {}, category: t.category, lastDate: t.date };
      g.amounts.push(Math.abs(t.amount));
      g.months.add(new Date(t.date).toISOString().slice(0, 7));
      g.descs[t.description] = (g.descs[t.description] || 0) + 1;
      if (new Date(t.date) > new Date(g.lastDate)) g.lastDate = t.date;
      groups.set(key, g);
    }

    const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const candidates = [];
    for (const g of groups.values()) {
      if (existingKeys.has(g.key)) continue;          // already tracked
      if (g.months.size < 2) continue;                // must recur across months
      const med = median(g.amounts);
      if (med <= 0) continue;
      // Amounts should be roughly consistent (within 25% of the median).
      const consistent = g.amounts.filter(a => Math.abs(a - med) <= med * 0.25).length;
      if (consistent < 2) continue;
      // Representative name = most frequent original description, trimmed.
      const name = Object.entries(g.descs).sort((a, b) => b[1] - a[1])[0][0].slice(0, 40).trim();
      candidates.push({
        name,
        cost: Math.round(med),
        frequency: 'monthly',
        category: g.category || 'Subscriptions',
        occurrences: g.months.size,
        lastSeen: g.lastDate,
      });
    }
    candidates.sort((a, b) => b.occurrences - a.occurrences || b.cost - a.cost);
    res.json(candidates.slice(0, 12));
  } catch (e) {
    console.error('[subscriptions/detect]', e.message);
    res.status(500).json({ message: 'Server error' });
  }
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

// Pay a user-selected set of bills/debts from the wallet (Bills page checkboxes).
// Body: { billIds: [], debtIds: [] }. Source is the main wallet for now (paying
// from an external bank account comes with the bank integration).
app.post('/api/payments/pay-selected', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const { billIds = [], debtIds = [] } = req.body || {};
    if (billIds.length === 0 && debtIds.length === 0) {
      return res.status(400).json({ message: 'Select at least one item to pay' });
    }
    const wallet = await getOrCreateWallet(userId);
    let totalPaid = 0;
    const errors = [];
    const today = new Date();

    for (const id of debtIds) {
      const debt = await Debt.findOne({ _id: id, userId });
      if (!debt || debt.balance <= 0) continue;
      const amount = Math.min(debt.scheduledPayment?.amount || debt.minPayment, debt.balance);
      if (wallet.balance < amount) { errors.push(`Insufficient funds for debt: ${debt.name}`); continue; }
      wallet.balance -= amount;
      debt.balance = Math.max(0, debt.balance - amount);
      await debt.save();
      totalPaid += amount;
      await new WalletTransaction({ userId, type: 'withdrawal', amount, description: `Debt payment: ${debt.name}`, status: 'completed' }).save();
    }

    for (const id of billIds) {
      const bill = await RecurringBill.findOne({ _id: id, userId });
      if (!bill) continue;
      const amount = bill.amount;
      if (wallet.balance < amount) { errors.push(`Insufficient funds for bill: ${bill.name}`); continue; }
      wallet.balance -= amount;
      if (bill.frequency === 'yearly') bill.nextDue = new Date(bill.nextDue.getFullYear() + 1, bill.nextDue.getMonth(), bill.dueDate);
      else bill.nextDue = new Date(bill.nextDue.getFullYear(), bill.nextDue.getMonth() + 1, bill.dueDate);
      await bill.save();
      totalPaid += amount;
      await new WalletTransaction({ userId, type: 'withdrawal', amount, description: `Bill payment: ${bill.name}`, status: 'completed' }).save();
      await new Transaction({ userId, date: today, description: bill.name, amount: -Math.abs(amount), category: bill.category || 'Bills', type: 'expense' }).save();
    }

    await wallet.save();
    res.json({
      message: errors.length ? `Paid ${totalPaid} — some failed: ${errors.join('; ')}` : `Paid ${totalPaid} from wallet.`,
      totalPaid, errors, balance: wallet.balance,
    });
  } catch (err) {
    console.error('Pay selected error:', err);
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

// Email diagnostics (superadmin): verifies SMTP and sends a test mail, returning
// the real error so misconfiguration is obvious. Visit while logged in as admin:
//   GET /api/admin/test-email            -> sends to your own account email
//   GET /api/admin/test-email?to=x@y.com -> sends to a specific address
app.get('/api/admin/test-email', auth, superAdminAuth, async (req, res) => {
  const transport = brevoConfigured() ? 'brevo-api' : (smtpConfigured() ? 'smtp' : 'none');
  const diag = {
    transport, // which path will actually be used
    BREVO_API_KEY_set: brevoConfigured(),
    EMAIL_USER_set: !!process.env.EMAIL_USER,
    EMAIL_PASS_set: !!process.env.EMAIL_PASS,
    EMAIL_PASS_length: (process.env.EMAIL_PASS || '').replace(/\s+/g, '').length, // app passwords are 16
    sender: senderEmail() || null,
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 587,
    from: emailConfigured() ? mailFrom() : null,
  };
  if (!emailConfigured()) return res.status(400).json({ ok: false, message: 'No email transport configured. Set BREVO_API_KEY (recommended) or EMAIL_USER/EMAIL_PASS.', diag });
  if (brevoConfigured() && !senderEmail()) {
    return res.status(400).json({ ok: false, message: 'BREVO_API_KEY is set but no sender address. Set EMAIL_FROM_ADDRESS (or EMAIL_USER) to your Brevo-verified sender.', diag });
  }
  try {
    const to = (req.query.to || req.user.email);
    await sendEmail({ to, subject: `FinPilot email test ✅ (${transport})`, text: 'If you can read this, email sending works.' });
    res.json({ ok: true, message: `Test email sent to ${to} via ${transport}. Check inbox and spam.`, diag });
  } catch (err) {
    // Brevo errors carry the real reason in the HTTP response body.
    const apiMsg = err.response?.data?.message || err.response?.data?.code;
    res.status(502).json({ ok: false, message: apiMsg || err.message, code: err.code || err.response?.status || err.responseCode || null, diag });
  }
});
// Idempotent: with the correct setup key, creates a superadmin — or, if the email
// already exists, promotes that account and resets its password to the one given.
app.post('/api/admin/setup', authLimiter, async (req, res) => {
  try {
    // Disabled by default. Because the original setup key leaked via git history,
    // the endpoint stays off unless ALLOW_ADMIN_SETUP=true is set in the env
    // (set it temporarily only when you need to create/promote an admin).
    if (process.env.ALLOW_ADMIN_SETUP !== 'true') {
      return res.status(403).json({ message: 'Admin setup is disabled.' });
    }
    const { setupKey, name, email, password } = req.body;
    if (!process.env.ADMIN_SETUP_KEY || setupKey !== process.env.ADMIN_SETUP_KEY) {
      return res.status(403).json({ message: 'Invalid setup key' });
    }
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });
    if (password.length < 6) return res.status(400).json({ message: 'password must be at least 6 characters' });
    const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) {
      existing.role = 'superadmin';
      existing.password = hashedPassword;
      existing.isActive = true;
      await existing.save();
      return res.json({ message: 'Existing account promoted to superadmin', email: existing.email });
    }
    const superAdmin = new User({ name: name || 'Admin', email: email.toLowerCase().trim(), password: hashedPassword, role: 'superadmin' });
    await superAdmin.save();
    res.status(201).json({ message: 'Superadmin created', email: superAdmin.email });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Bank & Profile routes
// --------------------------
// Bank list is effectively static — cache it in memory for 24h to avoid hitting
// Paystack on every page load.
let banksCache = { data: null, ts: 0 };
app.get('/api/banks', auth, async (req, res) => {
  try {
    if (banksCache.data && Date.now() - banksCache.ts < 24 * 60 * 60 * 1000) {
      return res.json(banksCache.data);
    }
    const response = await axios.get('https://api.paystack.co/bank', {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });
    banksCache = { data: response.data.data, ts: Date.now() };
    res.json(response.data.data);
  } catch (err) {
    console.error('Error fetching banks from Paystack:', err.message);
    if (banksCache.data) return res.json(banksCache.data); // serve stale on failure
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

// --------------------------
// Bank linking via Mono (auto-import). Keys-pending: inert until MONO_* env vars
// are set. Public key is exposed to the frontend for the Connect widget; the
// secret key is used server-side to exchange the auth code and pull transactions.
// --------------------------
const MONO_BASE = 'https://api.withmono.com/v2';
const monoConfigured = () => !!(process.env.MONO_SECRET_KEY && process.env.MONO_PUBLIC_KEY);
const monoHeaders = () => ({ 'mono-sec-key': process.env.MONO_SECRET_KEY, 'Content-Type': 'application/json' });

// Config for the frontend widget + current link status.
app.get('/api/bank/mono-config', auth, async (req, res) => {
  const lb = req.user.linkedBank || {};
  res.json({
    enabled: monoConfigured(),
    publicKey: process.env.MONO_PUBLIC_KEY || '',
    connected: !!lb.accountId,
    institution: lb.institution || '',
    accountName: lb.accountName || '',
    lastSynced: lb.lastSynced || null,
  });
});

// Exchange the Mono Connect auth code for an account id and link it.
app.post('/api/bank/connect', auth, async (req, res) => {
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ message: 'Missing authorization code' });
    const exch = await axios.post(`${MONO_BASE}/accounts/auth`, { code }, { headers: monoHeaders(), timeout: 20000 });
    const accountId = exch.data?.data?.id || exch.data?.id;
    if (!accountId) return res.status(502).json({ message: 'Could not link account (no id returned)' });
    // Pull account metadata (bank name + account holder) for display.
    let institution = '', accountName = '';
    try {
      const info = await axios.get(`${MONO_BASE}/accounts/${accountId}`, { headers: monoHeaders(), timeout: 20000 });
      const acct = info.data?.data?.account || info.data?.account || info.data?.data || {};
      institution = acct.institution?.name || '';
      accountName = acct.name || '';
    } catch { /* metadata is best-effort */ }
    req.user.linkedBank = { provider: 'mono', accountId, institution, accountName, lastSynced: null };
    await req.user.save();
    res.json({ connected: true, institution, accountName });
  } catch (err) {
    console.error('[bank/connect]', err.response?.data || err.message);
    res.status(502).json({ message: err.response?.data?.message || 'Could not link your bank. Try again.' });
  }
});

// Pull transactions from the linked account and import new ones.
app.post('/api/bank/sync', auth, async (req, res) => {
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  const lb = req.user.linkedBank || {};
  if (!lb.accountId) return res.status(400).json({ message: 'No bank account linked' });
  try {
    const r = await axios.get(`${MONO_BASE}/accounts/${lb.accountId}/transactions`, {
      headers: monoHeaders(), params: { paginate: false }, timeout: 30000,
    });
    const raw = r.data?.data || r.data?.transactions || [];
    // Map Mono txns → our model. Mono amounts are in kobo; debit=expense, credit=income.
    const mapped = raw.map((t) => {
      const amt = Math.abs(Number(t.amount) || 0) / 100;
      const type = (t.type === 'credit') ? 'income' : 'expense';
      const description = (t.narration || t.description || 'Bank transaction').toString().trim();
      const date = new Date(t.date).toISOString().slice(0, 10);
      return { date, description, amount: amt, type, category: categorizeTransaction(description, type) };
    }).filter((t) => t.amount > 0 && t.date);

    // Dedupe against what the user already has.
    const existing = await Transaction.find({ userId: req.user._id }, { date: 1, amount: 1, description: 1 }).lean();
    const seen = new Set(existing.map((t) => `${new Date(t.date).toISOString().slice(0, 10)}|${Math.abs(t.amount)}|${t.description}`));
    const importBatch = new mongoose.Types.ObjectId().toString();
    const importedAt = new Date();
    const docs = mapped
      .filter((t) => !seen.has(`${t.date}|${t.amount}|${t.description}`))
      .map((t) => new Transaction({
        userId: req.user._id, date: new Date(t.date), description: t.description,
        amount: t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount),
        category: t.category, type: t.type, source: 'import',
        bank: lb.institution || 'Linked bank', importBatch, importedAt,
      }));
    if (docs.length) await Transaction.insertMany(docs, { ordered: false });
    req.user.linkedBank.lastSynced = importedAt;
    await req.user.save();
    res.json({ imported: docs.length, total: mapped.length, lastSynced: importedAt });
  } catch (err) {
    console.error('[bank/sync]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not sync transactions. Try again.' });
  }
});

// Unlink the bank account.
app.delete('/api/bank/unlink', auth, async (req, res) => {
  try {
    const id = req.user.linkedBank?.accountId;
    if (id && monoConfigured()) {
      axios.post(`${MONO_BASE}/accounts/${id}/unlink`, {}, { headers: monoHeaders(), timeout: 15000 }).catch(() => {});
    }
    req.user.linkedBank = { provider: '', accountId: '', institution: '', accountName: '', lastSynced: null };
    await req.user.save();
    res.json({ connected: false });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
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