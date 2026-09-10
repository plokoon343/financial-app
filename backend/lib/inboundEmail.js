// Inbound email helpers (spec B1: email forwarding). Pure + dependency-free so they
// can be unit-tested; server.js wires them to the provider webhook and the parser.
//
// Flow: user forwards bank-alert emails to <token>@in.automonie.com → the inbound
// provider (Mailgun/Postmark/SES) POSTs them to our webhook → we find the user by
// token, check the sender is a known bank, reduce the email to plain text, and run
// it through the same alert parser as SMS.

const crypto = require('crypto');

// A high-entropy, non-sequential token for the user's inbound address. 72 bits of
// randomness so addresses can't be guessed and one user can't inject into another.
function genToken() {
  return 'a' + crypto.randomBytes(9).toString('hex'); // 'a' + 18 hex = starts alpha
}

// Known bank / fintech alert domains. Only mail FROM these is accepted; everything
// else is dropped silently (spec B1). Matches the domain OR any subdomain of it, so
// "alerts.gtbank.com" passes for "gtbank.com". Extendable via env at the call site.
const BANK_EMAIL_DOMAINS = [
  'gtbank.com', 'gtworld.com', 'accessbankplc.com', 'access-bank.com', 'zenithbank.com',
  'firstbanknigeria.com', 'ubagroup.com', 'fcmb.com', 'fidelitybank.ng', 'stanbicibtc.com',
  'ecobank.com', 'unionbankng.com', 'sterling.ng', 'sterlingbankng.com', 'wemabank.com',
  'alat.ng', 'polarisbanklimited.com', 'keystonebankng.com', 'providusbank.com',
  'jaizbankplc.com', 'unitybankng.com', 'globusbank.com', 'premiumtrustbank.com',
  'opayweb.com', 'opay-inc.com', 'palmpay.com', 'palmpay-inc.com', 'moniepoint.com',
  'kuda.com', 'vbank.ng', 'vfdgroup.com', 'carbon.ng', 'getcarbon.co', 'paystack.com',
];

const lc = (s) => (s || '').toString().toLowerCase().trim();

// Pull the bare email address out of "Name <addr@x.com>" or "addr@x.com".
function emailAddress(from) {
  const s = lc(from);
  const m = s.match(/<([^>]+)>/);
  const addr = (m ? m[1] : s).trim();
  return addr.includes('@') ? addr : '';
}

function senderDomain(from) {
  const addr = emailAddress(from);
  const at = addr.lastIndexOf('@');
  return at === -1 ? '' : addr.slice(at + 1);
}

// Is the sender a known bank? domain === bank OR endsWith ".bank".
function isAllowedSender(from, extra = []) {
  const dom = senderDomain(from);
  if (!dom) return false;
  const list = BANK_EMAIL_DOMAINS.concat(extra.map(lc));
  return list.some((b) => dom === b || dom.endsWith('.' + b));
}

// Extract our per-user token from the recipient address, tolerating plus-addressing
// and any of the To/Cc list. Returns the token or ''.
function extractToken(recipient, inboundDomain = 'in.automonie.com') {
  const dom = lc(inboundDomain);
  const candidates = (recipient || '').toString().split(/[,;]/);
  for (const c of candidates) {
    const addr = emailAddress(c);
    const at = addr.lastIndexOf('@');
    if (at === -1) continue;
    if (addr.slice(at + 1) !== dom) continue;
    const local = addr.slice(0, at).split('+')[0]; // strip plus-addressing
    if (/^[a-z0-9]+$/.test(local)) return local;
  }
  return '';
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

// Reduce an HTML email body to readable plain text: drop scripts/styles, turn block
// boundaries into newlines, strip tags, decode the common entities.
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return ' '; } })
    .replace(/&[a-z#0-9]+;/gi, (e) => (ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .trim();
}

// Cut off a quoted reply / forwarded-history tail so we parse only the new alert.
function stripQuotedReply(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^>/.test(line)) break;
    if (/^-{2,}\s*(original message|forwarded message)\s*-{2,}/i.test(line)) break;
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^(From|Sent|To|Subject):\s/i.test(line) && out.length > 2) break;
    out.push(line);
  }
  return out.join('\n').trim();
}

// Cleaned plain-text body only (no subject): prefer text, fall back to HTML, quoted
// tail stripped. Used both for single-alert parsing (with the subject prepended) and
// as the input to the digest splitter.
function emailBodyText({ text = '', html = '' } = {}) {
  const body = text && text.trim() ? text : htmlToText(html);
  return stripQuotedReply(body);
}

// Best plain-text body from a provider payload (prefer text, fall back to HTML),
// with the quoted tail stripped. Includes the subject — bank alerts often put the
// amount/direction in the subject line.
function emailToText({ subject = '', text = '', html = '' } = {}) {
  return [(subject || '').trim(), emailBodyText({ text, html })].filter(Boolean).join('\n').trim();
}

// ── Digest emails (spec 3.6) ──
// Some banks send one email covering several transactions (a daily/weekly summary or
// a statement table). Split such a body into one segment per transaction so each is
// parsed and saved individually. Conservative: a single-transaction alert (even one
// that also quotes a balance) returns exactly one segment, so this never over-splits.
const MONEY_ANY = /(?:ngn|₦)\s?\d[\d,]*(?:\.\d{1,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\b\d+\.\d{2}\b/i;
const DATE_ANY = /\b\d{1,2}[\/-][A-Za-z0-9]{2,4}[\/-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const DIRECTION_ANY = /\b(debit|credit|debited|credited|dr|cr|withdrawn|withdrawal|deposit|received|sent|paid|purchase|pos|transfer|trf)\b/i;

function splitEmailAlerts(bodyText) {
  const text = (bodyText || '').trim();
  if (!text) return [];
  // 1) Blank-line blocks — each block that carries money AND a direction/date cue is
  //    its own transaction (banks that stack full alert paragraphs in one mail).
  const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  const richBlocks = blocks.filter((b) => MONEY_ANY.test(b) && (DIRECTION_ANY.test(b) || DATE_ANY.test(b)));
  if (richBlocks.length >= 2) return richBlocks;
  // 2) Table rows — a statement/digest puts one transaction per line. Count lines that
  //    have money AND a date or direction; if two or more, each such line is a row.
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const txnLines = lines.filter((l) => MONEY_ANY.test(l) && (DATE_ANY.test(l) || DIRECTION_ANY.test(l)));
  if (txnLines.length >= 2) return txnLines;
  // Single alert (or nothing splittable) — hand back the whole body unchanged.
  return [text];
}

// ── Gmail forwarding confirmation (spec 3.4) ──
// When a user points Gmail's "Forward a copy" at their inbound address, Gmail sends a
// one-time confirmation from forwarding-noreply@google.com with a code + a verify
// link. That mail isn't from a bank, so the allowlist would drop it — instead we
// detect it and surface the code/link so the user can finish setup without hunting.

// Is this the Gmail forwarding confirmation email?
function isGmailForwardingVerification(from) {
  return emailAddress(from) === 'forwarding-noreply@google.com';
}

// Pull the confirmation code + verify link out of the Gmail confirmation email.
// The code appears in the subject as "(#123456789)" and in the body as
// "Confirmation code: 123456789"; the link is a google.com verification URL. Returns
// { code, link } (either may be '') or null when neither is present.
function extractGmailVerification({ subject = '', text = '', html = '' } = {}) {
  const plain = htmlToText(html);
  const hay = [subject, text, plain].filter(Boolean).join('\n');
  let code = '';
  const cm = hay.match(/confirmation code[:\s#]*\s*(\d{6,12})/i)
    || subject.match(/\(#\s*(\d{6,12})\)/)
    || hay.match(/\(#\s*(\d{6,12})\)/)
    || hay.match(/\b(\d{9})\b/); // Gmail codes are 9 digits
  if (cm) code = cm[1];
  // Link: search the raw HTML (hrefs) and text for a google.com verification URL.
  const pool = `${html || ''} ${text || ''} ${plain}`;
  const links = pool.match(/https?:\/\/[^\s"'<>)]*google\.com\/[^\s"'<>)]*/gi) || [];
  const link = (
    links.find((u) => /(vf-|verify|anti-abuse|forwarding|vfe=)/i.test(u))
    || links.find((u) => /mail-settings\.google\.com|mail\.google\.com\/mail\//i.test(u))
    || ''
  ).replace(/&amp;/gi, '&');
  if (!code && !link) return null;
  return { code, link };
}

module.exports = {
  genToken, BANK_EMAIL_DOMAINS, isAllowedSender, senderDomain, emailAddress,
  extractToken, htmlToText, stripQuotedReply, emailToText, emailBodyText,
  isGmailForwardingVerification, extractGmailVerification, splitEmailAlerts,
};
