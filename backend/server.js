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
const Anthropic = require('@anthropic-ai/sdk');
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

// The "from" identity. Brevo requires a VERIFIED sender. TEMPORARY: we send from
// jaysonoketa@gmail.com (already verified in Brevo) until automonie.com is
// authenticated in Brevo — then set EMAIL_FROM_ADDRESS=superadmin@automonie.com
// (or change the default here). EMAIL_USER is also the SMTP login for the dev fallback.
const senderEmail = () => (process.env.EMAIL_FROM_ADDRESS || process.env.EMAIL_USER || 'jaysonoketa@gmail.com').trim();
const senderName = () => process.env.EMAIL_FROM_NAME || 'Automonie';
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
    subject: 'Reset your Automonie password',
    text: `Reset your password using this link (valid for 1 hour):\n\n${link}\n\nIf you didn't request this, ignore this email.`,
    html: `<p>Reset your Automonie password using the link below (valid for 1 hour):</p>
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

app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // raw body kept for webhook signature checks

// Strip MongoDB operator keys ($..., or keys with dots) from request body/query
// so user input can't inject query operators (e.g. { email: { $ne: null } }).
function stripMongoOperators(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) delete obj[key];
    else stripMongoOperators(obj[key], depth + 1);
  }
}
app.use((req, _res, next) => {
  stripMongoOperators(req.body);
  stripMongoOperators(req.query);
  next();
});

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

// AI assistant calls cost money per request — keep the per-user volume sane.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'You are sending messages too quickly. Please wait a moment.' },
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
  googleId: { type: String },   // set when the account is linked to Google sign-in
  role: { type: String, enum: ['user', 'superadmin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  // Subscription tier. 'pro' unlocks the AI assistant + advanced features (Paystack
  // billing wires `plan`/`planExpiry` later; for now the AI assistant is open to all).
  plan:       { type: String, enum: ['free', 'pro'], default: 'free' },
  planExpiry: { type: Date },
  // Profile / onboarding
  phone:         { type: String, default: '' },
  monthlyIncome: { type: Number, default: 0 },
  primaryGoal:   { type: String, default: '' },
  emailAlerts:   { type: Boolean, default: true },
  onboarded:     { type: Boolean, default: false },
  lastLogin:     { type: Date },
  // Email-based 2-step verification (#21/#22).
  twoFactorEnabled: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },   // new accounts verify their email via a code
  loginOtpHash:     { type: String },
  loginOtpExpiry:   { type: Date },
  // Tokens issued before this time are rejected (used by "log out of all devices").
  sessionsValidFrom: { type: Date },
  // Legacy single linked account (migrated into linkedBanks[] on next connect/sync).
  linkedBank: {
    provider:    { type: String, default: '' },   // 'mono'
    accountId:   { type: String, default: '' },
    institution: { type: String, default: '' },    // bank name
    accountName: { type: String, default: '' },
    lastSynced:  { type: Date },
  },
  // Multiple linked bank accounts via Mono (auto-import).
  linkedBanks: [{
    provider:    { type: String, default: 'mono' },
    accountId:   { type: String, default: '' },
    institution: { type: String, default: '' },
    accountName: { type: String, default: '' },
    lastSynced:  { type: Date },
  }],
  bankDetails: {
    bankName:        { type: String, default: '' },
    bankCode:        { type: String, default: '' },
    accountNumber:   { type: String, default: '' },
    accountName:     { type: String, default: '' },
    verified:        { type: Boolean, default: false }
  },
  // Dedicated NGN account for funding the wallet (Paystack DVA, or a 'dummy'
  // placeholder until Paystack DVA is activated). Deposits to it credit the wallet.
  virtualAccount: {
    provider:      { type: String, default: '' },   // 'paystack' | 'dummy'
    customerCode:  { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    accountName:   { type: String, default: '' },
    bankName:      { type: String, default: '' },
    active:        { type: Boolean, default: false },
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
  // Reusable Paystack card authorization for one-tap wallet top-ups (quick-add).
  // We never store card numbers — only Paystack's authorization_code (a token) and
  // display-safe metadata. Charged server-side via /transaction/charge_authorization.
  fundingCard: {
    authorizationCode: { type: String, default: '' },
    last4:             { type: String, default: '' },
    expMonth:          { type: String, default: '' },
    expYear:           { type: String, default: '' },
    bank:              { type: String, default: '' },
    cardType:          { type: String, default: '' },
    active:            { type: Boolean, default: false },
  },
  resetToken: String,
  resetTokenExpiry: Date,
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

// Sign-ups are held here until the email OTP is confirmed — the real User is
// only created on verification, so an unverified email never becomes an account.
// The TTL index auto-purges abandoned sign-ups after 30 minutes.
const pendingRegistrationSchema = new mongoose.Schema({
  email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:      { type: String, required: true },
  phone:     { type: String, default: '' },
  password:  { type: String, required: true },   // bcrypt hash
  otpHash:   { type: String, required: true },
  otpExpiry: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 30 },
});
const PendingRegistration = mongoose.model('PendingRegistration', pendingRegistrationSchema);

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
  // Savings plan: a locked goal can't be withdrawn before its deadline without
  // a 3% early-break fee. `locked` is the commitment; `deadline` is maturity.
  locked:   { type: Boolean, default: false },
  lockedAt: { type: Date },
  interestRate: { type: Number, default: 10 },  // annual % earned on a locked plan, paid at maturity
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
  // Optionally auto-pay down a debt instead of (or as well as) saving to a goal.
  targetDebtId: { type: mongoose.Schema.Types.ObjectId, ref: 'Debt', default: null },
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
        // Auto-pay down a linked debt as the amount is set aside.
        if (rule.targetDebtId) {
          const debt = await Debt.findOne({ _id: rule.targetDebtId, userId });
          if (debt) {
            debt.balance = Math.max(0, debt.balance - saveAmount);
            await debt.save();
          }
        }
        console.log(`✅ Auto‑saved ₦${saveAmount} for user ${userId}`);
      } else {
        // Not enough in the wallet to move to savings — tell the user instead of
        // failing silently. De-duped to once per day per user.
        const day = new Date().toISOString().slice(0, 10);
        const link = `savings_skip_${day}`;
        if (!(await Notification.findOne({ userId, link }))) {
          await createNotification(userId, {
            type: 'info', title: 'Auto-save skipped',
            message: `We couldn't move ₦${Math.round(saveAmount).toLocaleString()} to savings — your wallet balance is low. Top up to keep saving.`,
            link,
          });
        }
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
    const cleanEmail = email.toLowerCase().trim();
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) return res.status(400).json({ message: 'User already exists' });
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // The account is created ONLY after the email code is confirmed. Until then
    // the sign-up lives in PendingRegistration (auto-expiring); verify-login-otp
    // promotes it to a real User. If email isn't configured, fall back to
    // creating the account immediately so sign-up still works.
    if (emailConfigured()) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      await PendingRegistration.findOneAndUpdate(
        { email: cleanEmail },
        {
          email: cleanEmail, name, phone: cleanPhone.slice(0, 20), password: hashedPassword,
          otpHash: hashToken(otp), otpExpiry: new Date(Date.now() + 15 * 60 * 1000), createdAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      sendEmail({
        to: cleanEmail,
        subject: 'Verify your Automonie email',
        text: `Welcome to Automonie! Your verification code is ${otp}. It expires in 15 minutes.`,
        html: `<p>Welcome to Automonie! Your verification code is <strong style="font-size:20px">${otp}</strong>.</p><p>It expires in 15 minutes.</p>`,
      }).catch((e) => console.error('[register-verify] email failed:', e.message));
      return res.status(201).json({ otpRequired: true, email: cleanEmail });
    }
    const user = new User({ name, email: cleanEmail, password: hashedPassword, phone: cleanPhone.slice(0, 20), emailVerified: true });
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

    // New accounts must verify their email before signing in (we email a fresh
    // code and reuse the OTP verify flow). Existing accounts predate this field
    // (undefined) and are treated as already verified.
    if (user.emailVerified === false) {
      if (emailConfigured()) {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        user.loginOtpHash = hashToken(otp);
        user.loginOtpExpiry = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();
        sendEmail({
          to: user.email,
          subject: 'Verify your Automonie email',
          text: `Your verification code is ${otp}. It expires in 15 minutes.`,
          html: `<p>Your verification code is <strong style="font-size:20px">${otp}</strong>.</p><p>It expires in 15 minutes.</p>`,
        }).catch((e) => console.error('[login-verify] email failed:', e.message));
        return res.json({ otpRequired: true, email: user.email });
      }
      user.emailVerified = true; // email not configured → don't lock them out
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
    const cleanEmail = email.toLowerCase().trim();
    const code = String(otp).trim();

    const user = await User.findOne({ email: cleanEmail });
    if (user) {
      // Existing account: 2FA login, or a legacy unverified account confirming.
      if (!user.loginOtpHash || !user.loginOtpExpiry) return res.status(400).json({ message: 'No pending verification. Please sign in again.' });
      if (user.loginOtpExpiry < new Date()) return res.status(400).json({ message: 'Code expired. Please sign in again.' });
      if (user.loginOtpHash !== hashToken(code)) return res.status(400).json({ message: 'Incorrect code' });
      user.loginOtpHash = undefined;
      user.loginOtpExpiry = undefined;
      user.emailVerified = true;
      user.lastLogin = new Date();
      await user.save();
      const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
      return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, onboarded: user.onboarded } });
    }

    // No account yet → this code confirms a sign-up. Promote the pending record
    // into a real User now (this is where account creation actually happens).
    const pending = await PendingRegistration.findOne({ email: cleanEmail });
    if (!pending) return res.status(400).json({ message: 'No pending verification. Please sign in again.' });
    if (pending.otpExpiry < new Date()) return res.status(400).json({ message: 'Code expired. Please sign up again.' });
    if (pending.otpHash !== hashToken(code)) return res.status(400).json({ message: 'Incorrect code' });
    const created = new User({ name: pending.name, email: pending.email, password: pending.password, phone: pending.phone, emailVerified: true, lastLogin: new Date() });
    await created.save();
    await PendingRegistration.deleteOne({ _id: pending._id });
    const token = jwt.sign({ userId: created._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: created._id, name: created.name, email: created.email, role: created.role, onboarded: created.onboarded } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Resend the email-verification code for an unverified account.
app.post('/api/resend-verification', authLimiter, async (req, res) => {
  try {
    const cleanEmail = (req.body.email || '').toLowerCase().trim();
    if (cleanEmail && emailConfigured()) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiry = new Date(Date.now() + 15 * 60 * 1000);
      const user = await User.findOne({ email: cleanEmail });
      if (user && user.emailVerified === false) {
        user.loginOtpHash = hashToken(otp);
        user.loginOtpExpiry = expiry;
        await user.save();
        sendEmail({ to: cleanEmail, subject: 'Verify your Automonie email', text: `Your verification code is ${otp}. It expires in 15 minutes.`, html: `<p>Your verification code is <strong style="font-size:20px">${otp}</strong>.</p><p>It expires in 15 minutes.</p>` }).catch(() => {});
      } else if (!user) {
        const pending = await PendingRegistration.findOne({ email: cleanEmail });
        if (pending) {
          pending.otpHash = hashToken(otp);
          pending.otpExpiry = expiry;
          await pending.save();
          sendEmail({ to: cleanEmail, subject: 'Verify your Automonie email', text: `Your verification code is ${otp}. It expires in 15 minutes.`, html: `<p>Your verification code is <strong style="font-size:20px">${otp}</strong>.</p><p>It expires in 15 minutes.</p>` }).catch(() => {});
        }
      }
    }
    res.json({ message: 'If that account needs verification, a new code has been sent.' });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Google sign-in (keys-pending). Verifies a Google ID token, then finds or
// creates the matching user and issues our JWT. Configure by setting
// GOOGLE_CLIENT_IDS (comma-separated web/android/ios client IDs) on the server.
const { OAuth2Client } = require('google-auth-library');
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const googleClient = new OAuth2Client();
app.post('/api/auth/google', authLimiter, async (req, res) => {
  try {
    if (GOOGLE_CLIENT_IDS.length === 0) {
      return res.status(503).json({ message: 'Google sign-in is not configured yet.' });
    }
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ message: 'Missing Google credential' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
      payload = ticket.getPayload();
    } catch (e) {
      return res.status(401).json({ message: 'Could not verify your Google sign-in. Try again.' });
    }
    if (!payload || !payload.email || !payload.email_verified) {
      return res.status(401).json({ message: 'Your Google email could not be verified.' });
    }

    const email = payload.email.toLowerCase().trim();
    let user = await User.findOne({ email });
    if (!user) {
      const randomPw = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), await bcrypt.genSalt(10));
      user = new User({
        name: payload.name || email.split('@')[0],
        email,
        password: randomPw,
        googleId: payload.sub,
      });
    } else if (!user.googleId) {
      user.googleId = payload.sub;
    }
    user.lastLogin = new Date();
    await user.save();

    // Google itself is the strong factor, so we skip our email OTP here.
    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, onboarded: user.onboarded } });
  } catch (error) {
    console.error('[google-auth]', error.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// Current user's profile
app.get('/api/me', auth, async (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email, role: u.role,
    plan: u.plan || 'free',
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
  const { type, value, active, targetGoalId, targetDebtId } = req.body;
  if (!type || !value) return res.status(400).json({ message: 'Type and value required' });
  if (type === 'fixed' && value <= 0) return res.status(400).json({ message: 'Amount must be greater than 0' });
  if (type === 'roundup' && value <= 0) return res.status(400).json({ message: 'Round‑up step must be >0' });
  await SavingsRule.deleteOne({ userId: req.user._id });
  const rule = new SavingsRule({ userId: req.user._id, type, value, active: active !== false, targetGoalId: targetGoalId || null, targetDebtId: targetDebtId || null });
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

// Turn a goal into a locked Savings Plan: committed until its deadline.
app.post('/api/goals/:id/lock', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    if (new Date(goal.deadline) <= new Date()) {
      return res.status(400).json({ message: 'Pick a future deadline before locking this goal.' });
    }
    goal.locked = true;
    goal.lockedAt = new Date();
    goal.interestRate = PLAN_INTEREST_RATE;
    await goal.save();
    res.json(goal);
  } catch (error) {
    console.error('Goal lock error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Withdraw a goal's balance back to the wallet. If it's a locked plan pulled
// before its deadline, a 3% early-break fee is deducted; matured/unlocked goals
// withdraw in full.
const EARLY_BREAK_FEE = 0.03;
const PLAN_INTEREST_RATE = 10; // % per annum on locked savings plans
app.post('/api/goals/:id/withdraw', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });

    const amount = goal.current;
    if (amount <= 0) return res.status(400).json({ message: 'This goal has no funds to withdraw.' });

    const matured = new Date() >= new Date(goal.deadline);
    const early = goal.locked && !matured;
    const fee = early ? Math.round(amount * EARLY_BREAK_FEE * 100) / 100 : 0;

    // A matured locked plan earns interest for its full locked term (lockedAt →
    // deadline). Breaking early forfeits interest (and pays the 3% fee).
    let interest = 0;
    if (matured && goal.locked && goal.lockedAt) {
      const rate = (goal.interestRate ?? PLAN_INTEREST_RATE) / 100;
      const years = (new Date(goal.deadline) - new Date(goal.lockedAt)) / (365.25 * 24 * 60 * 60 * 1000);
      interest = Math.round(amount * rate * Math.max(0, years) * 100) / 100;
    }
    const net = Math.round((amount - fee + interest) * 100) / 100;

    const wallet = await getOrCreateWallet(req.user._id);
    wallet.balance += net;
    await wallet.save();

    goal.current = 0;
    goal.locked = false;
    goal.lockedAt = undefined;
    await goal.save();

    await new WalletTransaction({
      userId: req.user._id,
      type: 'deposit',
      amount: net,
      description: early
        ? `Early break of locked plan: ${goal.name} (3% fee ₦${fee.toLocaleString()})`
        : interest > 0
          ? `Matured plan: ${goal.name} (+₦${interest.toLocaleString()} interest)`
          : `Withdrawal from goal: ${goal.name}`,
      status: 'completed',
    }).save();

    res.json({ goal, withdrawn: net, fee, interest, early, newBalance: wallet.balance });
  } catch (error) {
    console.error('Goal withdraw error:', error);
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
// Advance a bill's nextDue to the next occurrence strictly after `from`. Loops so
// several missed periods don't leave it stuck in the past (but never double-charges,
// because a paid/skipped bill is only processed once per sweep).
function advanceBillDue(bill, from = new Date()) {
  let next = new Date(bill.nextDue);
  do {
    next = bill.frequency === 'yearly'
      ? new Date(next.getFullYear() + 1, next.getMonth(), bill.dueDate)
      : new Date(next.getFullYear(), next.getMonth() + 1, bill.dueDate);
  } while (next <= from);
  bill.nextDue = next;
}

// Process a single due bill: auto-debit the wallet (autoPay) or leave a reminder.
// On success also records an expense Transaction so autopay shows in insights/budgets.
async function processDueBill(bill) {
  const userId = bill.userId;
  if (bill.autoPay) {
    const wallet = await getOrCreateWallet(userId);
    if (wallet.balance >= bill.amount) {
      wallet.balance -= bill.amount;
      await wallet.save();
      await new WalletTransaction({ userId, type: 'withdrawal', amount: bill.amount, description: `Auto-pay: ${bill.name}`, status: 'completed' }).save();
      await new Transaction({ userId, date: new Date(), description: `Auto-pay: ${bill.name}`, amount: -Math.abs(bill.amount), category: bill.category || 'Bills', type: 'expense' }).save();
      await createNotification(userId, { type: 'success', title: 'Bill paid', message: `₦${bill.amount.toLocaleString()} paid for ${bill.name}.` });
      advanceBillDue(bill);
      await bill.save();
      return { bill: bill.name, status: 'paid', amount: bill.amount };
    }
    // Not enough funds — notify (deduped per bill per day) and retry next sweep by
    // leaving nextDue untouched.
    const link = `autopay_fail_${bill._id}_${new Date().toISOString().slice(0, 10)}`;
    if (!(await Notification.findOne({ userId, link }))) {
      await createNotification(userId, { type: 'danger', title: 'Autopay failed', message: `Couldn't pay ${bill.name} (₦${bill.amount.toLocaleString()}) — your wallet is low. Top up to pay it.`, link });
    }
    return { bill: bill.name, status: 'insufficient_funds', amount: bill.amount };
  }
  // Reminder-only bill.
  const link = `bill_due_${bill._id}_${new Date().toISOString().slice(0, 10)}`;
  if (!(await Notification.findOne({ userId, link }))) {
    await createNotification(userId, { type: 'info', title: 'Bill due', message: `${bill.name} (₦${bill.amount.toLocaleString()}) is due.`, link });
  }
  advanceBillDue(bill);
  await bill.save();
  return { bill: bill.name, status: 'reminder', amount: bill.amount };
}

// Manual trigger for one user (called on app launch). Matches everything due or
// overdue (nextDue <= end of today), not just bills due exactly today.
app.post('/api/bills/process', auth, async (req, res) => {
  try {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const dueBills = await RecurringBill.find({ userId: req.user._id, status: 'active', nextDue: { $lte: endOfDay } });
    const results = [];
    for (const bill of dueBills) results.push(await processDueBill(bill));
    res.json({ processed: dueBills.length, results });
  } catch (error) { console.error('[bills/process]', error.message); res.status(500).json({ message: 'Server error' }); }
});

// Server-side daily sweep across ALL users so autopay runs even if nobody opens
// the app. Dependency-free: interval + a short post-boot kick.
async function sweepAllDueBills() {
  try {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const dueBills = await RecurringBill.find({ status: 'active', nextDue: { $lte: endOfDay } });
    for (const bill of dueBills) {
      try { await processDueBill(bill); } catch (e) { console.error('[autopay sweep] bill', String(bill._id), e.message); }
    }
    if (dueBills.length) console.log(`[autopay sweep] processed ${dueBills.length} due bill(s)`);
  } catch (e) { console.error('[autopay sweep]', e.message); }
}
setInterval(sweepAllDueBills, 24 * 60 * 60 * 1000);
setTimeout(sweepAllDueBills, 30 * 1000);

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
    await sendEmail({ to, subject: `Automonie email test ✅ (${transport})`, text: 'If you can read this, email sending works.' });
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

// --------------------------
// Wallet funding via a dedicated NGN virtual account (Paystack DVA). Until DVA
// is activated, a 'dummy' placeholder account is issued so the UI works; real
// deposits begin once PAYSTACK_SECRET_KEY + DVA are live.
// --------------------------
const paystackConfigured = () => !!process.env.PAYSTACK_SECRET_KEY;
const paystackHeaders = () => ({ Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' });
const dummyAccountNumber = (userId) => {
  let n = '';
  for (const c of userId.toString().slice(-9)) n += (parseInt(c, 16) % 10).toString();
  return ('90' + n).slice(0, 10).padEnd(10, '0');
};

app.get('/api/wallet/virtual-account', auth, async (req, res) => {
  try {
    const va = req.user.virtualAccount;
    if (va && va.accountNumber) {
      const o = va.toObject ? va.toObject() : va;
      return res.json({ ...o, dummy: o.provider === 'dummy' });
    }
    if (!paystackConfigured()) {
      req.user.virtualAccount = {
        provider: 'dummy', customerCode: '',
        accountNumber: dummyAccountNumber(req.user._id),
        accountName: req.user.name || 'Automonie User',
        bankName: 'Test Bank (activation pending)', active: false,
      };
      await req.user.save();
      return res.json({ ...req.user.virtualAccount.toObject(), dummy: true });
    }
    const [first, ...rest] = (req.user.name || 'Automonie User').split(' ');
    const cust = await axios.post('https://api.paystack.co/customer',
      { email: req.user.email, first_name: first, last_name: rest.join(' ') || first, phone: req.user.phone || undefined },
      { headers: paystackHeaders(), timeout: 20000 });
    const customerCode = cust.data?.data?.customer_code;
    const dva = await axios.post('https://api.paystack.co/dedicated_account',
      { customer: customerCode, preferred_bank: process.env.PAYSTACK_DVA_BANK || 'wema-bank' },
      { headers: paystackHeaders(), timeout: 20000 });
    const acct = dva.data?.data || {};
    req.user.virtualAccount = {
      provider: 'paystack', customerCode,
      accountNumber: acct.account_number || '',
      accountName: acct.account_name || req.user.name,
      bankName: acct.bank?.name || 'Wema Bank', active: true,
    };
    await req.user.save();
    res.json({ ...req.user.virtualAccount.toObject(), dummy: false });
  } catch (err) {
    console.error('[wallet/virtual-account]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not set up your funding account. Try again.' });
  }
});

// Paystack webhook — credits the wallet when money lands in a user's DVA.
app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.sendStatus(200);
    const crypto = require('crypto');
    const hash = crypto.createHmac('sha512', secret).update(req.rawBody || Buffer.from('')).digest('hex');
    if (hash !== req.headers['x-paystack-signature']) return res.sendStatus(401);
    const event = req.body;
    if (event?.event === 'charge.success') {
      const d = event.data || {};
      const customerCode = d.customer?.customer_code;
      let user = customerCode ? await User.findOne({ 'virtualAccount.customerCode': customerCode }) : null;
      if (!user && d.customer?.email) user = await User.findOne({ email: d.customer.email });
      // Idempotent on reference; credits wallet, stores the reusable card auth, notifies.
      if (user) await creditFromCharge(user, d);
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[paystack/webhook]', e.message);
    res.sendStatus(200);
  }
});

// --------------------------
// Quick-add: fund the wallet with a saved Paystack card.
// The first top-up runs a normal Paystack checkout to capture a reusable
// authorization; later top-ups charge that authorization in one tap. We never
// store card numbers — only Paystack's authorization_code token + safe metadata.
// --------------------------
const koboToNaira = (kobo) => Math.round(kobo) / 100;

// Credit the wallet for a completed Paystack charge and persist a reusable card
// authorization if present. Idempotent on reference. Shared by verify + webhook.
async function creditFromCharge(user, data) {
  const reference = data.reference;
  const amount = koboToNaira(data.amount || 0);
  if (!reference || amount <= 0) return null;
  if (await WalletTransaction.findOne({ reference })) return null; // already processed
  const wallet = await getOrCreateWallet(user._id);
  wallet.balance += amount;
  await wallet.save();
  const viaCard = (data.channel || '') === 'card';
  await new WalletTransaction({
    userId: user._id, type: 'deposit', amount, reference, status: 'completed',
    description: viaCard ? 'Wallet top-up (card)' : 'Bank transfer deposit',
  }).save();
  const authz = data.authorization;
  if (authz && authz.reusable && authz.authorization_code) {
    user.fundingCard = {
      authorizationCode: authz.authorization_code,
      last4: authz.last4 || '', expMonth: authz.exp_month || '', expYear: authz.exp_year || '',
      bank: authz.bank || '', cardType: authz.card_type || '', active: true,
    };
    await user.save();
  }
  await createNotification(user._id, { type: 'success', title: 'Wallet funded', message: `₦${amount.toLocaleString()} added to your wallet.` });
  return { balance: wallet.balance, amount };
}

// Start a checkout to add a card and fund the wallet the first time.
app.post('/api/wallet/fund/init', auth, async (req, res) => {
  try {
    if (!paystackConfigured()) return res.status(503).json({ message: 'Card funding is not available yet.' });
    const amount = Math.round(Number(req.body.amount));
    if (!amount || amount < 100) return res.status(400).json({ message: 'Enter an amount of at least ₦100.' });
    const r = await axios.post('https://api.paystack.co/transaction/initialize',
      { email: req.user.email, amount: amount * 100, metadata: { userId: req.user._id.toString(), purpose: 'wallet_fund' } },
      { headers: paystackHeaders(), timeout: 20000 });
    const d = r.data?.data || {};
    res.json({ authorization_url: d.authorization_url, access_code: d.access_code, reference: d.reference });
  } catch (err) {
    console.error('[wallet/fund/init]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not start card funding. Try again.' });
  }
});

// Confirm a checkout by reference (belt-and-suspenders alongside the webhook).
app.post('/api/wallet/fund/verify', auth, async (req, res) => {
  try {
    if (!paystackConfigured()) return res.status(503).json({ message: 'Card funding is not available yet.' });
    const reference = (req.body.reference || '').toString();
    if (!reference) return res.status(400).json({ message: 'reference is required' });
    const r = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: paystackHeaders(), timeout: 20000 });
    const d = r.data?.data || {};
    if (d.status !== 'success') return res.status(402).json({ message: 'Payment not completed.' });
    await creditFromCharge(req.user, d);
    const wallet = await getOrCreateWallet(req.user._id);
    res.json({ balance: wallet.balance });
  } catch (err) {
    console.error('[wallet/fund/verify]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not verify the payment.' });
  }
});

// One-tap top-up: charge the saved card authorization for a preset amount.
app.post('/api/wallet/fund/charge', auth, async (req, res) => {
  try {
    if (!paystackConfigured()) return res.status(503).json({ message: 'Card funding is not available yet.' });
    const card = req.user.fundingCard;
    if (!card || !card.active || !card.authorizationCode) return res.status(400).json({ message: 'No saved card. Add one first.' });
    const amount = Math.round(Number(req.body.amount));
    if (!amount || amount < 100) return res.status(400).json({ message: 'Enter an amount of at least ₦100.' });
    const r = await axios.post('https://api.paystack.co/transaction/charge_authorization',
      { email: req.user.email, amount: amount * 100, authorization_code: card.authorizationCode },
      { headers: paystackHeaders(), timeout: 20000 });
    const d = r.data?.data || {};
    if (d.status !== 'success') return res.status(402).json({ message: 'Card charge was declined.' });
    await creditFromCharge(req.user, d);
    const wallet = await getOrCreateWallet(req.user._id);
    res.json({ balance: wallet.balance, amount });
  } catch (err) {
    console.error('[wallet/fund/charge]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not charge your card. Try again.' });
  }
});

// Saved funding card summary / removal.
app.get('/api/wallet/card', auth, (req, res) => {
  const c = req.user.fundingCard;
  if (!c || !c.active || !c.last4) return res.json({ card: null });
  res.json({ card: { last4: c.last4, expMonth: c.expMonth, expYear: c.expYear, bank: c.bank, cardType: c.cardType } });
});
app.delete('/api/wallet/card', auth, async (req, res) => {
  req.user.fundingCard = { authorizationCode: '', last4: '', expMonth: '', expYear: '', bank: '', cardType: '', active: false };
  await req.user.save();
  res.json({ message: 'Card removed' });
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
// All of a user's linked accounts (falls back to the legacy single field).
const userBankAccounts = (user) => {
  if (user.linkedBanks && user.linkedBanks.length) return user.linkedBanks;
  if (user.linkedBank?.accountId) return [user.linkedBank];
  return [];
};
// Move the legacy single linkedBank into the linkedBanks array (once).
const migrateLegacyBank = (user) => {
  if (!user.linkedBanks) user.linkedBanks = [];
  if (!user.linkedBanks.length && user.linkedBank?.accountId) {
    user.linkedBanks.push({
      provider: user.linkedBank.provider || 'mono', accountId: user.linkedBank.accountId,
      institution: user.linkedBank.institution || '', accountName: user.linkedBank.accountName || '',
      lastSynced: user.linkedBank.lastSynced || null,
    });
    user.linkedBank = { provider: '', accountId: '', institution: '', accountName: '', lastSynced: null };
  }
};

app.get('/api/bank/mono-config', auth, async (req, res) => {
  const banks = userBankAccounts(req.user).map((b) => ({
    accountId: b.accountId, institution: b.institution || '', accountName: b.accountName || '', lastSynced: b.lastSynced || null,
  }));
  res.json({
    enabled: monoConfigured(),
    publicKey: process.env.MONO_PUBLIC_KEY || '',
    connected: banks.length > 0,
    banks,
  });
});

// Hosted Mono Connect page for the mobile app. The app opens this in an in-app
// browser (expo-web-browser) passing a `redirect` deep link; the Mono widget
// runs here and, on success, redirects to `redirect?code=...` which the app
// captures. The public key is injected server-side (it is a public value).
// NOTE: confirm the connect.js CDN/global when MONO_* keys are added.
app.get('/bank/mono-connect', (req, res) => {
  const redirect = String(req.query.redirect || '');
  if (!redirect) return res.status(400).send('Missing redirect');
  // Only allow the app's own deep links — blocks open-redirect / reflected XSS.
  if (!/^(finpilot:|exp:|exps:)\/\//i.test(redirect)) return res.status(400).send('Invalid redirect');
  const publicKey = process.env.MONO_PUBLIC_KEY || '';
  const sep = redirect.includes('?') ? '&' : '?';
  const htmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jsStr = (s) => JSON.stringify(s).replace(/</g, '\\u003c');
  res.set('Content-Type', 'text/html');
  // Override helmet's default CSP for this page so the Mono Connect widget
  // (external script + inline init + its iframe/network calls) can load.
  res.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://connect.mono.co https://*.mono.co; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; " +
    "connect-src https:; frame-src https:;");
  res.send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect your bank</title>
<style>html,body{height:100%;margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0b1326;color:#e3e9f2;display:grid;place-items:center;text-align:center}
.box{max-width:340px;padding:24px}.sp{width:38px;height:38px;border:4px solid rgba(255,255,255,.18);border-top-color:#00a862;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}a.b{display:inline-block;margin-top:16px;background:#00a862;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:700}</style></head>
<body><div class="box"><div class="sp"></div><p id="msg">Opening secure bank connection…</p>
<a class="b" id="cancel" href="${htmlEsc(redirect + sep + 'status=closed')}">Cancel</a></div>
<script type="module">
  const KEY=${jsStr(publicKey)};
  const REDIRECT=${jsStr(redirect)};
  const SEP=${jsStr(sep)};
  const go=(q)=>{ window.location.replace(REDIRECT+SEP+q); };
  const fail=(m)=>{ const el=document.getElementById('msg'); if(el) el.textContent=m; };
  if(!KEY){ fail('Bank linking is not configured yet.'); }
  else{
    try{
      // Mono Connect v2 (same SDK the web app uses) loaded from a CDN — the old
      // connect.mono.co/connect.js now serves HTML, not JS.
      const { default: Connect } = await import('https://cdn.jsdelivr.net/npm/@mono.co/connect.js@2.2.0/+esm');
      const connect = new Connect({
        key: KEY, scope: 'auth',
        onSuccess: (res)=>{ const code=(res&&(res.code||(res.getAuthCode&&res.getAuthCode())))||''; go('code='+encodeURIComponent(code)); },
        onClose: ()=>{ go('status=closed'); },
      });
      connect.setup();
      connect.open();
    }catch(e){ fail('Could not load the bank connector. Please try again.'); }
  }
</script></body></html>`);
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
    migrateLegacyBank(req.user);
    if (req.user.linkedBanks.some((b) => b.accountId === accountId)) {
      return res.json({ connected: true, institution, accountName, alreadyLinked: true });
    }
    req.user.linkedBanks.push({ provider: 'mono', accountId, institution, accountName, lastSynced: null });
    await req.user.save();
    res.json({ connected: true, institution, accountName });
  } catch (err) {
    console.error('[bank/connect]', err.response?.data || err.message);
    res.status(502).json({ message: err.response?.data?.message || 'Could not link your bank. Try again.' });
  }
});

// Pull + import new transactions from ONE linked Mono account; updates the
// account object's lastSynced (caller persists).
async function syncMonoAccount(user, acct) {
  if (!acct?.accountId) return { imported: 0, total: 0 };
  const r = await axios.get(`${MONO_BASE}/accounts/${acct.accountId}/transactions`, {
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

  // Dedupe against what the user already has (incl. just-imported accounts).
  const existing = await Transaction.find({ userId: user._id }, { date: 1, amount: 1, description: 1 }).lean();
  const seen = new Set(existing.map((t) => `${new Date(t.date).toISOString().slice(0, 10)}|${Math.abs(t.amount)}|${t.description}`));
  const importBatch = new mongoose.Types.ObjectId().toString();
  const importedAt = new Date();
  const docs = mapped
    .filter((t) => !seen.has(`${t.date}|${t.amount}|${t.description}`))
    .map((t) => new Transaction({
      userId: user._id, date: new Date(t.date), description: t.description,
      amount: t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount),
      category: t.category, type: t.type, source: 'import',
      bank: acct.institution || 'Linked bank', importBatch, importedAt,
    }));
  if (docs.length) await Transaction.insertMany(docs, { ordered: false });
  acct.lastSynced = importedAt;
  return { imported: docs.length, total: mapped.length };
}

// Sync every account a user has linked.
async function syncAllMonoForUser(user) {
  migrateLegacyBank(user);
  const accts = userBankAccounts(user);
  let imported = 0, total = 0;
  for (const a of accts) { const r = await syncMonoAccount(user, a); imported += r.imported; total += r.total; }
  await user.save();
  return { imported, total, accounts: accts.length };
}

// Pull transactions from all linked accounts and import new ones (manual).
app.post('/api/bank/sync', auth, async (req, res) => {
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  if (!userBankAccounts(req.user).length) return res.status(400).json({ message: 'No bank account linked' });
  try {
    res.json(await syncAllMonoForUser(req.user));
  } catch (err) {
    console.error('[bank/sync]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not sync transactions. Try again.' });
  }
});

// Scheduled auto-sync for every linked account. Protected by a shared secret so
// an external scheduler (e.g. cron-job.org / a Render cron job) can trigger it —
// Render's free tier sleeps, so an in-process cron wouldn't fire reliably.
app.post('/api/cron/sync-banks', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('x-cron-secret') !== secret) return res.status(401).json({ message: 'Unauthorized' });
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  try {
    const users = await User.find({ $or: [
      { 'linkedBanks.0': { $exists: true } },
      { 'linkedBank.accountId': { $nin: [null, ''] } },
    ] });
    let imported = 0, synced = 0, failed = 0;
    for (const u of users) {
      try { imported += (await syncAllMonoForUser(u)).imported; synced += 1; }
      catch (e) { failed += 1; console.error('[cron/sync-banks]', u._id.toString(), e.response?.data || e.message); }
    }
    res.json({ users: users.length, synced, failed, imported });
  } catch (e) {
    console.error('[cron/sync-banks]', e.message);
    res.status(500).json({ message: 'Sync failed' });
  }
});

// Unlink the bank account.
// Unlink one account (?accountId=) or all of them.
app.delete('/api/bank/unlink', auth, async (req, res) => {
  try {
    migrateLegacyBank(req.user);
    const accountId = (req.query.accountId || req.body?.accountId || '').toString();
    const toRemove = accountId
      ? req.user.linkedBanks.filter((b) => b.accountId === accountId)
      : [...req.user.linkedBanks];
    if (monoConfigured()) {
      for (const b of toRemove) {
        axios.post(`${MONO_BASE}/accounts/${b.accountId}/unlink`, {}, { headers: monoHeaders(), timeout: 15000 }).catch(() => {});
      }
    }
    req.user.linkedBanks = accountId ? req.user.linkedBanks.filter((b) => b.accountId !== accountId) : [];
    await req.user.save();
    res.json({ connected: req.user.linkedBanks.length > 0, banks: req.user.linkedBanks.length });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Bill payments via VTpass (Airtime, Data, TV, Electricity). Keys-pending:
// inert until VTPASS_* env vars are set. Paid in-app from the user's wallet —
// we reserve the amount, call VTpass, and refund automatically if it declines.
// --------------------------
const VTPASS_BASE = () => (process.env.VTPASS_SANDBOX === 'true' || process.env.VTPASS_SANDBOX === '1')
  ? 'https://sandbox.vtpass.com/api'
  : 'https://vtpass.com/api';
const vtpassConfigured = () => !!(process.env.VTPASS_API_KEY && process.env.VTPASS_SECRET_KEY && process.env.VTPASS_PUBLIC_KEY);
const vtpassPostHeaders = () => ({ 'api-key': process.env.VTPASS_API_KEY, 'secret-key': process.env.VTPASS_SECRET_KEY, 'Content-Type': 'application/json' });
const vtpassGetHeaders  = () => ({ 'api-key': process.env.VTPASS_API_KEY, 'public-key': process.env.VTPASS_PUBLIC_KEY });

// VTpass requires request_id to start with the current date/time in West Africa Time.
const vtpassRequestId = () => {
  const d = new Date(Date.now() + 60 * 60 * 1000); // shift UTC → WAT (UTC+1, no DST)
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
  return `AM${stamp}${Math.random().toString(36).slice(2, 10)}`;
};

// Supported providers per bill type, with their VTpass serviceIDs. Shown in the
// UI even before keys are set so the page is browsable.
const BILL_PROVIDERS = {
  airtime: [
    { id: 'mtn', name: 'MTN' }, { id: 'glo', name: 'Glo' },
    { id: 'airtel', name: 'Airtel' }, { id: 'etisalat', name: '9mobile' },
  ],
  data: [
    { id: 'mtn-data', name: 'MTN Data' }, { id: 'glo-data', name: 'Glo Data' },
    { id: 'airtel-data', name: 'Airtel Data' }, { id: 'etisalat-data', name: '9mobile Data' },
  ],
  tv: [
    { id: 'dstv', name: 'DStv' }, { id: 'gotv', name: 'GOtv' },
    { id: 'startimes', name: 'StarTimes' }, { id: 'showmax', name: 'Showmax' },
  ],
  electricity: [
    { id: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)' },
    { id: 'eko-electric', name: 'Eko Electric (EKEDC)' },
    { id: 'abuja-electric', name: 'Abuja Electric (AEDC)' },
    { id: 'kano-electric', name: 'Kano Electric (KEDCO)' },
    { id: 'portharcourt-electric', name: 'Port Harcourt Electric (PHED)' },
    { id: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)' },
    { id: 'enugu-electric', name: 'Enugu Electric (EEDC)' },
    { id: 'benin-electric', name: 'Benin Electric (BEDC)' },
    { id: 'jos-electric', name: 'Jos Electric (JED)' },
    { id: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)' },
  ],
};
const BILL_CATEGORY = { airtime: 'Airtime', data: 'Data', tv: 'TV', electricity: 'Electricity' };

const billPaymentSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  billType:      { type: String, enum: ['airtime', 'data', 'tv', 'electricity'], required: true },
  serviceID:     { type: String, required: true },
  provider:      { type: String, default: '' },
  amount:        { type: Number, required: true },
  phone:         { type: String, default: '' },
  billersCode:   { type: String, default: '' },
  variationCode: { type: String, default: '' },
  requestId:     { type: String, required: true, unique: true },
  providerRef:   { type: String, default: '' },
  token:         { type: String, default: '' },   // electricity prepaid token
  status:        { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
  message:       { type: String, default: '' },
}, { timestamps: true });
billPaymentSchema.index({ userId: 1, createdAt: -1 });
const BillPayment = mongoose.model('BillPayment', billPaymentSchema);

// Config + provider catalogue for the Bills page.
app.get('/api/bills/providers', auth, async (req, res) => {
  res.json({ enabled: vtpassConfigured(), sandbox: VTPASS_BASE().includes('sandbox'), providers: BILL_PROVIDERS });
});

// Proxy VTpass variation codes (data plans, TV bouquets, meter types).
app.get('/api/bills/variations', auth, async (req, res) => {
  if (!vtpassConfigured()) return res.status(503).json({ message: 'Bill payments are not configured yet.' });
  const serviceID = (req.query.serviceID || '').trim();
  if (!serviceID) return res.status(400).json({ message: 'serviceID is required' });
  try {
    const r = await axios.get(`${VTPASS_BASE()}/service-variations`, { headers: vtpassGetHeaders(), params: { serviceID }, timeout: 20000 });
    const list = r.data?.content?.varations || r.data?.content?.variations || [];
    const variations = list.map((v) => ({ code: v.variation_code, name: v.name, amount: Number(v.variation_amount) || 0, fixedPrice: v.fixedPrice === 'Yes' }));
    res.json({ serviceID, variations });
  } catch (err) {
    console.error('[bills/variations]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not load options. Try again.' });
  }
});

// Verify a TV smartcard / electricity meter and return the customer name.
app.post('/api/bills/verify', auth, async (req, res) => {
  if (!vtpassConfigured()) return res.status(503).json({ message: 'Bill payments are not configured yet.' });
  const { serviceID, billersCode, type } = req.body;
  if (!serviceID || !billersCode) return res.status(400).json({ message: 'serviceID and billersCode are required' });
  try {
    const body = { billersCode: String(billersCode).trim(), serviceID };
    if (type) body.type = type; // 'prepaid' | 'postpaid' for electricity
    const r = await axios.post(`${VTPASS_BASE()}/merchant-verify`, body, { headers: vtpassPostHeaders(), timeout: 20000 });
    const c = r.data?.content || {};
    if (c.error || c.WrongBillersCode) return res.status(400).json({ message: c.error || 'Invalid number. Check and try again.' });
    res.json({
      customerName: c.Customer_Name || c.customerName || '',
      address: c.Address || c.address || '',
      outstanding: c.Outstanding || c.outstanding || '',
      minAmount: Number(c.Min_Purchase_Amount) || 0,
      dueDate: c.Due_Date || '',
    });
  } catch (err) {
    console.error('[bills/verify]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not verify. Try again.' });
  }
});

// Pay a bill from the wallet.
app.post('/api/bills/pay', auth, async (req, res) => {
  if (!vtpassConfigured()) return res.status(503).json({ message: 'Bill payments are not configured yet.' });
  const { billType, serviceID, amount, phone, billersCode, variationCode } = req.body;
  if (!billType || !BILL_PROVIDERS[billType]) return res.status(400).json({ message: 'Invalid bill type' });
  if (!serviceID || !BILL_PROVIDERS[billType].some((p) => p.id === serviceID)) return res.status(400).json({ message: 'Select a valid provider' });
  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0) return res.status(400).json({ message: 'Enter a valid amount' });
  const recipient = String(phone || '').trim();
  if (!recipient) return res.status(400).json({ message: 'Phone number is required' });
  if ((billType === 'data' || billType === 'tv') && !variationCode) return res.status(400).json({ message: 'Select a plan/bouquet' });
  if ((billType === 'tv' || billType === 'electricity') && !billersCode) {
    return res.status(400).json({ message: billType === 'tv' ? 'Smartcard number is required' : 'Meter number is required' });
  }

  const wallet = await getOrCreateWallet(req.user._id);
  if (wallet.balance < amt) return res.status(400).json({ message: 'Insufficient wallet balance' });

  const providerName = (BILL_PROVIDERS[billType].find((p) => p.id === serviceID) || {}).name || serviceID;
  const requestId = vtpassRequestId();

  // Reserve funds up-front; the catch/decline paths refund.
  wallet.balance -= amt;
  await wallet.save();

  let record;
  try {
    record = await BillPayment.create({
      userId: req.user._id, billType, serviceID, provider: providerName,
      amount: amt, phone: recipient, billersCode: billersCode || '', variationCode: variationCode || '',
      requestId, status: 'pending',
    });

    const payload = { request_id: requestId, serviceID, amount: amt, phone: recipient };
    if (billType === 'data' || billType === 'tv' || billType === 'electricity') payload.billersCode = String(billersCode || recipient).trim();
    if (variationCode) payload.variation_code = variationCode;
    if (billType === 'electricity') payload.type = req.body.meterType || 'prepaid';

    const r = await axios.post(`${VTPASS_BASE()}/pay`, payload, { headers: vtpassPostHeaders(), timeout: 45000 });
    const data = r.data || {};
    const txn = data.content?.transactions || {};
    const ok = data.code === '000' || txn.status === 'delivered';
    const pending = data.code === '099' || txn.status === 'pending' || txn.status === 'initiated';

    if (!ok && !pending) {
      wallet.balance += amt; await wallet.save();
      record.status = 'failed'; record.message = data.response_description || 'Payment declined'; await record.save();
      return res.status(502).json({ message: 'Payment failed. You were not charged.' });
    }

    const token = txn.token || data.token || (data.purchased_code || '').toString();
    record.status = pending ? 'pending' : 'completed';
    record.providerRef = txn.transactionId || data.requestId || '';
    record.token = token || '';
    record.message = data.response_description || (pending ? 'Pending confirmation' : 'Successful');
    await record.save();

    const label = billType === 'airtime' ? `${providerName} Airtime`
      : billType === 'data' ? `${providerName} Data`
      : billType === 'tv' ? `${providerName} subscription`
      : `${providerName} (meter ${billersCode})`;
    const descr = `${label} — ${recipient}`;
    await new WalletTransaction({ userId: req.user._id, type: 'withdrawal', amount: amt, description: descr, reference: requestId, status: record.status === 'pending' ? 'pending' : 'completed' }).save();
    await new Transaction({ userId: req.user._id, date: new Date(), description: descr, amount: -Math.abs(amt), category: BILL_CATEGORY[billType], type: 'expense', source: 'manual' }).save();
    await createNotification(req.user._id, { type: 'success', title: 'Bill paid', message: `${descr} • ₦${amt.toLocaleString()}` });

    res.json({
      status: record.status, message: record.message, amount: amt, balance: wallet.balance,
      token: record.token || undefined, reference: requestId, description: descr,
    });
  } catch (err) {
    console.error('[bills/pay]', err.response?.data || err.message);
    wallet.balance += amt; await wallet.save();
    if (record) { record.status = 'failed'; record.message = 'Network error'; await record.save().catch(() => {}); }
    res.status(502).json({ message: 'Could not complete payment. You were not charged.' });
  }
});

// Bill payment history.
app.get('/api/bills/history', auth, async (req, res) => {
  const items = await BillPayment.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50);
  res.json(items);
});

// --------------------------
// Cashflow forecast: project the wallet balance forward from recurring income,
// bills, subscriptions, debt payments and average discretionary spend.
// --------------------------
app.get('/api/cashflow/forecast', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 7), 180);
    const userId = req.user._id;
    const [wallet, txns, bills, subs, debts] = await Promise.all([
      getOrCreateWallet(userId),
      Transaction.find({ userId }).select('date amount type').sort({ date: -1 }).limit(3000).lean(),
      RecurringBill.find({ userId, status: { $ne: 'paused' } }).lean(),
      Subscription.find({ userId, status: 'active' }).lean(),
      Debt.find({ userId, balance: { $gt: 0 } }).lean(),
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);

    // Average daily discretionary spend over the last 90 days of expenses.
    const winStart = new Date(today); winStart.setDate(winStart.getDate() - 90);
    const recentExp = txns.filter((t) => t.type === 'expense' && new Date(t.date) >= winStart);
    const dailyBurn = recentExp.reduce((s, t) => s + Math.abs(t.amount), 0) / 90;

    // Monthly income + assumed pay day (most common day-of-month among income txns).
    const monthlyIncome = req.user.monthlyIncome || 0;
    const incomeTxns = txns.filter((t) => t.type === 'income');
    let payDay = 28;
    if (incomeTxns.length) {
      const counts = {};
      incomeTxns.forEach((t) => { const d = new Date(t.date).getDate(); counts[d] = (counts[d] || 0) + 1; });
      payDay = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]) || 28;
    }
    const subDay = (s) => s.scheduledPayment?.dayOfMonth || (s.nextPayment ? new Date(s.nextPayment).getDate() : 1);
    const dayOutflow = (dom) => {
      let out = 0;
      for (const b of bills) if (b.frequency === 'monthly' && b.dueDate === dom) out += b.amount;
      for (const s of subs) if (s.frequency === 'monthly' && subDay(s) === dom) out += s.cost;
      for (const dt of debts) if (dt.scheduledPayment?.enabled && dt.scheduledPayment.dayOfMonth === dom) out += (dt.scheduledPayment.amount || 0);
      return out;
    };

    let balance = wallet.balance;
    const series = [{ date: today.toISOString().slice(0, 10), balance: Math.round(balance) }];
    let lowest = { date: series[0].date, balance: Math.round(balance) };
    let shortfallDate = null, totalIn = 0, totalOut = 0, nextIncomeIdx = days + 1;

    for (let i = 1; i <= days; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      const dom = d.getDate();
      const inflow = (monthlyIncome && dom === payDay) ? monthlyIncome : 0;
      const outflow = dayOutflow(dom) + dailyBurn;
      if (inflow && i < nextIncomeIdx) nextIncomeIdx = i;
      balance += inflow - outflow;
      totalIn += inflow; totalOut += outflow;
      const iso = d.toISOString().slice(0, 10);
      series.push({ date: iso, balance: Math.round(balance) });
      if (balance < lowest.balance) lowest = { date: iso, balance: Math.round(balance) };
      if (shortfallDate === null && balance < 0) shortfallDate = iso;
    }

    // Safe to spend today = balance minus committed obligations (not discretionary
    // burn) before the next income lands.
    let committed = 0;
    for (let i = 1; i < nextIncomeIdx && i <= days; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      committed += dayOutflow(d.getDate());
    }

    res.json({
      days,
      currentBalance: Math.round(wallet.balance),
      dailyBurn: Math.round(dailyBurn),
      monthlyIncome, payDay,
      safeToSpend: Math.max(0, Math.round(wallet.balance - committed)),
      projectedEnd: series[series.length - 1].balance,
      lowest, shortfallDate,
      totals: { income: Math.round(totalIn), expense: Math.round(totalOut) },
      series,
    });
  } catch (e) {
    console.error('[cashflow/forecast]', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// --------------------------
// AI Assistant (Claude) — natural-language Q&A over the user's own finances
// --------------------------
// Activated by setting ANTHROPIC_API_KEY on the host. Until then the endpoint
// returns a friendly "coming soon" reply (same keys-pending pattern as the
// Mono/VTpass/Paystack integrations) so the UI degrades gracefully.
const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
// Model is overridable, but defaults to Anthropic's current flagship.
const AI_MODEL = process.env.AI_MODEL || 'claude-opus-4-8';
const anthropic = aiConfigured() ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Build a compact, structured snapshot of the user's finances for the model.
// We summarise rather than dump every row — keeps token cost down and avoids
// leaking more raw data than needed. NGN throughout.
const buildFinancialContext = async (user) => {
  const userId = user._id;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since90 = new Date(today); since90.setDate(since90.getDate() - 90);
  const thisMonth = monthKey(today);

  const [wallet, txns, budgets, goals, bills, subs, debts] = await Promise.all([
    getOrCreateWallet(userId),
    Transaction.find({ userId }).select('date description amount category type').sort({ date: -1 }).limit(600).lean(),
    Budget.find({ userId, month: thisMonth }).lean(),
    Goal.find({ userId }).lean(),
    RecurringBill.find({ userId, status: { $ne: 'paused' } }).lean(),
    Subscription.find({ userId, status: 'active' }).lean(),
    Debt.find({ userId, balance: { $gt: 0 } }).lean(),
  ]);

  const recent = txns.filter((t) => new Date(t.date) >= since90);
  const sum = (arr) => arr.reduce((s, t) => s + Math.abs(t.amount), 0);
  const income90 = sum(recent.filter((t) => t.type === 'income'));
  const expense90 = sum(recent.filter((t) => t.type === 'expense'));

  // This-month income/expense + per-category expense breakdown.
  const monthTxns = txns.filter((t) => monthKey(new Date(t.date)) === thisMonth);
  const incomeMonth = sum(monthTxns.filter((t) => t.type === 'income'));
  const expenseMonth = sum(monthTxns.filter((t) => t.type === 'expense'));
  const byCat = {};
  monthTxns.filter((t) => t.type === 'expense').forEach((t) => {
    byCat[t.category] = (byCat[t.category] || 0) + Math.abs(t.amount);
  });
  const topCats = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8);

  // Budgets vs actual this month.
  const budgetLines = budgets.map((b) => {
    const spent = byCat[b.category] || 0;
    return `  - ${b.category}: budget ${naira(b.amount)}, spent ${naira(spent)} (${b.amount ? Math.round((spent / b.amount) * 100) : 0}%)`;
  });

  const lines = [];
  lines.push(`User: ${user.name?.split(' ')[0] || 'there'}`);
  lines.push(`Currency: NGN (Nigerian Naira). Today: ${today.toISOString().slice(0, 10)}.`);
  if (user.monthlyIncome) lines.push(`Stated monthly income: ${naira(user.monthlyIncome)}`);
  if (user.primaryGoal) lines.push(`Primary goal: ${user.primaryGoal}`);
  lines.push('');
  lines.push(`Wallet balance: ${naira(wallet.balance)}  |  Savings: ${naira(wallet.savingsBalance)}`);
  lines.push('');
  lines.push(`This month (${thisMonth}): income ${naira(incomeMonth)}, expenses ${naira(expenseMonth)}, net ${naira(incomeMonth - expenseMonth)}.`);
  lines.push(`Last 90 days: income ${naira(income90)}, expenses ${naira(expense90)}, avg monthly spend ≈ ${naira(expense90 / 3)}.`);
  if (topCats.length) {
    lines.push('Top expense categories this month:');
    topCats.forEach(([c, v]) => lines.push(`  - ${c}: ${naira(v)}`));
  }
  if (budgetLines.length) { lines.push('Budgets this month:'); lines.push(...budgetLines); }
  if (goals.length) {
    lines.push('Savings goals:');
    goals.forEach((g) => lines.push(
      `  - ${g.name}: ${naira(g.current)} of ${naira(g.target)} (${g.target ? Math.round((g.current / g.target) * 100) : 0}%), due ${new Date(g.deadline).toISOString().slice(0, 10)}${g.locked ? ', LOCKED plan' : ''}`,
    ));
  }
  if (bills.length) {
    lines.push('Recurring bills:');
    bills.slice(0, 12).forEach((b) => lines.push(`  - ${b.name}: ${naira(b.amount)} ${b.frequency || 'monthly'}${b.dueDate ? `, day ${b.dueDate}` : ''}`));
  }
  if (subs.length) {
    lines.push('Subscriptions:');
    subs.slice(0, 12).forEach((s) => lines.push(`  - ${s.name}: ${naira(s.cost)} ${s.frequency || 'monthly'}`));
  }
  if (debts.length) {
    lines.push('Debts outstanding:');
    debts.forEach((d) => lines.push(`  - ${d.name}: ${naira(d.balance)} balance${d.interestRate ? ` @ ${d.interestRate}%` : ''}`));
  }
  // A modest tail of recent transactions for "what did I spend on X" questions.
  lines.push('');
  lines.push('Most recent transactions (newest first):');
  txns.slice(0, 40).forEach((t) => lines.push(
    `  ${new Date(t.date).toISOString().slice(0, 10)}  ${t.type === 'income' ? '+' : '-'}${naira(Math.abs(t.amount))}  ${t.category}  ${(t.description || '').slice(0, 50)}`,
  ));

  return lines.join('\n');
};

const AI_SYSTEM_PROMPT = `You are Automonie's built-in finance assistant for a Nigerian personal-finance app. You help the user understand their money AND take actions in the app on their behalf.

You can do two kinds of things:
1. INSIGHTS & REPORTS — answer questions and produce summaries/reports from the user's financial snapshot (provided in their message). Examples: "where is my money going", "give me a spending report for this month", "am I on track with my budgets".
2. ACTIONS — actually create things in the app using the provided tools: log a transaction, set a budget, create a savings goal, add a subscription to track, or set up a recurring bill.

Rules:
- All amounts are in Nigerian Naira (₦). Format money with the ₦ symbol and thousands separators.
- For insights/reports, use ONLY the snapshot data. Never invent transactions, balances, or numbers. If the data doesn't cover the question, say so and suggest what to track.
- For actions, use the matching tool. If a required detail is missing or ambiguous (e.g. the amount, the goal's target, or a deadline), ASK a short clarifying question instead of guessing. Never fabricate values for an action.
- After performing an action, confirm briefly what you did (the tool result tells you if it succeeded).
- You can only CREATE records. You cannot move money, pay bills, contribute to goals, delete, or edit existing items — if asked, explain they can do that from the relevant screen.
- Be concise and practical — this renders in a small chat window. Lead with the answer, then one supporting detail or tip.
- Give general budgeting/savings guidance, but no regulated investment, tax, or legal advice; suggest a professional for those. Be encouraging and non-judgmental.`;

// Tools the assistant can call. All are CREATE-only and scoped to the requesting
// user — nothing here moves real money (no wallet debits, goal contributions, or
// bill payments), so actions are low-risk and reversible from the UI.
const AI_TOOLS = [
  {
    name: 'create_transaction',
    description: 'Log a new income or expense transaction for the user. Use when the user says they earned, received, spent, paid, or bought something.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['income', 'expense'] },
        amount: { type: 'number', description: 'Positive amount in NGN' },
        category: { type: 'string', description: 'e.g. Food, Transport, Salary, Bills' },
        description: { type: 'string', description: 'Short note, e.g. "Lunch at Chicken Republic"' },
        date: { type: 'string', description: 'YYYY-MM-DD; defaults to today if omitted' },
      },
      required: ['type', 'amount', 'category', 'description'],
    },
  },
  {
    name: 'create_budget',
    description: "Set a monthly spending budget for a category. Use when the user wants to budget or cap spending on something.",
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        amount: { type: 'number', description: 'Monthly limit in NGN' },
        month: { type: 'string', description: "YYYY-MM; defaults to the current month" },
      },
      required: ['category', 'amount'],
    },
  },
  {
    name: 'create_goal',
    description: 'Create a savings goal the user is working toward.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        target: { type: 'number', description: 'Target amount in NGN' },
        deadline: { type: 'string', description: 'YYYY-MM-DD target date' },
        category: { type: 'string', description: 'Optional, defaults to General' },
      },
      required: ['name', 'target', 'deadline'],
    },
  },
  {
    name: 'add_subscription',
    description: 'Add a recurring subscription to track (e.g. Netflix, DSTV, gym). Tracking only — it does not auto-pay.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        cost: { type: 'number', description: 'Recurring cost in NGN' },
        frequency: { type: 'string', enum: ['monthly', 'yearly'] },
        category: { type: 'string' },
      },
      required: ['name', 'cost'],
    },
  },
  {
    name: 'create_bill',
    description: 'Set up a recurring bill reminder (e.g. rent, electricity) due on a day of the month. Reminder/tracking only — it does not auto-pay.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        amount: { type: 'number', description: 'Amount in NGN' },
        dueDate: { type: 'number', description: 'Day of month (1-31) the bill is due' },
        frequency: { type: 'string', enum: ['monthly', 'yearly'] },
        category: { type: 'string' },
      },
      required: ['name', 'amount', 'dueDate'],
    },
  },
];

// Execute one assistant tool call against the DB, scoped to `user`. Returns a
// { ok, summary } result that is fed back to the model and surfaced to the UI.
const executeAiTool = async (name, input, user) => {
  const userId = user._id;
  try {
    if (name === 'create_transaction') {
      const { type, category, description } = input;
      const amount = Math.abs(Number(input.amount));
      if (!['income', 'expense'].includes(type) || !amount || !category || !description) {
        return { ok: false, summary: 'Missing required fields for the transaction.' };
      }
      const date = input.date && !isNaN(Date.parse(input.date)) ? new Date(input.date) : new Date();
      const txn = new Transaction({
        userId, date, description: String(description).trim(),
        amount: type === 'expense' ? -amount : amount,
        category: String(category).trim(), type, source: 'manual',
      });
      await txn.save();
      await applySavingsRule(userId, txn.amount, txn.type);
      if (type === 'expense') checkBudgetAlert(userId, txn.category, date.toISOString().slice(0, 7));
      return { ok: true, summary: `Logged ${type} of ${naira(amount)} — ${category} (${txn.description}).`, kind: 'transaction' };
    }

    if (name === 'create_budget') {
      const category = String(input.category || '').trim();
      const amount = Math.abs(Number(input.amount));
      if (!category || !amount) return { ok: false, summary: 'Category and amount are required for a budget.' };
      const month = /^\d{4}-\d{2}$/.test(input.month || '') ? input.month : new Date().toISOString().slice(0, 7);
      if (await Budget.findOne({ userId, category, month })) {
        return { ok: false, summary: `A budget for ${category} already exists for ${month}. They can edit it on the Budget screen.` };
      }
      await new Budget({ userId, category, amount, month }).save();
      return { ok: true, summary: `Set a ${naira(amount)} budget for ${category} (${month}).`, kind: 'budget' };
    }

    if (name === 'create_goal') {
      const name2 = String(input.name || '').trim();
      const target = Math.abs(Number(input.target));
      if (!name2 || !target || !input.deadline || isNaN(Date.parse(input.deadline))) {
        return { ok: false, summary: 'A name, target amount, and a valid deadline date are required for a goal.' };
      }
      await new Goal({ userId, name: name2, target, current: 0, deadline: new Date(input.deadline), category: input.category || 'General' }).save();
      return { ok: true, summary: `Created goal "${name2}" — target ${naira(target)} by ${new Date(input.deadline).toISOString().slice(0, 10)}.`, kind: 'goal' };
    }

    if (name === 'add_subscription') {
      const name2 = String(input.name || '').trim();
      const cost = Math.abs(Number(input.cost));
      if (!name2 || !cost) return { ok: false, summary: 'A name and cost are required for a subscription.' };
      await new Subscription({
        userId, name: name2, cost, frequency: input.frequency || 'monthly',
        category: input.category || 'Entertainment', status: 'active',
        nextPayment: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }).save();
      return { ok: true, summary: `Now tracking subscription "${name2}" — ${naira(cost)} ${input.frequency || 'monthly'}.`, kind: 'subscription' };
    }

    if (name === 'create_bill') {
      const name2 = String(input.name || '').trim();
      const amount = Math.abs(Number(input.amount));
      const dueDate = Math.min(Math.max(parseInt(input.dueDate, 10) || 0, 1), 31);
      if (!name2 || !amount || !dueDate) return { ok: false, summary: 'A name, amount, and due day (1-31) are required for a bill.' };
      const now = new Date();
      let nextDue = new Date(now.getFullYear(), now.getMonth(), dueDate);
      if (nextDue < now) nextDue = new Date(now.getFullYear(), now.getMonth() + 1, dueDate);
      await new RecurringBill({
        userId, name: name2, amount, dueDate, frequency: input.frequency || 'monthly',
        category: input.category || 'Bills', autoPay: false, nextDue, status: 'active',
      }).save();
      return { ok: true, summary: `Set up bill reminder "${name2}" — ${naira(amount)} due on day ${dueDate} each ${input.frequency === 'yearly' ? 'year' : 'month'}.`, kind: 'bill' };
    }

    return { ok: false, summary: `Unknown action: ${name}.` };
  } catch (e) {
    console.error('[executeAiTool]', name, e.message);
    return { ok: false, summary: 'That action failed to save. Please try again or do it from the relevant screen.' };
  }
};

app.get('/api/ai/status', auth, async (req, res) => {
  res.json({ configured: aiConfigured(), model: aiConfigured() ? AI_MODEL : null, plan: req.user.plan || 'free' });
});

app.post('/api/ai/chat', aiLimiter, auth, async (req, res) => {
  try {
    const message = (req.body?.message || '').toString().trim();
    if (!message) return res.status(400).json({ message: 'Please enter a question.' });
    if (message.length > 2000) return res.status(400).json({ message: 'Message is too long (max 2000 characters).' });

    if (!aiConfigured()) {
      return res.json({
        configured: false,
        reply: "The AI assistant isn't switched on for this account yet — it's coming soon. In the meantime you can explore your Dashboard, Financial Health, and Cashflow for insights into your spending.",
      });
    }

    // Sanitise client-supplied history into a clean alternating turn list.
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    const priorTurns = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.toString().slice(0, 4000) }));

    const context = await buildFinancialContext(req.user);

    const messages = [
      ...priorTurns,
      {
        role: 'user',
        content: `Here is my current financial snapshot:\n\n${context}\n\n---\n\nMy question/request: ${message}`,
      },
    ];

    // Agentic loop: let the model call CREATE tools, execute them, feed results
    // back, and continue until it produces a final text answer. Capped so a
    // misbehaving turn can't loop forever.
    const actions = [];
    let reply = '';
    for (let step = 0; step < 6; step++) {
      const completion = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 1024,
        system: AI_SYSTEM_PROMPT,
        tools: AI_TOOLS,
        messages,
      });

      const textOut = (completion.content || [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (textOut) reply = textOut;

      const toolUses = (completion.content || []).filter((b) => b.type === 'tool_use');
      if (completion.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      // Echo the assistant turn (must include the tool_use blocks) then answer
      // each tool call in a single user turn.
      messages.push({ role: 'assistant', content: completion.content });
      const toolResults = [];
      for (const tu of toolUses) {
        const result = await executeAiTool(tu.name, tu.input || {}, req.user);
        actions.push({ tool: tu.name, ok: result.ok, kind: result.kind, summary: result.summary });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: result.summary,
          is_error: !result.ok,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    res.json({
      configured: true,
      reply: reply || "Sorry, I couldn't generate a response. Please try rephrasing.",
      actions,
      // True if anything was created — the UI uses this to refresh data views.
      changed: actions.some((a) => a.ok),
    });
  } catch (e) {
    console.error('[ai/chat]', e.status || '', e.message);
    if (e.status === 429) return res.status(429).json({ message: 'The assistant is busy right now. Please try again in a moment.' });
    res.status(500).json({ message: 'The assistant ran into a problem. Please try again.' });
  }
});

// --------------------------
// Reminders — "needs your attention" items computed from the user's own data.
// Feeds the mobile Home attention card and mirrors actionable items into the
// notification bell (deduped per period, same idempotent pattern as budget
// alerts). Read-only from the client's perspective; nothing here moves money.
// --------------------------
app.get('/api/reminders', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [wallet, bills, subs, lastImport, everImported] = await Promise.all([
      getOrCreateWallet(userId),
      RecurringBill.find({ userId, status: 'active' }).lean(),
      Subscription.find({ userId, status: 'active' }).lean(),
      Transaction.findOne({ userId, source: 'import' }).sort({ importedAt: -1 }).lean(),
      Transaction.exists({ userId, source: 'import' }),
    ]);

    const reminders = [];

    // 1) Overdue payments (bills + subscriptions past their due date).
    const overdue = bills.filter((b) => b.nextDue && new Date(b.nextDue) < today).length
      + subs.filter((s) => s.nextPayment && new Date(s.nextPayment) < today).length;
    if (overdue > 0) {
      reminders.push({
        id: 'overdue', type: 'payment', severity: 'high', icon: 'alert-circle',
        title: `${overdue} payment${overdue > 1 ? 's' : ''} overdue`,
        message: 'Some bills or subscriptions are past their due date.',
        action: { label: 'Review bills', route: '/bills' },
      });
    }

    // 2) New-month statement upload — only nag users who have imported before.
    if (everImported) {
      const lastDate = lastImport?.importedAt ? new Date(lastImport.importedAt) : null;
      const daysSince = lastDate ? Math.floor((today - lastDate) / 86400000) : 999;
      if (daysSince >= 30) {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const monthName = prev.toLocaleString('en-US', { month: 'long' });
        reminders.push({
          id: 'statement', type: 'statement', severity: 'medium', icon: 'cloud-upload',
          title: `Upload your ${monthName} statement`,
          message: 'Import last month’s bank statement to keep your insights current.',
          action: { label: 'Import statement', route: '/import-statement' },
        });
      }
    }

    // 3) Cash shortfall — committed outflows in the next 7 days vs wallet balance.
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const dueSoon = [...bills, ...subs].reduce((s, x) => {
      const d = x.nextDue || x.nextPayment;
      const amt = x.amount ?? x.cost ?? 0;
      return (d && new Date(d) >= today && new Date(d) <= in7) ? s + amt : s;
    }, 0);
    if (dueSoon > 0 && wallet.balance < dueSoon) {
      reminders.push({
        id: 'shortfall', type: 'cashflow', severity: 'high', icon: 'trending-down',
        title: 'You may run short this week',
        message: `${naira(dueSoon)} in payments are due soon but your wallet holds ${naira(wallet.balance)}.`,
        action: { label: 'See cashflow', route: '/cashflow' },
      });
    }

    // 4) Profile completion.
    if (!req.user.monthlyIncome) {
      reminders.push({
        id: 'profile', type: 'profile', severity: 'low', icon: 'person-circle',
        title: 'Finish setting up',
        message: 'Add your monthly income to unlock better forecasts.',
        action: { label: 'Update profile', route: '/settings' },
      });
    }

    // Mirror the important ones into the notification bell, deduped per period
    // (once a month for the statement nudge, once a day for the rest).
    for (const r of reminders) {
      if (r.severity === 'low') continue;
      const period = r.id === 'statement' ? monthKey(today) : today.toISOString().slice(0, 10);
      const link = `reminder:${r.id}:${period}`;
      Notification.findOne({ userId, link })
        .then((exists) => { if (!exists) createNotification(userId, { type: 'info', title: r.title, message: r.message, link }); })
        .catch(() => {});
    }

    res.json({ reminders });
  } catch (e) {
    console.error('[reminders]', e.message);
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