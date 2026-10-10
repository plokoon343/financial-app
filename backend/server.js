const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const fs = require('fs');
const csv = require('csv-parser');
const { Readable } = require('stream');
const axios = require('axios');
const crypto = require('crypto');
const { fingerprint, matchScore, MERGE, PROBABLE: PROBABLE_DUP } = require('./lib/dedupe');
const { detectTransfers, scorePair, routeKey } = require('./lib/internalTransfers');
const { classifyKind } = require('./lib/txnKinds');
const { pairReversals } = require('./lib/reversals');
const { reconcile, extractBalances } = require('./lib/reconcile');
const { parseOpayStatement } = require('./lib/opayStatement');
const { extractStatement: llmExtractStatement } = require('./lib/llmStatement');
const { extractCounterparty, contactKey, familySignal, isSelf } = require('./lib/counterparty');
const { normalizeAmount } = require('./lib/amount');
const inboundEmail = require('./lib/inboundEmail');
const shareIngest = require('./lib/shareIngest');
const { buildSummary: buildIncomeSummary, renderReportHTML: renderIncomeReportHTML } = require('./lib/incomeReport');
const { guideFor: cancelGuideFor, verifyCancellation } = require('./lib/cancelGuides');
const { resolveBank: resolveBankRegistry, extractAccountMask, BANKS: BANK_REGISTRY } = require('./lib/bankRegistry');
const { detectDirection, parseLabeledAlert, alertDescription, alertIgnoreReason } = require('./lib/alertParse');
const capture = require('./lib/capture');
const { brandFor } = require('./lib/subscriptionBrands');
const nudges = require('./lib/nudges');
const plans = require('./lib/plans');
const studentLib = require('./lib/student');
const welcomeEmails = require('./lib/welcomeEmails');
const { bankMethods } = require('./lib/bankMethods');
const { deriveCategoryKey, subscriptionKey } = require('./lib/merchantKey');
const { categorizeTransaction } = require('./lib/categorize');
const purposeInf = require('./lib/purposeInference');
const { classifyPurpose, proposalFrom } = require('./lib/purposeClassifier');
const { llmConfig, llmActive, inferPurposesLLM } = require('./lib/llmPurpose');
const { extractAlertLLM, validateExtract } = require('./lib/llmExtract');
require('dotenv').config();

// Where password-reset links point (the deployed frontend).
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://app.automonie.com';

// Email goes through the Brevo HTTP API (port 443). Render blocks outbound SMTP, so
// there is deliberately one transport. Without BREVO_API_KEY, email is disabled.
const emailConfigured = () => !!process.env.BREVO_API_KEY;

// The "from" identity. Brevo requires a verified sender; automonie.com is authenticated.
const senderEmail = () => (process.env.EMAIL_FROM_ADDRESS || 'hello@automonie.com').trim();
const senderName = () => process.env.EMAIL_FROM_NAME || 'Automonie';

// Send one email. Optional replyTo (string or {email,name}) and from-identity overrides
// are used by the newsletter to send as a no-reply. Throws on failure.
const sendEmail = async ({ to, subject, text, html, replyTo, fromName, fromEmail }) => {
  if (!emailConfigured()) throw new Error('Email is not configured (BREVO_API_KEY missing)');
  const body = {
    sender: { name: fromName || senderName(), email: fromEmail || senderEmail() },
    to: [{ email: to }],
    subject,
    textContent: text,
    htmlContent: html || `<p>${text}</p>`,
  };
  if (replyTo) body.replyTo = typeof replyTo === 'string' ? { email: replyTo } : replyTo;
  await axios.post('https://api.brevo.com/v3/smtp/email', body, {
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
    timeout: 15000,
  });
};

// Newsletter sends as a no-reply: Reply-To points at a no-reply address so replies
// don't land in a real inbox. NEWSLETTER_FROM_ADDRESS can make the From no-reply too.
const NEWSLETTER_FROM_NAME = process.env.NEWSLETTER_FROM_NAME || 'Automonie';
const NEWSLETTER_FROM_ADDRESS = process.env.NEWSLETTER_FROM_ADDRESS || '';
const NEWSLETTER_REPLY_TO = process.env.NEWSLETTER_REPLY_TO || 'noreply@automonie.com';
const sendNewsletterEmail = ({ to, subject, text, html }) => sendEmail({
  to, subject, text, html,
  fromName: NEWSLETTER_FROM_NAME,
  fromEmail: NEWSLETTER_FROM_ADDRESS || undefined,
  replyTo: { email: NEWSLETTER_REPLY_TO, name: 'Automonie (no-reply)' },
});

// Send a password-reset email. When email isn't configured, local development logs the
// link so an account can still be recovered; production never logs a reset token.
const sendResetEmail = async (to, link) => {
  if (!emailConfigured()) {
    if (process.env.NODE_ENV !== 'production') console.log(`[password-reset] (dev, email off) reset link for ${to}: ${link}`);
    else console.error('[password-reset] email not configured; reset email not sent');
    return false;
  }
  await sendEmail({
    to,
    subject: 'Reset your Automonie password',
    text: `Reset your password using this link (valid for 1 hour):

${link}

If you didn't request this, ignore this email.`,
    html: `<p>Reset your Automonie password using the link below (valid for 1 hour):</p>
           <p><a href="${link}">Reset my password</a></p>
           <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore this email.</p>`,
  });
  return true;
};

// One password rule for every path that sets a password (register, change, reset,
// admin setup). Returns an error message, or '' when the password is acceptable.
const MIN_PASSWORD_LENGTH = 8;
const passwordProblem = (pw) => (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH
  ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters` : '');

// Constant-time comparison for secrets and signatures, so response timing can't be
// used to guess them byte by byte.
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
// Cron endpoints are triggered by an external scheduler holding CRON_SECRET.
const cronAuthorized = (req) => !!process.env.CRON_SECRET && safeEqual(req.get('x-cron-secret'), process.env.CRON_SECRET);

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

// Fail fast if the JWT secret is missing - never fall back to a public default.
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
  process.exit(1);
}

const app = express();
app.set('trust proxy', 1);             // behind Render's proxy - needed for correct client IPs
app.use(helmet());                     // standard security headers
app.use(compression());                // gzip responses

// Restrict cross-origin requests to our own frontends. Non-browser callers (curl,
// health checks, the mobile app) send no Origin and are allowed. Extra origins, such
// as a preview deploy, can be added via ALLOWED_ORIGINS (comma-separated).
const allowedOrigins = [
  'https://app.automonie.com',
  'https://automonie.com',
  'https://www.automonie.com',
  'https://financial-app-fawn-nu.vercel.app',
  ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:4321']),
  ...((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)),
];
app.use(cors({
  origin: (origin, cb) => {
    // Unknown origins get no CORS headers, so the browser blocks them; no server error.
    cb(null, !origin || allowedOrigins.includes(origin));
  },
}));

app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } })); // raw body kept for webhook signature checks
app.use(express.urlencoded({ extended: true, limit: '5mb' })); // inbound-email providers post form fields

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

// Baseline per-IP limit across the whole API, so no endpoint (statement uploads,
// LLM-backed parsing, share ingestion) can be hammered. Generous enough for normal
// app use; the stricter limiters below still apply to auth and sensitive routes.
// Webhooks and cron are excluded: providers retry in bursts and cron is secret-gated.
// Signed-in requests are counted per user (people sharing campus or office Wi-Fi share
// one IP); anything without a valid token is counted per IP, so a forged token can't
// buy a fresh allowance.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const token = (req.get('Authorization') || '').replace('Bearer ', '');
    if (token) {
      try { return `u:${jwt.verify(token, JWT_SECRET).userId}`; } catch { /* fall back to IP */ }
    }
    return rateLimit.ipKeyGenerator(req.ip);
  },
  skip: (req) => /^\/api\/(cron\/|paystack\/webhook|bank\/mono-webhook|inbound-email\/webhook)/.test(req.originalUrl),
  message: { message: 'Too many requests. Please slow down and try again shortly.' },
});
app.use('/api', apiLimiter);

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

// AI assistant calls cost money per request - keep the per-user volume sane.
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
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app')
.then(() => console.log('MongoDB connected'))
.catch((err) => console.error('MongoDB connection error:', err.message));

// --------------------------
// Schemas (Models)
// --------------------------
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  // select:false so the hash never rides along on ordinary queries (e.g. admin
  // listings, profile fetches). The few routes that verify a password fetch it
  // explicitly with .select('+password').
  password: { type: String, required: true, select: false },
  googleId: { type: String },   // set when the account is linked to Google sign-in
  role: { type: String, enum: ['user', 'superadmin'], default: 'user' },
  // Scoped access: can use the Newsletter composer only (not the rest of admin).
  newsletterEditor: { type: Boolean, default: false },
  // Opted in to the beta testers program (gets the beta community + feedback prompts).
  betaTester: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  // Subscription tier. 'pro' unlocks the AI assistant + advanced features (Paystack
  // billing wires `plan`/`planExpiry` later; for now the AI assistant is open to all).
  plan:       { type: String, enum: ['free', 'pro', 'student', 'power'], default: 'free' }, // 'pro' is shown as Plus
  // When true, this user's parse corrections are NOT logged for training. Off by
  // default; user can opt out in settings. See ParseCorrection.
  trainingOptOut: { type: Boolean, default: false },
  familyPromptDone: { type: Boolean, default: false }, // the one-time "are these family?" prompt was answered
  planExpiry: { type: Date },
  planEverPaid:     { type: Boolean, default: false }, // has paid for a plan: no second free trial
  trialEndNotified: { type: Boolean, default: false }, // told once that the Plus trial ended
  // Student plan verification (lib/student): valid for a year from verifiedAt.
  student: {
    type: new mongoose.Schema({
      status:      { type: String, enum: ['none', 'pending', 'verified', 'rejected', 'expired'], default: 'none' },
      method:      { type: String, default: '' },   // email | id | nysc | code
      institution: { type: String, default: '' },
      schoolEmail: { type: String, default: '' },
      verifiedAt:  { type: Date, default: null },
      expiresAt:   { type: Date, default: null },
      freeUsed:    { type: Boolean, default: false }, // the free months were taken
      reminderSentAt: { type: Date, default: null },
      rejectReason: { type: String, default: '' },
      pendingEmail: { type: String, default: '' },
      otpHash:     { type: String, default: '' },
      otpExpires:  { type: Date, default: null },
      otpAttempts: { type: Number, default: 0 },
    }, { _id: false }),
    default: () => ({}),
  },
  // Profile / onboarding
  phone:         { type: String, default: '' },
  monthlyIncome: { type: Number, default: 0 },
  primaryGoal:   { type: String, default: '' },
  emailAlerts:   { type: Boolean, default: true },
  // Expo push tokens for this user's devices (spending-insight notifications).
  pushTokens:    { type: [String], default: [] },
  // Push nudges: a switch per category (missing = on) and whether amounts may show
  // on the lock screen (off by default). lastActiveAt is updated as the app is used.
  nudgePrefs: {
    spending: { type: Boolean, default: true }, budgets: { type: Boolean, default: true }, bills: { type: Boolean, default: true },
    streaks: { type: Boolean, default: true }, recap: { type: Boolean, default: true }, tips: { type: Boolean, default: true },
  },
  showAmountsInNotifications: { type: Boolean, default: false },
  // Onboarding: the banks and wallets the user said they use (registry codes), plus
  // any typed under 'Other'. Drives the 'banks to connect' checklist on Home.
  banksUsed:   { type: [String], default: [] },
  otherBanks:  { type: [String], default: [] },
  // First-time tips already shown, so they never repeat on any device.
  seenTips:    { type: [String], default: [] },
  lastActiveAt: { type: Date },
  // Days (YYYY-MM-DD) the user checked in: powers the "clarity streak". Stored
  // server-side so the streak survives a reinstall / new device.
  checkinDays:   { type: [String], default: [] },
  // Email forwarding (B1): a unique high-entropy inbound address token so the user
  // can forward bank-alert emails to <token>@in.automonie.com and have them parsed
  // automatically. lastAt drives the "we're receiving your alerts ✓" status.
  inboundEmailToken: { type: String, index: true, sparse: true },
  // Background capture (phone notifications, iPhone Shortcuts, quiet share): only the
  // SHA-256 of the user's capture key is stored.
  captureKeyHash: { type: String, index: true, sparse: true },
  captureLastAt: { type: Date },
  captureCount: { type: Number, default: 0 },
  inboundEmailLastAt: { type: Date },
  inboundEmailCount:  { type: Number, default: 0 },
  // Gmail forwarding confirmation captured from Google's noreply mail (spec 3.4), so
  // the onboarding screen can show the code/link instead of the user hunting for it.
  gmailVerifyCode: { type: String, default: '' },
  gmailVerifyLink: { type: String, default: '' },
  gmailVerifyAt:   { type: Date },
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
    lastTxnDate:     { type: Date },                    // sync cursor: newest imported txn date
    lastSyncAttempt: { type: Date },                    // rate-cap clock (last attempt, success or not)
    dirty:           { type: Boolean, default: false }, // webhook flagged new data to pull
    needsReauth:     { type: Boolean, default: false }, // user must manually re-link
  }],
  // Automonie Pro subscription (Paystack). We keep only the reusable authorization
  // token so renewals can charge the card without re-checkout. plan/planExpiry above
  // hold the entitlement; this holds how it renews.
  proSub: {
    authorizationCode: { type: String, default: '' },
    last4:             { type: String, default: '' },
    cardType:          { type: String, default: '' },
    autoRenew:         { type: Boolean, default: false },
    lastReference:     { type: String, default: '' },
  },
  resetToken: String,
  resetTokenExpiry: Date,
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

// ── Plans and gating (lib/plans) ───────────────────────────────────────────────
// Free, Plus (stored as 'pro'), Student and Power, plus a 14-day Plus trial for new
// accounts. Gates ask for a feature, not a plan, so plans can change shape freely.
const hasFeature = (user, feature) => plans.hasFeature(user, feature);
// Any paid-plan access (a paid plan, the trial, or an admin).
const isPro = (user) => plans.entitlement(user).features.length > 0;
// Standard 402 body a gated route returns, so every client can show one paywall.
const upgradeRequired = (feature) => {
  const cfg = plans.config();
  return { upgrade: true, feature, priceNaira: cfg.plusPrice, features: plans.PLUS_FEATURES.map((f) => plans.FEATURE_LABELS[f]), plans: plans.catalog(cfg), message: 'This is an Automonie Plus feature.' };
};

// Pro checkout stays OFF until BOTH the Paystack key is set AND it's explicitly
// switched on, so it can be fully built and deployed without going live. Flip
// PRO_CHECKOUT_ENABLED=true to launch.
const proCheckoutReady = () => !!process.env.PAYSTACK_SECRET_KEY && process.env.PRO_CHECKOUT_ENABLED === 'true';

// One row per successful Pro payment: makes granting idempotent (unique reference)
// and doubles as billing history.
const proPaymentSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  reference: { type: String, required: true, unique: true },
  amount:    { type: Number, default: 0 },
  months:    { type: Number, default: 1 },
  kind:      { type: String, enum: ['checkout', 'renewal'], default: 'checkout' },
  createdAt: { type: Date, default: Date.now },
});
const ProPayment = mongoose.model('ProPayment', proPaymentSchema);

// Sign-ups are held here until the email OTP is confirmed - the real User is
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
  // 'internal_transfer' = moving money between own banks (Spec 3). The other
  // non-discretionary kinds (cash_withdrawal / loan_in / debt_repayment / reversal
  // / failed) come from lib/txnKinds: all excluded from spending/income math the
  // same way (they are neither 'income' nor 'expense', so aggregations skip them).
  type: { type: String, enum: ['income', 'expense', 'internal_transfer', 'cash_withdrawal', 'loan_in', 'debt_repayment', 'reversal', 'failed'], required: true },
  // Origin tracking so transactions can be grouped/deleted by bank statement.
  source: { type: String, enum: ['manual', 'import', 'email', 'share', 'sms', 'notification'], default: 'manual' },
  bank: { type: String, default: '' },           // e.g. 'GTBank', 'Union', 'Kuda'
  // Account fingerprint (spec Addendum A, slice 2): the resolved bank code plus the
  // masked account tail (last 3-4 digits) the alert/statement referenced. Together
  // (bankCode, accountMask) identify WHICH of the user's accounts a transaction hit,
  // so a UserAccount can be named and multi-account / internal-transfer scoping works.
  bankCode: { type: String, default: '' },
  accountMask: { type: String, default: '' },    // e.g. '4120'
  // Normalised sender ID kept when the bank couldn't be resolved, so the user can
  // tag it later and we can retro-stamp their matching rows (Addendum A slice 3).
  senderKey: { type: String, default: '' },
  importBatch: { type: String, default: '' },     // one id per uploaded statement
  importedAt: { type: Date },
  transferPairId: { type: String, default: '' },  // links the two sides of an internal transfer
  reversalPairId: { type: String, default: '' },  // links a reversal credit to the debit it cancels
  // Cash tracking (spec C4): a cash_withdrawal the user has broken down into what the
  // cash was actually spent on. The child expense rows carry cashParentId = the
  // withdrawal's id, so the spending is counted while the withdrawal stays excluded.
  cashAllocated: { type: Boolean, default: false },
  cashParentId:  { type: String, default: '' },
  // Share-to-Automonie ingestion (share-sheet channel): provenance of a shared alert.
  parseConfidence: { type: String, default: '' },   // 'high' | 'low' at confirm time
  parseId:         { type: String, default: '' },   // ties the saved row to its parse
  dedupeGroupId:   { type: String, default: '' },   // shared with a merged auto-forward twin
  // Set when the user confirms a low-confidence row in the Action Center.
  reviewedAt:      { type: Date },
}, { timestamps: true });

// Confirmed self-transfer routes (a pair of the user's own banks). Once a user
// confirms "GTB -> Access is me moving my own money", future matches auto-classify.
const transferRouteSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  routeKey: { type: String, required: true },     // direction-agnostic 'access|gtb'
}, { timestamps: true });
transferRouteSchema.index({ userId: 1, routeKey: 1 }, { unique: true });
const TransferRoute = mongoose.model('TransferRoute', transferRouteSchema);
// Indexes for the common per-user queries (date listing & statement grouping).
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, importBatch: 1 });
const Transaction = mongoose.model('Transaction', transactionSchema);

// A distinct bank account the user has been seen transacting on (spec Addendum A,
// slice 2). Keyed by (bankCode, accountMask); created the first time a transaction
// fingerprints to a new pair, so the app can prompt "name this account" and later
// scope views/transfers per account. label empty ⇒ not yet named by the user.
const userAccountSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  bankCode:    { type: String, required: true },   // registry code, e.g. 'gtbank'
  bankName:    { type: String, default: '' },      // display name at first sight
  accountMask: { type: String, default: '' },      // last 3-4 digits, e.g. '4120' ('' = added by hand without them)
  label:       { type: String, default: '' },      // user-given nickname ('' = unnamed)
  type:        { type: String, enum: ['', 'current', 'savings', 'wallet', 'card', 'other'], default: '' },
  addedByUser: { type: Boolean, default: false },  // created in Accounts, not detected from alerts
  mergedInto:  { type: mongoose.Schema.Types.ObjectId, default: null }, // merged into another account: its alerts go there
  txnCount:    { type: Number, default: 0 },
  firstSeen:   { type: Date },
  lastSeen:    { type: Date },
  hidden:      { type: Boolean, default: false },   // user dismissed the naming prompt
  active:      { type: Boolean, default: true },     // false = deactivated (hidden from switcher + 'all' views, reversible)
  deleted:     { type: Boolean, default: false },    // user deleted it; kept so later alerts and imports don't bring it back
}, { timestamps: true });
userAccountSchema.index({ userId: 1, bankCode: 1, accountMask: 1 }, { unique: true });
const UserAccount = mongoose.model('UserAccount', userAccountSchema);

// People & Family ledger. Every person/business the user sends to or receives from,
// built from transfer counterparties (lib/counterparty). Aggregated stats let us show
// "who you send the most to", suggest family by shared surname, and: once the user
// labels a contact (relationship + optional category): auto-categorise their
// transfers. User-set fields (relationship/label/category) are never overwritten by
// re-aggregation. Keyed by account number when known, else normalised name.
const contactSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key:           { type: String, required: true },   // contactKey: 'acct:…' | 'name:…'
  name:          { type: String, default: '' },      // best-seen display name
  bank:          { type: String, default: '' },
  account:       { type: String, default: '' },      // may be masked (503****065)
  sentTotal:     { type: Number, default: 0 },       // ₦ you sent them
  sentCount:     { type: Number, default: 0 },
  receivedTotal: { type: Number, default: 0 },       // ₦ they sent you
  receivedCount: { type: Number, default: 0 },
  firstSeen:     { type: Date },
  lastSeen:      { type: Date },
  familySuggested: { type: Boolean, default: false }, // shared-surname signal (suggestion only)
  relationship:  { type: String, enum: ['family', 'friend', 'business', 'self', 'unknown'], default: 'unknown' },
  label:         { type: String, default: '' },      // user nickname
  category:      { type: String, default: '' },      // user-set: auto-apply to their transfers
}, { timestamps: true });
contactSchema.index({ userId: 1, key: 1 }, { unique: true });
const Contact = mongoose.model('Contact', contactSchema);

// Learn-unknown-senders flywheel (spec Addendum A, slice 3). A sender ID the parser
// couldn't map to a bank becomes an UnknownSender (one global doc per senderKey). As
// users tag it (SenderTag), votes accumulate; once enough distinct users agree on the
// same bank it's promoted, and from then on everyone's alerts from that sender
// resolve automatically. `status`: open → promoted (learned) | dismissed (not a bank).
const unknownSenderSchema = new mongoose.Schema({
  senderKey:       { type: String, required: true, unique: true },
  sample:          { type: String, default: '' },   // one redacted example, for context
  source:          { type: String, default: 'sms' },
  count:           { type: Number, default: 0 },     // total times seen (all users)
  status:          { type: String, enum: ['open', 'promoted', 'dismissed'], default: 'open' },
  promotedBankCode: { type: String, default: '' },
  promotedBankName: { type: String, default: '' },
  lastSeen:        { type: Date },
}, { timestamps: true });
const UnknownSender = mongoose.model('UnknownSender', unknownSenderSchema);

// One user's answer to "which bank is this sender?": their own resolution AND a vote
// toward promoting the sender globally. Unique per (user, sender).
const senderTagSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderKey: { type: String, required: true },
  bankCode:  { type: String, required: true },
  bankName:  { type: String, default: '' },
}, { timestamps: true });
senderTagSchema.index({ userId: 1, senderKey: 1 }, { unique: true });
senderTagSchema.index({ senderKey: 1, bankCode: 1 });
const SenderTag = mongoose.model('SenderTag', senderTagSchema);

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
  notifiedMilestone: { type: Number, default: 0 }, // last 25/50/75/100% a nudge was sent for
  createdAt: { type: Date, default: Date.now }
});
const Goal = mongoose.model('Goal', goalSchema);

// Every nudge sent, which line it used, and whether it was opened (the weekly report).
const nudgeLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  trigger:   { type: String, required: true },
  category:  { type: String, default: '' },
  variantId: { type: String, required: true },
  key:       { type: String, required: true }, // the occasion, so it is never sent twice
  sentAt:    { type: Date, required: true },
  openedAt:  { type: Date, default: null },
});
nudgeLogSchema.index({ userId: 1, sentAt: -1 });
nudgeLogSchema.index({ sentAt: -1 });
const NudgeLog = mongoose.model('NudgeLog', nudgeLogSchema);

// Admin edits to the nudge copy (by variant id), applied over data/nudge-copy.json.
const nudgeCopySchema = new mongoose.Schema({
  trigger:    { type: String, required: true },
  variantId:  { type: String, required: true },
  text:       { type: String, required: true },
  withAmount: { type: String, default: '' },
  complete:   { type: Boolean, default: false },
  active:     { type: Boolean, default: true },
}, { timestamps: true });
nudgeCopySchema.index({ trigger: 1, variantId: 1 }, { unique: true });
const NudgeCopy = mongoose.model('NudgeCopy', nudgeCopySchema);


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

// Global consensus categorizer - a free, self-improving classifier trained on the
// whole userbase's corrections. For each anonymised merchant `key` we tally which
// category people assign it (no amounts, no names, no userIds). New users then get
// accurate categories from the collective. Runs entirely on our own DB - no LLM,
// no per-call cost.
const globalCategorySchema = new mongoose.Schema({
  key:      { type: String, required: true, unique: true },
  counts:   { type: mongoose.Schema.Types.Mixed, default: {} }, // { <catSlug>: votes }
  total:    { type: Number, default: 0 },
  updatedAt:{ type: Date, default: Date.now },
});
const GlobalCategory = mongoose.model('GlobalCategory', globalCategorySchema);

// Parse-correction log: every review through the import gate (accepted OR edited)
// is a labelled training example: the raw source text, what we parsed, and what
// the user finalised it to. This is the proprietary dataset that later trains a
// real categoriser. Written fire-and-forget; never blocks a save. Deleted with the
// user's account; skipped entirely for users who set trainingOptOut.
const parseCorrectionSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  createdAt:{ type: Date, default: Date.now },
  // input
  rawText:  { type: String, default: '' },   // exact source string, unmodified
  source:   { type: String, enum: ['sms', 'email', 'statement_pdf', 'statement_csv', 'mono', 'voice', 'manual'], default: 'sms' },
  bankCode: { type: String, default: '' },
  fileFormatHint: { type: String, default: '' },
  // what we parsed
  parsedAmount:       { type: Number, default: null },
  parsedDirection:    { type: String, enum: ['debit', 'credit', null], default: null },
  parsedDate:         { type: Date, default: null },
  parsedCounterparty: { type: String, default: null },
  parsedCategory:     { type: String, default: null },
  parserVersion:      { type: String, default: '' },
  parserPath:         { type: String, enum: ['deterministic', 'llm_fallback', 'none'], default: 'none' },
  confidenceScore:    { type: Number, default: null },
  // what the user finalised it to
  finalAmount:        { type: Number },
  finalDirection:     { type: String, enum: ['debit', 'credit'] },
  finalDate:          { type: Date },
  finalCounterparty:  { type: String, default: '' },
  finalCategory:      { type: String, default: '' },
  wasCorrected:       { type: Boolean, default: false },
  correctedFields:    { type: [String], default: [] },
  userAction:         { type: String, enum: ['accepted', 'edited', 'rejected'], default: 'accepted' },
  // context
  timeToReviewMs:     { type: Number, default: null },
});
const ParseCorrection = mongoose.model('ParseCorrection', parseCorrectionSchema);

// Reconciliation outcome per statement import (spec A5/A7). Powers the accuracy
// dashboard's "% of imports that reconcile": the single best measure of parser
// health, tracked per bank. One row per upload that produced transactions.
const reconLogSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  bank:       { type: String, default: '' },
  source:     { type: String, default: 'statement' }, // statement_pdf | statement_csv | statement
  checked:    { type: Boolean, default: false },       // did we have balances to verify?
  ok:         { type: Boolean, default: null },         // balanced (only when checked)
  difference: { type: Number, default: null },
  rows:       { type: Number, default: 0 },
  uncertain:  { type: Number, default: 0 },             // rows flagged low/medium confidence (A6)
  createdAt:  { type: Date, default: Date.now, index: true },
});
const ReconLog = mongoose.model('ReconLog', reconLogSchema);

// Only real merchant/spend categories feed the SHARED pool. Person-to-person
// categories (Transfer, Savings, Family & Friends), income, and the catch-alls are
// excluded - a transfer key can be someone's name, which must never be shared. A
// vote threshold on top of this means a one-off personal key can't reach consensus.
const GLOBAL_ELIGIBLE_CATEGORIES = new Set([
  'Food', 'Groceries', 'Transport', 'Fuel', 'Housing', 'Utilities', 'Airtime & Data',
  'Shopping', 'Healthcare', 'Entertainment', 'Subscriptions', 'Education', 'Insurance',
  'Bank Charges', 'ATM/POS',
]);
const globalEligible = (c) => GLOBAL_ELIGIBLE_CATEGORIES.has(c);
// Category names hold spaces/&//, which are awkward as Mongo field keys - slug them.
const catSlug = (c) => c.replace(/[^a-z0-9]+/gi, '_');
const SLUG_TO_CAT = new Map([...GLOBAL_ELIGIBLE_CATEGORIES].map((c) => [catSlug(c), c]));
// Consensus is only trusted with enough independent votes AND a clear majority.
const GLOBAL_MIN_VOTES = 4;
const GLOBAL_MIN_SHARE = 0.6;

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
  link:    { type: String, default: '' },       // where tapping the item navigates (a real in-app route)
  dedupeKey: { type: String, default: '' },     // idempotency key (e.g. reminder:statement:2026-09); NOT a nav target
  read:    { type: Boolean, default: false },
}, { timestamps: true });
notificationSchema.index({ userId: 1, createdAt: -1 });
const Notification = mongoose.model('Notification', notificationSchema);

const createNotification = async (userId, { type = 'info', title, message = '', link = '', dedupeKey = '' }) => {
  try { await Notification.create({ userId, type, title, message, link, dedupeKey }); }
  catch (e) { console.error('[createNotification]', e.message); }
};

// In-app / beta feedback. Any signed-in user can send it; beta testers are nudged to.
// Superadmin reads it in the admin feedback inbox.
const feedbackSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  email:      { type: String, default: '' },
  name:       { type: String, default: '' },
  kind:       { type: String, enum: ['bug', 'idea', 'praise', 'other'], default: 'other' },
  message:    { type: String, required: true },
  platform:   { type: String, default: '' },   // 'web' | 'mobile'
  appVersion: { type: String, default: '' },
  betaTester: { type: Boolean, default: false },
  handled:    { type: Boolean, default: false }, // admin can mark as dealt with
}, { timestamps: true });
feedbackSchema.index({ userId: 1, createdAt: -1 });
const Feedback = mongoose.model('Feedback', feedbackSchema);

// Site-wide dismissible banner. A new doc is created each time it's set (so editing
// re-shows it to everyone); GET returns the latest active one. Per-user dismissal is
// tracked client-side by banner _id.
const globalBannerSchema = new mongoose.Schema({
  message:  { type: String, default: '' },
  type:     { type: String, default: 'info' }, // 'info' | 'warning' | 'success'
  link:     { type: String, default: '' },
  linkText: { type: String, default: '' },
  active:   { type: Boolean, default: false },
  createdBy:{ type: String, default: '' },
}, { timestamps: true });
const GlobalBanner = mongoose.model('GlobalBanner', globalBannerSchema);

// Activity log - a durable history of milestone actions in the app (goal
// reached, goal created, Pro subscribed...), distinct from the
// bank/transaction ledger. Surfaced on the History screen.
const activitySchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, required: true }, // 'goal_reached','goal_created','goal_withdrawn','pro_subscribed'
  title:   { type: String, required: true },
  message: { type: String, default: '' },
  amount:  { type: Number, default: 0 },
}, { timestamps: true });
activitySchema.index({ userId: 1, createdAt: -1 });
const Activity = mongoose.model('Activity', activitySchema);

const logActivity = async (userId, { type, title, message = '', amount = 0 }) => {
  try { await Activity.create({ userId, type, title, message, amount }); }
  catch (e) { console.error('[logActivity]', e.message); }
};

// Pre-launch waitlist - captured from the marketing site. Public, no auth.
const waitlistSchema = new mongoose.Schema({
  email:  { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:   { type: String, default: '' },
  phone:  { type: String, default: '' },   // WhatsApp number, for the community group
  source: { type: String, default: 'website' },
  // Newsletter: one-click unsubscribe (compliance). Token minted lazily at send time.
  unsubscribed: { type: Boolean, default: false },
  unsubToken:   { type: String, default: '' },
  newsletter:   { type: Boolean, default: false }, // subscribed through the newsletter form
  // When each welcome email was sent; set once, so signing up twice never sends twice.
  welcomeWaitlistAt:   { type: Date, default: null },
  welcomeNewsletterAt: { type: Date, default: null },
}, { timestamps: true });
const Waitlist = mongoose.model('Waitlist', waitlistSchema);

// A sent newsletter, kept for history/audit. We never store recipient emails here,
// only counts: the audience is always the current waitlist at send time.
const newsletterSchema = new mongoose.Schema({
  subject:   { type: String, required: true },
  html:      { type: String, default: '' },
  sent:      { type: Number, default: 0 },
  failed:    { type: Number, default: 0 },
  audience:  { type: Number, default: 0 },
  sentBy:    { type: String, default: '' },
}, { timestamps: true });
const Newsletter = mongoose.model('Newsletter', newsletterSchema);

// Images uploaded for a newsletter, served from a public URL so email clients can load
// them. Kept small; stored in the DB to avoid needing an external host.
const newsletterAssetSchema = new mongoose.Schema({
  data:        { type: Buffer, required: true },
  contentType: { type: String, required: true },
  createdBy:   { type: String, default: '' },
}, { timestamps: true });
const NewsletterAsset = mongoose.model('NewsletterAsset', newsletterAssetSchema);

// Recap release control - a single global doc. Each window is 'auto' (client's
// schedule rule decides), 'on' (force-dropped to everyone, Spotify-style) or
// 'off' (held). Lets an admin drop the yearly Wrapped exactly when they want.
const recapReleaseSchema = new mongoose.Schema({
  scope: { type: String, default: 'global', unique: true },
  day:   { type: String, enum: ['auto', 'on', 'off'], default: 'auto' },
  week:  { type: String, enum: ['auto', 'on', 'off'], default: 'auto' },
  month: { type: String, enum: ['auto', 'on', 'off'], default: 'auto' },
  year:  { type: String, enum: ['auto', 'on', 'off'], default: 'auto' },
}, { timestamps: true });
const RecapRelease = mongoose.model('RecapRelease', recapReleaseSchema);
async function getRecapRelease() {
  let r = await RecapRelease.findOne({ scope: 'global' });
  if (!r) r = await RecapRelease.create({ scope: 'global' });
  return r;
}

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
    const title = threshold === 'over' ? `Over budget: ${category}` : `Budget alert: ${category}`;
    const message = `You've used ${pctRound}% of your ${category} budget for ${monthStr}.`;
    // In-app only. The push for this goes through the nudge engine (budget_80 /
    // budget_over), which applies the daily limits, quiet hours and the user's settings.
    await createNotification(userId, { type: 'info', title, message, link });
  } catch (e) { console.error('[checkBudgetAlert]', e.message); }
};

const recurringBillSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 },
  dueDate: { type: Number, required: true },
  frequency: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  category: { type: String, default: 'Bills' },
  nextDue: { type: Date, required: true },
  status: { type: String, enum: ['active', 'paused'], default: 'active' },
  createdAt: { type: Date, default: Date.now }
});
const RecurringBill = mongoose.model('RecurringBill', recurringBillSchema);

const subscriptionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:      { type: String, required: true },
  cost:      { type: Number, required: true, min: 0 },
  frequency: { type: String, enum: ['monthly', 'yearly'], default: 'monthly' },
  category:  { type: String, default: 'Entertainment' },
  // 'cancelling' = the user started the assisted cancel flow; we watch the ledger to
  // confirm the charge actually stops (C1). cancelRequestedAt is the verification
  // baseline: any matching charge dated after it means the cancellation didn't take.
  status:    { type: String, enum: ['active', 'cancelling', 'cancelled'], default: 'active' },
  cancelRequestedAt: { type: Date },
  nextPayment: { type: Date },
  // Auto-linking: when a transaction is recognised as a subscription (import, email,
  // SMS, or manual recategorise) we upsert a Subscription keyed by sourceKey so it
  // shows on the Subscriptions page immediately. autoDetected ones are kept current
  // from the ledger; a user edit takes over.
  sourceKey:    { type: String, default: '' },
  autoDetected: { type: Boolean, default: false },
  lastCharge:   { type: Date },
  // Renewal reminders: the day of the month it bills (inferred from the last charge
  // when tracked from a detection, or set by the user), and how many days ahead to
  // nudge. No money moves: this only powers a "renews soon" notification.
  renewalDay:       { type: Number, min: 1, max: 31 },
  remindDaysBefore: { type: Number, default: 3, min: 0, max: 30 },
  // Auto-detected from a charge we couldn't name (e.g. 'N FLX' we don't know): the
  // user is asked what it is. Cleared once they rename it.
  needsName: { type: Boolean, default: false },
}, { timestamps: true });
subscriptionSchema.index({ userId: 1, sourceKey: 1 });
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Detections the user dismissed as "not a subscription", so /detect stops resurfacing
// them. Keyed by the same merchant signature the detector groups on.
const dismissedDetectionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  key:    { type: String, required: true },
}, { timestamps: true });
dismissedDetectionSchema.index({ userId: 1, key: 1 }, { unique: true });
const DismissedDetection = mongoose.model('DismissedDetection', dismissedDetectionSchema);

// Pairs of transactions the user said are both real (not a duplicate), so the Action
// Center stops asking. pairKey = the two ids sorted and joined.
const keptPairSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  pairKey: { type: String, required: true },
}, { timestamps: true });
keptPairSchema.index({ userId: 1, pairKey: 1 }, { unique: true });
const KeptPair = mongoose.model('KeptPair', keptPairSchema);

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
// the password is missing or wrong, pdf.js rejects with a PasswordException -
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

// Reject dates that parsed to something impossible - a wrong year/month/day means
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

// GTBank/GTCO (and similar) statements print an "Originating Branch" column
// (e.g. "635 AKIN ADESOLA") between the running balance and the free-text
// "Remarks". Because the balance parser flattens each row, that branch, plus the
// leading Reference token: gets glued to the front of every description, pushing
// the meaningful remarks out of view. The branch is IDENTICAL on every row, so we
// find it as the longest common prefix of each row's "<3-digit code> ..." tail and
// strip it (and anything before it), leaving the Remarks as the description. Bails
// safely (leaves descriptions untouched) when a statement isn't this layout.
const stripBranchPrefix = (transactions) => {
  const starts = [];
  const tails = [];
  for (const t of transactions) {
    const m = t.description.match(/\b\d{3}\s+[A-Z]/); // branch code + branch name start
    starts.push(m ? m.index : -1);
    tails.push(m ? t.description.slice(m.index) : null);
  }
  const present = tails.filter(Boolean);
  // Need the pattern on a real majority of rows before we trust it as the branch.
  if (present.length < Math.max(3, transactions.length * 0.5)) return;
  let lcp = present[0];
  for (const s of present) {
    let i = 0;
    while (i < lcp.length && i < s.length && lcp[i] === s[i]) i++;
    lcp = lcp.slice(0, i);
    if (!lcp) return; // no shared branch → don't risk mangling descriptions
  }
  // Drop a trailing partial word, unless most rows end that word right there (a row
  // like "...ADESOLAInstant Payment" glues the next word on; that is not a partial).
  const wordEnds = present.filter((t) => t.length === lcp.length || /^(?:[\s:;,'"’.\-]|[A-Z][a-z])/.test(t.slice(lcp.length, lcp.length + 2))).length;
  if (wordEnds < present.length * 0.5) lcp = lcp.replace(/\s+\S*$/, '');
  lcp = lcp.trim();
  if (!/^\d{3}\s+[A-Za-z]/.test(lcp) || lcp.length < 4 || lcp.length > 48) return;
  for (let i = 0; i < transactions.length; i++) {
    if (starts[i] === -1) continue;
    const t = transactions[i];
    const remarks = t.description.slice(starts[i] + lcp.length).replace(/^[\s:;,'"’.\-]+/, '').trim();
    if (remarks) {
      t.description = remarks.slice(0, 140).trim();
      t.category = categorizeTransaction(t.description, t.type); // re-categorise on the cleaner text
    }
  }
};

// Balance-aware parser for Nigerian bank statement PDFs (Union Bank, GTBank, etc.).
// These statements have no delimiters between columns, so the debit/credit columns
// are unreliable. Instead we read the running BALANCE at the end of each record and
// derive the transaction amount and direction from the balance change. This makes
// the extracted ledger reconcile exactly with the statement's opening/closing balance.
const parseStatementByBalance = (rawText) => {
  const lines = rawText.split('\n').map(l => l.replace(/ /g, ' ').trim()).filter(Boolean);

  // Opening + closing balance read straight from the statement's labelled summary
  // ("Opening Balance ..." / "Closing Balance ..."). The opening seeds the running-
  // balance derivation below; the closing is the independent anchor for reconciliation
  // (A5): opening + credits - debits must equal it, or a row was lost/misread.
  const { openingBalance, closingBalance } = extractBalances(rawText);
  let prevBalance = openingBalance != null ? openingBalance : null;

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

    let type, amount, confidenceLevel, columnAmount = null;
    if (prevBalance !== null && Math.abs(balance - prevBalance) > 0.005) {
      // Derive amount + direction from how the running balance moved: the balance
      // column validates both, so this is our high-confidence path (A6).
      amount = Math.abs(balance - prevBalance);
      type = balance >= prevBalance ? 'income' : 'expense';
      confidenceLevel = 'high';
      // The printed debit/credit, used to catch a lost row hiding in this jump.
      if (monies.length >= 2) columnAmount = monies[monies.length - 2];
    } else {
      // No usable balance baseline - fall back to the amount column + keywords.
      // Unvalidated → medium confidence, flagged for a look in the review gate.
      amount = monies.length >= 2 ? monies[monies.length - 2] : monies[0];
      type = inferTransactionType(block);
      confidenceLevel = 'medium';
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
      confidenceLevel,
      ...(columnAmount != null ? { columnAmount } : {}),
    });
  }
  // Reduce each description to the bank's "Remarks" narration where the layout has a
  // repeated Originating Branch column glued to the front (GTBank/GTCO etc.).
  stripBranchPrefix(transactions);
  // Reconcile the parsed ledger against the statement's own opening/closing balance.
  // Attached to the array (like .bank) so the upload route can surface it and flag
  // an import that doesn't balance before the user saves anything.
  transactions.openingBalance = openingBalance;
  transactions.closingBalance = closingBalance;
  // A statement is one account: fingerprint it once and stamp every row so the
  // import can attribute all of them to (bankCode, accountMask): Addendum A slice 2.
  const acct = fingerprintAccount(rawText);
  transactions.bankCode = acct.bankCode;
  transactions.accountMask = acct.accountMask;
  transactions.forEach((t) => { t.bankCode = acct.bankCode; t.accountMask = acct.accountMask; });
  const rec = reconcile({ transactions, openingBalance, closingBalance });
  transactions.reconciliation = rec;
  // If the ledger doesn't balance, the whole import is suspect: no row is "clean"
  // any more (drop high→medium), and the first divergent row and everything after it
  // are where the error lives (→ low). This is A6 confidence driven by A5.
  if (rec.checked && rec.ok === false) {
    const flagged = new Set(rec.amountMismatches || []);
    transactions.forEach((t, i) => {
      if (t.confidenceLevel === 'high') t.confidenceLevel = 'medium';
      // Amount-column mismatches pinpoint the rows; otherwise everything from the
      // first divergence on is suspect.
      if (flagged.size ? flagged.has(i) : (rec.firstDivergenceIndex != null && i >= rec.firstDivergenceIndex)) t.confidenceLevel = 'low';
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
    // Encrypted PDF with a missing or incorrect password - re-throw so the upload
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
    console.warn('[parsePDF] Very little text extracted - PDF may be a scanned image');
    return [];
  }

  // Dedicated strategy: OPay / OWealth wallet statements (space+time dates, glued
  // debit/credit/balance columns). The balance-aware parser can't read these and the
  // generic fallback used to turn their timestamps into hundreds of garbage rows, so
  // we detect and parse them explicitly, tagging OWealth churn + own-name transfers
  // as internal so they don't inflate income/spending.
  const opayParsed = parseOpayStatement(rawText);
  if (opayParsed && opayParsed.length > 0) {
    console.log(`[parsePDF] OPay parser found ${opayParsed.length} transactions (${opayParsed.filter(t => t.internal).length} internal)`);
    // Stamp every row with the OPay wallet's account fingerprint (bank code + last
    // 4 of the wallet number) so the wallet registers as its own traceable account
    // for per-account views, like every other bank the parsers detect.
    const opayMask = (opayParsed.accountNumber || '').toString().replace(/\D/g, '').slice(-4);
    opayParsed.forEach((t) => {
      if (!t.category) t.category = categorizeTransaction(t.description, t.type === 'income' ? 'income' : 'expense');
      t.bankCode = 'opay';
      if (opayMask) t.accountMask = opayMask;
    });
    opayParsed.bank = 'OPay';
    opayParsed.bankCode = 'opay';
    opayParsed.accountMask = opayMask;
    // Balance can't reconcile on OPay (OWealth-funded debits bypass the wallet
    // balance), but the explicit debit/credit columns are authoritative → trusted.
    opayParsed.reconciliation = { checked: false, ok: null };
    return opayParsed;
  }

  // Primary strategy: balance-aware parser for delimiter-less Nigerian bank PDFs.
  const balanceParsed = parseStatementByBalance(rawText);
  if (balanceParsed.length > 0) {
    console.log(`[parsePDF] Balance-aware parser found ${balanceParsed.length} transactions`);
    balanceParsed.bank = detectBank(rawText);
    return balanceParsed;
  }

  // Hybrid LLM fallback: the sustainability layer. When NO deterministic strategy
  // recognises the layout (a bank/fintech format we haven't hand-coded), ask the
  // configured model to extract the rows. It's validated the same way as everything
  // else: the reconciliation oracle re-checks the ledger, so a hallucinated amount
  // can't slip in. This is what lets new banks import with zero per-bank code.
  const llmParsed = await llmParseStatement(rawText);
  if (llmParsed && llmParsed.length > 0) {
    console.log(`[parsePDF] LLM parser found ${llmParsed.length} transactions (reconciled=${llmParsed.reconciliation?.ok})`);
    return llmParsed;
  }
  console.log('[parsePDF] Balance-aware + LLM found nothing - trying generic strategies…');

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
      balance,
      confidenceLevel: 'medium', // generic column parse, no balance validation (A6)
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
        balance: null,
        confidenceLevel: 'low', // speculative line-pair guess: flag for the user (A6)
      });

      i++; // skip the next line since we used it
    }
  }

  console.log(`[parsePDF] Parsed ${transactions.length} transactions`);
  transactions.bank = detectBank(rawText);
  // Even on the generic path, reconcile against any labelled opening/closing balance
  // in the text: it's the check that catches a dropped row on an unfamiliar format.
  const { openingBalance, closingBalance } = extractBalances(rawText);
  transactions.openingBalance = openingBalance;
  transactions.closingBalance = closingBalance;
  transactions.reconciliation = reconcile({ transactions, openingBalance, closingBalance });

  // SAFETY GATE: the generic strategies are best-effort guesses (they once turned an
  // OPay statement's timestamps into 500+ bogus rows). If the statement gave us a
  // real opening AND closing balance and this parse provably does NOT balance, the
  // ledger is wrong: returning nothing (→ the upload route asks the user to try
  // pasting alerts) is far safer than importing garbage the user might trust.
  if (transactions.reconciliation.checked && transactions.reconciliation.ok === false) {
    console.warn(`[parsePDF] Generic parse rejected: does not reconcile (off by ${transactions.reconciliation.difference}). Refusing ${transactions.length} untrusted rows.`);
    const rejected = [];
    rejected.bank = transactions.bank;
    rejected.rejectedReason = 'unreadable';
    return rejected;
  }
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

// categorizeTransaction now lives in lib/categorize (pure + corpus-tested against
// real bank alerts); imported at the top. Category names stay in sync with
// frontend/src/constants/categories.js so budgets cross-check correctly.

// Fold duplicate subscriptions of the same service into one. Rows the user created
// or edited win over auto-detected ones; among auto rows the most recently charged
// survives. Auto rows also take the brand's clean name once we recognise it.
async function mergeDuplicateSubscriptions(userId) {
  const subs = await Subscription.find({ userId, status: { $ne: 'cancelled' } });
  const groups = new Map();
  for (const s of subs) {
    const key = subscriptionKey(s.name) || s.sourceKey;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  for (const group of groups.values()) {
    const brand = brandFor(group[0].name);
    if (group.length > 1) {
      group.sort((a, b) => (a.autoDetected - b.autoDetected)
        || (new Date(b.lastCharge || b.createdAt) - new Date(a.lastCharge || a.createdAt)));
      const [keep, ...dupes] = group;
      const autoDupes = dupes.filter((d) => d.autoDetected);
      if (autoDupes.length) {
        const latest = autoDupes.reduce((m, d) => (new Date(d.lastCharge || 0) > new Date(m || 0) ? d.lastCharge : m), keep.lastCharge);
        if (latest) keep.lastCharge = latest;
        await Subscription.deleteMany({ _id: { $in: autoDupes.map((d) => d._id) }, userId, autoDetected: true });
      }
      if (brand && keep.autoDetected && keep.name !== brand.name) { keep.name = brand.name; keep.needsName = false; }
      await keep.save();
    } else if (brand && group[0].autoDetected && group[0].name !== brand.name) {
      group[0].name = brand.name;
      group[0].needsName = false;
      await group[0].save();
    }
  }
}

// Auto-link a recognised subscription so it shows on the Subscriptions page no matter
// how it entered: import, email forwarding, SMS scan, or a manual recategorise.
// Triggered when a transaction's category is 'Subscriptions': upsert a Subscription
// keyed by the merchant signature. Never clobbers a user's edits: only auto-detected
// rows are kept current from the ledger, and a service the user said is not a
// subscription is never re-added. Fire-and-forget safe.
async function maybeLinkSubscription(userId, { description, amount, category, date }) {
  if ((category || '').toString().trim().toLowerCase() !== 'subscriptions') return;
  const cost = Math.abs(Number(amount) || 0);
  if (!(cost > 0)) return;
  const brand = brandFor(description);
  const key = subscriptionKey(description);
  if (!key) return;
  const when = date ? new Date(date) : new Date();
  try {
    if (await DismissedDetection.exists({ userId, key })) return;
    // The same service under any spelling, or one the user added by hand by name.
    const or = [{ sourceKey: key }];
    if (brand) or.push({ name: new RegExp(`^${brand.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
    const existing = await Subscription.findOne({ userId, $or: or });
    if (existing) {
      const patch = { lastCharge: when };
      if (existing.autoDetected) patch.cost = Math.round(cost); // keep auto ones current; respect edits
      await Subscription.updateOne({ _id: existing._id }, { $set: patch });
      return;
    }
    const name = brand ? brand.name : (((description || '').toString().replace(/\s{2,}/g, ' ').trim().slice(0, 40)) || 'Subscription');
    await new Subscription({
      userId, name, cost: Math.round(cost), frequency: 'monthly', category: 'Subscriptions',
      status: 'active', autoDetected: true, sourceKey: key, lastCharge: when, needsName: !brand,
    }).save();
  } catch (e) { if (e && e.code !== 11000) console.error('[maybeLinkSubscription]', e.message); }
}

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

// Apply the SHARED consensus to rows the rules/user couldn't confidently place
// (still 'Other'/uncategorised). Only overrides when a merchant key has enough
// votes and a clear majority. Batch-loads to keep it one query per import.
const applyGlobalCategories = async (transactions) => {
  const isOther = (c) => !c || c === 'Other' || c === 'Other Income';
  const targets = transactions.filter((t) => isOther(t.category));
  if (!targets.length) return transactions;
  const keyOf = new Map();
  const keys = new Set();
  for (const t of targets) { const k = deriveCategoryKey(t.description); if (k) { keyOf.set(t, k); keys.add(k); } }
  if (!keys.size) return transactions;

  const docs = await GlobalCategory.find({ key: { $in: [...keys] } }).lean();
  const winner = new Map(); // key -> category
  for (const d of docs) {
    const counts = d.counts || {};
    let bestSlug = null, bestN = 0, total = 0;
    for (const [slug, n] of Object.entries(counts)) { if (n > 0) { total += n; if (n > bestN) { bestN = n; bestSlug = slug; } } }
    if (bestSlug && bestN >= GLOBAL_MIN_VOTES && total > 0 && bestN / total >= GLOBAL_MIN_SHARE) {
      const cat = SLUG_TO_CAT.get(bestSlug);
      if (cat) winner.set(d.key, cat);
    }
  }
  if (!winner.size) return transactions;
  return transactions.map((t) => {
    const k = keyOf.get(t);
    return (k && winner.has(k) && isOther(t.category)) ? { ...t, category: winner.get(k), globalGuess: true } : t;
  });
};

// Cast global votes as deltas keyed by "<key>\0<category>" -> ±n. Only eligible
// (merchant) categories are shared.
const castGlobalVotes = async (deltas) => {
  if (!deltas || !deltas.size) return;
  const ops = [];
  for (const [k, d] of deltas) {
    if (!d) continue;
    const [key, category] = k.split('|');   // key/category can't contain '|'
    ops.push({ updateOne: {
      filter: { key },
      update: { $inc: { [`counts.${catSlug(category)}`]: d, total: d }, $set: { updatedAt: new Date() } },
      upsert: true,
    } });
  }
  if (!ops.length) return;
  try { await GlobalCategory.bulkWrite(ops, { ordered: false }); }
  catch (e) { console.error('[castGlobalVotes]', e.message); }
};

// Persist description -> category mappings so future imports auto-apply them, and
// contribute one NET vote per user+key to the shared consensus (so a user can't
// stuff the global count, and changing your mind moves the vote, not adds one).
const learnCategories = async (userId, transactions) => {
  const byKey = new Map(); // dedupe within this batch (last choice wins)
  for (const t of transactions) {
    if (!t.description || !t.category) continue;
    const key = deriveCategoryKey(t.description);
    if (key) byKey.set(key, t.category);
  }
  if (!byKey.size) return;

  const prev = await LearnedCategory.find({ userId, key: { $in: [...byKey.keys()] } }).lean();
  const prevMap = new Map(prev.map((r) => [r.key, r.category]));

  const ops = [];
  const deltas = new Map();
  const bump = (key, category, d) => {
    if (!globalEligible(category)) return;
    const gk = `${key}|${category}`;
    deltas.set(gk, (deltas.get(gk) || 0) + d);
  };
  for (const [key, category] of byKey) {
    const old = prevMap.get(key);
    if (old === category) continue;            // no change → no new vote
    ops.push({ updateOne: { filter: { userId, key }, update: { $set: { category, updatedAt: new Date() } }, upsert: true } });
    if (old) bump(key, old, -1);               // move the vote off the old category
    bump(key, category, +1);
  }
  if (ops.length) {
    try { await LearnedCategory.bulkWrite(ops, { ordered: false }); }
    catch (e) { console.error('[learnCategories]', e.message); }
  }
  await castGlobalVotes(deltas);
};

// Log parse corrections from an import review. `rows` are the user-finalised
// transactions; each MAY carry a `_parse` object with the original parsed values
// + raw source text + parser metadata. Fire-and-forget (call without awaiting) so
// it never adds latency or blocks a save.
const dayKey = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return ''; } };
const normCp = (s) => (s || '').toString().toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const cleanDir = (v) => (v === 'debit' || v === 'credit' ? v : null);
const logParseCorrections = async (user, rows) => {
  try {
    if (!user || user.trainingOptOut) return;
    const uid = user._id;
    const docs = [];
    for (const t of rows || []) {
      const p = t && t._parse;
      if (!p) continue;                       // only log rows the client instrumented
      const finalDirection = t.type === 'income' ? 'credit' : 'debit';
      const finalAmount = Math.abs(Number(t.amount)) || 0;
      const finalCategory = t.category || 'Other';
      const finalCounterparty = t.description || '';
      const fields = [];
      if (p.amount != null && Math.abs(Number(p.amount)) !== finalAmount) fields.push('amount');
      if (cleanDir(p.direction) && cleanDir(p.direction) !== finalDirection) fields.push('direction');
      if (p.date && dayKey(p.date) !== dayKey(t.date)) fields.push('date');
      if (p.counterparty != null && normCp(p.counterparty) !== normCp(finalCounterparty)) fields.push('counterparty');
      if (p.category != null && p.category !== finalCategory) fields.push('category');
      const wasCorrected = fields.length > 0;
      docs.push({
        userId: uid,
        rawText: (p.rawText || '').toString(),
        source: p.source || 'sms',
        bankCode: (p.bank || p.bankCode || '').toString().toLowerCase().slice(0, 24),
        fileFormatHint: (p.fileFormatHint || '').toString().slice(0, 60),
        parsedAmount: p.amount != null ? Math.abs(Number(p.amount)) : null,
        parsedDirection: cleanDir(p.direction),
        parsedDate: p.date ? new Date(p.date) : null,
        parsedCounterparty: p.counterparty != null ? String(p.counterparty) : null,
        parsedCategory: p.category != null ? String(p.category) : null,
        parserVersion: (p.parserVersion || '').toString().slice(0, 40),
        parserPath: ['deterministic', 'llm_fallback', 'none'].includes(p.parserPath) ? p.parserPath : 'none',
        confidenceScore: p.confidence != null ? Number(p.confidence) : (p.confidenceScore != null ? Number(p.confidenceScore) : null),
        finalAmount, finalDirection, finalDate: new Date(t.date),
        finalCounterparty, finalCategory,
        wasCorrected, correctedFields: fields,
        userAction: p.action === 'rejected' ? 'rejected' : (wasCorrected ? 'edited' : 'accepted'),
        timeToReviewMs: p.timeToReviewMs != null ? Number(p.timeToReviewMs) : null,
      });
    }
    if (docs.length) await ParseCorrection.insertMany(docs, { ordered: false });
  } catch (e) { console.error('[parse-corrections]', e.message); }
};

// Internal-transfer reconciliation (Spec 3). Loads the user's transactions (a
// recent window after an import, or all history for the manual backfill), finds
// self-transfer pairs, and for each high-confidence pair marks BOTH sides
// 'internal_transfer' (excluded from spending/income) with a shared transferPairId.
// When the debited amount exceeds the credited amount, the difference is booked as
// a real 'Bank Charges' expense so the money still reconciles.
const reconcileTransfers = async (userId, { allHistory = false } = {}) => {
  const query = { userId, type: { $in: ['income', 'expense'] } };
  if (!allHistory) {
    const since = new Date(Date.now() - 120 * 86400000); // last ~120 days after an import
    query.date = { $gte: since };
  }
  const [txns, user, routes] = await Promise.all([
    Transaction.find(query).select('type amount date bank description').lean(),
    User.findById(userId).select('name').lean(),
    TransferRoute.find({ userId }).select('routeKey').lean(),
  ]);
  if (txns.length < 2) return { classified: 0, charges: 0, ask: 0 };

  const routeKeys = new Set(routes.map((r) => r.routeKey));
  const { auto, ask } = detectTransfers(txns, { userName: user?.name || '', routeKeys });
  if (!auto.length) return { classified: 0, charges: 0, ask: ask.length };

  const ops = [];
  let charges = 0;
  for (const pair of auto) {
    const pairId = new mongoose.Types.ObjectId().toString();
    ops.push({ updateOne: { filter: { _id: pair.debit._id, userId }, update: { $set: { type: 'internal_transfer', transferPairId: pairId } } } });
    ops.push({ updateOne: { filter: { _id: pair.credit._id, userId }, update: { $set: { type: 'internal_transfer', transferPairId: pairId } } } });
    if (pair.fee > 0) {
      ops.push({ insertOne: { document: {
        userId, date: new Date(pair.debit.date), amount: -Math.abs(pair.fee),
        description: 'Transfer fee', category: 'Bank Charges', type: 'expense',
        source: 'import', bank: pair.debit.bank || '', transferPairId: pairId,
      } } });
      charges++;
    }
  }
  if (ops.length) { try { await Transaction.bulkWrite(ops, { ordered: false }); } catch (e) { console.error('[reconcileTransfers]', e.message); } }
  return { classified: auto.length, charges, ask: ask.length };
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
  // Registry cascade first (resolves truncated sender IDs like PREMIUMTRST, and email
  // domains), then the legacy keyword signatures as a fallback.
  const m = resolveBankRegistry(text);
  if (m) return m.name;
  const l = (text || '').toLowerCase();
  for (const [name, kws] of BANK_SIGNATURES) {
    if (kws.some(kw => l.includes(kw))) return name;
  }
  return '';
};

// Account fingerprint from an alert/statement (spec Addendum A, slice 2): the
// registry bank code + name (so multiple sender-ID spellings collapse to one code)
// and the masked account tail. Returns empty strings when unknown: never guesses.
// An explicit sender ID (SMS address / email from) is fed to the resolver's fuzzy
// path and, when the bank is still unknown, kept as senderKey for the learn-unknown
// -senders flywheel (Addendum A slice 3).
const normalizeSenderKey = (s = '') => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
const fingerprintAccount = (text = '', sender = '') => {
  const m = resolveBankRegistry(text, sender || undefined);
  const key = normalizeSenderKey(sender);
  return {
    bankCode: m ? m.code : '',
    bankName: m ? m.name : detectBank(text),
    accountMask: extractAccountMask(text) || '',
    // Only a meaningful (≥4 char) sender is worth learning; skip shortcodes/blanks.
    senderKey: !m && key.length >= 4 ? key : '',
  };
};

// Record that a (bankCode, accountMask) pair was seen for a user, creating the
// UserAccount on first sight (unnamed) and bumping its counters otherwise. Needs a
// mask AND a resolved bank to be meaningful; a bare mask with no bank is ignored so
// we don't create ghost "unknown-bank" accounts. Fire-and-forget safe.
// Accounts the user merged into another one: 'code|mask' -> the account they went
// into, so new alerts and imports for the old fingerprint land on the merged account.
async function mergedAccountMap(userId) {
  const merged = await UserAccount.find({ userId, mergedInto: { $ne: null } }, { bankCode: 1, accountMask: 1, mergedInto: 1 }).lean();
  if (!merged.length) return new Map();
  const targets = await UserAccount.find({ userId, _id: { $in: merged.map((m) => m.mergedInto) } }, { bankCode: 1, accountMask: 1, bankName: 1 }).lean();
  const byId = new Map(targets.map((t) => [String(t._id), t]));
  return new Map(merged.filter((m) => byId.has(String(m.mergedInto)))
    .map((m) => [`${m.bankCode}|${m.accountMask}`, byId.get(String(m.mergedInto))]));
}
// The fingerprint a transaction should carry, after following any merge.
async function resolveAccountStamp(userId, bankCode, accountMask, map) {
  if (!bankCode) return { merged: false, bankCode, accountMask };
  const m = map || await mergedAccountMap(userId).catch(() => new Map());
  const t = m.get(`${bankCode}|${accountMask || ''}`);
  return t ? { merged: true, bankCode: t.bankCode, accountMask: t.accountMask, bankName: t.bankName || '' } : { merged: false, bankCode, accountMask };
}

async function touchUserAccount(userId, { bankCode, bankName, accountMask }, when) {
  if (!bankCode || !accountMask) return;
  const at = when ? new Date(when) : new Date();
  try {
    await UserAccount.updateOne(
      { userId, bankCode, accountMask },
      {
        $setOnInsert: { userId, bankCode, accountMask, label: '', hidden: false, firstSeen: at },
        $set: { bankName: bankName || '', lastSeen: at },
        $inc: { txnCount: 1 },
      },
      { upsert: true },
    );
  } catch (e) {
    // A concurrent upsert can race the unique index; ignore duplicate-key noise.
    if (e && e.code !== 11000) console.error('[touchUserAccount]', e.message);
  }
}

// ── Learn-unknown-senders flywheel (Addendum A slice 3) ──
const SENDER_PROMOTE_THRESHOLD = 3; // distinct users agreeing on the same bank

// Record a sender ID we couldn't resolve, so it can be tagged. Idempotent-ish upsert.
async function logUnknownSender(senderKey, sample, source) {
  if (!senderKey || senderKey.length < 4) return;
  try {
    await UnknownSender.updateOne(
      { senderKey },
      {
        $setOnInsert: { senderKey, status: 'open', sample: (sample || '').slice(0, 160), source: source || 'sms' },
        $set: { lastSeen: new Date() },
        $inc: { count: 1 },
      },
      { upsert: true },
    );
  } catch (e) { if (e && e.code !== 11000) console.error('[logUnknownSender]', e.message); }
}

// The bank a sender resolves to via learning: the user's own tag first, then a
// globally-promoted consensus. Returns { code, name } or null.
async function learnedBankFor(userId, senderKey) {
  if (!senderKey) return null;
  const mine = await SenderTag.findOne({ userId, senderKey }).lean();
  if (mine && mine.bankCode) return { code: mine.bankCode, name: mine.bankName || '' };
  const promoted = await UnknownSender.findOne({ senderKey, status: 'promoted' }).lean();
  if (promoted && promoted.promotedBankCode) return { code: promoted.promotedBankCode, name: promoted.promotedBankName || '' };
  return null;
}

// After a tag lands, promote the sender if enough distinct users agree on one bank.
async function maybePromoteSender(senderKey) {
  try {
    const tags = await SenderTag.find({ senderKey }).select('userId bankCode bankName').lean();
    const byBank = new Map();
    for (const t of tags) {
      const e = byBank.get(t.bankCode) || { users: new Set(), name: t.bankName || '' };
      e.users.add(String(t.userId));
      if (!e.name && t.bankName) e.name = t.bankName;
      byBank.set(t.bankCode, e);
    }
    let winner = null;
    for (const [code, e] of byBank) {
      if (e.users.size >= SENDER_PROMOTE_THRESHOLD && (!winner || e.users.size > winner.size)) {
        winner = { code, name: e.name, size: e.users.size };
      }
    }
    if (winner) {
      await UnknownSender.updateOne(
        { senderKey },
        { $set: { status: 'promoted', promotedBankCode: winner.code, promotedBankName: winner.name } },
        { upsert: true },
      );
    }
  } catch (e) { console.error('[maybePromoteSender]', e.message); }
}

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
    // When the user was last in the app (for the "not opened in 5 days" nudge). At
    // most one write an hour, and never in the way of the request.
    if (!req.user.lastActiveAt || Date.now() - req.user.lastActiveAt.getTime() > 3600000) {
      User.updateOne({ _id: req.user._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
    }
    next();
  } catch (error) {
    // expired or invalid token - flag it so the client can send the user to login
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

// Newsletter composer access: superadmins, or a user flagged newsletterEditor. Lets you
// hand the newsletter to someone without giving them the whole admin panel.
const newsletterAuth = async (req, res, next) => {
  try {
    if (req.user.role === 'superadmin' || req.user.newsletterEditor) return next();
    return res.status(403).json({ message: 'Access denied. Newsletter access only.' });
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
  } catch { res.status(503).json({ status: 'Error', database: 'Disconnected' }); }
});

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
    if (passwordProblem(password)) return res.status(400).json({ message: passwordProblem(password) });
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
    res.status(201).json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, newsletterEditor: !!user.newsletterEditor, betaTester: !!user.betaTester, onboarded: user.onboarded } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
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
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, newsletterEditor: !!user.newsletterEditor, betaTester: !!user.betaTester, onboarded: user.onboarded } });
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
      return res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, newsletterEditor: !!user.newsletterEditor, betaTester: !!user.betaTester, onboarded: user.onboarded } });
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
    res.json({ token, user: { id: user._id, name: user.name, email: user.email, role: user.role, newsletterEditor: !!user.newsletterEditor, betaTester: !!user.betaTester, onboarded: user.onboarded } });
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
    newsletterEditor: !!u.newsletterEditor,
    betaTester: !!u.betaTester,
    plan: u.plan || 'free',
    phone: u.phone || '', monthlyIncome: u.monthlyIncome || 0,
    primaryGoal: u.primaryGoal || '', emailAlerts: u.emailAlerts !== false,
    twoFactorEnabled: !!u.twoFactorEnabled,
    onboarded: !!u.onboarded, lastLogin: u.lastLogin || null,
    trainingOptOut: !!u.trainingOptOut,
    seenTips: u.seenTips || [],
  });
});

// First-time tips: mark one as seen (it never shows again, on any device), or clear
// them all to see the tips again.
app.post('/api/me/tips', auth, async (req, res) => {
  try {
    const id = (req.body?.id || '').toString().trim();
    if (!/^[a-z0-9:_-]{1,60}$/i.test(id)) return res.status(400).json({ message: 'Bad tip id' });
    await User.updateOne({ _id: req.user._id }, { $addToSet: { seenTips: id } });
    res.json({ ok: true });
  } catch (e) { console.error('[me/tips]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/me/tips', auth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { seenTips: [] } });
    res.json({ ok: true });
  } catch (e) { console.error('[me/tips]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// How-to for each feature (Help page). Data, so text and video links change without
// an app release.
const HELP = require('./data/help.json');
app.get('/api/help', (req, res) => res.json(HELP));

// Opt in / out of the beta testers program. Returns the beta community link on opt-in.
app.patch('/api/me/beta', auth, async (req, res) => {
  try {
    const on = !!req.body.enabled;
    await User.updateOne({ _id: req.user._id }, { $set: { betaTester: on } });
    res.json({ ok: true, betaTester: on, groupUrl: on ? BETA_WHATSAPP_URL : '' });
  } catch (e) { console.error('[me/beta]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Send in-app feedback (bug / idea / praise). Any signed-in user.
app.post('/api/feedback', auth, async (req, res) => {
  try {
    const message = String(req.body.message || '').trim().slice(0, 4000);
    if (message.length < 3) return res.status(400).json({ message: 'Please write a little more.' });
    const kinds = ['bug', 'idea', 'praise', 'other'];
    const kind = kinds.includes(req.body.kind) ? req.body.kind : 'other';
    await Feedback.create({
      userId: req.user._id, email: req.user.email, name: req.user.name, kind, message,
      platform: String(req.body.platform || '').slice(0, 20),
      appVersion: String(req.body.appVersion || '').slice(0, 20),
      betaTester: !!req.user.betaTester,
    });
    res.json({ ok: true, message: 'Thank you. Your feedback is in.' });
  } catch (e) { console.error('[feedback]', e.message); res.status(500).json({ message: 'Could not send feedback.' }); }
});

// Admin: read recent feedback (newest first), with an open/handled count.
app.get('/api/admin/feedback', auth, superAdminAuth, async (req, res) => {
  try {
    const items = await Feedback.find({}).sort({ createdAt: -1 }).limit(300).lean();
    res.json({ items, open: items.filter((f) => !f.handled).length });
  } catch (e) { console.error('[admin/feedback]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Admin: mark a feedback item handled / re-open it.
app.patch('/api/admin/feedback/:id', auth, superAdminAuth, async (req, res) => {
  try {
    const handled = !!req.body.handled;
    const f = await Feedback.findByIdAndUpdate(req.params.id, { $set: { handled } }, { new: true }).lean();
    if (!f) return res.status(404).json({ message: 'Not found' });
    res.json({ ok: true, id: f._id, handled: f.handled });
  } catch (e) { console.error('[admin/feedback/patch]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Pro / billing status for the client paywall. checkoutAvailable is false until
// Paystack subscription billing is wired: the gate is real regardless, and flips
// the moment a user's plan becomes 'pro'.
app.get('/api/billing/status', auth, (req, res) => {
  const ps = req.user.proSub || {};
  const cfg = plans.config();
  const ent = plans.entitlement(req.user, new Date(), cfg);
  res.json({
    plan: req.user.plan || 'free',
    tier: ent.tier, tierName: ent.name, source: ent.source,
    trialDaysLeft: ent.source === 'trial' ? plans.daysLeft(ent.until) : null,
    trialEnded: ent.source === 'none' && !!ent.trialEndsAt && ent.trialEndsAt < new Date() && !req.user.planEverPaid,
    isPro: isPro(req.user),
    priceNaira: cfg.plusPrice,
    features: plans.PLUS_FEATURES.map((f) => plans.FEATURE_LABELS[f]),
    plans: plans.catalog(cfg),
    student: studentOut(req.user),
    planExpiry: req.user.planExpiry || null,
    checkoutAvailable: proCheckoutReady(),
    autoRenew: !!ps.autoRenew,
    card: ps.last4 ? { last4: ps.last4, cardType: ps.cardType || '' } : null,
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
    if (passwordProblem(newPassword)) return res.status(400).json({ message: passwordProblem(newPassword) });
    const acct = await User.findById(req.user._id).select('+password');
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    const ok = await bcrypt.compare(currentPassword, acct.password);
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    acct.password = await bcrypt.hash(newPassword, await bcrypt.genSalt(10));
    acct.sessionsValidFrom = new Date(); // sign out other sessions on password change
    await acct.save();
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
    const acct = await User.findById(req.user._id).select('+password');
    const ok = acct && await bcrypt.compare(password, acct.password);
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

// Collections from retired features (wallet, auto-savings, debts, bill payments).
// Their models are gone, but older accounts may still hold rows, so export and
// deletion reach them by collection name.
const LEGACY_USER_COLLECTIONS = ['wallets', 'wallettransactions', 'savingsrules', 'debts', 'billpayments'];
const legacyRows = async (userId) => {
  const out = {};
  for (const name of LEGACY_USER_COLLECTIONS) {
    const rows = await mongoose.connection.collection(name).find({ userId }).toArray().catch(() => []);
    if (rows.length) out[name] = rows;
  }
  return out;
};

// Remove everything we hold about a user. ProPayment rows stay: they are payment
// records we must retain for accounting.
async function deleteUserData(userId, email) {
  const uid = new mongoose.Types.ObjectId(String(userId));
  await Promise.all([
    Transaction, Budget, Goal, Subscription, RecurringBill, LearnedCategory, ParseCorrection,
    SupportTicket, Notification, TransferRoute, UserAccount, Contact, SenderTag, ReconLog,
    Feedback, Activity, DismissedDetection, KeptPair, NudgeLog, StudentReview,
  ].map((M) => M.deleteMany({ userId: uid })));
  await Promise.all(LEGACY_USER_COLLECTIONS.map((name) =>
    mongoose.connection.collection(name).deleteMany({ userId: uid }).catch(() => null)));
  if (email) {
    await Waitlist.deleteMany({ email });
    await PendingRegistration.deleteMany({ email });
  }
  await User.deleteOne({ _id: uid });
}

// Export all of the user's data as JSON
app.get('/api/me/export', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const [transactions, budgets, goals, subscriptions, bills, accounts, contacts, tickets, legacy] = await Promise.all([
      Transaction.find({ userId: uid }).lean(),
      Budget.find({ userId: uid }).lean(),
      Goal.find({ userId: uid }).lean(),
      Subscription.find({ userId: uid }).lean(),
      RecurringBill.find({ userId: uid }).lean(),
      UserAccount.find({ userId: uid }).lean(),
      Contact.find({ userId: uid }).lean(),
      SupportTicket.find({ userId: uid }).lean(),
      legacyRows(uid),
    ]);
    res.json({
      exportedAt: new Date().toISOString(),
      profile: { name: req.user.name, email: req.user.email, phone: req.user.phone, monthlyIncome: req.user.monthlyIncome, primaryGoal: req.user.primaryGoal },
      transactions, budgets, goals, subscriptions, bills, accounts, contacts, supportTickets: tickets,
      ...(Object.keys(legacy).length ? { legacy } : {}),
    });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Delete account and all associated data (requires current password)
app.delete('/api/me', sensitiveLimiter, auth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ message: 'Password is required to delete your account' });
    const acct = await User.findById(req.user._id).select('+password');
    const ok = acct && await bcrypt.compare(password, acct.password);
    if (!ok) return res.status(400).json({ message: 'Password is incorrect' });
    await deleteUserData(req.user._id, req.user.email);
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
      // Never return the link in the API response - that would let anyone reset
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
    if (passwordProblem(password)) return res.status(400).json({ message: passwordProblem(password) });
    const user = await User.findOne({
      resetToken: hashToken(token),
      resetTokenExpiry: { $gt: new Date() },
    });
    if (!user) return res.status(400).json({ message: 'This reset link is invalid or has expired.' });

    user.password = await bcrypt.hash(password, await bcrypt.genSalt(10));
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;
    // A reset often follows a compromise: end every existing session so a stolen
    // token stops working immediately (same as a normal password change).
    user.sessionsValidFrom = new Date();
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

// The current site-wide banner (or null). Any signed-in user; dismissal is client-side.
app.get('/api/global-banner', auth, async (req, res) => {
  try {
    const b = await GlobalBanner.findOne({ active: true }).sort({ createdAt: -1 }).lean();
    if (!b) return res.json({ banner: null });
    res.json({ banner: { id: String(b._id), message: b.message, type: b.type, link: b.link, linkText: b.linkText } });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Admin: broadcast an in-app notification to every active user's bell (fan-out).
app.post('/api/admin/notify-all', auth, superAdminAuth, async (req, res) => {
  try {
    const title = (req.body?.title || '').toString().trim();
    if (!title) return res.status(400).json({ message: 'A title is required.' });
    const type = ['info', 'success', 'warning', 'danger'].includes(req.body?.type) ? req.body.type : 'info';
    const message = (req.body?.message || '').toString().slice(0, 500);
    const link = (req.body?.link || '').toString().slice(0, 300);
    const users = await User.find({ isActive: { $ne: false } }, { _id: 1 }).lean();
    const docs = users.map((u) => ({ userId: u._id, title, message, type, link }));
    if (docs.length) await Notification.insertMany(docs, { ordered: false });
    res.json({ sent: docs.length });
  } catch (e) { console.error('[notify-all]', e.message); res.status(500).json({ message: 'Broadcast failed.' }); }
});

// Admin: set or clear the site-wide banner. active:false (or empty message) clears it.
app.post('/api/admin/global-banner', auth, superAdminAuth, async (req, res) => {
  try {
    const message = (req.body?.message || '').toString().trim().slice(0, 300);
    const active = !!req.body?.active && !!message;
    await GlobalBanner.updateMany({ active: true }, { $set: { active: false } }); // retire any current one
    if (!active) return res.json({ banner: null });
    const type = ['info', 'warning', 'success'].includes(req.body?.type) ? req.body.type : 'info';
    const b = await GlobalBanner.create({
      message, type, active: true,
      link: (req.body?.link || '').toString().slice(0, 300),
      linkText: (req.body?.linkText || '').toString().slice(0, 60),
      createdBy: req.user.email,
    });
    res.json({ banner: { id: String(b._id), message: b.message, type: b.type, link: b.link, linkText: b.linkText } });
  } catch (e) { console.error('[global-banner]', e.message); res.status(500).json({ message: 'Could not update the banner.' }); }
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
  const { date, description, amount, category, type, source, bank, bankCode, accountMask, parseConfidence, parseId, dedupeGroupId } = req.body;
  if (!date || !description || !amount || !category || !type) return res.status(400).json({ message: 'All fields required' });
  // Provenance for a share-sheet confirm (spec §8): stamp source + parse metadata + the
  // account fingerprint so a confirmed shared alert behaves like any imported row.
  const shared = source === 'share';
  const st = await resolveAccountStamp(req.user._id, (bankCode || '').toString().toLowerCase().slice(0, 24), (accountMask || '').toString().replace(/\D/g, '').slice(0, 4));
  const bCode = st.bankCode;
  const bMask = st.accountMask;
  const transaction = new Transaction({
    userId: req.user._id, date: new Date(date), description: description.trim(),
    amount: type === 'expense' ? -Math.abs(amount) : Math.abs(amount), category: category.trim(), type,
    ...(shared ? { source: 'share', importedAt: new Date() } : {}),
    ...(bank ? { bank: String(bank).slice(0, 40) } : {}),
    ...(bCode ? { bankCode: bCode } : {}), ...(bMask ? { accountMask: bMask } : {}),
    ...(parseConfidence ? { parseConfidence: String(parseConfidence).slice(0, 8) } : {}),
    ...(parseId ? { parseId: String(parseId).slice(0, 64) } : {}),
    ...(dedupeGroupId ? { dedupeGroupId: String(dedupeGroupId).slice(0, 64) } : {}),
  });
  await transaction.save();
  if (shared && bCode) { try { await touchUserAccount(req.user._id, { bankCode: bCode, bankName: bank || '', accountMask: bMask }, transaction.date); } catch { /* non-fatal */ } }
  await maybeLinkSubscription(req.user._id, { description: transaction.description, amount: transaction.amount, category: transaction.category, date: transaction.date });
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
      // Type flipped but amount unchanged - fix the sign.
      const a = Math.abs(txn.amount);
      txn.amount = newType === 'expense' ? -a : a;
    }
    await txn.save();
    if (categoryChanged) {
      await learnCategories(req.user._id, [{ description: txn.description, category: txn.category }]);
      // "or any other way": a manual recategorise to Subscriptions also surfaces it.
      await maybeLinkSubscription(req.user._id, { description: txn.description, amount: txn.amount, category: txn.category, date: txn.date, bankName: txn.bank });
    }
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

// Corper starter preset: seed a ₦77k NYSC allawee budget for this month plus an
// after-service savings goal. Idempotent: skips any category that already has a
// budget this month and won't duplicate the goal. Powers the /corper funnel so a
// corper is set up in one tap. Amounts total ₦77,000 (needs ₦45k, savings ₦20k,
// fun ₦12k); the user can edit any of them afterwards.
const CORPER_BUDGET = [
  { category: 'Transport', amount: 18000 },
  { category: 'Food', amount: 22000 },
  { category: 'Airtime & Data', amount: 5000 },
  { category: 'Savings', amount: 20000 },
  { category: 'Entertainment', amount: 12000 },
];
app.post('/api/presets/corper', auth, async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const existing = await Budget.find({ userId: req.user._id, month }, { category: 1 }).lean();
    const have = new Set(existing.map((b) => b.category));
    const toCreate = CORPER_BUDGET.filter((b) => !have.has(b.category));
    if (toCreate.length) {
      await Budget.insertMany(toCreate.map((b) => ({ userId: req.user._id, category: b.category, amount: b.amount, month })));
    }
    let goalCreated = false;
    const goalName = 'After Service Fund';
    const goalExists = await Goal.findOne({ userId: req.user._id, name: goalName });
    if (!goalExists) {
      const deadline = new Date(); deadline.setMonth(deadline.getMonth() + 12);
      await Goal.create({ userId: req.user._id, name: goalName, target: 240000, current: 0, deadline, category: 'Savings' });
      goalCreated = true;
    }
    res.json({ ok: true, budgetsCreated: toCreate.length, budgetsSkipped: CORPER_BUDGET.length - toCreate.length, goalCreated, month });
  } catch (e) { console.error('[presets/corper]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Invite link to the Automonie WhatsApp community - sent to every new signup.
const WHATSAPP_GROUP_URL = 'https://chat.whatsapp.com/GwGSrl76CbaLA7xQqmmLrU?s=cl&p=a&ilr=4';
// Separate beta testers community. Set BETA_WHATSAPP_URL on Render once the beta
// group exists; until then it falls back to the general community link.
const BETA_WHATSAPP_URL = process.env.BETA_WHATSAPP_URL || WHATSAPP_GROUP_URL;
// Only two WhatsApp destinations: the general community (channel/group) for every
// public signup incl. corpers, and the beta testers GC for beta opt-ins.
const groupUrlFor = (source) => (String(source || '').toLowerCase() === 'beta' ? BETA_WHATSAPP_URL : WHATSAPP_GROUP_URL);

// Waitlist - public signup from the marketing site (rate-limited, deduped).
app.post('/api/waitlist', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 120);
    // WhatsApp number - keep digits and a leading +, cap length. Optional.
    const phone = String(req.body.phone || '').replace(/[^\d+]/g, '').slice(0, 20);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    const result = await Waitlist.updateOne(
      { email },
      { $setOnInsert: { email, name, phone, source: String(req.body.source || 'website').slice(0, 40) } },
      { upsert: true },
    );
    // Backfill the WhatsApp number if they signed up before we collected it.
    if (!result.upsertedCount && phone) await Waitlist.updateOne({ email, $or: [{ phone: '' }, { phone: { $exists: false } }] }, { $set: { phone } });
    sendWelcome('waitlist', email).catch(() => {});
    res.json({ ok: true, message: "You're on the list! We'll email you at launch.", groupUrl: groupUrlFor(req.body.source) });
  } catch (e) { console.error('[waitlist]', e.message); res.status(500).json({ message: 'Could not join the waitlist. Try again.' }); }
});
// ── Welcome emails (lib/welcomeEmails) ─────────────────────────────────────────
// Each is sent at most once per address: the send is claimed by setting its
// timestamp first, so a double signup (or two quick clicks) can't send it twice.
// With BREVO_TEMPLATE_WAITLIST_WELCOME / BREVO_TEMPLATE_NEWSLETTER_WELCOME set, the
// email goes through that Brevo template (copy edited in Brevo, no deploy); without,
// it uses the built-in version. WELCOME_HEADER_URL is the header image (the GIF).
const WELCOME_TEMPLATES = {
  waitlist: () => Number(process.env.BREVO_TEMPLATE_WAITLIST_WELCOME) || 0,
  newsletter: () => Number(process.env.BREVO_TEMPLATE_NEWSLETTER_WELCOME) || 0,
};
const unsubUrlFor = (token) => `${PUBLIC_API_URL}/unsubscribe?token=${token}`;
async function ensureUnsubToken(doc) {
  if (doc.unsubToken) return doc.unsubToken;
  const token = crypto.randomBytes(16).toString('hex');
  await Waitlist.updateOne({ _id: doc._id }, { $set: { unsubToken: token } });
  return token;
}
async function sendWelcome(kind, email) {
  if (!emailConfigured()) return false;
  const field = kind === 'newsletter' ? 'welcomeNewsletterAt' : 'welcomeWaitlistAt';
  const doc = await Waitlist.findOneAndUpdate({ email, [field]: null, unsubscribed: { $ne: true } }, { $set: { [field]: new Date() } }, { new: true });
  if (!doc) return false; // already welcomed, or unsubscribed
  try {
    const params = {
      firstName: (doc.name || '').trim().split(/\s+/)[0] || '',
      whatsappUrl: groupUrlFor(doc.source),
      unsubscribeUrl: unsubUrlFor(await ensureUnsubToken(doc)),
      headerImageUrl: process.env.WELCOME_HEADER_URL || '',
    };
    const templateId = WELCOME_TEMPLATES[kind]();
    if (templateId) {
      await axios.post('https://api.brevo.com/v3/smtp/email', { to: [{ email }], templateId, params }, {
        headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' }, timeout: 15000,
      });
    } else {
      const m = kind === 'newsletter'
        ? welcomeEmails.newsletterWelcome({ name: doc.name, unsubscribeUrl: params.unsubscribeUrl, headerImageUrl: params.headerImageUrl })
        : welcomeEmails.waitlistWelcome({ name: doc.name, whatsappUrl: params.whatsappUrl, headerImageUrl: params.headerImageUrl });
      const send = kind === 'newsletter' ? sendNewsletterEmail : sendEmail;
      await send({ to: email, subject: m.subject, text: m.text, html: m.html });
    }
    return true;
  } catch (e) {
    // Let a later signup try again.
    await Waitlist.updateOne({ _id: doc._id }, { $set: { [field]: null } }).catch(() => {});
    console.error(`[welcome:${kind}]`, e.response?.data?.message || e.message);
    return false;
  }
}

// Newsletter signup (the site's newsletter form). Joins the same list as the waitlist,
// flags it as a newsletter subscriber (re-subscribing after an unsubscribe), and sends
// the newsletter welcome once.
app.post('/api/newsletter/subscribe', authLimiter, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address.' });
    await Waitlist.updateOne(
      { email },
      { $setOnInsert: { email, name, source: String(req.body.source || 'newsletter').slice(0, 40) }, $set: { newsletter: true, unsubscribed: false } },
      { upsert: true },
    );
    sendWelcome('newsletter', email).catch(() => {});
    res.json({ ok: true, message: 'You’re subscribed. Check your inbox for a welcome email.' });
  } catch (e) { console.error('[newsletter/subscribe]', e.message); res.status(500).json({ message: 'Could not subscribe. Try again.' }); }
});

app.get('/api/admin/waitlist', auth, superAdminAuth, async (req, res) => {
  try {
    const [items, count] = await Promise.all([
      Waitlist.find().sort({ createdAt: -1 }).limit(2000).lean(),
      Waitlist.countDocuments(),
    ]);
    res.json({ count, items });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// ── Newsletter (to the waitlist) ────────────────────────────────────────────────
const PUBLIC_API_URL = process.env.PUBLIC_API_URL || 'https://api.automonie.com';

// Newsletter image upload (graphics). Stores the image and returns a public URL to drop
// into the email. Images only, 5 MB cap.
const newsletterImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
app.post('/api/admin/newsletter/image', auth, newsletterAuth, (req, res) => {
  newsletterImageUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ message: 'Please choose an image (max 5 MB).' });
    try {
      const asset = await NewsletterAsset.create({ data: req.file.buffer, contentType: req.file.mimetype, createdBy: req.user.email });
      res.json({ url: `${PUBLIC_API_URL}/api/newsletter/asset/${asset._id}` });
    } catch (e) { console.error('[newsletter/image]', e.message); res.status(500).json({ message: 'Could not save the image.' }); }
  });
});
// Import a Word (.docx) draft: convert to HTML for the editor to review before sending.
const docxUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
app.post('/api/admin/newsletter/import-docx', auth, newsletterAuth, (req, res) => {
  docxUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ message: 'Choose a .docx file.' });
    if (!/word|officedocument|\.docx$/i.test(req.file.mimetype + req.file.originalname)) {
      return res.status(400).json({ message: 'That doesn’t look like a .docx Word file.' });
    }
    try {
      const result = await mammoth.convertToHtml({ buffer: req.file.buffer });
      res.json({ html: sanitizeNewsletterBody(result.value || '') });
    } catch (e) { console.error('[import-docx]', e.message); res.status(500).json({ message: 'Could not read that document.' }); }
  });
});

// Public: serve a newsletter image so email clients (and the composer preview) can load it.
app.get('/api/newsletter/asset/:id', async (req, res) => {
  try {
    const a = await NewsletterAsset.findById(req.params.id);
    if (!a) return res.status(404).end();
    res.set('Content-Type', a.contentType);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(a.data);
  } catch { res.status(404).end(); }
});

// Strip anything unsafe/unwanted from the visual editor's HTML before it goes out:
// scripts, styles, iframes, event handlers and javascript: URLs. Keeps ordinary
// formatting tags (b/i/u/h/p/ul/a/img/font/span with inline styles).
function sanitizeNewsletterBody(html) {
  return (html || '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')  // onclick=, onerror=, …
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*(\2)/gi, '$1=$2#$3');
}

// Wrap the admin's body in a simple branded shell + a one-click unsubscribe footer.
function newsletterHtml(bodyHtml, unsubUrl) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#0b1326">
    <div style="padding:20px 4px;font-weight:800;font-size:20px;color:#0f6e56">automonie</div>
    <div style="background:#fff;border:1px solid #e7ebf1;border-radius:14px;padding:22px 22px 8px;line-height:1.6;font-size:16px">${bodyHtml}</div>
    <p style="color:#8a97a8;font-size:12px;line-height:1.6;padding:16px 6px">
      You're getting this because you joined the Automonie waitlist.
      <a href="${unsubUrl}" style="color:#8a97a8">Unsubscribe</a>.
    </p>
  </div>`;
}
function newsletterText(bodyHtml, unsubUrl) {
  const plain = bodyHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `${plain}\n\nYou joined the Automonie waitlist. Unsubscribe: ${unsubUrl}`;
}

// How many subscribers a send would reach right now.
app.get('/api/admin/newsletter/audience', auth, newsletterAuth, async (req, res) => {
  try {
    const [active, total, recent] = await Promise.all([
      Waitlist.countDocuments({ unsubscribed: { $ne: true } }),
      Waitlist.countDocuments(),
      Newsletter.find().sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    res.json({ active, total, unsubscribed: total - active, history: recent });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Send a test to the admin's own address (no real audience touched).
app.post('/api/admin/newsletter/test', auth, newsletterAuth, async (req, res) => {
  try {
    if (!emailConfigured()) return res.status(503).json({ message: 'Email is not configured (set BREVO_API_KEY).' });
    const subject = (req.body?.subject || '').toString().trim();
    const body = sanitizeNewsletterBody((req.body?.html || '').toString().trim());
    if (!subject || !body) return res.status(400).json({ message: 'Subject and body are required.' });
    const to = req.body?.to || req.user.email;
    const unsubUrl = `${PUBLIC_API_URL}/unsubscribe?token=preview`;
    await sendNewsletterEmail({ to, subject: `[TEST] ${subject}`, html: newsletterHtml(body, unsubUrl), text: newsletterText(body, unsubUrl) });
    res.json({ ok: true, to });
  } catch (e) { console.error('[newsletter/test]', e.response?.data || e.message); res.status(502).json({ message: 'Test send failed. Check the email config.' }); }
});

// Send the newsletter to every non-unsubscribed subscriber. Sequential, per-recipient
// (each gets their own unsubscribe link; no addresses are shared). Records the send.
app.post('/api/admin/newsletter/send', auth, newsletterAuth, async (req, res) => {
  try {
    if (!emailConfigured()) return res.status(503).json({ message: 'Email is not configured (set BREVO_API_KEY).' });
    const subject = (req.body?.subject || '').toString().trim();
    const body = sanitizeNewsletterBody((req.body?.html || '').toString().trim());
    if (!subject || !body) return res.status(400).json({ message: 'Subject and body are required.' });
    // Safety cap per run (Brevo free tier ~300/day). Override with ?limit=.
    const cap = Math.max(1, Math.min(5000, parseInt(req.body?.limit, 10) || 5000));

    const subs = await Waitlist.find({ unsubscribed: { $ne: true } }).select('email unsubToken').limit(cap).lean();
    let sent = 0, failed = 0;
    for (const s of subs) {
      try {
        let token = s.unsubToken;
        if (!token) { token = crypto.randomBytes(16).toString('hex'); await Waitlist.updateOne({ _id: s._id }, { $set: { unsubToken: token } }); }
        const unsubUrl = `${PUBLIC_API_URL}/unsubscribe?token=${token}`;
        await sendNewsletterEmail({ to: s.email, subject, html: newsletterHtml(body, unsubUrl), text: newsletterText(body, unsubUrl) });
        sent += 1;
      } catch (err) { failed += 1; console.error('[newsletter] to', s.email, err.response?.data?.message || err.message); }
      await new Promise((r) => setTimeout(r, 120)); // gentle pacing for the provider
    }
    await Newsletter.create({ subject, html: body, sent, failed, audience: subs.length, sentBy: req.user.email });
    res.json({ sent, failed, audience: subs.length });
  } catch (e) { console.error('[newsletter/send]', e.message); res.status(500).json({ message: 'Send failed.' }); }
});

// Public one-click unsubscribe (from the email footer). No auth; token identifies the
// subscriber. Returns a tiny confirmation page.
app.get('/unsubscribe', async (req, res) => {
  const token = (req.query.token || '').toString();
  const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Automonie</title><body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f6f8fa;margin:0"><div style="max-width:440px;margin:12vh auto;background:#fff;border:1px solid #e7ebf1;border-radius:16px;padding:28px;text-align:center"><div style="font-weight:800;font-size:20px;color:#0f6e56;margin-bottom:12px">automonie</div><p style="color:#0b1326;line-height:1.6;font-size:16px">${msg}</p></div></body>`;
  try {
    if (token && token !== 'preview') {
      const r = await Waitlist.updateOne({ unsubToken: token }, { $set: { unsubscribed: true } });
      if (r.matchedCount) return res.send(page("You're unsubscribed. You won't get any more Automonie emails. Change your mind? Just rejoin the waitlist."));
    }
    res.send(page('This unsubscribe link is invalid or has already been used.'));
  } catch (e) { res.status(500).send(page('Something went wrong. Please try again later.')); }
});

// Correction rate by bank, source and parser version. Tells us which parsers are
// weakest, useful from day one (before any ML exists).
app.get('/api/admin/parse-corrections/stats', auth, superAdminAuth, async (req, res) => {
  try {
    const groupBy = (field) => ParseCorrection.aggregate([
      { $group: { _id: `$${field}`, total: { $sum: 1 }, corrected: { $sum: { $cond: ['$wasCorrected', 1, 0] } } } },
      { $project: { _id: 0, key: '$_id', total: 1, corrected: 1,
        correctionRate: { $round: [{ $multiply: [{ $cond: [{ $gt: ['$total', 0] }, { $divide: ['$corrected', '$total'] }, 0] }, 100] }, 1] } } },
      { $sort: { total: -1 } },
    ]);
    const [byBank, bySource, byParser, byField, totals] = await Promise.all([
      groupBy('bankCode'), groupBy('source'), groupBy('parserVersion'),
      ParseCorrection.aggregate([
        { $unwind: '$correctedFields' },
        { $group: { _id: '$correctedFields', count: { $sum: 1 } } },
        { $project: { _id: 0, field: '$_id', count: 1 } }, { $sort: { count: -1 } },
      ]),
      ParseCorrection.aggregate([{ $group: { _id: null, total: { $sum: 1 }, corrected: { $sum: { $cond: ['$wasCorrected', 1, 0] } } } }]),
    ]);
    const t = totals[0] || { total: 0, corrected: 0 };
    res.json({
      total: t.total, corrected: t.corrected,
      overallCorrectionRate: t.total ? Math.round((t.corrected / t.total) * 1000) / 10 : 0,
      byBank, bySource, byParser, mostCorrectedFields: byField,
    });
  } catch (e) { console.error('[pc-stats]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// The ingestion accuracy dashboard (spec A7). Combines the correction log (how often
// users fix a parsed field, per bank/source/field: amount + direction fixes are the
// emergencies) with the reconciliation log (what % of statement imports balance, per
// bank). One glance answers: which bank is failing my users right now?
app.get('/api/admin/ingestion/accuracy', auth, superAdminAuth, async (req, res) => {
  try {
    const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
    // Per-bank correction breakdown incl. the critical amount/direction fixes.
    const corrByBank = await ParseCorrection.aggregate([
      { $group: {
        _id: '$bankCode',
        total: { $sum: 1 },
        corrected: { $sum: { $cond: ['$wasCorrected', 1, 0] } },
        amountFix: { $sum: { $cond: [{ $in: ['amount', { $ifNull: ['$correctedFields', []] }] }, 1, 0] } },
        directionFix: { $sum: { $cond: [{ $in: ['direction', { $ifNull: ['$correctedFields', []] }] }, 1, 0] } },
      } },
      { $sort: { total: -1 } },
    ]);
    const bySource = await ParseCorrection.aggregate([
      { $group: { _id: '$source', total: { $sum: 1 }, corrected: { $sum: { $cond: ['$wasCorrected', 1, 0] } } } },
      { $sort: { total: -1 } },
    ]);
    const byField = await ParseCorrection.aggregate([
      { $unwind: '$correctedFields' },
      { $group: { _id: '$correctedFields', count: { $sum: 1 } } }, { $sort: { count: -1 } },
    ]);
    const byPath = await ParseCorrection.aggregate([
      { $group: { _id: '$parserPath', count: { $sum: 1 } } }, { $sort: { count: -1 } },
    ]);
    const totalsA = await ParseCorrection.aggregate([
      { $group: { _id: null, total: { $sum: 1 }, corrected: { $sum: { $cond: ['$wasCorrected', 1, 0] } },
        amountFix: { $sum: { $cond: [{ $in: ['amount', { $ifNull: ['$correctedFields', []] }] }, 1, 0] } } } },
    ]);
    // Reconciliation health per bank + overall (statements only).
    const reconByBank = await ReconLog.aggregate([
      { $group: { _id: '$bank', imports: { $sum: 1 },
        checked: { $sum: { $cond: ['$checked', 1, 0] } },
        balanced: { $sum: { $cond: [{ $eq: ['$ok', true] }, 1, 0] } } } },
      { $sort: { imports: -1 } },
    ]);
    const reconTotals = await ReconLog.aggregate([
      { $group: { _id: null, imports: { $sum: 1 }, checked: { $sum: { $cond: ['$checked', 1, 0] } },
        balanced: { $sum: { $cond: [{ $eq: ['$ok', true] }, 1, 0] } } } },
    ]);

    const ct = totalsA[0] || { total: 0, corrected: 0, amountFix: 0 };
    const rt = reconTotals[0] || { imports: 0, checked: 0, balanced: 0 };
    const reconMap = new Map(reconByBank.map((r) => [r._id || '', r]));

    // Merge correction + reconcile per bank, and rank "worst" first (high correction
    // rate + amount fixes + low reconcile) so the failing banks surface at the top.
    const banks = corrByBank.map((b) => {
      const key = b._id || '(unknown)';
      const rec = reconMap.get((b._id || '')) || { imports: 0, checked: 0, balanced: 0 };
      const correctionRate = pct(b.corrected, b.total);
      const amountFixRate = pct(b.amountFix, b.total);
      const reconcileRate = pct(rec.balanced, rec.checked);
      return {
        bank: key, samples: b.total, correctionRate, amountFix: b.amountFix, amountFixRate, directionFix: b.directionFix,
        imports: rec.imports, reconcileChecked: rec.checked, reconcileRate,
        health: Math.round((amountFixRate * 2 + correctionRate + (rec.checked ? (100 - reconcileRate) : 0))),
      };
    });
    // Include banks that have imports but no corrections yet.
    for (const r of reconByBank) {
      const key = r._id || '';
      if (!corrByBank.some((b) => (b._id || '') === key)) {
        banks.push({ bank: key || '(unknown)', samples: 0, correctionRate: 0, amountFix: 0, amountFixRate: 0, directionFix: 0,
          imports: r.imports, reconcileChecked: r.checked, reconcileRate: pct(r.balanced, r.checked), health: r.checked ? (100 - pct(r.balanced, r.checked)) : 0 });
      }
    }
    banks.sort((a, b) => b.health - a.health);

    res.json({
      corrections: {
        total: ct.total, corrected: ct.corrected, overallRate: pct(ct.corrected, ct.total),
        amountFix: ct.amountFix, amountFixRate: pct(ct.amountFix, ct.total),
        bySource: bySource.map((s) => ({ key: s._id || '(none)', total: s.total, corrected: s.corrected, rate: pct(s.corrected, s.total) })),
        byField: byField.map((f) => ({ field: f._id, count: f.count })),
        byParserPath: byPath.map((p) => ({ path: p._id || 'none', count: p.count })),
      },
      reconciliation: {
        imports: rt.imports, checked: rt.checked, balanced: rt.balanced,
        reconcileRate: pct(rt.balanced, rt.checked), checkedRate: pct(rt.checked, rt.imports),
      },
      banks,
    });
  } catch (e) { console.error('[ingestion-accuracy]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Let a user opt out of contributing anonymised parse corrections to training.
app.post('/api/me/training-optout', auth, async (req, res) => {
  try {
    req.user.trainingOptOut = !!req.body.optOut;
    await req.user.save();
    res.json({ trainingOptOut: req.user.trainingOptOut });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Recap release config - clients read this to know which recaps are "dropped".
app.get('/api/recaps/config', auth, async (req, res) => {
  try { const r = await getRecapRelease(); res.json({ day: r.day, week: r.week, month: r.month, year: r.year }); }
  catch { res.json({ day: 'auto', week: 'auto', month: 'auto', year: 'auto' }); }
});
app.patch('/api/admin/recaps', auth, superAdminAuth, async (req, res) => {
  try {
    const r = await getRecapRelease();
    for (const k of ['day', 'week', 'month', 'year']) if (['auto', 'on', 'off'].includes(req.body[k])) r[k] = req.body[k];
    await r.save();
    res.json({ day: r.day, week: r.week, month: r.month, year: r.year });
  } catch (e) { console.error('[admin/recaps]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Activity / history - milestone actions in the app (distinct from transactions).
app.get('/api/activity', auth, async (req, res) => {
  try {
    const items = await Activity.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json(items);
  } catch (e) { console.error('[activity]', e.message); res.status(500).json({ message: 'Server error' }); }
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
  await logActivity(req.user._id, { type: 'goal_created', title: 'Goal created', message: goal.name, amount: goal.target });
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
// Goals track money the user sets aside themselves. Adding to or taking from a goal
// only updates its progress; no money moves.
app.post('/api/goals/:id/contribute', auth, async (req, res) => {
  try {
    const amount = Math.abs(Number(req.body.amount) || 0);
    if (!amount) return res.status(400).json({ message: 'Enter an amount greater than 0' });
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    if (goal.current >= goal.target) return res.status(400).json({ message: 'Goal already achieved' });
    const justReached = goal.current + amount >= goal.target;
    goal.current = Math.min(goal.current + amount, goal.target);
    await goal.save();
    if (justReached) await logActivity(req.user._id, { type: 'goal_reached', title: 'Goal reached', message: `${goal.name} completed`, amount: goal.target });
    res.json({ goal });
  } catch (e) { console.error('[goals/contribute]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Record money taken out of a goal. Without an amount, the whole balance is taken.
app.post('/api/goals/:id/withdraw', auth, async (req, res) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, userId: req.user._id });
    if (!goal) return res.status(404).json({ message: 'Goal not found' });
    if (goal.current <= 0) return res.status(400).json({ message: 'This goal has nothing saved yet.' });
    const asked = Math.abs(Number(req.body.amount) || 0);
    const amount = asked ? Math.min(asked, goal.current) : goal.current;
    goal.current = Math.round((goal.current - amount) * 100) / 100;
    await goal.save();
    await logActivity(req.user._id, { type: 'goal_withdrawn', title: 'Taken from goal', message: goal.name, amount });
    res.json({ goal, withdrawn: amount });
  } catch (e) { console.error('[goals/withdraw]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Recurring bills. Reminders only: nothing is ever paid automatically.
app.get('/api/bills', auth, async (req, res) => {
  try {
    const bills = await RecurringBill.find({ userId: req.user._id }).sort({ nextDue: 1 });
    res.json(bills);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/bills', auth, async (req, res) => {
  try {
    const { name, amount, dueDate, frequency, category } = req.body;
    const now = new Date();
    let nextDue = new Date(now.getFullYear(), now.getMonth(), dueDate);
    if (nextDue < now) nextDue = new Date(now.getFullYear(), now.getMonth() + 1, dueDate);
    const bill = new RecurringBill({ userId: req.user._id, name, amount, dueDate, frequency, category, nextDue, status: 'active' });
    await bill.save();
    res.status(201).json(bill);
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/bills/:id', auth, async (req, res) => {
  try {
    const { name, amount, dueDate, frequency, category, status } = req.body;
    const bill = await RecurringBill.findOne({ _id: req.params.id, userId: req.user._id });
    if (!bill) return res.status(404).json({ message: 'Bill not found' });
    if (name !== undefined) bill.name = name;
    if (amount !== undefined) bill.amount = amount;
    if (dueDate !== undefined) bill.dueDate = dueDate;
    if (frequency !== undefined) bill.frequency = frequency;
    if (category !== undefined) bill.category = category;
    if (status !== undefined) bill.status = status;
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
// several missed periods don't leave it stuck in the past (but never double-reminds,
// because a bill is only processed once per sweep).
// Pure: the nextDue strictly after `from`, without mutating the bill.
function nextDueAfter(bill, from = new Date()) {
  let next = new Date(bill.nextDue);
  do {
    next = bill.frequency === 'yearly'
      ? new Date(next.getFullYear() + 1, next.getMonth(), bill.dueDate)
      : new Date(next.getFullYear(), next.getMonth() + 1, bill.dueDate);
  } while (next <= from);
  return next;
}
function advanceBillDue(bill, from = new Date()) {
  bill.nextDue = nextDueAfter(bill, from);
}

// Process a single due bill: leave a reminder and move it to its next cycle.
async function processDueBill(bill) {
  const userId = bill.userId;
  const claimedNext = nextDueAfter(bill);
  // Atomically claim this due-cycle: advance nextDue only while it still equals
  // the value we read. Overlapping sweeps (cron + in-process interval +
  // app-launch trigger) race here - exactly one wins; the losers get null and
  // skip, so a bill is never reminded twice for the same cycle.
  const claim = async () => RecurringBill.findOneAndUpdate(
    { _id: bill._id, status: 'active', nextDue: bill.nextDue },
    { $set: { nextDue: claimedNext } },
  );

  // Claim atomically so overlapping sweeps don't double-remind.
  if (!(await claim())) return { bill: bill.name, status: 'skipped', amount: bill.amount };
  const link = `bill_due_${bill._id}_${new Date().toISOString().slice(0, 10)}`;
  if (!(await Notification.findOne({ userId, link }))) {
    await createNotification(userId, { type: 'info', title: 'Bill due', message: `${bill.name} (₦${bill.amount.toLocaleString()}) is due.`, link });
  }
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

// Server-side daily sweep across ALL users so reminders go out even if nobody opens
// the app. Dependency-free: interval + a short post-boot kick.
async function sweepAllDueBills() {
  try {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const dueBills = await RecurringBill.find({ status: 'active', nextDue: { $lte: endOfDay } });
    for (const bill of dueBills) {
      try { await processDueBill(bill); } catch (e) { console.error('[bill sweep] bill', String(bill._id), e.message); }
    }
    if (dueBills.length) console.log(`[bill sweep] processed ${dueBills.length} due bill(s)`);
  } catch (e) { console.error('[bill sweep]', e.message); }
}
setInterval(sweepAllDueBills, 24 * 60 * 60 * 1000);
setTimeout(sweepAllDueBills, 30 * 1000);

// Reliable external trigger for the bill reminder sweep. Render's free tier sleeps when
// idle, so the in-process interval above can miss days; point an external
// scheduler (cron-job.org / Render cron) at this daily, guarded by CRON_SECRET.
app.post('/api/cron/process-bills', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  try {
    const endOfDay = new Date(); endOfDay.setHours(23, 59, 59, 999);
    const dueBills = await RecurringBill.find({ status: 'active', nextDue: { $lte: endOfDay } });
    let reminders = 0, failed = 0;
    for (const bill of dueBills) {
      try {
        const r = await processDueBill(bill);
        if (r.status === 'reminder') reminders += 1;
      } catch (e) { failed += 1; console.error('[cron/process-bills] bill', String(bill._id), e.message); }
    }
    res.json({ due: dueBills.length, reminders, failed });
  } catch (e) {
    console.error('[cron/process-bills]', e.message);
    res.status(500).json({ message: 'Sweep failed' });
  }
});

// ── Subscription renewal reminders ─────────────────────────────────────────────
// The next date a subscription bills, computed (never charged) from its renewalDay
// (or the day implied by lastCharge/nextPayment) advanced to the next future date.
function computeNextRenewal(sub, from = new Date()) {
  const start = new Date(from); start.setHours(0, 0, 0, 0);
  const day = sub.renewalDay
    || (sub.nextPayment ? new Date(sub.nextPayment).getDate() : null)
    || (sub.lastCharge ? new Date(sub.lastCharge).getDate() : null);
  if (!day) return sub.nextPayment ? new Date(sub.nextPayment) : null;
  if (sub.frequency === 'yearly') {
    const anchor = sub.lastCharge ? new Date(sub.lastCharge) : (sub.nextPayment ? new Date(sub.nextPayment) : start);
    let next = new Date(start.getFullYear(), anchor.getMonth(), day);
    while (next < start) next = new Date(next.getFullYear() + 1, anchor.getMonth(), day);
    return next;
  }
  let next = new Date(start.getFullYear(), start.getMonth(), day);
  while (next < start) next = new Date(next.getFullYear(), next.getMonth() + 1, day);
  return next;
}

// Notify a user before each active subscription renews. Idempotent per renewal date
// via the notification `link`, so overlapping sweeps (cron + interval) can't double-
// remind. Also keeps sub.nextPayment current. Never moves money.
async function sweepSubscriptionReminders() {
  try {
    const subs = await Subscription.find({ status: 'active' });
    const now = new Date();
    for (const sub of subs) {
      try {
        const next = computeNextRenewal(sub, now);
        if (!next) continue;
        // Keep the stored renewal date fresh for the UI.
        if (!sub.nextPayment || new Date(sub.nextPayment).getTime() !== next.getTime()) {
          sub.nextPayment = next; await sub.save();
        }
        const days = Math.ceil((next.getTime() - now.getTime()) / 86400000);
        const window = sub.remindDaysBefore ?? 3;
        if (days < 0 || days > window) continue;
        const link = `sub_renewal_${sub._id}_${next.toISOString().slice(0, 10)}`;
        if (await Notification.findOne({ userId: sub.userId, link })) continue;
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        await createNotification(sub.userId, {
          type: 'info', title: 'Subscription renews soon',
          message: `${sub.name} renews ${when}${sub.cost ? ` (about ₦${Math.round(sub.cost).toLocaleString()})` : ''}. Cancel it now if you don't want to be charged.`,
          link,
        });
      } catch (e) { console.error('[sub reminders] sub', String(sub._id), e.message); }
    }
  } catch (e) { console.error('[sub reminders]', e.message); }
}
setInterval(sweepSubscriptionReminders, 24 * 60 * 60 * 1000);
setTimeout(sweepSubscriptionReminders, 45 * 1000);

// External scheduler trigger (Render free tier sleeps; the interval alone can miss a
// day). Guarded by CRON_SECRET like the other crons.
app.post('/api/cron/subscription-reminders', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  try { await sweepSubscriptionReminders(); res.json({ ok: true }); }
  catch (e) { console.error('[cron/subscription-reminders]', e.message); res.status(500).json({ message: 'Sweep failed' }); }
});

// ONE daily maintenance ping to schedule instead of many: runs the due-bill sweep and
// the subscription renewal reminders back-to-back. Each job is isolated so one failing
// never blocks the other. Guarded by CRON_SECRET. The per-job endpoints above still
// exist if you'd rather schedule them separately.
app.post('/api/cron/daily', (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  // Respond immediately (202) so the scheduler never waits on the sweep: it can grow
  // past a 30s HTTP timeout as the user base grows, and a timed-out request would look
  // like a failure. The jobs run in the background, each isolated so one can't block
  // the other. Errors surface in the server logs, not the HTTP response.
  res.status(202).json({ ok: true, started: ['bills', 'subscription-reminders', 'students-trials'] });
  (async () => {
    try { await sweepAllDueBills(); } catch (e) { console.error('[cron/daily] bills', e.message); }
    try { await sweepSubscriptionReminders(); } catch (e) { console.error('[cron/daily] subs', e.message); }
    try { console.log('[cron/daily] students', await sweepStudentsAndTrials()); } catch (e) { console.error('[cron/daily] students', e.message); }
  })();
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
    // Reconciliation result (A5), captured before the array is rebuilt by the
    // category passes below. Health metric: log every import's balance outcome.
    const reconciliation = (transactions && transactions.reconciliation) || { checked: false, ok: null };
    console.log(`[reconcile] user=${req.user._id} bank=${detectedBank || '?'} checked=${reconciliation.checked} ok=${reconciliation.ok} rows=${transactions.length} diff=${reconciliation.difference}`);
    // Persist the outcome for the accuracy dashboard (A7). Fire-and-forget.
    ReconLog.create({
      userId: req.user._id, bank: (detectedBank || '').toLowerCase(),
      source: ext === 'pdf' ? 'statement_pdf' : (ext === 'csv' ? 'statement_csv' : 'statement'),
      checked: !!reconciliation.checked, ok: reconciliation.ok,
      difference: reconciliation.difference ?? null, rows: transactions.length,
      uncertain: transactions.filter(t => t.confidenceLevel === 'low' || t.confidenceLevel === 'medium').length,
    }).catch((e) => console.error('[reconlog]', e.message));

    // Apply categories the user has taught the app from previous corrections.
    transactions = await applyLearnedCategories(req.user._id, transactions);
    // Then the shared consensus for anything the rules/user left as 'Other'.
    transactions = await applyGlobalCategories(transactions);

    const existing = await Transaction.find({ userId: req.user._id }, { date: 1, amount: 1, description: 1 }).lean();
    const existingKeys = new Set(existing.map(t => `${new Date(t.date).toISOString().split('T')[0]}|${Math.abs(t.amount)}|${t.description}`));
    const tagged = transactions.map(t => ({ ...t, duplicate: existingKeys.has(`${t.date}|${t.amount}|${t.description}`) }));
    const dupCount = tagged.filter(t => t.duplicate).length;
    // How many rows we're not fully sure about (A6): drives a "give these a look" hint.
    const uncertainCount = tagged.filter(t => t.confidenceLevel === 'medium' || t.confidenceLevel === 'low').length;
    const warnings = dupCount > 0 ? [`${dupCount} transaction(s) already exist and are pre‑marked.`] : [];
    if (reconciliation.checked && reconciliation.ok === false) {
      warnings.unshift(`This statement doesn't balance: ${reconciliation.reason}. Review carefully before saving.`);
    }
    return res.json({
      transactions: tagged,
      meta: { totalFound: tagged.length, duplicateCount: dupCount, uncertainCount, detectedBank, reconciliation, warnings },
    });
  } catch (error) {
    console.error('[upload-statement]', error.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return res.status(500).json({ message: "We couldn't read that file. Check it's a bank statement (PDF, CSV or Excel) and try again." });
  }
});

// Best-effort SMS/alert parser for the WEB paste box. This is deliberately a
// review-gate DRAFT: the canonical, corpus-tested parser lives in the mobile app;
// here we reuse the server's amount/date/type/category helpers to seed the review
// table. What matters for accuracy is that the RAW text + the values the user
// finalises are logged (source 'sms'), so they grow the golden corpus.
// Money in an alert: "NGN 5,000.00" / "₦5,000" / "N5000" (N only when it directly
// precedes a digit, so the 'n' in "on"/"in" isn't mistaken for naira) / a bare 2dp
// figure. Groups 1|2|3 hold the number.
const SMS_MONEY_RE = /(?:ngn|naira|₦)\s*([\d,]+(?:\.\d{1,2})?)|\bn(\d[\d,]*(?:\.\d{1,2})?)|\b([\d,]+\.\d{2})\b/gi;
// detectDirection (tiered credit/debit inference) + parseLabeledAlert (structured
// "Label : Value" alerts like GTBank GeNS) live in lib/alertParse: pure + corpus-
// tested against real bank emails.
const SMS_DATE_RE = /\b(\d{1,2}[\/-][A-Za-z]{3}[\/-]\d{2,4}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/i;

function parseOneAlert(msg, source = 'sms', sender = '') {
  const raw = msg.trim();
  if (!raw) return null;
  if (alertIgnoreReason(raw)) return null; // Stage 1.3: not a transaction → drop

  // Fast path: structured "Label : Value" alerts (GTBank GeNS et al.) state the
  // amount + direction explicitly, so parse the fields directly: far more reliable
  // than inferring from free text. Falls through to the generic path when it's not
  // a labelled alert.
  const labeled = parseLabeledAlert(raw);

  // Amount: labelled field if present, else first money-looking token (normalised).
  let amount = null, amtConf = 'low';
  if (labeled) { amount = labeled.amount; amtConf = 'high'; }
  else {
    const monies = [];
    let m;
    SMS_MONEY_RE.lastIndex = 0;
    while ((m = SMS_MONEY_RE.exec(raw)) !== null) monies.push(m[1] || m[2] || m[3]);
    for (const tok of monies) {
      const norm = normalizeAmount(tok);
      if (norm.value != null) { amount = norm.value; amtConf = norm.confidence; break; }
    }
  }
  // Direction: labelled field is authoritative; else tiered inference.
  const dir = labeled ? { type: labeled.type, conf: 'high' } : detectDirection(raw);
  const type = dir.type;
  const dirConf = dir.conf;
  // Date: labelled Value Date, else first date-looking token, else today. The caller
  // can see whether the text had a date (email falls back to when it was received).
  const dm = raw.match(SMS_DATE_RE);
  const textDate = (labeled && labeled.date && normalizeAnyDate(labeled.date)) || (dm && normalizeAnyDate(dm[1])) || null;
  const date = textDate || new Date().toISOString().slice(0, 10);
  // Description: labelled field, else a narration field or the counterparty phrase
  // (never the email subject or greeting), else strip money/dates/refs from the body.
  const description = (labeled && labeled.description) || alertDescription(raw) || (raw
    .replace(SMS_MONEY_RE, ' ')
    .replace(SMS_DATE_RE, ' ')
    .replace(/\b(?:ref|txn|transaction id|receipt)[:#\s]*[A-Za-z0-9]+/gi, ' ')
    .replace(/\b\d{6,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 140)) || 'Bank alert';
  const { bankCode, bankName, accountMask, senderKey } = fingerprintAccount(raw, sender);
  const bank = bankName || detectBank(raw);
  const category = categorizeTransaction(description, type);
  const confidence = amount != null && dirConf === 'high' && amtConf !== 'low' ? 'high' : (amount != null ? 'medium' : 'low');
  return {
    date, dateFromText: !!textDate, directionKnown: dirConf !== 'low', description, amount: amount != null ? +Number(amount).toFixed(2) : 0,
    type, category, bank, bankCode, accountMask, senderKey, reference: null, raw,
    // low-confidence amount is left visibly empty for the user to fill (spec A6).
    needsReview: confidence === 'low',
    confidence,
    _parse: {
      rawText: raw, source, bank, parserVersion: 'backend-sms-lite-v1', parserPath: 'deterministic',
      amount: amount != null ? +Number(amount).toFixed(2) : null,
      direction: type === 'income' ? 'credit' : 'debit',
      date, counterparty: description, category, confidence,
    },
  };
}

// Tier-2 LLM parser rescue (spec 6.1). Uses the shared Gemini config, so one env key
// lights up parsing and purpose inference together. Returns a validated
// { amount, type, merchant, date } or null (never throws).
async function llmRescueRow(rawText, source = 'sms', sender = '') {
  try {
    const cfg = llmConfig();
    if (!cfg) return null;
    const ex = await extractAlertLLM(rawText, cfg);
    const v = validateExtract(ex, rawText);
    if (!v) return null;
    const { bankCode, bankName, accountMask, senderKey } = fingerprintAccount(rawText, sender);
    const description = v.merchant || 'Bank alert';
    const category = categorizeTransaction(description, v.type);
    return {
      date: v.date || new Date().toISOString().slice(0, 10),
      description, amount: +Number(v.amount).toFixed(2), type: v.type, category,
      bank: bankName || detectBank(rawText), bankCode, accountMask, senderKey,
      reference: null, raw: rawText, needsReview: false, confidence: 'medium',
      _parse: {
        rawText, source, bank: bankName, parserVersion: 'llm-extract-v1', parserPath: 'llm',
        amount: +Number(v.amount).toFixed(2), direction: v.type === 'income' ? 'credit' : 'debit',
        date: v.date || null, counterparty: description, category, confidence: 'medium',
      },
    };
  } catch (e) { console.error('[llm-rescue]', e.message); return null; }
}

// LLM statement fallback (hybrid architecture): extract a WHOLE statement's rows when
// no deterministic strategy recognised its layout. Validated by the reconciliation
// oracle: if the statement gave a real opening AND closing balance and the LLM's
// ledger doesn't balance, we reject it (return null) rather than import a wrong
// ledger. Returns a parser-shaped array (or null), never throws.
async function llmParseStatement(rawText) {
  try {
    const cfg = llmConfig();
    if (!cfg) return null;
    const rows = await llmExtractStatement(rawText, cfg);
    if (!rows || !rows.length) return null;

    const { openingBalance, closingBalance } = extractBalances(rawText);
    const recon = reconcile({ transactions: rows, openingBalance, closingBalance });
    // Same safety gate as every other parser: a provably-wrong ledger is refused.
    if (recon.checked && recon.ok === false) {
      console.warn(`[llmParseStatement] rejected: does not reconcile (off by ${recon.difference}).`);
      return null;
    }
    const out = rows.map((r) => ({
      date: r.date,
      description: r.description,
      amount: +Number(r.amount).toFixed(2),
      type: r.type,
      category: categorizeTransaction(r.description, r.type),
      reference: null,
      // Trust it only as far as the math backs it: balanced → high, unverifiable → medium.
      confidenceLevel: recon.checked && recon.ok ? 'high' : 'medium',
    }));
    out.bank = detectBank(rawText);
    out.openingBalance = openingBalance;
    out.closingBalance = closingBalance;
    out.reconciliation = recon;
    return out;
  } catch (e) { console.error('[llmParseStatement]', e.message); return null; }
}

// ─── People & Family ledger helpers ──────────────────────────────────────────
// Fold a list of transactions into per-counterparty aggregates (sent/received totals
// + first/last seen), keeping the fullest name and best bank/account seen.
function aggregateCounterparties(txns, holderName) {
  const agg = new Map();
  for (const t of txns) {
    const cp = extractCounterparty(t.description);
    if (!cp) continue;
    // A transfer to/from the user's own account is internal, not a contact.
    if (holderName && isSelf(holderName, cp.name)) continue;
    const key = contactKey(cp);
    if (!key) continue;
    const amt = Math.abs(Number(t.amount) || 0);
    if (!amt) continue;
    const when = new Date(t.date);
    let g = agg.get(key);
    if (!g) { g = { key, name: cp.name, bank: cp.bank, account: cp.account, sent: 0, sentCount: 0, recv: 0, recvCount: 0, first: when, last: when }; agg.set(key, g); }
    // Direction: prefer the narration's to/from; fall back to the ledger sign.
    const isOut = cp.direction === 'to' || (cp.direction !== 'from' && t.type === 'expense');
    if (isOut) { g.sent += amt; g.sentCount++; } else { g.recv += amt; g.recvCount++; }
    if (when < g.first) g.first = when;
    if (when > g.last) g.last = when;
    if (cp.account && !g.account) g.account = cp.account;
    if (cp.bank && !g.bank) g.bank = cp.bank;
    if ((cp.name || '').length > (g.name || '').length) g.name = cp.name;
  }
  return agg;
}

// Incremental fold after an import (fresh rows only): adds to existing totals and
// never touches the user's own relationship/label/category.
async function foldContactsIncremental(userId, txns, holderName) {
  const agg = aggregateCounterparties(txns, holderName);
  const ops = [];
  for (const g of agg.values()) {
    ops.push({ updateOne: {
      filter: { userId, key: g.key },
      update: {
        $setOnInsert: { userId, key: g.key, relationship: 'unknown', label: '', category: '' },
        $set: { name: g.name, bank: g.bank, account: g.account, familySuggested: familySignal(holderName, g.name), lastSeen: g.last },
        $inc: { sentTotal: g.sent, sentCount: g.sentCount, receivedTotal: g.recv, receivedCount: g.recvCount },
        $min: { firstSeen: g.first },
      },
      upsert: true,
    } });
  }
  if (ops.length) await Contact.bulkWrite(ops, { ordered: false });
  return ops.length;
}

// Full rebuild from ALL of the user's transactions: resets the stats but preserves
// the user's own labels/relationship/category across the rebuild.
async function rebuildContacts(userId, holderName) {
  const txns = await Transaction.find({ userId }, { description: 1, amount: 1, type: 1, date: 1 }).lean();
  const agg = aggregateCounterparties(txns, holderName);
  const existing = await Contact.find({ userId }, { key: 1, relationship: 1, label: 1, category: 1 }).lean();
  const userFields = new Map(existing.map((c) => [c.key, { relationship: c.relationship, label: c.label, category: c.category }]));
  await Contact.deleteMany({ userId });
  const docs = [];
  for (const g of agg.values()) {
    const uf = userFields.get(g.key) || {};
    docs.push({
      userId, key: g.key, name: g.name, bank: g.bank, account: g.account,
      sentTotal: g.sent, sentCount: g.sentCount, receivedTotal: g.recv, receivedCount: g.recvCount,
      firstSeen: g.first, lastSeen: g.last, familySuggested: familySignal(holderName, g.name),
      relationship: uf.relationship || 'unknown', label: uf.label || '', category: uf.category || '',
    });
  }
  if (docs.length) await Contact.insertMany(docs, { ordered: false });
  return docs.length;
}

// The category a labelled contact should stamp on their transfers: an explicit
// category the user chose, else 'Family & Friends' when tagged family/friend.
function contactCategory(c) {
  if (c && c.category) return c.category;
  if (c && (c.relationship === 'family' || c.relationship === 'friend')) return 'Family & Friends';
  return '';
}

// Recategorise the user's existing transfers to one contact (used when they label it).
async function applyContactToPast(userId, contact) {
  const cat = contactCategory(contact);
  if (!cat) return 0;
  const txns = await Transaction.find({ userId, type: { $in: ['income', 'expense'] } }, { description: 1 }).lean();
  const ids = [];
  for (const t of txns) {
    const cp = extractCounterparty(t.description);
    if (cp && contactKey(cp) === contact.key) ids.push(t._id);
  }
  if (!ids.length) return 0;
  await Transaction.updateMany({ _id: { $in: ids }, userId }, { $set: { category: cat } });
  return ids.length;
}

// Deterministic parse, with an optional LLM rescue for the needs-review tail (unknown
// banks / odd wording) when a provider is configured. Rescue is capped per call so a
// paste of many unparseable lines can't fan out into many LLM calls.
const LLM_RESCUE_MAX = 8;
async function parseAlertsWithRescue(rawList, source = 'sms', sender = '') {
  const rows = rawList.map((b) => ({ raw: b, row: parseOneAlert(b, source, sender) }));
  if (llmActive()) {
    let used = 0;
    for (const item of rows) {
      if (used >= LLM_RESCUE_MAX) break;
      if (item.row && item.row.amount <= 0 && item.row.needsReview) {
        const rescued = await llmRescueRow(item.raw, source, sender);
        if (rescued) { item.row = rescued; used += 1; }
      }
    }
  }
  return rows.map((r) => r.row);
}

app.post('/api/parse-sms', auth, async (req, res) => {
  try {
    const text = (req.body?.text || '').toString();
    if (!text.trim()) return res.status(400).json({ message: 'Paste one or more bank alerts first.' });
    // Split into individual alerts on blank lines; fall back to the whole block.
    const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    const source = blocks.length ? blocks : [text];
    // Deterministic parse + an optional LLM rescue for the needs-review tail (unknown
    // banks / odd wording) when a Tier-2 provider is configured.
    let rows = (await parseAlertsWithRescue(source, 'sms')).filter((r) => r && (r.amount > 0 || r.needsReview));
    if (!rows.length) return res.status(422).json({ message: "Couldn't read a transaction from that. Check you pasted the full alert.", transactions: [] });
    // Apply the user's learned categories, then the shared consensus.
    rows = await applyLearnedCategories(req.user._id, rows);
    rows = await applyGlobalCategories(rows);
    const detectedBank = rows.find((r) => r.bank)?.bank || '';
    return res.json({ transactions: rows, meta: { totalFound: rows.length, detectedBank, source: 'sms' } });
  } catch (e) {
    console.error('[parse-sms]', e.message);
    return res.status(500).json({ message: 'Could not parse those alerts.' });
  }
});

// ── Email forwarding (spec B1) ─────────────────────────────────────────────────
// The user forwards bank-alert emails to <token>@in.automonie.com; the inbound
// provider POSTs them to the webhook below, and we parse them like SMS. Activated
// once INBOUND_EMAIL_SECRET (+ DNS/MX for the inbound domain) are configured.
const INBOUND_DOMAIN = process.env.INBOUND_EMAIL_DOMAIN || 'in.automonie.com';
const inboundExtraDomains = (process.env.INBOUND_EMAIL_EXTRA_DOMAINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const inboundActive = () => !!process.env.INBOUND_EMAIL_SECRET;

// The user's unique inbound address (creates the token on first request) + whether
// we've started receiving mail for them.
app.get('/api/inbound-email/address', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('inboundEmailToken inboundEmailLastAt inboundEmailCount gmailVerifyCode gmailVerifyLink gmailVerifyAt');
    if (!user.inboundEmailToken) {
      // Generate a unique token (retry on the rare index collision).
      for (let i = 0; i < 5; i++) {
        const tok = inboundEmail.genToken();
        if (!(await User.exists({ inboundEmailToken: tok }))) { user.inboundEmailToken = tok; break; }
      }
      await user.save();
    }
    res.json({
      address: `${user.inboundEmailToken}@${INBOUND_DOMAIN}`,
      domain: INBOUND_DOMAIN,
      active: inboundActive(),                       // false until keys/DNS are set
      receiving: !!user.inboundEmailLastAt,
      lastAt: user.inboundEmailLastAt || null,
      count: user.inboundEmailCount || 0,
      gmailVerification: gmailVerificationPayload(user),
    });
  } catch (e) { console.error('[inbound-email/address]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// The pending Gmail forwarding confirmation (spec 3.4), or null. Surfaced so the
// onboarding screen shows the code + verify link the moment Google's mail lands.
function gmailVerificationPayload(u) {
  if (!u || (!u.gmailVerifyCode && !u.gmailVerifyLink)) return null;
  return { code: u.gmailVerifyCode || '', link: u.gmailVerifyLink || '', at: u.gmailVerifyAt || null };
}

// Poll for the "we're receiving your alerts ✓" state (drives the test-email step),
// and for a freshly-arrived Gmail confirmation.
app.get('/api/inbound-email/status', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user._id).select('inboundEmailLastAt inboundEmailCount gmailVerifyCode gmailVerifyLink gmailVerifyAt');
    res.json({ active: inboundActive(), receiving: !!u.inboundEmailLastAt, lastAt: u.inboundEmailLastAt || null, count: u.inboundEmailCount || 0, gmailVerification: gmailVerificationPayload(u) });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Dismiss the captured Gmail confirmation once the user has clicked through / no
// longer needs it shown.
app.post('/api/inbound-email/gmail-verification/clear', auth, async (req, res) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $set: { gmailVerifyCode: '', gmailVerifyLink: '', gmailVerifyAt: null } });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Ingest one parsed email alert: dedupe (±1 day, any source), resolve/learn the bank
// (Addendum A slice 3), and save. Returns 1 if a transaction was created, else 0.
// Called once per alert: a digest email (spec 3.6) drives this several times; each
// call re-queries so rows created earlier in the same digest also dedupe.
// Save one parsed alert for a user unless it duplicates a row within a day (any
// source). Returns 1 when saved, 0 for a duplicate. Shared by email, background
// capture and the quiet share target.
async function ingestAlert(user, parsed, source = 'email') {
  const when = new Date(parsed.date);
  const gte = new Date(when.getTime() - 86400000), lte = new Date(when.getTime() + 86400000);
  const existing = await Transaction.find({ userId: user._id, date: { $gte: gte, $lte: lte } })
    .select('amount type date bank description').lean();
  const fp = fingerprint({ amount: parsed.amount, type: parsed.type, date: parsed.date, bank: parsed.bank, description: parsed.description });
  const dup = existing.some((e) => matchScore(fp, fingerprint({ amount: e.amount, type: e.type, date: new Date(e.date).toISOString().slice(0, 10), bank: e.bank, description: e.description })) >= MERGE);
  if (dup) return 0;
  const signed = parsed.type === 'income' ? Math.abs(parsed.amount) : -Math.abs(parsed.amount);
  const kind = classifyKind({ type: parsed.type, description: parsed.description, category: parsed.category });
  let eCode = (parsed.bankCode || '').toString().toLowerCase().slice(0, 24);
  let eBank = parsed.bank || '';
  let eMask = (parsed.accountMask || '').toString().replace(/\D/g, '').slice(0, 4);
  let eSender = normalizeSenderKey(parsed.senderKey || '');
  if (!eCode && eSender) {
    const learned = await learnedBankFor(user._id, eSender);
    if (learned) { eCode = learned.code; if (!eBank) eBank = learned.name; eSender = ''; }
    else { await logUnknownSender(eSender, parsed.raw || parsed.description || '', source); }
  }
  if (eCode) {
    const st = await resolveAccountStamp(user._id, eCode, eMask);
    if (st.merged) { eCode = st.bankCode; eMask = st.accountMask; eBank = st.bankName || eBank; }
  }
  await new Transaction({
    userId: user._id, date: when, description: parsed.description, amount: signed,
    category: parsed.category || 'Other', type: kind || parsed.type,
    source, bank: eBank, importedAt: new Date(),
    bankCode: eCode, accountMask: eMask, senderKey: eSender,
    ...(parsed.confidence ? { parseConfidence: String(parsed.confidence).slice(0, 8) } : {}),
  }).save();
  await touchUserAccount(user._id, { bankCode: eCode, bankName: eBank, accountMask: eMask }, when);
  await maybeLinkSubscription(user._id, { description: parsed.description, amount: parsed.amount, category: parsed.category, date: when, bankName: eBank });
  return 1;
}

// ─── Share-to-Automonie ingestion (share-sheet channel) ─────────────────────────
// The user shares any transaction alert (SMS / OPay-PalmPay push / email body / any
// on-screen text) to Automonie. We run it through the SAME deterministic parser as
// SMS/email (parseOneAlert), dedupe it against recent rows, and return candidate(s) +
// confidence + a dedupe verdict. We do NOT save here: the client shows a confirm sheet
// and persists via POST /api/transactions with source:'share'. Raw shared text is
// transient: parsed, then never persisted or logged (it holds full account details).
const shareIdemp = new Map(); // clientIdempotencyKey -> { at, body }  (double-submit guard)
function shareDedupeCheck(existing, parsed) {
  const fp = fingerprint({ amount: parsed.amount, type: parsed.type, date: parsed.date, bank: parsed.bank, description: parsed.description });
  for (const e of existing) {
    const s = matchScore(fp, fingerprint({ amount: e.amount, type: e.type, date: new Date(e.date).toISOString().slice(0, 10), bank: e.bank, description: e.description }));
    if (s >= MERGE) return { verdict: 'duplicate_suspected', existingTransactionId: String(e._id) };
  }
  return { verdict: 'unique', existingTransactionId: null };
}
app.post('/api/ingest/share', auth, async (req, res) => {
  try {
    const key = (req.body?.clientIdempotencyKey || '').toString().slice(0, 64);
    const now = Date.now();
    for (const [k, v] of shareIdemp) if (now - v.at > 120000) shareIdemp.delete(k);
    if (key && shareIdemp.has(key)) return res.json(shareIdemp.get(key).body); // reject double-submit

    const rawText = (req.body?.sharedText || '').toString();
    if (rawText.length > shareIngest.MAX_SHARE_CHARS * 4) return res.status(413).json({ message: 'Shared text too large' });
    const text = shareIngest.guardText(rawText);
    if (!text.trim()) return res.status(422).json({ error: 'no_transaction', message: "Couldn't find a transaction here." });

    // Multi-transaction blob → split (reuse the email digest splitter); a single alert
    // yields exactly one segment.
    const segments = inboundEmail.splitEmailAlerts(text);
    const rows = [];
    for (const seg of segments) {
      const parsed = parseOneAlert(seg, 'share'); // deterministic only: no LLM gap-fill for amount/direction
      if (parsed && parsed.amount > 0) rows.push(parsed);
    }
    if (rows.length === 0) return res.status(422).json({ error: 'no_transaction', message: "Couldn't find a transaction here." });

    // Dedupe each candidate against the user's rows in a ±1-day window (cross-source:
    // catches an auto-forwarded twin so we never double-count).
    const times = rows.map((r) => new Date(r.date).getTime()).filter((t) => !isNaN(t));
    const base = times.length ? times : [now];
    const gte = new Date(Math.min(...base) - 86400000), lte = new Date(Math.max(...base) + 86400000);
    const existing = await Transaction.find({ userId: req.user._id, date: { $gte: gte, $lte: lte } })
      .select('amount type date bank description').lean();

    const parseId = crypto.randomUUID();
    const candidates = rows.map((r) => ({
      ...shareIngest.toCandidate(r),
      confidence: shareIngest.confidenceTier(r),
      dedupe: shareDedupeCheck(existing, r),
      bankCode: r.bankCode || null, // passed back so the confirm-save can persist the fingerprint
    }));
    const body = { candidates, candidate: candidates[0], parseId, multiple: candidates.length > 1 };
    if (key) shareIdemp.set(key, { at: now, body });
    res.json(body);
  } catch (e) { console.error('[ingest/share]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Inbound providers (SendGrid Inbound Parse, Mailgun routes) POST the email as
// multipart/form-data, which express.json/urlencoded don't parse, so we run a
// dedicated multer pass on the webhook to populate req.body with the text fields.
// Attachments are accepted into memory and ignored; a parse error never fails the
// webhook (we'd rather 200/ignore than make the provider retry-storm).
const inboundUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 25 } });
const parseInboundBody = (req, res, next) => {
  inboundUpload.any()(req, res, (err) => {
    if (err) console.error('[inbound-email/parse]', err.message);
    next();
  });
};

// Provider webhook. Provider-agnostic: normalises SendGrid / Mailgun / Postmark / SES
// field names. Always answers 200 for accepted-but-ignored mail so the provider
// doesn't retry; 503 until activated, 401 on a bad secret.
app.post('/api/inbound-email/webhook', parseInboundBody, async (req, res) => {
  try {
    if (!inboundActive()) return res.status(503).json({ message: 'Email forwarding is not enabled yet.' });
    const key = req.get('x-inbound-key') || req.query.key || req.body?.key || '';
    if (!safeEqual(key, process.env.INBOUND_EMAIL_SECRET)) return res.status(401).json({ message: 'Bad webhook key' });

    const b = req.body || {};
    // Collect EVERY possible recipient field into one string for extractToken to
    // scan. Critical for forwarded mail: Gmail auto-forward keeps the user's own
    // address in the To header and puts our <token>@in.automonie.com address only in
    // the envelope recipient: Postmark surfaces that as `OriginalRecipient` (Mailgun:
    // `recipient`). Without it, every forwarded alert is dropped as "no-token".
    const recipient = [
      b.OriginalRecipient, b.recipient, b.To, b.to,
      Array.isArray(b.ToFull) ? b.ToFull.map((x) => x && x.Email).filter(Boolean).join(',') : '',
      b.Cc, b.cc,
    ].filter(Boolean).join(',');
    const from = b.sender || b.From || b.from || b.FromFull?.Email || '';
    const subject = b.subject || b.Subject || '';
    const text = b['body-plain'] || b['stripped-text'] || b.TextBody || b.text || b.plain || '';
    const html = b['body-html'] || b.HtmlBody || b.html || '';

    const token = inboundEmail.extractToken(recipient, INBOUND_DOMAIN);
    if (!token) return res.json({ ok: true, skipped: 'no-token' });
    const user = await User.findOne({ inboundEmailToken: token }).select('_id name inboundEmailCount gmailVerifyCode gmailVerifyLink gmailVerifyAt');
    if (!user) return res.json({ ok: true, skipped: 'unknown-recipient' });

    // Gmail forwarding confirmation (spec 3.4): Google's one-time verify mail isn't a
    // bank, so it would be dropped below: capture its code/link first and surface it
    // to the onboarding screen so the user can finish enabling forwarding.
    if (inboundEmail.isGmailForwardingVerification(from)) {
      const v = inboundEmail.extractGmailVerification({ subject, text, html });
      if (v) {
        user.gmailVerifyCode = v.code || '';
        user.gmailVerifyLink = v.link || '';
        user.gmailVerifyAt = new Date();
        await user.save();
      }
      return res.json({ ok: true, gmailVerification: !!v });
    }

    // Resolve the effective bank sender + text to parse. Accepts a direct/auto-forward
    // (envelope From is the bank) AND a manual forward from any provider (From is the
    // user's Yahoo/Gmail; the bank sits in the quoted forwarded header). Anything with
    // no recognisable bank sender is silently dropped (spec B1).
    const resolved = inboundEmail.resolveBankEmail({ subject, text, html, from }, inboundExtraDomains);
    if (!resolved) return res.json({ ok: true, skipped: 'sender-not-allowed' });
    const bankFrom = resolved.sender;

    // We're receiving mail for this user → light up the status regardless of parse.
    user.inboundEmailLastAt = new Date();

    // Digest emails (spec 3.6): one mail may cover several transactions. Split the
    // body into per-transaction segments, a single alert yields exactly one, and
    // ingest each. Only for a single alert do we parse the subject-bearing text (banks
    // often put the amount/direction there); a digest's subject is a generic summary.
    const segments = inboundEmail.splitEmailAlerts(resolved.bodyOnly);
    let parsedRows;
    if (segments.length > 1) {
      parsedRows = (await parseAlertsWithRescue(segments, 'email', bankFrom)).filter((r) => r && r.amount > 0);
    } else {
      const [one] = await parseAlertsWithRescue([resolved.fullText], 'email', bankFrom);
      parsedRows = one && one.amount > 0 ? [one] : [];
    }
    // An alert with no readable date happened when the bank emailed it, not "today"
    // (forwards and retries can land days later).
    const sent = b.Date || b.date || (b.timestamp ? Number(b.timestamp) * 1000 : null);
    const sentDay = sent && !isNaN(new Date(sent)) ? new Date(sent).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' }) : null;
    // For a single alert the subject was parsed with the body (for amount/direction);
    // the description must come from the body alone, never the subject line.
    const bodyDescription = segments.length > 1 ? '' : alertDescription(resolved.bodyOnly);
    let created = 0;
    for (const parsed of parsedRows) {
      // Only the rules decide direction. With no debit/credit wording at all it is
      // a notice, not a transaction, and must not land in the ledger as spending.
      if (!parsed.directionKnown) continue;
      if (sentDay && parsed.dateFromText === false) parsed.date = sentDay;
      if (bodyDescription) {
        parsed.description = bodyDescription;
        parsed.category = categorizeTransaction(bodyDescription, parsed.type);
      }
      created += await ingestAlert(user, parsed, 'email');
    }
    if (created) {
      user.inboundEmailCount = (user.inboundEmailCount || 0) + created;
      try { await reconcileTransfers(user._id); } catch { /* non-fatal */ }
    }
    await user.save();
    return res.json({ ok: true, created });
  } catch (e) { console.error('[inbound-email/webhook]', e.message); return res.status(500).json({ message: 'Server error' }); }
});

// ─── Action Center ──────────────────────────────────────────────────────────────
// Everything that needs the user's decision, in one list: transactions we weren't
// sure about, possible duplicates, subscriptions we couldn't name, charges that look
// like untracked subscriptions, accounts to name and banks we don't recognise.
const pairKeyOf = (a, b) => [String(a), String(b)].sort().join(':');

async function findPossibleDuplicates(userId, kept) {
  const since = new Date(Date.now() - 120 * 86400000);
  const txns = await Transaction.find({ userId, type: { $in: ['income', 'expense'] }, date: { $gte: since } })
    .select('date amount type description bank source').sort({ date: 1 }).lean();
  const byAmount = new Map();
  for (const t of txns) {
    const k = `${t.type}:${Math.abs(t.amount).toFixed(2)}`;
    if (!byAmount.has(k)) byAmount.set(k, []);
    byAmount.get(k).push(t);
  }
  const fp = (t) => fingerprint({ amount: Math.abs(t.amount), type: t.type, date: new Date(t.date).toISOString().slice(0, 10), bank: t.bank, description: t.description });
  const pairs = [];
  for (const group of byAmount.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (Math.abs(new Date(b.date) - new Date(a.date)) > 86400000) continue;
        if (kept.has(pairKeyOf(a._id, b._id))) continue;
        const score = matchScore(fp(a), fp(b));
        if (score >= PROBABLE_DUP) pairs.push({ a, b, score });
      }
    }
  }
  return pairs.sort((x, y) => y.score - x.score).slice(0, 20);
}

const slimTxn = (t) => ({ id: t._id, date: t.date, amount: Math.abs(t.amount), type: t.type, description: t.description, bank: t.bank || '', source: t.source || 'manual', category: t.category });

async function actionCenterItems(userId) {
  const keptRows = await KeptPair.find({ userId }, { pairKey: 1 }).lean();
  const kept = new Set(keptRows.map((k) => k.pairKey));
  const notSenders = await dismissedSenderKeys(userId);
  const [lowConf, dupes, unnamedSubs, detected, accounts, senders] = await Promise.all([
    // Anything saved without the user seeing it that the rules weren't sure about.
    Transaction.find({ userId, reviewedAt: { $exists: false }, $or: [{ parseConfidence: 'low' }, { parseConfidence: 'medium', source: { $in: ['email', 'notification', 'sms'] } }] }).sort({ date: -1 }).limit(30).lean(),
    findPossibleDuplicates(userId, kept),
    Subscription.find({ userId, needsName: true, status: { $ne: 'cancelled' } }).sort({ lastCharge: -1 }).limit(20).lean(),
    detectSubscriptions(userId).catch(() => []),
    UserAccount.find({ userId, hidden: { $ne: true }, active: { $ne: false }, deleted: { $ne: true }, label: { $in: ['', null] }, txnCount: { $gt: 0 } }).sort({ txnCount: -1 }).limit(10).lean(),
    Transaction.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId), senderKey: { $type: 'string', $ne: '', $nin: notSenders } } },
      { $group: { _id: '$senderKey', count: { $sum: 1 }, sample: { $first: '$description' } } },
      { $sort: { count: -1 } }, { $limit: 10 },
    ]),
  ]);
  const items = [
    ...lowConf.map((t) => ({ type: 'review_transaction', id: String(t._id), transaction: slimTxn(t) })),
    ...dupes.map(({ a, b, score }) => ({ type: 'possible_duplicate', id: pairKeyOf(a._id, b._id), score, first: slimTxn(a), second: slimTxn(b) })),
    ...unnamedSubs.map((s) => ({ type: 'name_subscription', id: String(s._id), key: s.sourceKey || subscriptionKey(s.name), name: s.name, cost: s.cost, lastCharge: s.lastCharge || null })),
    ...detected.map((d) => ({ type: 'track_subscription', id: `detect:${d.key}`, key: d.key, name: d.name, cost: d.cost, occurrences: d.occurrences, lastSeen: d.lastSeen })),
    ...accounts.map((a) => ({ type: 'name_account', id: String(a._id), bankName: a.bankName || '', bankCode: a.bankCode, accountMask: a.accountMask, txnCount: a.txnCount || 0 })),
    ...senders.map((s) => ({ type: 'tag_sender', id: `sender:${s._id}`, senderKey: s._id, sample: (s.sample || '').slice(0, 80), count: s.count })),
  ];
  return items;
}

app.get('/api/action-center', auth, async (req, res) => {
  try {
    const items = await actionCenterItems(req.user._id);
    const counts = items.reduce((m, it) => { m[it.type] = (m[it.type] || 0) + 1; return m; }, {});
    if (req.query.summary === '1') return res.json({ total: items.length, counts });
    res.json({ total: items.length, counts, items });
  } catch (e) { console.error('[action-center]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Confirm a transaction we weren't sure about (after the user checked or edited it).
app.post('/api/transactions/:id/reviewed', auth, async (req, res) => {
  try {
    const t = await Transaction.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: { reviewedAt: new Date(), parseConfidence: 'high' } }, { new: true });
    if (!t) return res.status(404).json({ message: 'Transaction not found' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Both rows of a suspected duplicate are real: stop flagging the pair.
app.post('/api/action-center/keep-both', auth, async (req, res) => {
  try {
    const { first, second } = req.body || {};
    if (!first || !second) return res.status(400).json({ message: 'Missing transactions.' });
    const owned = await Transaction.countDocuments({ _id: { $in: [first, second] }, userId: req.user._id });
    if (owned !== 2) return res.status(404).json({ message: 'Transaction not found' });
    await KeptPair.updateOne({ userId: req.user._id, pairKey: pairKeyOf(first, second) }, { $setOnInsert: { userId: req.user._id, pairKey: pairKeyOf(first, second) } }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { if (e && e.code === 11000) return res.json({ ok: true }); res.status(500).json({ message: 'Server error' }); }
});

// ─── Background capture ─────────────────────────────────────────────────────────
// Android bank-app notifications, iPhone Shortcuts on bank SMS, and the quiet share
// target post here from the phone without opening the app. They authenticate with
// the user's capture key (x-capture-key), not a login session. Alerts go through the
// same deterministic parser and duplicate check as everything else; low-confidence
// rows are saved with parseConfidence 'low' so they surface for review.
const captureLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `cap:${String(req.headers['x-capture-key'] || '').slice(0, 64) || rateLimit.ipKeyGenerator(req.ip)}`,
  message: { message: 'Too many captures at once. They will be retried.' },
});

const captureUser = async (req) => {
  const key = String(req.headers['x-capture-key'] || req.body?.key || '');
  if (!capture.looksLikeCaptureKey(key)) return null;
  return User.findOne({ captureKeyHash: capture.hashCaptureKey(key), isActive: { $ne: false } })
    .select('_id name captureCount captureLastAt');
};

// Create (or replace) the signed-in user's capture key. The key is returned once;
// replacing it disconnects every phone or Shortcut that used the old one.
app.post('/api/capture/key', auth, async (req, res) => {
  try {
    const key = capture.newCaptureKey();
    req.user.captureKeyHash = capture.hashCaptureKey(key);
    await req.user.save();
    res.json({ key, endpoint: `${process.env.PUBLIC_API_URL || 'https://financial-app-w2ai.onrender.com'}/api/ingest/capture` });
  } catch (e) { console.error('[capture/key]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.get('/api/capture/status', auth, async (req, res) => {
  res.json({ connected: !!req.user.captureKeyHash, lastAt: req.user.captureLastAt || null, count: req.user.captureCount || 0 });
});

app.delete('/api/capture/key', auth, async (req, res) => {
  try {
    req.user.captureKeyHash = undefined;
    await req.user.save();
    res.json({ connected: false });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Parse a captured alert text and save it. Returns { saved, duplicate, ignored }.
async function ingestCapturedText(user, { text, sender = '', source, day }) {
  const parsed = parseOneAlert(text, source, sender);
  if (!parsed || !(parsed.amount > 0) || !parsed.directionKnown) return { saved: false, ignored: true };
  if (day && parsed.dateFromText === false) parsed.date = day;
  const created = await ingestAlert(user, parsed, source);
  if (created) {
    user.captureCount = (user.captureCount || 0) + 1;
    try { await reconcileTransfers(user._id); } catch { /* non-fatal */ }
    if (parsed.confidence !== 'high') {
      await createNotification(user._id, {
        type: 'info', title: 'Check a captured transaction',
        message: `We saved ${naira(parsed.amount)} (${parsed.description.slice(0, 40)}) but weren't sure about it. Give it a quick look.`,
      }).catch(() => {});
    }
  }
  return { saved: !!created, duplicate: !created, amount: parsed.amount, type: parsed.type, description: parsed.description };
}

// Text capture: { source: 'notification' | 'sms', title?, text, bigText?, app?, sender?, postedAt? }
app.post('/api/ingest/capture', captureLimiter, async (req, res) => {
  try {
    const user = await captureUser(req);
    if (!user) return res.status(401).json({ message: 'Unknown capture key. Reconnect from the app.' });
    const b = req.body || {};
    const source = b.source === 'notification' ? 'notification' : 'sms';
    const text = capture.captureText({ title: b.title, text: b.text, bigText: b.bigText });
    if (!text.trim()) return res.status(400).json({ message: 'Nothing to read.' });
    // The bank app's name helps resolve the bank when the alert text doesn't say it.
    const sender = String(b.sender || capture.bankForApp(b.app) || '').slice(0, 60);
    const result = await ingestCapturedText(user, { text, sender, source, day: capture.captureDay(b.postedAt) });
    user.captureLastAt = new Date();
    await user.save();
    res.json({ ok: true, ...result });
  } catch (e) { console.error('[ingest/capture]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Read the text out of an image (a receipt screenshot) with the vision model. The
// model only transcribes; amounts and direction still come from the deterministic
// parser reading that text.
async function transcribeImage(buffer, mime) {
  const cfg = llmConfig();
  if (!cfg) return '';
  const r = await fetch(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'text', text: 'Transcribe every piece of text in this image exactly as written, line by line. Output only the text, nothing else.' },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
      ] }],
    }),
  });
  if (!r.ok) throw new Error(`vision ${r.status}`);
  const j = await r.json();
  return String(j.choices?.[0]?.message?.content || '').slice(0, capture.MAX_CAPTURE_CHARS);
}

const captureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype === 'application/pdf' || /^image\/(png|jpe?g|webp)$/.test(file.mimetype)),
});

// File capture from the quiet share target: a PDF receipt or a receipt screenshot.
app.post('/api/ingest/capture-file', captureLimiter, (req, res, next) => {
  captureUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.code === 'LIMIT_FILE_SIZE' ? 'File too large (8 MB max).' : 'Unsupported file.' });
    next();
  });
}, async (req, res) => {
  try {
    const user = await captureUser(req);
    if (!user) return res.status(401).json({ message: 'Unknown capture key. Reconnect from the app.' });
    if (!req.file) return res.status(400).json({ message: 'Send a PDF receipt or a screenshot.' });
    let text = '';
    if (req.file.mimetype === 'application/pdf') {
      try { text = await extractPdfText(req.file.buffer); }
      catch (e) { if (isPdfPasswordError(e)) return res.status(422).json({ message: 'That PDF is password protected. Upload it from the app instead.' }); throw e; }
    } else {
      text = await transcribeImage(req.file.buffer, req.file.mimetype);
      if (!text) return res.status(503).json({ message: 'Reading screenshots is not switched on yet.' });
    }
    // A long PDF is a statement, not a receipt: point the user at statement upload.
    if (text.length > capture.MAX_CAPTURE_CHARS) return res.status(422).json({ message: 'This looks like a full statement. Upload it from Import instead.' });
    const result = await ingestCapturedText(user, { text, source: 'share', day: capture.captureDay(Date.now()) });
    user.captureLastAt = new Date();
    await user.save();
    res.json({ ok: true, ...result });
  } catch (e) { console.error('[ingest/capture-file]', e.message); res.status(500).json({ message: 'Server error' }); }
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

    // De-duplicate in two layers:
    //  1) intra-batch exact (day + |amount| + description): repeated rows in a
    //     single scan collapse, as before.
    //  2) cross-source fuzzy vs everything already saved in the ±1 day window (ANY
    //     source, so a manual entry or a prior statement/SMS import is caught)
    //     drop only near-certain duplicates (matchScore >= 85, amount exact +
    //     direction mandatory). Ambiguous rows are kept, so a real transaction is
    //     never deleted. This is what makes SMS + statement + Mono not triple-count.
    const keyOf = (d, amt, desc) => `${new Date(d).toISOString().slice(0, 10)}|${Math.round(Math.abs(amt))}|${(desc || '').trim().toLowerCase()}`;
    const isoDay = (d) => new Date(d).toISOString().slice(0, 10);
    const times = valid.map(t => +new Date(t.date)).filter(n => !isNaN(n));
    let existingFps = [];
    if (times.length) {
      const gte = new Date(Math.min(...times) - 86400000);
      const lte = new Date(Math.max(...times) + 86400000);
      const existing = await Transaction.find({ userId: req.user._id, date: { $gte: gte, $lte: lte } })
        .select('date amount description type bank').lean();
      existingFps = existing.map(e => fingerprint({ amount: e.amount, type: e.type, date: isoDay(e.date), bank: e.bank, description: e.description }));
    }
    const seen = new Set();
    const fresh = [];
    for (const t of valid) {
      const k = keyOf(t.date, t.amount, t.description);
      if (seen.has(k)) continue;                                            // intra-batch exact repeat
      const fp = fingerprint({ amount: t.amount, type: t.type, date: isoDay(t.date), bank: t.bank || bankLabel, description: t.description });
      if (existingFps.some(efp => matchScore(fp, efp) >= MERGE)) continue;  // cross-source duplicate already on file
      seen.add(k); fresh.push(t);
    }
    const skipped = valid.length - fresh.length;
    if (fresh.length === 0) return res.json({ message: `Skipped ${skipped} duplicate(s) - nothing new to import.`, count: 0, skipped });

    // Learn-unknown-senders (Addendum A slice 3): for rows the parser couldn't map
    // to a bank but that carry a sender ID, try the learning layer (the user's own
    // tag, then a promoted global consensus). If it resolves, fill the bank in place;
    // otherwise keep the senderKey on the row and log the sender so it can be tagged.
    const learnedCache = new Map();
    for (const t of fresh) {
      const key = normalizeSenderKey(t.senderKey || '');
      if (!key) { t.senderKey = ''; continue; }
      t.senderKey = key;
      if (t.bankCode) continue; // already resolved by the parser
      let learned = learnedCache.get(key);
      if (learned === undefined) { learned = await learnedBankFor(req.user._id, key); learnedCache.set(key, learned); }
      if (learned) { t.bankCode = learned.code; if (!t.bank) t.bank = learned.name; t.senderKey = ''; }
      else { await logUnknownSender(key, t.raw || t.description || '', t._parse?.source || 'sms'); }
    }

    // Auto-categorise transfers to/from contacts the user has already labelled: a
    // contact with a category (or tagged family/friend) stamps that on their rows.
    const cpKeyOf = new Map(); // txn -> contactKey
    for (const t of fresh) { const cp = extractCounterparty(t.description); if (cp) { const k = contactKey(cp); if (k) cpKeyOf.set(t, k); } }
    const contactCatMap = new Map();
    if (cpKeyOf.size) {
      const keys = [...new Set(cpKeyOf.values())];
      const cs = await Contact.find({ userId: req.user._id, key: { $in: keys } }, { key: 1, category: 1, relationship: 1 }).lean();
      for (const c of cs) { const cat = contactCategory(c); if (cat) contactCatMap.set(c.key, cat); }
    }

    // Rows for an account the user merged away land on the account it went into.
    const merges = await mergedAccountMap(req.user._id);
    if (merges.size) {
      for (const t of fresh) {
        const tg = merges.get(`${(t.bankCode || '').toString().toLowerCase().slice(0, 24)}|${(t.accountMask || '').toString().replace(/\D/g, '').slice(0, 4)}`);
        if (tg) { t.bankCode = tg.bankCode; t.accountMask = tg.accountMask; }
      }
    }

    const docs = fresh.map(t => {
      // Sign stays tied to the real direction (income +, expense −); the KIND
      // (cash-out / loan / repayment / reversal / failed) only overrides the type,
      // so it's excluded from spend/income math while keeping its true amount.
      const amount = t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount);
      const kind = classifyKind({ type: t.type, description: t.description, category: t.category });
      // A parser-flagged internal move (e.g. OPay OWealth churn / own-account
      // transfer) becomes an internal_transfer, sign already set above, so it's
      // excluded from spend/income math without losing the row.
      const finalType = t.internal ? 'internal_transfer' : (kind || t.type);
      const contactCat = contactCatMap.get(cpKeyOf.get(t)) || '';
      return new Transaction({
        userId: req.user._id, date: new Date(t.date), description: t.description,
        amount, category: contactCat || t.category || 'Other', type: finalType,
        // Prefer a per-transaction bank (an SMS scan can span several banks),
        // falling back to the batch-level label.
        source: 'import', bank: ((t.bank || bankLabel) || '').toString().trim(), importBatch, importedAt,
        // Account fingerprint (Addendum A slice 2): carried through from the parse.
        bankCode: (t.bankCode || '').toString().toLowerCase().slice(0, 24),
        accountMask: (t.accountMask || '').toString().replace(/\D/g, '').slice(0, 4),
        senderKey: (t.senderKey || '').toString().slice(0, 24), // unresolved sender (slice 3)
      });
    });
    const inserted = await Transaction.insertMany(docs, { ordered: false });
    // Register any accounts these transactions touched, so a new (bank, account)
    // pair can be surfaced for naming. One touch per distinct account in the batch.
    try {
      const acctSeen = new Map();
      for (const t of fresh) {
        const code = (t.bankCode || '').toString().toLowerCase().slice(0, 24);
        const mask = (t.accountMask || '').toString().replace(/\D/g, '').slice(0, 4);
        if (!code || !mask) continue;
        const key = `${code}|${mask}`;
        const prev = acctSeen.get(key);
        const when = +new Date(t.date);
        if (!prev) acctSeen.set(key, { code, mask, name: t.bank || '', when, count: 1 });
        else { prev.count++; if (when > prev.when) prev.when = when; }
      }
      for (const a of acctSeen.values()) {
        await UserAccount.updateOne(
          { userId: req.user._id, bankCode: a.code, accountMask: a.mask },
          {
            $setOnInsert: { userId: req.user._id, bankCode: a.code, accountMask: a.mask, label: '', hidden: false, firstSeen: new Date(a.when) },
            $set: { bankName: a.name || '', lastSeen: new Date(a.when) },
            $inc: { txnCount: a.count },
          },
          { upsert: true },
        );
      }
    } catch (e) { console.error('[import/accounts]', e.message); }
    // Update the People & Family ledger from this batch (counterparties + totals).
    try { await foldContactsIncremental(req.user._id, fresh, req.user.name); } catch (e) { console.error('[import/contacts]', e.message); }
    // Learn description -> category from what the user chose to import (incl. any
    // edits they made on the review screen), so future imports auto-apply them.
    await learnCategories(req.user._id, fresh);
    // Surface any recognised subscriptions on the Subscriptions page immediately.
    for (const t of fresh) {
      if ((t.category || '').toLowerCase() === 'subscriptions') {
        await maybeLinkSubscription(req.user._id, { description: t.description, amount: t.amount, category: t.category, date: t.date, bankName: t.bank });
      }
    }
    // Detect internal transfers created/exposed by this import (both sides may now
    // be present). Never let a reconcile error fail the import.
    let transfersFound = 0;
    try { transfersFound = (await reconcileTransfers(req.user._id)).classified; } catch (e) { console.error('[import/reconcile]', e.message); }
    // Capture training data from this review (accepted + edited rows that carry
    // `_parse` metadata). Fire-and-forget: never blocks or fails the import.
    logParseCorrections(req.user, valid);
    // Raise budget alerts for each distinct expense category+month just imported.
    const pairs = new Set(fresh
      .filter(t => t.type === 'expense' && t.category && !classifyKind({ type: t.type, description: t.description, category: t.category }))
      .map(t => `${t.category}|${new Date(t.date).toISOString().slice(0, 7)}`));
    for (const pair of pairs) {
      const [cat, m] = pair.split('|');
      checkBudgetAlert(req.user._id, cat, m);
    }
    const suffix = skipped ? ` (skipped ${skipped} duplicate${skipped > 1 ? 's' : ''}).` : ' successfully.';
    return res.json({ message: `Imported ${inserted.length} transaction(s)${suffix}`, count: inserted.length, skipped, transfersFound });
  } catch (error) {
    if (error.result) return res.json({ message: `Imported ${error.result.nInserted} transaction(s).`, count: error.result.nInserted });
    console.error('Import error:', error);
    return res.status(500).json({ message: 'Error importing transactions' });
  }
});

// --------------------------
// Bank accounts (spec Addendum A, slice 2: account fingerprinting)
// --------------------------
// The distinct accounts we've fingerprinted from the user's imports/alerts.
// `needsNaming` accounts (label empty, not dismissed, seen ≥1) are surfaced by the
// app for a one-tap "name this account" prompt.
app.get('/api/accounts', auth, async (req, res) => {
  try {
    const accounts = await UserAccount.find({ userId: req.user._id, deleted: { $ne: true } }).sort({ lastSeen: -1 }).lean();
    const out = accounts.map((a) => ({
      id: a._id,
      bankCode: a.bankCode,
      bankName: a.bankName || '',
      accountMask: a.accountMask,
      label: a.label || '',
      type: a.type || '',
      addedByUser: !!a.addedByUser,
      txnCount: a.txnCount || 0,
      firstSeen: a.firstSeen || null,
      lastSeen: a.lastSeen || null,
      active: a.active !== false,
      needsNaming: !a.label && !a.hidden && a.active !== false && (a.txnCount || 0) > 0,
    }));
    res.json({ accounts: out, unnamed: out.filter((a) => a.needsNaming).length });
  } catch (e) { console.error('[accounts/list]', e.message); res.status(500).json({ message: 'Server error' }); }
});

const ACCOUNT_TYPES = ['current', 'savings', 'wallet', 'card', 'other'];

// Rename an account and/or change its type; only the fields sent change. Clearing
// the label reverts it to needing a name.
app.patch('/api/accounts/:id', auth, async (req, res) => {
  try {
    const acct = await UserAccount.findOne({ _id: req.params.id, userId: req.user._id, deleted: { $ne: true } });
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    if (req.body?.label !== undefined) {
      acct.label = (req.body.label ?? '').toString().trim().slice(0, 40);
      if (acct.label) acct.hidden = false; // naming it un-dismisses it
    }
    if (req.body?.type !== undefined) {
      const type = String(req.body.type || '');
      if (type && !ACCOUNT_TYPES.includes(type)) return res.status(400).json({ message: 'Unknown account type.' });
      acct.type = type;
    }
    await acct.save();
    res.json({ ok: true, id: acct._id, label: acct.label, type: acct.type });
  } catch (e) { console.error('[accounts/patch]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Add an account by hand: a bank from the list (or any name), an optional type and
// last four digits. Alerts for the same bank and digits land on it. Adding one the
// user deleted before brings it back.
app.post('/api/accounts', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const known = BANK_REGISTRY.find((x) => x.code === String(b.bankCode || ''));
    const customName = (b.bankName || '').toString().trim().slice(0, 40);
    if (!known && !customName) return res.status(400).json({ message: 'Pick a bank, or type its name.' });
    const bankCode = known ? known.code : `custom-${customName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 16) || 'bank'}`;
    const bankName = known ? known.name : customName;
    const accountMask = (b.accountMask || '').toString().replace(/\D/g, '').slice(-4);
    const type = ACCOUNT_TYPES.includes(b.type) ? b.type : '';
    const label = (b.label || '').toString().trim().slice(0, 40);
    let acct = await UserAccount.findOne({ userId: req.user._id, bankCode, accountMask });
    if (acct && !acct.deleted) return res.status(409).json({ message: 'You already have this account.', id: acct._id });
    const txnCount = accountMask ? await Transaction.countDocuments({ userId: req.user._id, bankCode, accountMask }) : 0;
    if (acct) Object.assign(acct, { deleted: false, mergedInto: null, active: true, hidden: false });
    else acct = new UserAccount({ userId: req.user._id, bankCode, accountMask, firstSeen: new Date(), lastSeen: new Date() });
    Object.assign(acct, { bankName, label, type, txnCount, addedByUser: true });
    await acct.save();
    res.status(201).json({ ok: true, id: acct._id });
  } catch (e) { console.error('[accounts/create]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Merge one account into another (the same account detected twice, say with and
// without its last digits). Its transactions move over, and its future alerts and
// imports follow.
app.post('/api/accounts/:id/merge', auth, async (req, res) => {
  try {
    const into = String(req.body?.into || '');
    if (!into || into === req.params.id) return res.status(400).json({ message: 'Pick a different account to merge into.' });
    const [src, dst] = await Promise.all([
      UserAccount.findOne({ _id: req.params.id, userId: req.user._id, deleted: { $ne: true } }),
      UserAccount.findOne({ _id: into, userId: req.user._id, deleted: { $ne: true } }),
    ]);
    if (!src || !dst) return res.status(404).json({ message: 'Account not found' });
    const moved = await Transaction.updateMany(
      { userId: req.user._id, bankCode: src.bankCode, accountMask: src.accountMask },
      { $set: { bankCode: dst.bankCode, accountMask: dst.accountMask, ...(dst.bankName ? { bank: dst.bankName } : {}) } },
    );
    dst.txnCount = (dst.txnCount || 0) + (moved.modifiedCount || 0);
    if (!dst.label && src.label) dst.label = src.label;
    if (!dst.type && src.type) dst.type = src.type;
    Object.assign(src, { deleted: true, mergedInto: dst._id, txnCount: 0 });
    // Anything merged into src earlier now points at dst too.
    await UserAccount.updateMany({ userId: req.user._id, mergedInto: src._id }, { $set: { mergedInto: dst._id } });
    await Promise.all([dst.save(), src.save()]);
    res.json({ ok: true, moved: moved.modifiedCount || 0 });
  } catch (e) { console.error('[accounts/merge]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Dismiss the naming prompt for an account without naming it (stops it nagging).
app.post('/api/accounts/:id/dismiss', auth, async (req, res) => {
  try {
    const acct = await UserAccount.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id }, { $set: { hidden: true } }, { new: true });
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    res.json({ ok: true });
  } catch (e) { console.error('[accounts/dismiss]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Deactivate / reactivate an account. A deactivated account keeps its data but is
// hidden from the account switcher and from "All accounts" views (the frontend reads
// `active` and filters). Fully reversible - nothing is deleted.
app.post('/api/accounts/:id/active', auth, async (req, res) => {
  try {
    const active = req.body?.active !== false; // default true unless explicitly false
    const acct = await UserAccount.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id }, { $set: { active } }, { new: true });
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    res.json({ ok: true, id: acct._id, active });
  } catch (e) { console.error('[accounts/active]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Delete an account. With ?withTransactions=1 it also permanently deletes every
// transaction stamped to that account (bankCode + accountMask), for clearing a bad
// import. Without it the transactions stay, unassigned, in the All view. The record
// is kept as deleted so the next alert or re-import doesn't bring the account back;
// it returns only if the user restores (undo) or adds it again.
app.delete('/api/accounts/:id', auth, async (req, res) => {
  try {
    const acct = await UserAccount.findOne({ _id: req.params.id, userId: req.user._id });
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    const withTxns = req.query.withTransactions === '1' || req.query.withTransactions === 'true';
    // Without its last digits an account can't tell its rows from any other unassigned
    // row at the same bank, so it never takes transactions down with it.
    if (withTxns && !acct.accountMask) return res.status(400).json({ message: 'This account has no transactions of its own to delete.' });
    let transactionsDeleted = 0;
    if (withTxns) {
      const del = await Transaction.deleteMany({ userId: req.user._id, bankCode: acct.bankCode, accountMask: acct.accountMask });
      transactionsDeleted = del.deletedCount || 0;
    }
    acct.deleted = true;
    if (withTxns) acct.txnCount = 0;
    await acct.save();
    res.json({ ok: true, transactionsDeleted });
  } catch (e) { console.error('[accounts/delete]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Undo a delete (only the account; deleted transactions are gone for good).
app.post('/api/accounts/:id/restore', auth, async (req, res) => {
  try {
    const acct = await UserAccount.findOneAndUpdate({ _id: req.params.id, userId: req.user._id, mergedInto: null }, { $set: { deleted: false } }, { new: true });
    if (!acct) return res.status(404).json({ message: 'Account not found' });
    res.json({ ok: true });
  } catch (e) { console.error('[accounts/restore]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// People & Family ledger
// --------------------------
// List contacts (people/businesses the user transacts with), richest first.
app.get('/api/contacts', auth, async (req, res) => {
  try {
    const rows = await Contact.find({ userId: req.user._id }).lean();
    const out = rows
      .map((c) => ({
        id: c._id,
        name: c.label || c.name,
        realName: c.name,
        bank: c.bank || '',
        account: c.account || '',
        sentTotal: Math.round(c.sentTotal || 0),
        sentCount: c.sentCount || 0,
        receivedTotal: Math.round(c.receivedTotal || 0),
        receivedCount: c.receivedCount || 0,
        net: Math.round((c.receivedTotal || 0) - (c.sentTotal || 0)),
        volume: Math.round((c.sentTotal || 0) + (c.receivedTotal || 0)),
        relationship: c.relationship || 'unknown',
        familySuggested: !!c.familySuggested,
        category: c.category || '',
        firstSeen: c.firstSeen || null,
        lastSeen: c.lastSeen || null,
      }))
      .sort((a, b) => b.volume - a.volume);
    res.json({
      contacts: out,
      familySuggestions: out.filter((c) => c.familySuggested && c.relationship === 'unknown').length,
      familyPromptDone: !!req.user.familyPromptDone,
    });
  } catch (e) { console.error('[contacts/list]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Label a contact: set relationship (family/friend/business/self), a nickname, and/or
// a category to auto-apply to their transfers. `applyToPast` recategorises existing
// transfers to/from this contact right away.
app.patch('/api/contacts/:id', auth, async (req, res) => {
  try {
    const c = await Contact.findOne({ _id: req.params.id, userId: req.user._id });
    if (!c) return res.status(404).json({ message: 'Contact not found' });
    const rels = ['family', 'friend', 'business', 'self', 'unknown'];
    if (req.body.relationship != null && rels.includes(req.body.relationship)) c.relationship = req.body.relationship;
    if (req.body.label != null) c.label = req.body.label.toString().trim().slice(0, 60);
    if (req.body.category != null) c.category = req.body.category.toString().trim().slice(0, 40);
    await c.save();
    let recategorized = 0;
    if (req.body.applyToPast) {
      try { recategorized = await applyContactToPast(req.user._id, c); } catch (e) { console.error('[contacts/apply]', e.message); }
    }
    res.json({ ok: true, id: c._id, relationship: c.relationship, category: contactCategory(c), recategorized });
  } catch (e) { console.error('[contacts/patch]', e.message); res.status(500).json({ message: 'Server error' }); }
});

const personOut = (c) => ({
  id: c._id, name: c.label || c.name, realName: c.name, relationship: c.relationship || 'unknown',
  category: c.category || '', sentTotal: Math.round(c.sentTotal || 0), receivedTotal: Math.round(c.receivedTotal || 0),
  sentCount: c.sentCount || 0, receivedCount: c.receivedCount || 0,
});

// The person on a transaction (the "Person" chip on transaction detail), or null.
app.get('/api/transactions/:id/person', auth, async (req, res) => {
  try {
    const t = await Transaction.findOne({ _id: req.params.id, userId: req.user._id }, { description: 1 }).lean();
    if (!t) return res.status(404).json({ message: 'Transaction not found' });
    const cp = extractCounterparty(t.description);
    const key = cp && contactKey(cp);
    const c = key ? await Contact.findOne({ userId: req.user._id, key }).lean() : null;
    res.json({ person: c ? personOut(c) : null });
  } catch (e) { console.error('[transactions/person]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Which person each transaction is with: { links: { [transactionId]: contactId } }.
// Drives the Person chip in the transaction list and the People filter on Money.
app.get('/api/contacts/links', auth, async (req, res) => {
  try {
    const [contacts, txns] = await Promise.all([
      Contact.find({ userId: req.user._id }, { key: 1 }).lean(),
      Transaction.find({ userId: req.user._id }, { description: 1 }).lean(),
    ]);
    const byKey = new Map(contacts.map((c) => [c.key, String(c._id)]));
    const links = {};
    for (const t of txns) {
      const cp = extractCounterparty(t.description);
      const id = cp && byKey.get(contactKey(cp));
      if (id) links[String(t._id)] = id;
    }
    res.json({ links });
  } catch (e) { console.error('[contacts/links]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// The family-by-surname suggestion is asked once; after that it never nags again.
app.post('/api/contacts/family-prompt/done', auth, async (req, res) => {
  try {
    req.user.familyPromptDone = true;
    await req.user.save();
    res.json({ ok: true });
  } catch (e) { console.error('[contacts/family-prompt]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Rebuild the whole ledger from all transactions (one-time backfill / after edits).
app.post('/api/contacts/rebuild', auth, async (req, res) => {
  try {
    const count = await rebuildContacts(req.user._id, req.user.name);
    res.json({ ok: true, contacts: count });
  } catch (e) { console.error('[contacts/rebuild]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Unknown senders (spec Addendum A, slice 3: learn-unknown-senders flywheel)
// --------------------------
// Registry banks the user can pick from when tagging a sender (code + display name).
// Every bank with the ways to get its transactions in, best first, for this platform.
const platformOf = (req) => (['android', 'ios', 'web'].includes(req.query.platform) ? req.query.platform : 'web');
app.get('/api/banks/methods', auth, (req, res) => {
  res.json({ banks: bankMethods({ platform: platformOf(req), monoEnabled: monoConfigured() }) });
});

// The banks the user said they use, each with its best method and whether anything
// from it has arrived yet (the Home checklist).
app.get('/api/me/banks', auth, async (req, res) => {
  try {
    const all = bankMethods({ platform: platformOf(req), monoEnabled: monoConfigured() });
    const used = req.user.banksUsed || [];
    const [codes, accts] = await Promise.all([
      Transaction.distinct('bankCode', { userId: req.user._id, bankCode: { $in: used } }),
      UserAccount.distinct('bankCode', { userId: req.user._id, bankCode: { $in: used }, deleted: { $ne: true } }),
    ]);
    const connected = new Set([...codes, ...accts]);
    const banks = used.map((c) => all.find((b) => b.code === c)).filter(Boolean).map((b) => ({ ...b, connected: connected.has(b.code) }));
    res.json({ banks, other: req.user.otherBanks || [] });
  } catch (e) { console.error('[me/banks]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/me/banks', auth, async (req, res) => {
  try {
    const known = new Set(bankMethods().map((b) => b.code));
    const codes = [...new Set((Array.isArray(req.body?.codes) ? req.body.codes : []).map(String))].filter((c) => known.has(c)).slice(0, 20);
    const other = (Array.isArray(req.body?.other) ? req.body.other : []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 10);
    await User.updateOne({ _id: req.user._id }, { $set: { banksUsed: codes, otherBanks: other } });
    res.json({ ok: true, codes, other });
  } catch (e) { console.error('[me/banks]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.get('/api/banks', auth, (req, res) => {
  res.json({ banks: BANK_REGISTRY.map((b) => ({ code: b.code, name: b.name })) });
});

// Senders on the user's own transactions we couldn't map to a bank: they can tag
// each one so those (and future) alerts resolve. Grouped, with a sample + count.
// A sender the user says isn't one of their banks stops being asked about. Kept with
// the other per-user dismissals, keyed 'sender:<KEY>'.
const dismissedSenderKeys = async (userId) =>
  (await DismissedDetection.find({ userId, key: /^sender:/ }, { key: 1 }).lean()).map((d) => d.key.slice(7));

app.get('/api/senders/unknown', auth, async (req, res) => {
  try {
    const dismissed = await dismissedSenderKeys(req.user._id);
    const rows = await Transaction.aggregate([
      // Must be a NON-EMPTY STRING: `$ne: ''` alone also matches null/missing
      // senderKey (older rows predating the field), which collapse into a phantom
      // untaggable "unknown sender". Require an actual sender id.
      { $match: { userId: new mongoose.Types.ObjectId(req.user._id), senderKey: { $type: 'string', $ne: '', $nin: dismissed } } },
      { $group: { _id: '$senderKey', count: { $sum: 1 }, sample: { $first: '$description' }, lastSeen: { $max: '$date' } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);
    const promoted = rows.length
      ? await UnknownSender.find({ senderKey: { $in: rows.map((r) => r._id) }, status: 'promoted' }).lean()
      : [];
    const pMap = new Map(promoted.map((p) => [p.senderKey, p]));
    res.json({
      senders: rows.map((r) => ({
        senderKey: r._id,
        count: r.count,
        sample: (r.sample || '').slice(0, 80),
        lastSeen: r.lastSeen || null,
        // A community-promoted guess, offered as a one-tap suggestion.
        suggestion: pMap.has(r._id) ? { bankCode: pMap.get(r._id).promotedBankCode, bankName: pMap.get(r._id).promotedBankName } : null,
      })),
    });
  } catch (e) { console.error('[senders/unknown]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Tag a sender → bank. Records the user's answer (also a vote), retro-stamps their
// matching transactions, registers the accounts, and promotes on consensus.
// 'Not a bank' on an unknown sender, and its undo.
const senderDismissKey = (req) => {
  const k = normalizeSenderKey((req.body?.senderKey || '').toString());
  return k ? `sender:${k}` : '';
};
app.post('/api/senders/dismiss', auth, async (req, res) => {
  try {
    const key = senderDismissKey(req);
    if (!key) return res.status(400).json({ message: 'Which sender?' });
    await DismissedDetection.updateOne({ userId: req.user._id, key }, { $setOnInsert: { userId: req.user._id, key } }, { upsert: true });
    res.json({ ok: true });
  } catch (e) { console.error('[senders/dismiss]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/senders/undismiss', auth, async (req, res) => {
  try {
    const key = senderDismissKey(req);
    if (!key) return res.status(400).json({ message: 'Which sender?' });
    await DismissedDetection.deleteOne({ userId: req.user._id, key });
    res.json({ ok: true });
  } catch (e) { console.error('[senders/undismiss]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/senders/tag', auth, async (req, res) => {
  try {
    const senderKey = normalizeSenderKey(req.body?.senderKey || '');
    const bankCode = (req.body?.bankCode || '').toString().toLowerCase().trim();
    if (!senderKey) return res.status(400).json({ message: 'Missing sender.' });
    const bank = BANK_REGISTRY.find((b) => b.code === bankCode);
    if (!bank) return res.status(400).json({ message: 'Pick a bank from the list.' });

    await SenderTag.updateOne(
      { userId: req.user._id, senderKey },
      { $set: { bankCode: bank.code, bankName: bank.name } },
      { upsert: true },
    );
    // Retro-stamp the user's own transactions carrying this sender.
    const affected = await Transaction.find({ userId: req.user._id, senderKey }).select('accountMask date').lean();
    await Transaction.updateMany(
      { userId: req.user._id, senderKey },
      { $set: { bankCode: bank.code, bank: bank.name, senderKey: '' } },
    );
    // Register any accounts those now-attributed transactions belong to.
    const byMask = new Map();
    for (const t of affected) {
      const mask = (t.accountMask || '').toString().replace(/\D/g, '').slice(0, 4);
      if (!mask) continue;
      const e = byMask.get(mask) || { count: 0, when: 0 };
      e.count++; e.when = Math.max(e.when, +new Date(t.date));
      byMask.set(mask, e);
    }
    for (const [mask, e] of byMask) {
      await UserAccount.updateOne(
        { userId: req.user._id, bankCode: bank.code, accountMask: mask },
        {
          $setOnInsert: { userId: req.user._id, bankCode: bank.code, accountMask: mask, label: '', hidden: false, firstSeen: new Date(e.when || Date.now()) },
          $set: { bankName: bank.name, lastSeen: new Date(e.when || Date.now()) },
          $inc: { txnCount: e.count },
        },
        { upsert: true },
      );
    }
    await maybePromoteSender(senderKey);
    res.json({ ok: true, updated: affected.length });
  } catch (e) { console.error('[senders/tag]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Admin: review all unknown senders across users, with vote tallies, to promote or
// dismiss. Promotion also happens automatically once enough users agree.
app.get('/api/admin/senders', auth, superAdminAuth, async (req, res) => {
  try {
    const senders = await UnknownSender.find({}).sort({ count: -1 }).limit(200).lean();
    const tallies = await SenderTag.aggregate([
      { $group: { _id: { senderKey: '$senderKey', bankCode: '$bankCode' }, users: { $addToSet: '$userId' }, bankName: { $first: '$bankName' } } },
    ]);
    const byKey = new Map();
    for (const t of tallies) {
      const arr = byKey.get(t._id.senderKey) || [];
      arr.push({ bankCode: t._id.bankCode, bankName: t.bankName, votes: t.users.length });
      byKey.set(t._id.senderKey, arr);
    }
    res.json({
      senders: senders.map((s) => ({
        senderKey: s.senderKey, sample: s.sample, source: s.source, count: s.count,
        status: s.status, promotedBankCode: s.promotedBankCode, promotedBankName: s.promotedBankName,
        lastSeen: s.lastSeen, votes: (byKey.get(s.senderKey) || []).sort((a, b) => b.votes - a.votes),
      })),
      threshold: SENDER_PROMOTE_THRESHOLD,
    });
  } catch (e) { console.error('[admin/senders]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/admin/senders/:key/promote', auth, superAdminAuth, async (req, res) => {
  try {
    const senderKey = normalizeSenderKey(req.params.key || '');
    const bank = BANK_REGISTRY.find((b) => b.code === (req.body?.bankCode || '').toString().toLowerCase());
    if (!bank) return res.status(400).json({ message: 'Unknown bank code.' });
    await UnknownSender.updateOne(
      { senderKey },
      { $set: { status: 'promoted', promotedBankCode: bank.code, promotedBankName: bank.name } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) { console.error('[admin/senders/promote]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/admin/senders/:key/dismiss', auth, superAdminAuth, async (req, res) => {
  try {
    await UnknownSender.updateOne({ senderKey: normalizeSenderKey(req.params.key || '') }, { $set: { status: 'dismissed' } });
    res.json({ ok: true });
  } catch (e) { console.error('[admin/senders/dismiss]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Subscriptions. Each row is enriched with its cancellation guide (C1), and any
// subscription mid-cancellation is verified against the ledger: did a matching
// charge land AFTER the cancel request (didn't take) or has it gone quiet past a
// billing cycle (confirmed stopped)? Confirmed ones are promoted to 'cancelled'.
app.get('/api/subscriptions', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    try { await mergeDuplicateSubscriptions(uid); } catch (e) { console.error('[subs/merge]', e.message); }
    const subs = await Subscription.find({ userId: uid }).sort({ createdAt: -1 }).lean();
    const cancelling = subs.filter((s) => s.status === 'cancelling' && s.cancelRequestedAt);
    let txns = [];
    if (cancelling.length) {
      txns = await Transaction.find({ userId: uid, type: 'expense' }, { description: 1, date: 1 }).lean();
    }
    const pro = hasFeature(req.user, 'cancel');
    const promote = [];
    const out = subs.map((s) => {
      // Free users get a locked guide stub (name/method only): the steps + tracking
      // are the Pro deliverable (C1). Pro users get the full playbook.
      const full = cancelGuideFor(s.name);
      const guide = pro ? full : { name: full.name, method: full.method, matched: full.matched, steps: [], url: '', locked: true };
      let cancelCheck = null;
      if (s.status === 'cancelling' && s.cancelRequestedAt) {
        const key = subscriptionKey(s.name);
        const chargedAfter = !!key && txns.some((t) => subscriptionKey(t.description) === key && new Date(t.date) > new Date(s.cancelRequestedAt));
        cancelCheck = verifyCancellation({ requestedAt: s.cancelRequestedAt, frequency: s.frequency, chargedAfter });
        if (cancelCheck.state === 'confirmed') promote.push(s._id);
      }
      // Ready-computed next renewal date so clients don't re-implement the date math.
      const nextRenewal = s.status === 'active' ? computeNextRenewal(s) : null;
      return { ...s, guide, cancelCheck, nextRenewal };
    });
    // Persist confirmed cancellations so we stop re-checking them.
    if (promote.length) {
      try { await Subscription.updateMany({ _id: { $in: promote }, userId: uid }, { $set: { status: 'cancelled' } }); } catch (e) { console.error('[subs/promote]', e.message); }
      for (const s of out) if (promote.some((id) => String(id) === String(s._id))) s.status = 'cancelled';
    }
    res.json(out); // array shape preserved; clients gate on plan / billing status
  } catch (e) { console.error('[subscriptions]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Auto-detect likely subscriptions from the user's transactions: recurring
// charges to the same merchant, similar amount, across multiple months.
// Recurring charges that look like subscriptions the user isn't tracking yet.
async function detectSubscriptions(userId) {
  const [txns, existing] = await Promise.all([
    Transaction.find({ userId, type: 'expense' }, { description: 1, amount: 1, date: 1, category: 1 }).lean(),
    Subscription.find({ userId }, { name: 1 }).lean(),
  ]);
  const dismissed = await DismissedDetection.find({ userId }, { key: 1 }).lean();
  const existingKeys = new Set([
    ...existing.map(s => subscriptionKey(s.name)),
    ...dismissed.map(d => d.key),
  ].filter(Boolean));

  // Group transactions by merchant signature.
  const groups = new Map();
  for (const t of txns) {
    const key = subscriptionKey(t.description);
    if (!key) continue;
    const g = groups.get(key) || { key, brand: brandFor(t.description), amounts: [], months: new Set(), descs: {}, category: t.category, lastDate: t.date };
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
    const name = g.brand ? g.brand.name : Object.entries(g.descs).sort((a, b) => b[1] - a[1])[0][0].slice(0, 40).trim();
    candidates.push({
      key: g.key,
      name,
      cost: Math.round(med),
      frequency: 'monthly',
      category: g.category || 'Subscriptions',
      occurrences: g.months.size,
      lastSeen: g.lastDate,
    });
  }
  candidates.sort((a, b) => b.occurrences - a.occurrences || b.cost - a.cost);
  return candidates.slice(0, 12);
}

app.get('/api/subscriptions/detect', auth, async (req, res) => {
  try { res.json(await detectSubscriptions(req.user._id)); }
  catch (e) { console.error('[subscriptions/detect]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.post('/api/subscriptions', auth, async (req, res) => {
  try {
    const { name, cost, frequency, category, remindDaysBefore } = req.body;
    if (!name || !cost) return res.status(400).json({ message: 'Name and cost required' });
    const now = new Date();
    const freq = frequency || 'monthly';
    // Renewal day: explicit, else inferred from a supplied last-charge date (tracking a
    // detected charge), so reminders have a real date to work from.
    const lastCharge = req.body.lastCharge ? new Date(req.body.lastCharge) : null;
    let renewalDay = Number(req.body.renewalDay) || null;
    if (!renewalDay && lastCharge && !isNaN(lastCharge)) renewalDay = lastCharge.getDate();
    if (renewalDay && (renewalDay < 1 || renewalDay > 31)) renewalDay = null;
    let nextPayment;
    if (renewalDay) {
      nextPayment = computeNextRenewal({ renewalDay, frequency: freq, lastCharge }, now);
    } else {
      nextPayment = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
    const sub = new Subscription({
      userId: req.user._id, name, cost: parseFloat(cost),
      frequency: freq, category: category || 'Entertainment',
      status: 'active', nextPayment,
      renewalDay: renewalDay || undefined,
      remindDaysBefore: remindDaysBefore != null ? Math.max(0, Math.min(30, Number(remindDaysBefore))) : 3,
      lastCharge: lastCharge && !isNaN(lastCharge) ? lastCharge : undefined,
    });
    await sub.save();
    res.status(201).json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.put('/api/subscriptions/:id', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Not found' });
    const { name, cost, frequency, category, status, renewalDay, remindDaysBefore } = req.body;
    if (name !== undefined) { sub.name = name; sub.needsName = false; }
    if (cost !== undefined) sub.cost = parseFloat(cost);
    if (frequency !== undefined) sub.frequency = frequency;
    if (category !== undefined) sub.category = category;
    if (status !== undefined) sub.status = status;
    if (remindDaysBefore !== undefined) sub.remindDaysBefore = Math.max(0, Math.min(30, Number(remindDaysBefore) || 0));
    if (renewalDay !== undefined) {
      const rd = Number(renewalDay);
      sub.renewalDay = rd >= 1 && rd <= 31 ? rd : undefined;
      if (sub.renewalDay) sub.nextPayment = computeNextRenewal(sub);
    }
    await sub.save();
    res.json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/subscriptions/:id', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    // One we found ourselves stays gone: the next charge must not bring it back.
    const key = sub && sub.autoDetected ? (sub.sourceKey || subscriptionKey(sub.name)) : '';
    if (key) await DismissedDetection.updateOne({ userId: req.user._id, key }, { $setOnInsert: { userId: req.user._id, key } }, { upsert: true }).catch(() => {});
    res.json({ message: 'Deleted', dismissedKey: key || null });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Dismiss a detected recurring charge as "not a subscription" so /detect stops
// resurfacing it. Keyed by the merchant signature the detector groups on.
app.post('/api/subscriptions/dismiss-detected', auth, async (req, res) => {
  try {
    // The detector's own key when the client has it; a display name can be shortened.
    const key = (typeof req.body?.key === 'string' && req.body.key.trim().slice(0, 120)) || subscriptionKey((req.body?.name || '').toString());
    if (!key) return res.status(400).json({ message: 'Nothing to dismiss.' });
    await DismissedDetection.updateOne(
      { userId: req.user._id, key },
      { $setOnInsert: { userId: req.user._id, key } },
      { upsert: true },
    );
    res.json({ ok: true, key });
  } catch (e) {
    if (e && e.code === 11000) return res.json({ ok: true }); // already dismissed
    console.error('[dismiss-detected]', e.message); res.status(500).json({ message: 'Server error' });
  }
});

// Undo a dismissal (the 5-second undo after 'Not one').
app.post('/api/subscriptions/undismiss-detected', auth, async (req, res) => {
  try {
    const key = (typeof req.body?.key === 'string' && req.body.key.trim().slice(0, 120)) || subscriptionKey((req.body?.name || '').toString());
    if (!key) return res.status(400).json({ message: 'Nothing to restore.' });
    await DismissedDetection.deleteOne({ userId: req.user._id, key });
    res.json({ ok: true });
  } catch (e) { console.error('[undismiss-detected]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// C1: start the assisted cancellation: mark it 'cancelling', stamp the baseline we
// verify against, and hand back the step-by-step guide for this provider.
app.post('/api/subscriptions/:id/start-cancel', auth, async (req, res) => {
  try {
    if (!hasFeature(req.user, 'cancel')) return res.status(402).json(upgradeRequired('cancel'));
    const sub = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Not found' });
    sub.status = 'cancelling';
    sub.cancelRequestedAt = new Date();
    await sub.save();
    res.json({ subscription: sub, guide: cancelGuideFor(sub.name) });
  } catch (e) { console.error('[start-cancel]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// The user confirms it's fully cancelled (or we stop tracking it as active).
app.post('/api/subscriptions/:id/mark-cancelled', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Not found' });
    sub.status = 'cancelled';
    await sub.save();
    res.json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Undo: the user decided to keep the subscription after all.
app.post('/api/subscriptions/:id/keep', auth, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sub) return res.status(404).json({ message: 'Not found' });
    sub.status = 'active';
    sub.cancelRequestedAt = null;
    await sub.save();
    res.json(sub);
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Superadmin routes
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
// Grant / revoke scoped newsletter access (composer only, not the rest of admin).
app.patch('/api/admin/users/:id/newsletter-editor', auth, superAdminAuth, async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const user = await User.findByIdAndUpdate(req.params.id, { newsletterEditor: enabled }, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: enabled ? 'Newsletter access granted' : 'Newsletter access revoked', user: { id: user._id, email: user.email, newsletterEditor: user.newsletterEditor } });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});
// Grant / revoke a plan for a user (how testers and comped users get one). `plan` =
// 'free'|'pro' (Plus)|'student'|'power'; optional `months` sets an expiry. A Student
// plan still needs a current verification to count. Billing flips the same fields.
app.patch('/api/admin/users/:id/plan', auth, superAdminAuth, async (req, res) => {
  try {
    const { plan, months } = req.body;
    if (!['free', 'pro', 'student', 'power'].includes(plan)) return res.status(400).json({ message: 'Invalid plan' });
    const update = { plan };
    if (plan !== 'free') update.planExpiry = months ? new Date(Date.now() + Number(months) * 30 * 24 * 60 * 60 * 1000) : null;
    else update.planExpiry = null;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ message: `Plan set to ${plan}`, user: { id: user._id, email: user.email, plan: user.plan, planExpiry: user.planExpiry } });
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
    await deleteUserData(user._id, user.email);
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
    const waitlistCount = await Waitlist.countDocuments();
    res.json({ totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers, totalTransactions, totalBudgets, waitlistCount, platformIncome: incomeAgg[0]?.total || 0, platformExpenses: Math.abs(expenseAgg[0]?.total || 0), recentUsers });
  } catch (error) { res.status(500).json({ message: 'Server error' }); }
});

// Email diagnostics (superadmin): sends a test mail through Brevo and returns the
// provider's real error so misconfiguration is obvious.
//   GET /api/admin/test-email            -> sends to your own account email
//   GET /api/admin/test-email?to=x@y.com -> sends to a specific address
app.get('/api/admin/test-email', auth, superAdminAuth, async (req, res) => {
  const diag = { BREVO_API_KEY_set: emailConfigured(), sender: senderEmail(), senderName: senderName() };
  if (!emailConfigured()) return res.status(400).json({ ok: false, message: 'Email is not configured. Set BREVO_API_KEY.', diag });
  try {
    const to = (req.query.to || req.user.email);
    await sendEmail({ to, subject: 'Automonie email test', text: 'If you can read this, email sending works.' });
    res.json({ ok: true, message: `Test email sent to ${to}. Check inbox and spam.`, diag });
  } catch (err) {
    // Brevo errors carry the real reason in the HTTP response body.
    const apiMsg = err.response?.data?.message || err.response?.data?.code;
    res.status(502).json({ ok: false, message: apiMsg || 'Send failed', status: err.response?.status || null, diag });
  }
});
// Idempotent: with the correct setup key, creates a superadmin - or, if the email
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
    if (!process.env.ADMIN_SETUP_KEY || !safeEqual(setupKey, process.env.ADMIN_SETUP_KEY)) {
      return res.status(403).json({ message: 'Invalid setup key' });
    }
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });
    if (passwordProblem(password)) return res.status(400).json({ message: passwordProblem(password) });
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

const paystackHeaders = () => ({ Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' });
const koboToNaira = (kobo) => Math.round(kobo) / 100;

// Paystack webhook. Only Pro subscription charges are acted on.
app.post('/api/paystack/webhook', async (req, res) => {
  try {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) return res.sendStatus(200);
    const hash = crypto.createHmac('sha512', secret).update(req.rawBody || Buffer.from('')).digest('hex');
    if (!safeEqual(hash, req.headers['x-paystack-signature'])) return res.sendStatus(401);
    const event = req.body;
    const d = event?.data || {};
    if (event?.event === 'charge.success' && d.metadata?.purpose === 'pro_subscription') {
      let user = d.metadata?.userId ? await User.findById(d.metadata.userId).catch(() => null) : null;
      if (!user && d.customer?.email) user = await User.findOne({ email: d.customer.email });
      if (user) await grantProFromCharge(user, d, 'checkout');
    }
    res.sendStatus(200);
  } catch (e) {
    console.error('[paystack/webhook]', e.message);
    res.sendStatus(200);
  }
});

// ── Automonie Pro subscription (Paystack) ───────────────────────────────────────
// ── Student plan: verification ──────────────────────────────────────────────────
// Three ways in: a code sent to an allow-listed school email; a student ID photo
// (or, for corps members, a state code and call-up letter) checked by an admin; or a
// campaign code handed out at a talk. Verification lasts a year, with a reminder two
// weeks before; a lapsed verification drops a Student plan to Free.
const studentDomainSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true, lowercase: true, trim: true },
  institution: { type: String, default: '' },
}, { timestamps: true });
const StudentDomain = mongoose.model('StudentDomain', studentDomainSchema);

// Uploads waiting for an admin. The image is deleted as soon as it's decided.
const studentReviewSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind:        { type: String, enum: ['student_id', 'nysc'], required: true },
  institution: { type: String, default: '' },
  matric:      { type: String, default: '' },
  stateCode:   { type: String, default: '' },
  image:       { type: Buffer, select: false },
  contentType: { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reason:      { type: String, default: '' },
  decidedBy:   { type: String, default: '' },
  decidedAt:   { type: Date },
}, { timestamps: true });
const StudentReview = mongoose.model('StudentReview', studentReviewSchema);

// Codes handed out at campus or CDS talks, each with a usage limit.
const campaignCodeSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  label:     { type: String, default: '' },
  maxUses:   { type: Number, default: 100 },
  uses:      { type: Number, default: 0 },
  expiresAt: { type: Date, default: null },
  active:    { type: Boolean, default: true },
}, { timestamps: true });
const CampaignCode = mongoose.model('CampaignCode', campaignCodeSchema);

// The allow-list lives in the database (editable in admin); seeded from the file once.
let studentDomainsSeeded = false;
async function studentDomains() {
  if (!studentDomainsSeeded) {
    studentDomainsSeeded = true;
    if (!(await StudentDomain.estimatedDocumentCount())) {
      const seed = require('./data/student-domains.json').domains;
      await StudentDomain.insertMany(seed.map((domain) => ({ domain })), { ordered: false }).catch(() => {});
    }
  }
  return (await StudentDomain.find({}, { domain: 1 }).lean()).map((d) => d.domain);
}

const STUDENT_VALID_DAYS = 365;
const hashCode = (c) => crypto.createHash('sha256').update(String(c)).digest('hex');
function markStudentVerified(user, method, extra = {}) {
  const now = new Date();
  user.student = {
    ...(user.student?.toObject ? user.student.toObject() : user.student || {}),
    ...extra,
    status: 'verified', method, verifiedAt: now,
    expiresAt: new Date(now.getTime() + STUDENT_VALID_DAYS * 86400000),
    reminderSentAt: null, rejectReason: '', otpHash: '', otpExpires: null, otpAttempts: 0, pendingEmail: '',
  };
}
const studentOut = (u) => {
  const s = u.student || {};
  return {
    status: s.status || 'none', method: s.method || '', institution: s.institution || '',
    schoolEmail: s.schoolEmail || '', expiresAt: s.expiresAt || null, rejectReason: s.rejectReason || '',
    freeUsed: !!s.freeUsed, pendingEmail: s.pendingEmail || '',
  };
};

app.get('/api/student/status', auth, (req, res) => res.json(studentOut(req.user)));

// 1. School email: send a 6-digit code to an allow-listed address.
app.post('/api/student/email', authLimiter, auth, async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const domain = studentLib.schoolDomainFor(email, await studentDomains());
    if (!domain) return res.status(400).json({ message: 'That isn’t a school email we recognise. Use your institution email, or verify with your student ID instead.' });
    if (!emailConfigured()) return res.status(503).json({ message: 'Email isn’t available right now. Try the student ID option.' });
    const code = studentLib.newCode(() => crypto.randomInt(0, 1e6) / 1e6);
    req.user.student = { ...(req.user.student?.toObject?.() || req.user.student || {}), pendingEmail: email, otpHash: hashCode(code), otpExpires: new Date(Date.now() + 15 * 60000), otpAttempts: 0 };
    await req.user.save();
    await sendEmail({
      to: email,
      subject: 'Your Automonie student code',
      text: `Your code is ${code}. It expires in 15 minutes. If you didn't ask for it, ignore this email.`,
      html: `<p style="font-family:Poppins,Arial,sans-serif;font-size:15px">Your Automonie student code is</p><p style="font-family:Poppins,Arial,sans-serif;font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p style="font-family:Poppins,Arial,sans-serif;font-size:13px;color:#5B6B7A">It expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
    });
    res.json({ ok: true, sentTo: email });
  } catch (e) { console.error('[student/email]', e.message); res.status(500).json({ message: 'Could not send the code. Try again.' }); }
});
app.post('/api/student/email/verify', authLimiter, auth, async (req, res) => {
  try {
    const s = req.user.student || {};
    if (!s.otpHash || !s.otpExpires || new Date(s.otpExpires) < new Date()) return res.status(400).json({ message: 'That code has expired. Ask for a new one.' });
    if ((s.otpAttempts || 0) >= 5) return res.status(429).json({ message: 'Too many tries. Ask for a new code.' });
    if (!safeEqual(hashCode(String(req.body?.code || '').trim()), s.otpHash)) {
      req.user.student.otpAttempts = (s.otpAttempts || 0) + 1;
      await req.user.save();
      return res.status(400).json({ message: 'That code doesn’t match.' });
    }
    const email = s.pendingEmail;
    const domain = studentLib.schoolDomainFor(email, await studentDomains());
    const inst = domain ? (await StudentDomain.findOne({ domain }).lean())?.institution || '' : '';
    markStudentVerified(req.user, 'email', { schoolEmail: email, institution: inst || domain || '' });
    await req.user.save();
    res.json(studentOut(req.user));
  } catch (e) { console.error('[student/verify]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// 2. Student ID, or 3. NYSC state code + call-up letter: an admin checks the upload.
const studentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|webp|heic)$/.test(file.mimetype) || file.mimetype === 'application/pdf'),
});
async function queueStudentReview(req, res, kind) {
  if (!req.file) return res.status(400).json({ message: kind === 'nysc' ? 'Add a photo of your call-up letter.' : 'Add a photo of your student ID.' });
  const fields = { institution: String(req.body.institution || '').trim().slice(0, 120), matric: String(req.body.matric || '').trim().slice(0, 40) };
  if (kind === 'student_id' && (!fields.institution || !fields.matric)) return res.status(400).json({ message: 'Add your institution and matric number.' });
  let stateCode = '';
  if (kind === 'nysc') {
    stateCode = studentLib.normalizeStateCode(req.body.stateCode);
    if (!stateCode) return res.status(400).json({ message: 'Enter your state code like LA/25A/1234.' });
  }
  await StudentReview.updateMany({ userId: req.user._id, status: 'pending' }, { $set: { status: 'rejected', reason: 'Replaced by a newer upload', decidedAt: new Date() }, $unset: { image: 1 } });
  await StudentReview.create({ userId: req.user._id, kind, ...fields, stateCode, image: req.file.buffer, contentType: req.file.mimetype });
  req.user.student = { ...(req.user.student?.toObject?.() || req.user.student || {}), status: req.user.student?.status === 'verified' ? 'verified' : 'pending', rejectReason: '' };
  await req.user.save();
  res.json(studentOut(req.user));
}
app.post('/api/student/id', auth, (req, res) => studentUpload.single('image')(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
  queueStudentReview(req, res, 'student_id').catch((e) => { console.error('[student/id]', e.message); res.status(500).json({ message: 'Server error' }); });
}));
app.post('/api/student/nysc', auth, (req, res) => studentUpload.single('image')(req, res, (err) => {
  if (err) return res.status(400).json({ message: err.message || 'Upload failed' });
  queueStudentReview(req, res, 'nysc').catch((e) => { console.error('[student/nysc]', e.message); res.status(500).json({ message: 'Server error' }); });
}));

// 4. Campaign code (from a talk): verifies straight away while uses remain.
app.post('/api/student/code', authLimiter, auth, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) return res.status(400).json({ message: 'Enter the code.' });
    const now = new Date();
    const hit = await CampaignCode.findOneAndUpdate(
      { code, active: true, $expr: { $lt: ['$uses', '$maxUses'] }, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
      { $inc: { uses: 1 } }, { new: true },
    );
    if (!hit) return res.status(400).json({ message: 'That code isn’t valid, or it has been used up.' });
    markStudentVerified(req.user, 'code', { institution: hit.label || '' });
    await req.user.save();
    res.json(studentOut(req.user));
  } catch (e) { console.error('[student/code]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Start the Student plan: the first time, the free months; after that, checkout.
app.post('/api/student/start', auth, async (req, res) => {
  try {
    if (!plans.studentVerified(req.user, new Date())) return res.status(403).json({ message: 'Verify that you’re a student first.' });
    const cfg = plans.config();
    if (!req.user.student.freeUsed) {
      const base = req.user.plan === 'student' && req.user.planExpiry > new Date() ? req.user.planExpiry : new Date();
      req.user.plan = 'student';
      req.user.planExpiry = new Date(new Date(base).getTime() + cfg.studentFreeDays * 86400000);
      req.user.student.freeUsed = true;
      await req.user.save();
      await createNotification(req.user._id, { type: 'success', title: 'Student plan active', message: `Free until ${req.user.planExpiry.toLocaleDateString('en-NG', { dateStyle: 'medium' })}, then ₦${cfg.studentPrice} a month.` }).catch(() => {});
      return res.json({ ok: true, plan: 'student', planExpiry: req.user.planExpiry, free: true });
    }
    res.json({ ok: false, checkout: true, plan: 'student', priceNaira: cfg.studentPrice });
  } catch (e) { console.error('[student/start]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Admin: the review queue (pattern of the feedback inbox), codes and the domain list.
app.get('/api/admin/student-reviews', auth, superAdminAuth, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const rows = await StudentReview.find({ status }).sort({ createdAt: status === 'pending' ? 1 : -1 }).limit(200).populate('userId', 'name email').lean();
    res.json({ items: rows.map((r) => ({ id: r._id, kind: r.kind, institution: r.institution, matric: r.matric, stateCode: r.stateCode, status: r.status, reason: r.reason, createdAt: r.createdAt, decidedAt: r.decidedAt, user: r.userId ? { name: r.userId.name, email: r.userId.email } : null })) });
  } catch (e) { console.error('[admin/student-reviews]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.get('/api/admin/student-reviews/:id/image', auth, superAdminAuth, async (req, res) => {
  try {
    const r = await StudentReview.findById(req.params.id).select('+image contentType');
    if (!r || !r.image) return res.status(404).end();
    res.set('Content-Type', r.contentType || 'application/octet-stream');
    res.set('Cache-Control', 'no-store');
    res.send(r.image);
  } catch { res.status(404).end(); }
});
app.post('/api/admin/student-reviews/:id/decision', auth, superAdminAuth, async (req, res) => {
  try {
    const approve = req.body?.approve === true;
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!approve && !reason) return res.status(400).json({ message: 'Give a reason so the student knows what to fix.' });
    const r = await StudentReview.findOneAndUpdate(
      { _id: req.params.id, status: 'pending' },
      { $set: { status: approve ? 'approved' : 'rejected', reason, decidedBy: req.user.email, decidedAt: new Date() }, $unset: { image: 1 } },
      { new: true },
    );
    if (!r) return res.status(404).json({ message: 'Already decided, or not found.' });
    const u = await User.findById(r.userId);
    if (u) {
      if (approve) markStudentVerified(u, r.kind === 'nysc' ? 'nysc' : 'id', { institution: r.kind === 'nysc' ? `NYSC ${r.stateCode}` : r.institution });
      else u.student = { ...(u.student?.toObject?.() || u.student || {}), status: u.student?.status === 'verified' ? 'verified' : 'rejected', rejectReason: reason };
      await u.save();
      await createNotification(u._id, approve
        ? { type: 'success', title: 'You’re verified', message: 'Your Student plan is ready to start in Settings.' }
        : { type: 'info', title: 'We couldn’t verify you yet', message: reason }).catch(() => {});
    }
    res.json({ ok: true });
  } catch (e) { console.error('[admin/student-decision]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.get('/api/admin/campaign-codes', auth, superAdminAuth, async (req, res) => {
  res.json({ items: await CampaignCode.find().sort({ createdAt: -1 }).lean() });
});
app.post('/api/admin/campaign-codes', auth, superAdminAuth, async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);
    if (code.length < 4) return res.status(400).json({ message: 'Codes need at least 4 letters or digits.' });
    const doc = await CampaignCode.create({
      code, label: String(req.body?.label || '').slice(0, 80),
      maxUses: Math.max(1, Math.min(100000, Number(req.body?.maxUses) || 100)),
      expiresAt: req.body?.expiresAt ? new Date(req.body.expiresAt) : null,
    });
    res.status(201).json(doc);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ message: 'That code already exists.' });
    console.error('[admin/campaign-codes]', e.message); res.status(500).json({ message: 'Server error' });
  }
});
app.patch('/api/admin/campaign-codes/:id', auth, superAdminAuth, async (req, res) => {
  const doc = await CampaignCode.findByIdAndUpdate(req.params.id, { $set: { active: req.body?.active !== false } }, { new: true }).catch(() => null);
  if (!doc) return res.status(404).json({ message: 'Not found' });
  res.json(doc);
});
app.get('/api/admin/student-domains', auth, superAdminAuth, async (req, res) => {
  await studentDomains();
  res.json({ items: await StudentDomain.find().sort({ domain: 1 }).lean() });
});
app.post('/api/admin/student-domains', auth, superAdminAuth, async (req, res) => {
  try {
    const domain = String(req.body?.domain || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return res.status(400).json({ message: 'Enter a domain like unilag.edu.ng.' });
    const doc = await StudentDomain.findOneAndUpdate({ domain }, { $set: { domain, institution: String(req.body?.institution || '').slice(0, 120) } }, { upsert: true, new: true });
    res.status(201).json(doc);
  } catch (e) { console.error('[admin/student-domains]', e.message); res.status(500).json({ message: 'Server error' }); }
});
app.delete('/api/admin/student-domains/:id', auth, superAdminAuth, async (req, res) => {
  await StudentDomain.deleteOne({ _id: req.params.id }).catch(() => {});
  res.json({ ok: true });
});

// Daily: remind students two weeks before their verification lapses; when it does,
// mark it expired and drop a Student plan to Free. Also tell users once when their
// Plus trial has ended, so it's never a surprise.
async function sweepStudentsAndTrials(now = new Date()) {
  const soon = new Date(now.getTime() + 14 * 86400000);
  const remind = await User.find({ 'student.status': 'verified', 'student.expiresAt': { $gt: now, $lte: soon }, 'student.reminderSentAt': null }).limit(500);
  for (const u of remind) {
    await createNotification(u._id, { type: 'info', title: 'Re-verify your student status', message: `Your verification ends on ${new Date(u.student.expiresAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}. Re-verify in Settings to keep the Student plan.` }).catch(() => {});
    if (emailConfigured()) {
      await sendEmail({ to: u.email, subject: 'Re-verify your Automonie student status', text: 'Your student verification ends in two weeks. Open Automonie, go to Settings, then Plans, and verify again to keep the Student price.' }).catch(() => {});
    }
    u.student.reminderSentAt = now;
    await u.save();
  }
  const lapsed = await User.find({ 'student.status': 'verified', 'student.expiresAt': { $lte: now } }).limit(500);
  for (const u of lapsed) {
    u.student.status = 'expired';
    if (u.plan === 'student') { u.plan = 'free'; u.planExpiry = null; }
    await u.save();
    await createNotification(u._id, { type: 'info', title: 'Student plan paused', message: 'Your student verification lapsed, so you’re on Free. Verify again in Settings to switch back.' }).catch(() => {});
  }
  const cfg = plans.config();
  const trialCut = new Date(now.getTime() - cfg.trialDays * 86400000);
  const trialsEnded = await User.find({ createdAt: { $lte: trialCut, $gt: new Date(trialCut.getTime() - 7 * 86400000) }, trialEndNotified: { $ne: true }, planEverPaid: { $ne: true } }).select('_id plan planExpiry role createdAt planEverPaid student').limit(1000);
  for (const u of trialsEnded) {
    if (plans.entitlement(u, now).tier !== 'free') continue;
    await createNotification(u._id, { type: 'info', title: 'Your Plus trial has ended', message: 'You’re on Free now: everything you added stays. Plus features like receipt scanning and report exports are in Settings, then Plans.' }).catch(() => {});
    await User.updateOne({ _id: u._id }, { $set: { trialEndNotified: true } });
  }
  return { reminded: remind.length, lapsed: lapsed.length, trialsEnded: trialsEnded.length };
}

// Built but LAUNCH-GATED by proCheckoutReady() (needs PAYSTACK_SECRET_KEY +
// PRO_CHECKOUT_ENABLED=true). checkout → Paystack → verify/webhook grants Pro; a
// saved authorization lets the daily cron renew it. Extends from the later of now /
// current expiry so paying early never loses days.

// Grant (or extend) Pro from a successful Paystack charge. Idempotent on reference.
// kind = 'checkout' (user paid) or 'renewal' (cron charged the saved card).
async function grantProFromCharge(user, data, kind = 'checkout') {
  const reference = data.reference;
  if (!reference) return null;
  if (await ProPayment.findOne({ reference })) return { already: true }; // processed
  const months = Math.max(1, Math.min(12, Number(data.metadata?.months) || 1));
  const amount = koboToNaira(data.amount || 0);
  const base = user.planExpiry && new Date(user.planExpiry) > new Date() ? new Date(user.planExpiry) : new Date();
  const expiry = new Date(base.getTime() + months * 30 * 24 * 60 * 60 * 1000);
  const paidPlan = ['pro', 'student', 'power'].includes(data.metadata?.plan) ? data.metadata.plan : 'pro';
  user.plan = paidPlan;
  user.planExpiry = expiry;
  user.planEverPaid = true;
  const authz = data.authorization;
  if (authz && authz.reusable && authz.authorization_code) {
    user.proSub = {
      authorizationCode: authz.authorization_code,
      last4: authz.last4 || '', cardType: authz.card_type || '',
      autoRenew: true, lastReference: reference,
    };
  } else if (user.proSub) {
    user.proSub.lastReference = reference;
  }
  await user.save();
  await new ProPayment({ userId: user._id, reference, amount, months, kind }).save();
  try {
    const planName = (plans.catalog().find((p) => p.code === paidPlan) || {}).name || 'Plus';
    await createNotification(user._id, { type: 'success', title: `Automonie ${planName} active`, message: `You're on ${planName} until ${expiry.toLocaleDateString('en-NG', { dateStyle: 'medium' })}.` });
    await logActivity(user._id, { type: 'pro_subscribed', title: `Automonie ${planName}`, message: kind === 'renewal' ? 'Auto-renewed' : 'Subscribed', amount });
  } catch { /* non-fatal */ }
  return { plan: paidPlan, planExpiry: expiry };
}

// Start Pro checkout: returns the Paystack authorization_url to open.
app.post('/api/billing/checkout', auth, async (req, res) => {
  try {
    if (!proCheckoutReady()) return res.status(503).json({ message: 'Checkout is not available yet.' });
    const months = Math.max(1, Math.min(12, Number(req.body.months) || 1));
    const planCode = ['pro', 'student', 'power'].includes(req.body.plan) ? req.body.plan : 'pro';
    const plan = plans.catalog().find((p) => p.code === planCode);
    if (!plan.onSale || !(plan.priceNaira > 0)) return res.status(400).json({ message: `${plan.name} isn't on sale yet.` });
    if (planCode === 'student' && !plans.studentVerified(req.user, new Date())) return res.status(403).json({ message: 'Verify that you’re a student first.' });
    const amount = plan.priceNaira * months;
    const payload = {
      email: req.user.email,
      amount: amount * 100,
      metadata: { userId: req.user._id.toString(), purpose: 'pro_subscription', plan: planCode, months },
      channels: ['card'],
    };
    if (process.env.PRO_CALLBACK_URL) payload.callback_url = process.env.PRO_CALLBACK_URL;
    const r = await axios.post('https://api.paystack.co/transaction/initialize', payload, { headers: paystackHeaders(), timeout: 20000 });
    const d = r.data?.data || {};
    res.json({ authorization_url: d.authorization_url, access_code: d.access_code, reference: d.reference, amount, months });
  } catch (err) {
    console.error('[billing/checkout]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not start checkout. Try again.' });
  }
});

// Verify a Pro checkout by reference (belt-and-suspenders alongside the webhook).
app.post('/api/billing/verify', auth, async (req, res) => {
  try {
    if (!proCheckoutReady()) return res.status(503).json({ message: 'Checkout is not available yet.' });
    const reference = (req.body.reference || '').toString();
    if (!reference) return res.status(400).json({ message: 'reference is required' });
    const r = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: paystackHeaders(), timeout: 20000 });
    const d = r.data?.data || {};
    if (d.status !== 'success') return res.status(402).json({ message: 'Payment not completed.' });
    if (d.metadata?.purpose !== 'pro_subscription') return res.status(400).json({ message: 'Not a plan payment.' });
    await grantProFromCharge(req.user, d, 'checkout');
    const u = await User.findById(req.user._id).select('plan planExpiry proSub');
    res.json({ plan: u.plan, planExpiry: u.planExpiry, isPro: isPro(u), autoRenew: !!u.proSub?.autoRenew });
  } catch (err) {
    console.error('[billing/verify]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not verify the payment.' });
  }
});

// Turn auto-renew off/on. Off = user keeps Pro until it expires, then lapses to free.
app.post('/api/billing/auto-renew', auth, async (req, res) => {
  try {
    const on = !!req.body.enabled;
    const user = await User.findById(req.user._id);
    if (!user.proSub) user.proSub = {};
    user.proSub.autoRenew = on && !!user.proSub.authorizationCode;
    await user.save();
    res.json({ autoRenew: user.proSub.autoRenew });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Cron: renew Pro for users whose plan expires within ~24h and who have auto-renew +
// a saved card. Charges the saved authorization; grantProFromCharge extends them.
app.post('/api/cron/renew-pro', async (req, res) => {
  try {
    if (!cronAuthorized(req)) return res.sendStatus(401);
    if (!proCheckoutReady()) return res.json({ renewed: 0, skipped: 'not-live' });
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const due = await User.find({
      plan: { $in: ['pro', 'student', 'power'] }, 'proSub.autoRenew': true,
      'proSub.authorizationCode': { $nin: ['', null] },
      planExpiry: { $lte: soon },
    }).limit(200);
    let renewed = 0, failed = 0;
    for (const user of due) {
      try {
        if (user.plan === 'student' && !plans.studentVerified(user, new Date())) continue;
        const price = (plans.catalog().find((p) => p.code === user.plan) || {}).priceNaira;
        if (!(price > 0)) continue;
        const r = await axios.post('https://api.paystack.co/transaction/charge_authorization',
          { email: user.email, amount: price * 100, authorization_code: user.proSub.authorizationCode,
            metadata: { userId: user._id.toString(), purpose: 'pro_subscription', plan: user.plan, months: 1 } },
          { headers: paystackHeaders(), timeout: 20000 });
        const d = r.data?.data || {};
        if (d.status === 'success') { await grantProFromCharge(user, d, 'renewal'); renewed++; }
        else { failed++; await createNotification(user._id, { type: 'info', title: 'Renewal failed', message: 'We couldn’t charge your card. Update it to keep your plan.' }); }
      } catch (e) { failed++; console.error('[renew-pro]', user._id.toString(), e.response?.data || e.message); }
    }
    res.json({ renewed, failed, considered: due.length });
  } catch (e) { console.error('[renew-pro]', e.message); res.status(500).json({ message: 'Server error' }); }
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
// HTTP→deep-link bridge. Chrome Custom Tabs won't follow a JS navigation to a
// custom scheme, but it follows an HTTP 302 to one - so the Mono page returns
// here and we redirect to the app's deep link, closing the in-app browser.
app.get('/bank/return', (req, res) => {
  const to = String(req.query.to || '');
  if (!/^(finpilot:|exp:|exps:)\/\//i.test(to)) return res.status(400).send('Invalid redirect');
  res.redirect(302, to);
});

app.get('/bank/mono-connect', (req, res) => {
  const redirect = String(req.query.redirect || '');
  if (!redirect) return res.status(400).send('Missing redirect');
  // Only allow the app's own deep links - blocks open-redirect / reflected XSS.
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
<style>html,body{height:100%;margin:0;font-family:system-ui,-apple-system,sans-serif;background:#000000;color:#e3e9f2;display:grid;place-items:center;text-align:center}
.box{max-width:340px;padding:24px}.sp{width:38px;height:38px;border:4px solid rgba(255,255,255,.18);border-top-color:#00a862;border-radius:50%;margin:0 auto 16px;animation:s 1s linear infinite}
@keyframes s{to{transform:rotate(360deg)}}a.b{display:inline-block;margin-top:16px;background:#00a862;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:700}
#dbg{margin-top:16px;font-size:11px;line-height:1.5;color:#7fe9d6;text-align:left;max-height:42vh;overflow:auto;white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.04);border-radius:8px;padding:8px}</style></head>
<body><div class="box"><div class="sp"></div><p id="msg">Opening secure bank connection…</p>
<a class="b" id="cancel" href="${htmlEsc(redirect + sep + 'status=closed')}">Back to app</a>
<pre id="dbg"></pre></div>
<script type="module">
  const KEY=${jsStr(publicKey)};
  const REDIRECT=${jsStr(redirect)};
  const SEP=${jsStr(sep)};
  let done=false, loaded=false;
  // Chrome Custom Tabs blocks ALL programmatic navigation to an app deep link
  // (JS location.replace AND a server 302 both silently no-op) - only a real
  // user tap is honored. So every outcome resolves to a one-tap button that
  // carries the result (the auth code, or a status) back into the app.
  const go=(q)=>{
    if(done) return; done=true; clearTimeout(guard);
    const btn=document.getElementById('cancel'), sp=document.querySelector('.sp');
    const success = q.indexOf('code=')===0 && q.length>5;
    if(btn){ btn.setAttribute('href', REDIRECT+SEP+q); btn.textContent = success ? 'Finish - open Automonie' : 'Back to app'; }
    if(msgEl) msgEl.textContent = success ? '✓ Bank linked! Tap Finish to continue.'
      : (q.indexOf('status=timeout')===0 ? 'Timed out - tap to return.' : 'Tap to return to the app.');
    if(sp) sp.style.display='none';
    log(success ? '✓ READY - tap Finish' : 'READY - tap Back to app');
  };
  const msgEl=document.getElementById('msg'), dbgEl=document.getElementById('dbg');
  const log=(m)=>{ if(msgEl) msgEl.textContent=m; if(dbgEl) dbgEl.textContent += m + '\\n'; };
  window.addEventListener('error', (e)=>log('JS ERROR: '+((e&&e.message)||e)));
  window.addEventListener('unhandledrejection', (e)=>log('REJECT: '+((e&&e.reason&&(e.reason.message||e.reason))||'')));
  log('key: '+(KEY ? (KEY.slice(0,8)+'… ('+KEY.length+' chars)') : 'MISSING'));

  // Bounce back only if the widget never became ready (so we don't interrupt a
  // legitimately-open picker).
  const guard=setTimeout(()=>{ if(!loaded && !done){ log('TIMEOUT - widget never opened. Returning…'); setTimeout(()=>go('status=timeout'),1600);} }, 25000);

  async function loadConnect(){
    try{
      log('1) import ESM…');
      const m = await import('https://cdn.jsdelivr.net/npm/@mono.co/connect.js@2.2.0/+esm');
      if(typeof m.default==='function'){ log('   ESM ok (default)'); return m.default; }
      if(typeof m.Connect==='function'){ log('   ESM ok (Connect)'); return m.Connect; }
      log('   ESM loaded, no constructor');
    }catch(e){ log('   ESM failed: '+((e&&e.message)||e)); }
    log('2) load UMD script…');
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/@mono.co/connect.js@2.2.0/dist/index.js'; s.onload=res; s.onerror=()=>rej(new Error('UMD blocked/failed')); document.head.appendChild(s); });
    const C = window.Connect || window.MonoConnect;
    log('   UMD '+(typeof C==='function'?'ok':'no constructor'));
    return C;
  }

  if(!KEY){ clearTimeout(guard); log('NOT CONFIGURED - MONO_PUBLIC_KEY is empty on the server.'); }
  else{
    (async()=>{
      try{
        const Connect = await loadConnect();
        if(typeof Connect!=='function') throw new Error('constructor unavailable');
        log('3) new Connect + setup…');
        let opened=false;
        let connect;
        const openOnce=(from)=>{ if(opened||done) return; opened=true; log('4) open() ['+from+']'); try{ connect.open(); }catch(e){ log('open() error: '+((e&&e.message)||e)); } };
        connect = new Connect({
          key: KEY, scope: 'auth',
          onLoad: ()=>{ loaded=true; log('onLoad - widget ready'); openOnce('onLoad'); },
          onSuccess: (res)=>{ log('onSuccess'); const code=(res&&(res.code||(res.getAuthCode&&res.getAuthCode())))||''; go('code='+encodeURIComponent(code)); },
          onClose: ()=>{ log('onClose'); go('status=closed'); },
          onEvent: (ev)=>{ try{ log('event: '+((ev&&(ev.type||ev.eventName))||JSON.stringify(ev))); }catch(_){ } },
        });
        connect.setup();
        setTimeout(()=>openOnce('fallback-3s'), 3000);
      }catch(e){ clearTimeout(guard); log('FATAL: '+((e&&e.message)||'unknown')); setTimeout(()=>go('status=error'),2500); }
    })();
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

// --- Sync rate caps (control Mono cost). Mono bills per page of transactions
// returned, and even an "empty" refresh bills. So automatic syncs run only at
// the plan's cadence, and manual syncs have a shorter floor to stop hammering. ---
const _DAY = 24 * 60 * 60 * 1000;
const SYNC_AUTO_MS   = { free: 7 * _DAY,               pro: 1 * _DAY };
const SYNC_MANUAL_MS = { free: 4 * 60 * 60 * 1000,     pro: 1 * 60 * 60 * 1000 };
const planKey = (user) => (user?.plan === 'pro' ? 'pro' : 'free');
function syncDue(acct, plan, manual) {
  const interval = (manual ? SYNC_MANUAL_MS : SYNC_AUTO_MS)[plan] || SYNC_AUTO_MS.free;
  const last = acct.lastSyncAttempt ? new Date(acct.lastSyncAttempt).getTime() : 0;
  return Date.now() - last >= interval;
}

// Pull + import ONLY NEW transactions from one linked Mono account, using a
// per-account cursor (lastTxnDate). We fetch from the cursor forward (with a
// small overlap), so we never re-fetch - and never re-pay for - history we
// already hold. First sync (no cursor) pulls full history once. Idempotent:
// dedupe removes any repeats, so a retried/failed sync never duplicates or
// double-charges.
async function syncMonoAccount(user, acct) {
  if (!acct?.accountId) return { imported: 0, total: 0 };
  acct.lastSyncAttempt = new Date();          // rate-cap clock, set before the call
  const params = { paginate: false };
  if (acct.lastTxnDate) {
    const from = new Date(acct.lastTxnDate);
    from.setDate(from.getDate() - 3);         // 3-day overlap catches late-posting entries
    params.start = from.toISOString().slice(0, 10);
  }
  const r = await axios.get(`${MONO_BASE}/accounts/${acct.accountId}/transactions`, {
    headers: monoHeaders(), params, timeout: 30000,
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

  // Idempotent dedupe against what the user already has.
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

  // Advance the cursor to the newest transaction date we saw.
  for (const t of mapped) {
    if (!acct.lastTxnDate || new Date(t.date) > new Date(acct.lastTxnDate)) acct.lastTxnDate = new Date(t.date);
  }
  acct.lastSynced = importedAt;
  acct.dirty = false;
  return { imported: docs.length, total: mapped.length };
}

// Sync a user's linked accounts, honouring rate caps.
//   opts.manual    - use the shorter manual floor instead of the auto cadence
//   opts.dirtyOnly - only sync accounts a webhook flagged (webhook mode)
//   opts.force     - ignore rate caps entirely
async function syncAllMonoForUser(user, opts = {}) {
  migrateLegacyBank(user);
  const plan = planKey(user);
  const accts = userBankAccounts(user);
  let imported = 0, total = 0, skipped = 0;
  for (const a of accts) {
    if (opts.dirtyOnly && !a.dirty) { skipped += 1; continue; }
    if (!opts.force && !syncDue(a, plan, opts.manual)) { skipped += 1; continue; }
    try { const r = await syncMonoAccount(user, a); imported += r.imported; total += r.total; }
    catch (e) { console.error('[mono/sync]', a.accountId, e.response?.data || e.message); }
  }
  await user.save();
  return { imported, total, accounts: accts.length, skipped };
}

// Pull transactions from all linked accounts and import new ones (manual).
app.post('/api/bank/sync', auth, async (req, res) => {
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  if (!userBankAccounts(req.user).length) return res.status(400).json({ message: 'No bank account linked' });
  try {
    const r = await syncAllMonoForUser(req.user, { manual: true });
    const message = r.imported > 0
      ? `Imported ${r.imported} new transaction(s).`
      : (r.skipped > 0 && r.accounts > 0
          ? 'You are up to date. Automatic sync keeps your transactions current; try a manual refresh again a little later.'
          : 'No new transactions.');
    res.json({ ...r, message });
  } catch (err) {
    console.error('[bank/sync]', err.response?.data || err.message);
    res.status(502).json({ message: 'Could not sync transactions. Try again.' });
  }
});

// Scheduled auto-sync for every linked account. Protected by a shared secret so
// an external scheduler (e.g. cron-job.org / a Render cron job) can trigger it -
// Render's free tier sleeps, so an in-process cron wouldn't fire reliably.
app.post('/api/cron/sync-banks', async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  if (!monoConfigured()) return res.status(503).json({ message: 'Bank linking is not configured yet.' });
  try {
    const users = await User.find({ $or: [
      { 'linkedBanks.0': { $exists: true } },
      { 'linkedBank.accountId': { $nin: [null, ''] } },
    ] });
    // Webhook mode: Mono pushes updates, so only sync accounts it flagged (dirty)
    // - no paying to poll unchanged accounts. Polling mode (no webhook secret):
    // sync every account that's due at the plan cadence.
    const webhookMode = !!process.env.MONO_WEBHOOK_SEC;
    let imported = 0, synced = 0, failed = 0;
    for (const u of users) {
      try { imported += (await syncAllMonoForUser(u, { dirtyOnly: webhookMode })).imported; synced += 1; }
      catch (e) { failed += 1; console.error('[cron/sync-banks]', u._id.toString(), e.response?.data || e.message); }
    }
    res.json({ users: users.length, synced, failed, imported, mode: webhookMode ? 'webhook' : 'polling' });
  } catch (e) {
    console.error('[cron/sync-banks]', e.message);
    res.status(500).json({ message: 'Sync failed' });
  }
});

// ---------------------------------------------------------------------------
// Push notifications (Expo) - spending-insight nudges with local personality.
// ---------------------------------------------------------------------------
const isExpoToken = (t) => /^Expo(nent)?PushToken\[.+\]$/.test(String(t || ''));

// Register a device's Expo push token.
app.post('/api/push/register', auth, async (req, res) => {
  try {
    const token = (req.body.token || '').toString().trim();
    if (!isExpoToken(token)) return res.status(400).json({ message: 'Invalid push token' });
    await User.updateOne({ _id: req.user._id }, { $addToSet: { pushTokens: token } });
    res.json({ ok: true });
  } catch (e) { console.error('[push/register]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Push settings: one switch per category, and whether amounts may show on the lock
// screen (off by default). Older apps send { insights } which switches all of them.
const NUDGE_CATEGORIES = nudges.CATEGORIES;
const pushSettingsOut = (u) => ({
  categories: Object.fromEntries(NUDGE_CATEGORIES.map((c) => [c, u.nudgePrefs?.[c] !== false])),
  showAmounts: !!u.showAmountsInNotifications,
});
app.get('/api/push/settings', auth, (req, res) => res.json(pushSettingsOut(req.user)));
app.post('/api/push/settings', auth, async (req, res) => {
  try {
    const b = req.body || {};
    const set = {};
    if (typeof b.insights === 'boolean') NUDGE_CATEGORIES.forEach((c) => { set[`nudgePrefs.${c}`] = b.insights; });
    if (b.categories && typeof b.categories === 'object') {
      for (const c of NUDGE_CATEGORIES) if (typeof b.categories[c] === 'boolean') set[`nudgePrefs.${c}`] = b.categories[c];
    }
    if (typeof b.showAmounts === 'boolean') set.showAmountsInNotifications = b.showAmounts;
    if (!Object.keys(set).length) return res.status(400).json({ message: 'Nothing to change.' });
    const u = await User.findByIdAndUpdate(req.user._id, { $set: set }, { new: true });
    res.json(pushSettingsOut(u));
  } catch (e) { console.error('[push/settings]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Fire-and-forget send via the Expo push service (batched at 100/request).
async function sendExpoPush(tokens, { title, body, data }) {
  if (process.env.PUSH_DISABLED === 'true') return; // off switch (and for tests)
  const messages = (tokens || []).filter(isExpoToken)
    .map((to) => ({ to, sound: 'default', title, body, data: data || {}, channelId: 'alerts', priority: 'high' }));
  for (let i = 0; i < messages.length; i += 100) {
    try {
      await axios.post('https://exp.host/--/api/v2/push/send', messages.slice(i, i + 100),
        { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
    } catch (e) { console.error('[expo-push]', e.response?.data || e.message); }
  }
}

// ── Nudges: the push rules engine (lib/nudges). Copy is data: data/nudge-copy.json,
// with admin edits from the NudgeCopy collection applied on top.
const NUDGE_BASE_COPY = require('./data/nudge-copy.json');
async function nudgeCopy() {
  const overrides = await NudgeCopy.find({}).lean().catch(() => []);
  return nudges.mergeCopy(NUDGE_BASE_COPY, overrides);
}

// Everything the triggers look at, for one user.
async function nudgeSnapshot(u, now) {
  const since = new Date(now.getTime() - 63 * 86400000);
  const [txns, budgets, bills, subs, goals, lowConf, unnamed] = await Promise.all([
    Transaction.find({ userId: u._id, date: { $gte: since } }, { date: 1, amount: 1, type: 1, category: 1, description: 1 }).lean(),
    Budget.find({ userId: u._id, month: nudges.lagos(now).monthKey }, { category: 1, amount: 1 }).lean(),
    RecurringBill.find({ userId: u._id, status: 'active' }, { name: 1, nextDue: 1 }).lean(),
    Subscription.find({ userId: u._id, status: 'active' }).lean(),
    Goal.find({ userId: u._id }, { name: 1, target: 1, current: 1, notifiedMilestone: 1 }).lean(),
    Transaction.countDocuments({ userId: u._id, parseConfidence: 'low', reviewedAt: { $exists: false } }),
    Subscription.countDocuments({ userId: u._id, needsName: true, status: { $ne: 'cancelled' } }),
  ]);
  return {
    createdAt: u.createdAt, lastActiveAt: u.lastActiveAt || u.lastLogin || null,
    txns: txns.map((t) => ({ id: String(t._id), date: t.date, amount: t.amount, type: t.type, category: t.category, description: t.description, createdAt: t._id.getTimestamp() })),
    budgets,
    goals: goals.map((g) => ({ id: String(g._id), name: g.name, target: g.target, current: g.current, notifiedMilestone: g.notifiedMilestone || 0 })),
    bills: bills.map((b) => ({ id: String(b._id), name: b.name, nextDue: b.nextDue })),
    subs: subs.map((s) => ({ id: String(s._id), name: s.name, nextRenewal: computeNextRenewal(s, now) })).filter((s) => s.nextRenewal),
    reviewPending: lowConf + unnamed,
  };
}

// One user: pick at most one nudge, send it, log it. Returns the log row or null.
async function nudgeUser(u, copy, now) {
  const log = await NudgeLog.find({ userId: u._id, sentAt: { $gte: new Date(now.getTime() - 45 * 86400000) } }, { trigger: 1, key: 1, sentAt: 1, variantId: 1 }).sort({ sentAt: -1 }).lean();
  const snap = await nudgeSnapshot(u, now);
  const chosen = nudges.select(nudges.evaluate(snap, now), { log, prefs: u.nudgePrefs || {}, copy, now });
  if (!chosen) return null;
  const spec = copy[chosen.trigger];
  const complete = chosen.trigger === 'goal_progress' && chosen.vars.pct === 100;
  const lastVariant = log.find((l) => l.trigger === chosen.trigger)?.variantId;
  const variant = nudges.pickVariant(complete ? spec.completeVariants : spec.variants, lastVariant);
  const body = variant && nudges.render(variant, chosen.vars, { showAmounts: !!u.showAmountsInNotifications });
  if (!body) return null;
  const row = await NudgeLog.create({ userId: u._id, trigger: chosen.trigger, category: spec.category, variantId: variant.id, key: chosen.key, sentAt: now });
  await sendExpoPush(u.pushTokens, { title: spec.title, body, data: { type: 'nudge', nudgeId: String(row._id), nav: spec.nav } });
  await createNotification(u._id, { type: 'info', title: spec.title, message: body }).catch(() => {});
  if (chosen.trigger === 'goal_progress') await Goal.updateOne({ _id: chosen.vars.goalId, userId: u._id }, { $set: { notifiedMilestone: chosen.vars.pct } });
  return row;
}

let nudgesRunning = false;
async function runNudgesJob(now = new Date()) {
  if (nudgesRunning) return { skipped: 'already running' };
  nudgesRunning = true;
  try {
    const copy = await nudgeCopy();
    const users = await User.find({ 'pushTokens.0': { $exists: true } }).select('_id pushTokens nudgePrefs showAmountsInNotifications createdAt lastActiveAt lastLogin').lean();
    let sent = 0;
    for (const u of users) {
      try { if (await nudgeUser(u, copy, now)) sent += 1; } catch (e) { console.error('[nudges] user', String(u._id), e.message); }
    }
    return { users: users.length, sent };
  } finally { nudgesRunning = false; }
}

// Hourly, from an external scheduler (cron-job.org / Render cron) holding CRON_SECRET.
// /api/cron/insights is the old daily job's address, kept so an existing schedule works.
app.post(['/api/cron/nudges', '/api/cron/insights'], async (req, res) => {
  if (!cronAuthorized(req)) return res.status(401).json({ message: 'Unauthorized' });
  // Outside production a run can be pinned to a time (?at=ISO) and awaited (?wait=1),
  // so the rules can be tested without waiting for the clock.
  const testing = process.env.NODE_ENV !== 'production';
  const at = testing && req.query.at ? new Date(req.query.at) : new Date();
  if (testing && req.query.wait) return res.json(await runNudgesJob(at));
  res.status(202).json({ ok: true });
  runNudgesJob(at).then((r) => console.log('[cron/nudges]', r)).catch((e) => console.error('[cron/nudges]', e.message));
});

// Stopgap in-process run every hour while the server is awake; the limits and the
// per-occasion keys make an extra run harmless. An external hourly cron is better.
setInterval(() => { runNudgesJob().catch((e) => console.error('[nudges:interval]', e.message)); }, 60 * 60 * 1000);

// A nudge was tapped (the app reports it), for the open-rate report.
app.post('/api/nudges/:id/opened', auth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Bad id' });
    await NudgeLog.updateOne({ _id: req.params.id, userId: req.user._id, openedAt: null }, { $set: { openedAt: new Date() } });
    res.json({ ok: true });
  } catch (e) { console.error('[nudges/opened]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Admin: the copy library with sends and opens per line over the last N days (the
// weekly report), and editing a line without a release.
app.get('/api/admin/nudges', auth, superAdminAuth, async (req, res) => {
  try {
    const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 7));
    const since = new Date(Date.now() - days * 86400000);
    const [copy, stats] = await Promise.all([
      nudgeCopy(),
      NudgeLog.aggregate([
        { $match: { sentAt: { $gte: since } } },
        { $group: { _id: { trigger: '$trigger', variantId: '$variantId' }, sent: { $sum: 1 }, opened: { $sum: { $cond: [{ $ifNull: ['$openedAt', false] }, 1, 0] } } } },
      ]),
    ]);
    const byVariant = new Map(stats.map((s) => [`${s._id.trigger}|${s._id.variantId}`, s]));
    const triggers = Object.entries(copy).map(([trigger, t]) => ({
      trigger, title: t.title, category: t.category,
      variants: [...t.variants, ...(t.completeVariants || []).map((v) => ({ ...v, complete: true }))].map((v) => {
        const s = byVariant.get(`${trigger}|${v.id}`) || { sent: 0, opened: 0 };
        return { ...v, active: v.active !== false, sent: s.sent, opened: s.opened, openRate: s.sent ? Math.round((s.opened / s.sent) * 1000) / 10 : null };
      }),
    }));
    res.json({ days, triggers, totals: { sent: stats.reduce((a, s) => a + s.sent, 0), opened: stats.reduce((a, s) => a + s.opened, 0) } });
  } catch (e) { console.error('[admin/nudges]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.put('/api/admin/nudges/:trigger/:variantId', auth, superAdminAuth, async (req, res) => {
  try {
    const { trigger, variantId } = req.params;
    if (!NUDGE_BASE_COPY[trigger] || trigger === '_about') return res.status(404).json({ message: 'Unknown trigger' });
    if (!/^[a-z0-9-]{1,40}$/.test(variantId)) return res.status(400).json({ message: 'Variant ids are lowercase letters, digits and dashes.' });
    const text = (req.body?.text || '').toString().trim().slice(0, 200);
    const withAmount = (req.body?.withAmount || '').toString().trim().slice(0, 200);
    if (!text) return res.status(400).json({ message: 'The line can’t be empty.' });
    // The default line must never put money on the lock screen.
    if (/₦|\bNGN\b|\{(amount|remaining)\}/.test(text)) return res.status(400).json({ message: 'Keep amounts out of the main line; put them in the amount version.' });
    if (/\p{Extended_Pictographic}/u.test(`${text} ${withAmount}`)) return res.status(400).json({ message: 'No emoji in notifications.' });
    await NudgeCopy.updateOne(
      { trigger, variantId },
      { $set: { trigger, variantId, text, withAmount, complete: !!req.body?.complete, active: req.body?.active !== false } },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) { console.error('[admin/nudges/put]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Mono webhook: Mono POSTs here when a linked account's data changes. We verify
// the shared secret, flag the account "dirty", and sync it immediately if it's
// due at the plan cadence; otherwise the cron picks up flagged accounts later.
// This is what lets us stop polling (and stop paying for empty polls).
// Enable by setting MONO_WEBHOOK_SEC to the secret configured in the Mono
// dashboard, and pointing the dashboard webhook at /api/bank/mono-webhook.
// NOTE: confirm Mono's exact event names + payload shape in the dashboard; the
// matching below is deliberately liberal so it works across their variants.
app.post('/api/bank/mono-webhook', async (req, res) => {
  const sec = process.env.MONO_WEBHOOK_SEC;
  if (!sec || !safeEqual(req.get('mono-webhook-secret'), sec)) return res.status(401).json({ status: 'unauthorized' });
  try {
    const event = (req.body?.event || req.body?.type || '').toString();
    const d = req.body?.data || {};
    const accountId = (d?.account?._id || d?.account?.id || d?._id || d?.id || d?.account || '').toString();
    if (!accountId) return res.json({ status: 'ignored' });

    const user = await User.findOne({ 'linkedBanks.accountId': accountId });
    const acct = user?.linkedBanks?.find((b) => b.accountId === accountId);
    if (!user || !acct) return res.json({ status: 'no-account' });

    if (/reauth/i.test(event)) {
      acct.needsReauth = true;
      await user.save();
    } else if (/update|sync|transaction|data\.?status|connected/i.test(event)) {
      acct.dirty = true;                                 // there is new data to pull
      if (monoConfigured() && syncDue(acct, planKey(user), false)) {
        try { await syncMonoAccount(user, acct); }       // pull now if due (else cron gets it)
        catch (e) { console.error('[mono/webhook sync]', e.response?.data || e.message); }
      }
      await user.save();
    }
    return res.json({ status: 'ok' });
  } catch (e) {
    console.error('[mono/webhook]', e.message);
    return res.status(200).json({ status: 'error' });   // 200 so Mono doesn't retry-storm
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
// Cashflow forecast: project the user's money forward from income, bills,
// subscriptions and average day-to-day spend. We can't see a live bank balance, so
// the starting point is what the user enters (?balance=) or, by default, what's left
// of this month's tracked income.
// --------------------------
app.get('/api/cashflow/forecast', auth, async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 7), 180);
    const userId = req.user._id;
    const [txns, bills, subs] = await Promise.all([
      Transaction.find({ userId }).select('date amount type').sort({ date: -1 }).limit(3000).lean(),
      RecurringBill.find({ userId, status: { $ne: 'paused' } }).lean(),
      Subscription.find({ userId, status: 'active' }).lean(),
    ]);

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const sumOf = (rows) => rows.reduce((s, t) => s + Math.abs(t.amount), 0);

    // Average daily spend over the last 90 days of expenses.
    const winStart = new Date(today); winStart.setDate(winStart.getDate() - 90);
    const dailyBurn = sumOf(txns.filter((t) => t.type === 'expense' && new Date(t.date) >= winStart)) / 90;

    // Monthly income: the stated figure, else the last 90 days' average. Pay day is
    // the most common day-of-month among income rows.
    const incomeTxns = txns.filter((t) => t.type === 'income');
    const monthlyIncome = req.user.monthlyIncome
      || Math.round(sumOf(incomeTxns.filter((t) => new Date(t.date) >= winStart)) / 3);
    let payDay = 28;
    if (incomeTxns.length) {
      const counts = {};
      incomeTxns.forEach((t) => { const d = new Date(t.date).getDate(); counts[d] = (counts[d] || 0) + 1; });
      payDay = Number(Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0]) || 28;
    }

    const entered = Number(req.query.balance);
    const hasEntered = req.query.balance !== undefined && req.query.balance !== '' && Number.isFinite(entered);
    const thisMonth = txns.filter((t) => new Date(t.date) >= monthStart);
    const leftThisMonth = sumOf(thisMonth.filter((t) => t.type === 'income')) - sumOf(thisMonth.filter((t) => t.type === 'expense'));
    const start = hasEntered ? entered : leftThisMonth;

    const subDay = (s) => s.renewalDay || (s.nextPayment ? new Date(s.nextPayment).getDate() : 1);
    const dayOutflow = (dom) => {
      let out = 0;
      for (const b of bills) if (b.frequency === 'monthly' && b.dueDate === dom) out += b.amount;
      for (const s of subs) if (s.frequency === 'monthly' && subDay(s) === dom) out += s.cost;
      return out;
    };

    let balance = start;
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

    // Safe to spend today = starting money minus committed bills and subscriptions
    // (not day-to-day spend) before the next income lands.
    let committed = 0;
    for (let i = 1; i < nextIncomeIdx && i <= days; i++) {
      const d = new Date(today); d.setDate(d.getDate() + i);
      committed += dayOutflow(d.getDate());
    }

    res.json({
      days,
      currentBalance: Math.round(start),
      startingFrom: hasEntered ? 'entered' : 'this_month',
      dailyBurn: Math.round(dailyBurn),
      monthlyIncome, payDay,
      safeToSpend: Math.max(0, Math.round(start - committed)),
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
// AI Assistant - natural-language Q&A over the user's own finances
// --------------------------
// Runs on Gemini (the shared llmConfig). Off until AI_ASSISTANT_ENABLED=true is set
// on the host, so turning on the key for parsing doesn't also launch the assistant.
// While off, the endpoint returns a friendly "coming soon" reply.
const aiConfigured = () => process.env.AI_ASSISTANT_ENABLED === 'true' && !!llmConfig();
const aiModel = () => process.env.AI_ASSISTANT_MODEL || (llmConfig() || {}).model || null;

const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

// Build a compact, structured snapshot of the user's finances for the model.
// We summarise rather than dump every row - keeps token cost down and avoids
// leaking more raw data than needed. NGN throughout.
const buildFinancialContext = async (user) => {
  const userId = user._id;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const since90 = new Date(today); since90.setDate(since90.getDate() - 90);
  const thisMonth = monthKey(today);

  const [txns, budgets, goals, bills, subs] = await Promise.all([
    Transaction.find({ userId }).select('date description amount category type').sort({ date: -1 }).limit(600).lean(),
    Budget.find({ userId, month: thisMonth }).lean(),
    Goal.find({ userId }).lean(),
    RecurringBill.find({ userId, status: { $ne: 'paused' } }).lean(),
    Subscription.find({ userId, status: 'active' }).lean(),
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
      `  - ${g.name}: ${naira(g.current)} of ${naira(g.target)} (${g.target ? Math.round((g.current / g.target) * 100) : 0}%), due ${new Date(g.deadline).toISOString().slice(0, 10)}`,
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
1. INSIGHTS & REPORTS - answer questions and produce summaries/reports from the user's financial snapshot (provided in their message). Examples: "where is my money going", "give me a spending report for this month", "am I on track with my budgets".
2. ACTIONS - actually create things in the app using the provided tools: log a transaction, set a budget, create a savings goal, add a subscription to track, or set up a recurring bill.

Rules:
- All amounts are in Nigerian Naira (₦). Format money with the ₦ symbol and thousands separators.
- For insights/reports, use ONLY the snapshot data. Never invent transactions, balances, or numbers. If the data doesn't cover the question, say so and suggest what to track.
- For actions, use the matching tool. If a required detail is missing or ambiguous (e.g. the amount, the goal's target, or a deadline), ASK a short clarifying question instead of guessing. Never fabricate values for an action.
- After performing an action, confirm briefly what you did (the tool result tells you if it succeeded).
- You can only CREATE records. You cannot move money, pay bills, contribute to goals, delete, or edit existing items - if asked, explain they can do that from the relevant screen.
- Format for a small chat panel: open with one short sentence that answers the question, then at most 4 short bullet points if more detail helps. Use **bold** only for key figures or names. No headings, tables, emoji or long paragraphs. Never list your own capabilities unless the user asks what you can do; for a greeting, reply in one friendly sentence and suggest one thing to ask.
- Give general budgeting/savings guidance, but no regulated investment, tax, or legal advice; suggest a professional for those. Be encouraging and non-judgmental.`;

// Tools the assistant can call. All are CREATE-only and scoped to the requesting
// user. Nothing here moves money, so actions are low-risk and reversible from the UI.
const AI_TOOLS = [
  {
    name: 'create_transaction',
    description: 'Log a new income or expense transaction for the user. Use when the user says they earned, received, spent, paid, or bought something.',
    parameters: {
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
    parameters: {
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
    parameters: {
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
    description: 'Add a recurring subscription to track (e.g. Netflix, DSTV, gym). Tracking only - it does not auto-pay.',
    parameters: {
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
    description: 'Set up a recurring bill reminder (e.g. rent, electricity) due on a day of the month. Reminder/tracking only - it does not auto-pay.',
    parameters: {
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
// The same tools in the chat-completions function-calling shape.
const AI_FUNCTIONS = AI_TOOLS.map((t) => ({ type: 'function', function: t }));

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
      if (type === 'expense') checkBudgetAlert(userId, txn.category, date.toISOString().slice(0, 7));
      return { ok: true, summary: `Logged ${type} of ${naira(amount)} - ${category} (${txn.description}).`, kind: 'transaction' };
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
      return { ok: true, summary: `Created goal "${name2}" - target ${naira(target)} by ${new Date(input.deadline).toISOString().slice(0, 10)}.`, kind: 'goal' };
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
      return { ok: true, summary: `Now tracking subscription "${name2}" - ${naira(cost)} ${input.frequency || 'monthly'}.`, kind: 'subscription' };
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
        category: input.category || 'Bills', nextDue, status: 'active',
      }).save();
      return { ok: true, summary: `Set up bill reminder "${name2}" - ${naira(amount)} due on day ${dueDate} each ${input.frequency === 'yearly' ? 'year' : 'month'}.`, kind: 'bill' };
    }

    return { ok: false, summary: `Unknown action: ${name}.` };
  } catch (e) {
    console.error('[executeAiTool]', name, e.message);
    return { ok: false, summary: 'That action failed to save. Please try again or do it from the relevant screen.' };
  }
};

// Which key-gated features are switched on, so clients can hide what isn't live.
// Feature switches the apps read at start-up. Key-gated ones turn on when their keys
// are set; the rest are plain flags, off unless set to 'true'. Shared Expenses is off:
// its screens are hidden, and the entries people made stay on their devices.
app.get('/api/features', auth, (req, res) => {
  res.json({
    assistant: aiConfigured(),
    bankLink: monoConfigured(),
    sharedExpenses: process.env.FEATURE_SHARED_EXPENSES === 'true',
  });
});

app.get('/api/ai/status', auth, async (req, res) => {
  res.json({ configured: aiConfigured(), model: aiConfigured() ? aiModel() : null, plan: req.user.plan || 'free' });
});

app.post('/api/ai/chat', aiLimiter, auth, async (req, res) => {
  try {
    const message = (req.body?.message || '').toString().trim();
    if (!message) return res.status(400).json({ message: 'Please enter a question.' });
    if (message.length > 2000) return res.status(400).json({ message: 'Message is too long (max 2000 characters).' });

    if (!aiConfigured()) {
      return res.json({
        configured: false,
        reply: "The AI assistant isn't switched on for this account yet - it's coming soon. In the meantime you can explore your Dashboard, Financial Health, and Cashflow for insights into your spending.",
      });
    }

    // Sanitise client-supplied history into a clean alternating turn list.
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
    const priorTurns = history
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.toString().slice(0, 4000) }));

    const context = await buildFinancialContext(req.user);

    const cfg = llmConfig();
    const messages = [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      ...priorTurns,
      {
        role: 'user',
        content: `Here is my current financial snapshot:\n\n${context}\n\n---\n\nMy question/request: ${message}`,
      },
    ];

    // Agentic loop: let the model call CREATE tools, execute them, feed results back,
    // and continue until it produces a final text answer. Capped so a misbehaving
    // turn can't loop forever.
    const actions = [];
    let reply = '';
    for (let step = 0; step < 6; step++) {
      const r = await fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: aiModel(), max_tokens: 1024, temperature: 0.3, messages, tools: AI_FUNCTIONS }),
      });
      if (!r.ok) { const err = new Error(`assistant HTTP ${r.status}`); err.status = r.status; throw err; }
      const msg = (await r.json())?.choices?.[0]?.message || {};
      if (typeof msg.content === 'string' && msg.content.trim()) reply = msg.content.trim();

      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (!calls.length) break;

      // Echo the assistant turn (with its tool calls), then answer each call.
      messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });
      for (const call of calls) {
        let input = {};
        try { input = JSON.parse(call.function?.arguments || '{}'); } catch { /* empty args */ }
        const result = await executeAiTool(call.function?.name, input, req.user);
        actions.push({ tool: call.function?.name, ok: result.ok, kind: result.kind, summary: result.summary });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.summary });
      }
    }

    res.json({
      configured: true,
      reply: reply || "Sorry, I couldn't generate a response. Please try rephrasing.",
      actions,
      // True if anything was created - the UI uses this to refresh data views.
      changed: actions.some((a) => a.ok),
    });
  } catch (e) {
    console.error('[ai/chat]', e.status || '', e.message);
    if (e.status === 429) return res.status(429).json({ message: 'The assistant is busy right now. Please try again in a moment.' });
    res.status(500).json({ message: 'The assistant ran into a problem. Please try again.' });
  }
});

// --------------------------
// AI counterparty -> purpose inference (spec 6.1): turn generic "Transfer" rows into
// real purposes (rent / savings / family / salary…). STAGED, keys-pending: the model
// only runs when the Gemini key is set; it PROPOSES, lib/purposeInference validates
// against a closed allow-list, and the user CONFIRMS before anything is written.
// Pro-gated (an AI feature, like the assistant / C6 / C1).
// --------------------------

// The generic-transfer groups worth asking about: deterministic, no model call, so
// the UI can show the work up front. `available` says whether inference is live.
// Tier-1 hint: the category the user has already taught for a counterparty (their
// own LearnedCategory rules). Returned as candidate.key -> category. Global consensus
// isn't consulted here: it already stamps categories at import time, so those rows
// aren't generic candidates any more.
async function purposeHints(userId, candidates) {
  const hints = new Map();
  const rules = await LearnedCategory.find({ userId }).lean();
  if (!rules.length) return hints;
  const learned = new Map(rules.map((r) => [r.key, r.category]));
  for (const c of candidates) {
    const k = deriveCategoryKey(c.counterparty);
    if (k && learned.has(k)) hints.set(c.key, learned.get(k));
  }
  return hints;
}

// Tier-2: send the residual (ambiguous) candidates to Gemini and return validated
// proposals tagged source:'ai'. A failure just means Tier-1's results stand.
async function tier2Propose(residual, cfg) {
  const prompt = purposeInf.buildInferencePrompt(residual, naira);
  const raw = await inferPurposesLLM(prompt, cfg);
  return purposeInf.validateProposals(raw, residual).map((p) => ({ ...p, source: 'ai' }));
}

// The generic-transfer groups worth asking about: deterministic, no model call. The
// feature ALWAYS works (Tier-1 is free/on-box); `booster` names the LLM tail provider
// when one is configured, else null.
app.get('/api/ai/purpose/candidates', auth, async (req, res) => {
  try {
    if (!hasFeature(req.user, 'ai-purpose')) return res.status(402).json(upgradeRequired('ai-purpose'));
    const txns = await Transaction.find({ userId: req.user._id, type: { $in: ['income', 'expense'] } })
      .select('description amount category type date').sort({ date: -1 }).limit(1000).lean();
    const candidates = purposeInf.buildCandidates(txns);
    const cfg = llmConfig();
    res.json({
      available: true,                    // Tier-1 always available
      booster: cfg ? cfg.name : null,     // LLM tail, if configured
      candidates: candidates.map((c) => ({ counterparty: c.counterparty, count: c.count, avgAmount: c.avgAmount, totalAmount: c.totalAmount, direction: c.direction, cadence: c.cadence, txnIds: c.txnIds })),
    });
  } catch (e) { console.error('[ai/purpose/candidates]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Hybrid inference (spec 6.1). Tier-1: free/on-box deterministic classifier (learned-
// category hints + keyword rules + cadence/amount heuristics). Tier-2 (optional): only
// the ambiguous tail Tier-1 couldn't label goes to the configured LLM provider. Both
// tiers are validated against the closed allow-list; the user still confirms. Only
// redacted names/amounts/cadence ever leave the server (no account numbers).
app.post('/api/ai/purpose/infer', auth, async (req, res) => {
  try {
    if (!hasFeature(req.user, 'ai-purpose')) return res.status(402).json(upgradeRequired('ai-purpose'));
    const txns = await Transaction.find({ userId: req.user._id, type: { $in: ['income', 'expense'] } })
      .select('description amount category type date').sort({ date: -1 }).limit(1000).lean();
    const candidates = purposeInf.buildCandidates(txns);
    if (!candidates.length) return res.json({ available: true, proposals: [], tiers: { rules: 0, ai: 0 } });

    // Tier-1: deterministic, free.
    const hints = await purposeHints(req.user._id, candidates);
    const proposals = [];
    const residual = [];
    for (const c of candidates) {
      const p = proposalFrom(c, classifyPurpose(c, hints.get(c.key) || null));
      if (p) proposals.push(p); else residual.push(c);
    }
    const rulesCount = proposals.length;

    // Tier-2: the ambiguous tail only, if an LLM provider is configured + keyed.
    let aiCount = 0;
    const cfg = llmConfig();
    if (residual.length && cfg) {
      try {
        const aiProps = await tier2Propose(residual, cfg);
        aiCount = aiProps.length;
        proposals.push(...aiProps);
      } catch (e) { console.error('[ai/purpose/tier2]', e.status || '', e.message); } // Tier-1 stands
    }

    res.json({ available: true, proposals, tiers: { rules: rulesCount, ai: aiCount } });
  } catch (e) {
    console.error('[ai/purpose/infer]', e.message);
    res.status(500).json({ message: 'Could not analyse those transactions.' });
  }
});

// Superadmin diagnostic: one-shot LIVE ping of the configured Tier-2 LLM provider, so
// you can confirm the key actually works (not just that it's set). Not on any hot path.
app.get('/api/admin/ai/ping', auth, superAdminAuth, async (req, res) => {
  const cfg = llmConfig();
  if (!cfg) return res.json({ configured: false, provider: null, message: 'No GEMINI_API_KEY set, running deterministic-only.' });
  const started = Date.now();
  try {
    const r = await fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, max_tokens: 5, temperature: 0, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] }),
    });
    const body = await r.text();
    if (!r.ok) return res.json({ configured: true, provider: cfg.name, model: cfg.model, ok: false, status: r.status });
    let sample = ''; try { sample = JSON.parse(body)?.choices?.[0]?.message?.content || ''; } catch { /* noop */ }
    return res.json({ configured: true, provider: cfg.name, model: cfg.model, ok: true, ms: Date.now() - started, sample: sample.slice(0, 60) });
  } catch {
    return res.json({ configured: true, provider: cfg.name, model: cfg.model, ok: false });
  }
});

// Apply a confirmed proposal: set the category on the named transactions and LEARN it
// so future transfers from the same counterparty auto-apply. Validates the category
// is one the allow-list produces (a user can't push arbitrary categories through).
app.post('/api/ai/purpose/apply', auth, async (req, res) => {
  try {
    if (!hasFeature(req.user, 'ai-purpose')) return res.status(402).json(upgradeRequired('ai-purpose'));
    const txnIds = Array.isArray(req.body?.txnIds) ? req.body.txnIds.filter((x) => mongoose.isValidObjectId(x)) : [];
    const category = (req.body?.category || '').toString().trim();
    const allowed = new Set(purposeInf.PURPOSES.map((p) => p.category).filter(Boolean));
    if (!txnIds.length || !allowed.has(category)) return res.status(400).json({ message: 'Nothing to apply.' });

    const result = await Transaction.updateMany(
      { _id: { $in: txnIds }, userId: req.user._id }, { $set: { category } });
    // Learn description -> category from the affected rows so it sticks next time.
    const affected = await Transaction.find({ _id: { $in: txnIds }, userId: req.user._id }).select('description category').lean();
    try { await learnCategories(req.user._id, affected); } catch { /* non-fatal */ }
    res.json({ ok: true, updated: result.modifiedCount ?? result.nModified ?? 0 });
  } catch (e) { console.error('[ai/purpose/apply]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// --------------------------
// Reminders - "needs your attention" items computed from the user's own data.
// Feeds the mobile Home attention card and mirrors actionable items into the
// notification bell (deduped per period, same idempotent pattern as budget
// alerts). Read-only from the client's perspective; nothing here moves money.
// --------------------------
app.get('/api/reminders', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const [bills, subs, lastImport, everImported, lastTxn] = await Promise.all([
      RecurringBill.find({ userId, status: 'active' }).lean(),
      Subscription.find({ userId, status: 'active' }).lean(),
      Transaction.findOne({ userId, source: 'import' }).sort({ importedAt: -1 }).lean(),
      Transaction.exists({ userId, source: 'import' }),
      Transaction.findOne({ userId }).sort({ createdAt: -1 }).lean(),
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

    // 2) New-month statement upload - only nag users who have imported before.
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

    // 2b) Quick-log nudge - nothing added in a while. Points at the fast SMS/email
    // paste import (not just the monthly statement upload). Suppressed when the
    // monthly statement nudge is already showing so we don't double-nag.
    const hasStatementNudge = reminders.some((r) => r.id === 'statement');
    if (!hasStatementNudge && lastTxn?.createdAt) {
      const daysQuiet = Math.floor((today - new Date(lastTxn.createdAt)) / 86400000);
      if (daysQuiet >= 14) {
        reminders.push({
          id: 'log-txns', type: 'import', severity: 'medium', icon: 'chatbox-ellipses',
          title: 'Add your recent transactions',
          message: 'Paste your latest bank SMS or email alerts to keep your spending up to date.',
          action: { label: 'Import alerts', route: '/sms-import' },
        });
      }
    }

    // 3) Action Center: things we need the user to decide.
    try {
      const pending = (await actionCenterItems(userId)).length;
      if (pending > 0) {
        reminders.push({
          id: 'actions', type: 'review', severity: 'medium', icon: 'list',
          title: `${pending} thing${pending === 1 ? '' : 's'} to review`,
          message: 'Transactions we weren’t sure about, possible duplicates and unclear names.',
          action: { label: 'Open Action Center', route: '/actions' },
        });
      }
    } catch (e) { console.error('[reminders/actions]', e.message); }

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
      const period = r.id === 'statement' ? monthKey(today)
        : r.id === 'log-txns' ? `w${Math.floor(today.getTime() / 604800000)}`
        : today.toISOString().slice(0, 10);
      const dedupeKey = `reminder:${r.id}:${period}`;
      // Tapping the bell item should go to the reminder's real destination, not the
      // dedup string. Match legacy rows (link === dedupeKey) too so we don't double-post.
      const navLink = r.action?.route || '/';
      Notification.findOne({ userId, $or: [{ dedupeKey }, { link: dedupeKey }] })
        .then((exists) => { if (!exists) createNotification(userId, { type: 'info', title: r.title, message: r.message, link: navLink, dedupeKey }); })
        .catch(() => {});
    }

    res.json({ reminders });
  } catch (e) {
    console.error('[reminders]', e.message);
    res.status(500).json({ message: 'Server error' });
  }
});

// 404 handler
// (404 catch-all moved below, after the categorizer routes, so it doesn't shadow them.)

// Re-run the categorizer (your own learned rules → shared consensus) over rows
// still sitting in 'Other', so existing transactions benefit as the shared model
// grows. Free - no external calls.
app.post('/api/transactions/recategorize', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const others = await Transaction.find({ userId: uid, category: { $in: ['Other', 'Other Income'] } })
      .select('_id description category type').lean();
    if (!others.length) return res.json({ updated: 0, remaining: 0 });
    let mapped = await applyLearnedCategories(uid, others);
    mapped = await applyGlobalCategories(mapped);
    const isOther = (c) => !c || c === 'Other' || c === 'Other Income';
    const ops = [];
    for (const m of mapped) {
      if (!isOther(m.category)) {
        ops.push({ updateOne: { filter: { _id: m._id, userId: uid }, update: { $set: { category: m.category } } } });
      }
    }
    if (ops.length) await Transaction.bulkWrite(ops, { ordered: false });
    res.json({ updated: ops.length, remaining: others.length - ops.length });
  } catch (e) { console.error('[recategorize]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// List the medium-confidence (55-79) transfer pairs that need the user to confirm
// ("Was this a transfer to your own account?"). Same detection as reconcileTransfers
// but returns the `ask` pairs shaped for the confirm card instead of just a count.
app.get('/api/transactions/pending-transfers', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const [txns, user, routes] = await Promise.all([
      Transaction.find({ userId: uid, type: { $in: ['income', 'expense'] } })
        .select('type amount date bank description').lean(),
      User.findById(uid).select('name').lean(),
      TransferRoute.find({ userId: uid }).select('routeKey').lean(),
    ]);
    if (txns.length < 2) return res.json({ pairs: [] });
    const routeKeys = new Set(routes.map((r) => r.routeKey));
    const { ask } = detectTransfers(txns, { userName: user?.name || '', routeKeys });
    const side = (t) => ({
      id: String(t._id), amount: Math.abs(t.amount), date: t.date,
      bank: t.bank || '', description: t.description || '',
    });
    const pairs = ask.map((p) => ({
      debit: side(p.debit), credit: side(p.credit),
      score: p.score, fee: p.fee || 0,
    }));
    res.json({ pairs });
  } catch (e) { console.error('[pending-transfers]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Confirm a self-transfer route ("Yes, that was my own account") + optionally
// reclassify a specific pending pair. Remembers the route so future matches on the
// same two banks auto-classify.
app.post('/api/transactions/confirm-transfer', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const { debitId, creditId } = req.body || {};
    if (!debitId || !creditId) return res.status(400).json({ message: 'debitId and creditId are required' });
    const [d, c] = await Promise.all([
      Transaction.findOne({ _id: debitId, userId: uid }),
      Transaction.findOne({ _id: creditId, userId: uid }),
    ]);
    if (!d || !c) return res.status(404).json({ message: 'Transaction not found' });
    const pairId = new mongoose.Types.ObjectId().toString();
    d.type = 'internal_transfer'; d.transferPairId = pairId;
    c.type = 'internal_transfer'; c.transferPairId = pairId;
    await Promise.all([d.save(), c.save()]);
    const fee = Math.max(0, Math.abs(d.amount) - Math.abs(c.amount));
    if (fee > 0) {
      await new Transaction({ userId: uid, date: d.date, amount: -Math.abs(fee), description: 'Transfer fee', category: 'Bank Charges', type: 'expense', source: 'import', bank: d.bank || '', transferPairId: pairId }).save();
    }
    // Remember this route so future matches on these two banks auto-classify.
    try { await TransferRoute.updateOne({ userId: uid, routeKey: routeKey(d.bank, c.bank) }, { $setOnInsert: { userId: uid, routeKey: routeKey(d.bank, c.bank) } }, { upsert: true }); } catch { /* dup ok */ }
    res.json({ ok: true, transferPairId: pairId, fee });
  } catch (e) { console.error('[confirm-transfer]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Manually mark ONE transaction as a transfer between the user's own accounts
// ("Move between my accounts"): excludes it from spending/income math. This is the
// reliable fallback for self-transfers auto-detection misses: a cross-bank move where
// only one side was imported, or a pair that scored too low (e.g. done across days
// with no bank name in the narration). We still TRY to pair the opposite side when
// it's present, so both sides drop out together; otherwise the single row is excluded
// on its own. The amount sign is preserved so "Undo" can restore the direction.
app.post('/api/transactions/:id/mark-transfer', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const txn = await Transaction.findOne({ _id: req.params.id, userId: uid });
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    if (txn.type === 'internal_transfer') return res.json({ ok: true, already: true, paired: !!txn.transferPairId });

    const isDebit = txn.type === 'expense' || txn.amount < 0;
    const wantType = isDebit ? 'income' : 'expense';
    const winMs = 72 * 3600000;
    const from = new Date(new Date(txn.date).getTime() - winMs);
    const to = new Date(new Date(txn.date).getTime() + winMs);
    // Candidate opposite sides not already tied to a transfer.
    const cands = await Transaction.find({
      userId: uid, type: wantType,
      date: { $gte: from, $lte: to },
      $or: [{ transferPairId: { $exists: false } }, { transferPairId: '' }, { transferPairId: null }],
    }).select('type amount date bank description').lean();

    const user = await User.findById(uid).select('name').lean();
    const self = { type: txn.type === 'expense' ? 'expense' : (txn.amount < 0 ? 'expense' : 'income'), amount: txn.amount, date: txn.date, bank: txn.bank, description: txn.description };
    // Score each candidate as a (debit, credit) pair and keep the best plausible one.
    let best = null, bestScore = 0;
    for (const c of cands) {
      if (String(c._id) === String(txn._id)) continue;
      const debit = isDebit ? self : c;
      const credit = isDebit ? c : self;
      const s = scorePair(debit, credit, { userName: user?.name || '' });
      if (s > bestScore) { bestScore = s; best = c; }
    }

    const pairId = new mongoose.Types.ObjectId().toString();
    txn.type = 'internal_transfer'; txn.transferPairId = pairId; // sign preserved
    await txn.save();

    let paired = false, fee = 0;
    if (best && bestScore >= 40) { // amount matches at least (scorePair floors amount at 30/40)
      await Transaction.updateOne({ _id: best._id, userId: uid }, { $set: { type: 'internal_transfer', transferPairId: pairId } });
      paired = true;
      const da = isDebit ? Math.abs(txn.amount) : Math.abs(best.amount);
      const ca = isDebit ? Math.abs(best.amount) : Math.abs(txn.amount);
      fee = Math.max(0, da - ca);
      if (fee > 0) {
        const feeBank = isDebit ? (txn.bank || '') : (best.bank || '');
        await new Transaction({ userId: uid, date: txn.date, amount: -Math.abs(fee), description: 'Transfer fee', category: 'Bank Charges', type: 'expense', source: 'import', bank: feeBank, transferPairId: pairId }).save();
      }
      try {
        const rk = routeKey(isDebit ? txn.bank : best.bank, isDebit ? best.bank : txn.bank);
        await TransferRoute.updateOne({ userId: uid, routeKey: rk }, { $setOnInsert: { userId: uid, routeKey: rk } }, { upsert: true });
      } catch { /* dup ok */ }
    }
    res.json({ ok: true, paired, fee, transferPairId: pairId });
  } catch (e) { console.error('[mark-transfer]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Undo a manual/auto transfer classification for a single transaction. Restores the
// whole pair (and drops any generated fee row) when it was paired; otherwise just the
// one row, recovering its direction from the preserved amount sign.
app.post('/api/transactions/:id/unmark-transfer', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const txn = await Transaction.findOne({ _id: req.params.id, userId: uid });
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    const restore = async (r) => { r.type = r.amount >= 0 ? 'income' : 'expense'; r.transferPairId = ''; await r.save(); };
    if (txn.transferPairId) {
      const rows = await Transaction.find({ userId: uid, transferPairId: txn.transferPairId });
      for (const r of rows) {
        if (r.description === 'Transfer fee' && r.category === 'Bank Charges') { await r.deleteOne(); continue; }
        await restore(r);
      }
      return res.json({ ok: true, restored: rows.length });
    }
    await restore(txn);
    res.json({ ok: true, restored: 1 });
  } catch (e) { console.error('[unmark-transfer]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// ── Cash tracking (spec C4) ─────────────────────────────────────────────────────
// Cash withdrawals are excluded from spending (the money left the bank but we don't
// know where it went). This lets the user break a withdrawal down into what the cash
// was actually spent on, turning the biggest blind spot in Nigerian finance into real,
// categorised spending: without double-counting (the withdrawal stays excluded).
app.get('/api/cash/pending', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const rows = await Transaction.find({ userId: uid, type: 'cash_withdrawal', cashAllocated: { $ne: true } })
      .select('amount date description bank').sort({ date: -1 }).limit(50).lean();
    res.json(rows.map((r) => ({ ...r, amount: Math.abs(r.amount) })));
  } catch (e) { console.error('[cash/pending]', e.message); res.status(500).json({ message: 'Server error' }); }
});

app.post('/api/transactions/:id/allocate-cash', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const txn = await Transaction.findOne({ _id: req.params.id, userId: uid });
    if (!txn) return res.status(404).json({ message: 'Not found' });
    if (txn.type !== 'cash_withdrawal') return res.status(400).json({ message: 'Not a cash withdrawal' });
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const clean = items
      .map((i) => ({ category: (i.category || 'Other').toString().trim(), amount: Math.abs(Number(i.amount)) || 0, description: (i.description || '').toString().trim() }))
      .filter((i) => i.amount > 0);
    if (!clean.length) return res.status(400).json({ message: 'Add at least one cash expense.' });
    const total = clean.reduce((s, i) => s + i.amount, 0);
    const cashAmount = Math.abs(txn.amount);
    if (total > cashAmount + 0.5) return res.status(400).json({ message: `That's more than the ₦${cashAmount.toLocaleString()} you withdrew.` });

    const docs = clean.map((i) => new Transaction({
      userId: uid, date: txn.date, description: i.description || `Cash · ${i.category}`,
      amount: -i.amount, category: i.category, type: 'expense',
      source: 'manual', bank: txn.bank || '', cashParentId: String(txn._id),
    }));
    const inserted = await Transaction.insertMany(docs, { ordered: false });
    txn.cashAllocated = true;
    await txn.save();
    await learnCategories(uid, clean); // teach description→category from the allocation
    res.json({ ok: true, created: inserted.length, allocated: total, remaining: Math.round((cashAmount - total) * 100) / 100 });
  } catch (e) { console.error('[allocate-cash]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// "Don't track this one": mark a withdrawal handled so it stops prompting, without
// creating any spending rows.
app.post('/api/transactions/:id/skip-cash', auth, async (req, res) => {
  try {
    const txn = await Transaction.findOne({ _id: req.params.id, userId: req.user._id });
    if (!txn) return res.status(404).json({ message: 'Not found' });
    txn.cashAllocated = true;
    await txn.save();
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ message: 'Server error' }); }
});

// Reclassify existing income/expense rows into their non-discretionary KIND
// (cash-out / loan / repayment / reversal / failed) so historical numbers get the
// same exclusions new imports do. Safe to re-run; only moves rows OUT of the
// income/expense buckets, never back in.
app.post('/api/transactions/reclassify-kinds', auth, async (req, res) => {
  try {
    const uid = req.user._id;
    const txns = await Transaction.find({ userId: uid, type: { $in: ['income', 'expense'] } })
      .select('type description category').lean();
    const ops = [];
    for (const t of txns) {
      const kind = classifyKind({ type: t.type, description: t.description, category: t.category });
      if (kind) ops.push({ updateOne: { filter: { _id: t._id, userId: uid }, update: { $set: { type: kind } } } });
    }
    if (ops.length) { try { await Transaction.bulkWrite(ops, { ordered: false }); } catch (e) { console.error('[reclassify-kinds]', e.message); } }

    // Pair each reversal with the original debit it cancels, so both net to zero.
    const [reversals, debits] = await Promise.all([
      Transaction.find({ userId: uid, type: 'reversal' }).select('amount date bank').lean(),
      Transaction.find({ userId: uid, type: 'expense' }).select('amount date bank').lean(),
    ]);
    const pairs = pairReversals(reversals, debits);
    if (pairs.length) {
      const revOps = pairs.map((p) => ({ updateOne: {
        filter: { _id: p.debitId, userId: uid },
        update: { $set: { type: 'reversal', reversalPairId: p.reversalId } },
      } }));
      try { await Transaction.bulkWrite(revOps, { ordered: false }); } catch (e) { console.error('[reclassify-reversals]', e.message); }
    }
    res.json({ reclassified: ops.length, reversalsPaired: pairs.length });
  } catch (e) { console.error('[reclassify-kinds]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Verified income & financial report (spec C6). Aggregates the user's own data into
// a professional summary for visa / rent / loan / japa applications. `?format=html`
// returns a printable document (the mobile app prints it to PDF; web prints it
// directly); otherwise JSON for an in-app preview. `months` = 1..24 (default 6).
app.get('/api/reports/income-summary', auth, async (req, res) => {
  try {
    const months = Math.max(1, Math.min(24, parseInt(req.query.months, 10) || 6));
    const [txns, user] = await Promise.all([
      Transaction.find({ userId: req.user._id }).select('type amount date description category').lean(),
      User.findById(req.user._id).select('name').lean(),
    ]);
    const summary = buildIncomeSummary(txns, {
      months,
      userName: user?.name || '',
    });
    if ((req.query.format || '').toLowerCase() === 'html') {
      // The shareable document is the paid deliverable (C6). The JSON preview above
      // is free, so free users still see the value before the paywall.
      if (!hasFeature(req.user, 'report')) return res.status(402).json(upgradeRequired('report'));
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(renderIncomeReportHTML(summary, { brand: 'Automonie' }));
    }
    return res.json({ ...summary, isPro: hasFeature(req.user, 'report') });
  } catch (e) { console.error('[income-summary]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Record a daily check-in and return the current streak. Server-side so the
// streak survives a reinstall / new device. Accepts optional `days` (local
// history) to merge, so a first sync after reinstall restores the run.
// Clarity streak with forgiveness (Gen-Z spec): consecutive check-in days ending
// today, but a single missed day is bridged by a free "freeze": at most one per
// calendar month. Today itself is never frozen (no live streak until you check in).
// Returns { streak, frozen: [YYYY-MM-DD bridged] }. Pure + deterministic from the
// day set, so client and server agree.
function streakWithFreeze(days, today = new Date()) {
  const set = new Set(days);
  const todayKey = today.toISOString().slice(0, 10);
  const usedMonths = new Set();
  const confirmed = [];   // freezes that actually bridged to an earlier check-in
  let pending = [];       // freezes not yet known to bridge anything
  let streak = 0;
  const d = new Date(today);
  for (let i = 0; i < 800; i++) {
    const key = d.toISOString().slice(0, 10);
    if (set.has(key)) {
      streak += 1;
      if (pending.length) { confirmed.push(...pending); pending = []; } // the gap(s) bridged to here
    } else if (key !== todayKey && !usedMonths.has(key.slice(0, 7))) {
      usedMonths.add(key.slice(0, 7)); pending.push(key);               // tentative bridge
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  // Trailing pending freezes (before the earliest check-in) bridged nothing: drop them.
  return { streak, frozen: confirmed };
}

app.post('/api/checkin', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('checkinDays');
    if (!user) return res.status(404).json({ message: 'Not found' });
    const set = new Set(user.checkinDays || []);
    set.add(new Date().toISOString().slice(0, 10));
    if (Array.isArray(req.body?.days)) {
      for (const d of req.body.days) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
    }
    user.checkinDays = [...set].sort().slice(-400);
    await user.save();
    const { streak, frozen } = streakWithFreeze(user.checkinDays);
    const thisMonth = new Date().toISOString().slice(0, 7);
    res.json({ streak, days: user.checkinDays, frozen, freezeUsedThisMonth: frozen.some((d) => d.startsWith(thisMonth)) });
  } catch (e) { console.error('[checkin]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// One-time (superadmin): seed the shared consensus from every existing per-user
// correction, so the global pool starts warm instead of empty.
app.post('/api/admin/backfill-global-categories', auth, superAdminAuth, async (req, res) => {
  try {
    const all = await LearnedCategory.find({}).select('key category').lean();
    const tally = new Map(); // key -> Map(category -> votes)
    for (const r of all) {
      if (!globalEligible(r.category)) continue;
      if (!tally.has(r.key)) tally.set(r.key, new Map());
      const m = tally.get(r.key); m.set(r.category, (m.get(r.category) || 0) + 1);
    }
    const ops = [];
    for (const [key, m] of tally) {
      const counts = {}; let total = 0;
      for (const [cat, n] of m) { counts[catSlug(cat)] = n; total += n; }
      ops.push({ updateOne: { filter: { key }, update: { $set: { counts, total, updatedAt: new Date() } }, upsert: true } });
    }
    if (ops.length) await GlobalCategory.bulkWrite(ops, { ordered: false });
    res.json({ seededKeys: ops.length, fromCorrections: all.length });
  } catch (e) { console.error('[backfill-global]', e.message); res.status(500).json({ message: 'Server error' }); }
});

// Unknown routes → 404 (must stay after every real route).
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
  // Never log the full connection string: in production it carries the DB password.
  const dbHost = (process.env.MONGODB_URI || 'mongodb://localhost:27017').replace(/\/\/[^@/]*@/, '//***@').split('?')[0];
  console.log(`Server running on port ${PORT} (db: ${dbHost})`);
});