// NDPC/NDPR compliance helpers (round 5, section 14): the consent types and
// security-event types we log, the current policy version to stamp on new
// consent records, and a pure CSV writer for the data-portability export.
// Dependency-free so it can be tested without a database.
'use strict';

// Keep in sync with the "Effective date and last updated" line at the top of
// automonie-web/src/pages/privacy.astro. A new value here starts a fresh
// consent trail; it does not need every user to re-consent to re-use it.
const POLICY_VERSION = '2026-10-16';

// What we record a timestamp for when it changes. Maps to privacy.astro
// section 8 ("Consent") and section 4.3 ("records of security events").
const CONSENT_TYPES = Object.freeze([
  'terms',               // Terms of Service, at signup
  'privacy',             // Privacy Policy, at signup
  'training',            // "Help improve Automonie" (keep raw alert/statement text)
  'notification_access', // Android bank-app notification capture
  'email_forwarding',    // forwarding address generated
  'beta',                // beta programme opt-in
]);

const SECURITY_EVENT_TYPES = Object.freeze([
  'login',
  'password_change',
  'password_reset',
  'logout_all',
]);

const isConsentType = (t) => CONSENT_TYPES.includes(t);
const isSecurityEventType = (t) => SECURITY_EVENT_TYPES.includes(t);

// One row per transaction, matching the fields a bank statement export would
// carry. Quotes any value containing a comma, quote or newline (RFC 4180).
function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function transactionsToCSV(transactions) {
  const headers = ['date', 'description', 'amount', 'type', 'category', 'bank', 'source'];
  const lines = [headers.join(',')];
  for (const t of transactions || []) {
    const row = [
      t.date ? new Date(t.date).toISOString().slice(0, 10) : '',
      t.description || '',
      t.amount ?? '',
      t.type || '',
      t.category || '',
      t.bank || '',
      t.source || '',
    ];
    lines.push(row.map(csvCell).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = { POLICY_VERSION, CONSENT_TYPES, SECURITY_EVENT_TYPES, isConsentType, isSecurityEventType, transactionsToCSV, csvCell };
