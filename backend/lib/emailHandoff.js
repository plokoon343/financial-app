// Round 10 Part F1: "finish on your computer". The phone creates a one-time link that
// opens the email setup page on a computer, so nobody sets up Gmail forwarding on a phone.
//
// Token rules: valid 24 hours, redeemable exactly once, tied to one user. Only a hash is
// stored. Redeeming trades the token for a short page session (a second random key), so
// the page can keep updating live without the token being reusable: a second visit to
// the same link is refused. The page session is also tied to the one user and ends
// 2 hours after the link was opened (or at the token's own expiry, whichever is first).

const crypto = require('crypto');

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_LINKS_PER_HOUR = 6;

const hash = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex');
const newKey = () => crypto.randomBytes(24).toString('base64url');
// Tokens are base64url, 32 chars. Anything else is refused before it touches the database.
const looksLikeKey = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{32}$/.test(s);

function defineModel(mongoose) {
  if (mongoose.models.EmailHandoff) return mongoose.models.EmailHandoff;
  const schema = new mongoose.Schema({
    userId:      { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    tokenHash:   { type: String, required: true, unique: true },
    createdAt:   { type: Date, default: Date.now },
    expiresAt:   { type: Date, required: true },
    openedAt:    { type: Date, default: null },
    sessionHash: { type: String, default: null, index: true, sparse: true },
    sessionExpiresAt: { type: Date, default: null },
  });
  schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });  // rows clean themselves up
  return mongoose.model('EmailHandoff', schema);
}

// Create a link for one user. Earlier links stay valid until they expire or are used, so
// the QR on screen keeps working after "Email me the link". Throws { code: 'rate' } past the hourly cap.
async function createHandoff(Model, userId, now = new Date()) {
  const recent = await Model.countDocuments({ userId, createdAt: { $gt: new Date(now.getTime() - 3600000) } });
  if (recent >= MAX_LINKS_PER_HOUR) { const e = new Error('Too many links'); e.code = 'rate'; throw e; }
  const token = newKey();
  const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS);
  await Model.create({ userId, tokenHash: hash(token), createdAt: now, expiresAt });
  return { token, expiresAt };
}

// Atomic: one update that only matches an unopened, unexpired token. Two phones or two
// tabs racing cannot both win.
async function redeem(Model, token, now = new Date()) {
  if (!looksLikeKey(token)) return { ok: false, reason: 'invalid' };
  const tokenHash = hash(token);
  const sessionKey = newKey();
  const doc = await Model.findOneAndUpdate(
    { tokenHash, openedAt: null, expiresAt: { $gt: now } },
    { $set: { openedAt: now, sessionHash: hash(sessionKey), sessionExpiresAt: null } },
    { new: true },
  );
  if (!doc) {
    const existing = await Model.findOne({ tokenHash });
    if (!existing) return { ok: false, reason: 'invalid' };
    return { ok: false, reason: existing.openedAt ? 'used' : 'expired' };
  }
  const sessionExpiresAt = new Date(Math.min(doc.expiresAt.getTime(), now.getTime() + SESSION_TTL_MS));
  await Model.updateOne({ _id: doc._id }, { $set: { sessionExpiresAt } });
  return { ok: true, userId: doc.userId, sessionKey, sessionExpiresAt };
}

// The page's live-update key -> the one user it belongs to, or null.
async function userForSession(Model, sessionKey, now = new Date()) {
  if (!looksLikeKey(sessionKey)) return null;
  const doc = await Model.findOne({ sessionHash: hash(sessionKey), sessionExpiresAt: { $gt: now } });
  return doc ? doc.userId : null;
}

// The three ticks, the same on the phone and the web page. Gmail "confirmed" is the
// user saying they entered the code (or a first bank email arriving, which proves it).
function ticksFor({ opened, user }) {
  const firstBankEmail = !!(user && user.inboundEmailLastAt);
  return {
    linkOpened: !!opened,
    gmailConfirmed: !!(user && user.gmailConfirmedAt) || firstBankEmail,
    firstBankEmail,
  };
}

// Everything the setup page may show, built from the one user's own record. Nothing
// about any other user can enter this function.
function pageView({ user, ticks, address, active, filter }) {
  const hasCode = !!(user.gmailVerifyCode || user.gmailVerifyLink);
  return {
    address,
    active,
    ticks,
    gmailVerification: hasCode ? { code: user.gmailVerifyCode || '', link: user.gmailVerifyLink || '' } : null,
    filter: { filter: filter.filter, count: filter.addresses.length, missingBanks: filter.missingBanks },
  };
}

module.exports = { TOKEN_TTL_MS, SESSION_TTL_MS, MAX_LINKS_PER_HOUR, hash, newKey, looksLikeKey, defineModel, createHandoff, redeem, userForSession, ticksFor, pageView };
