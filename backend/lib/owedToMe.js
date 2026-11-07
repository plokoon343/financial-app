// Owed to me (13.6): lent money and split bills become a short list on Plan. Pure
// decision logic; server.js owns the OwedToMe collection and the transactions.
'use strict';

const DAY = 86400000;

// A new "I lent this" record: not spending (Debt in section 2), tracked against the
// transfer's own amount.
function lendRecord({ transactionId, person, amount, date }) {
  return { transactionId, person, amount: Math.abs(Number(amount) || 0), repaid: 0, status: 'open', lentAt: date || new Date() };
}

// Is a credit from this person a plausible payback: within 90 days of the lend,
// equal to or less than what's still owed? Suggested with one tap, never auto-applied.
function isPaybackCandidate(record, credit, now = new Date()) {
  if (!record || record.status !== 'open') return false;
  const owed = record.amount - (record.repaid || 0);
  if (!(owed > 0)) return false;
  const amt = Math.abs(Number(credit.amount) || 0);
  if (!(amt > 0) || amt > owed + 0.5) return false;
  const days = (new Date(now).getTime() - new Date(record.lentAt).getTime()) / DAY;
  if (days < 0 || days > 90) return false;
  return true;
}

// Apply a (possibly partial) payback. Returns the updated balance fields.
function applyPayback(record, amount) {
  const paid = Math.min(record.amount - (record.repaid || 0), Math.abs(Number(amount) || 0));
  const repaid = (record.repaid || 0) + paid;
  return { repaid, remaining: Math.max(0, record.amount - repaid), status: repaid >= record.amount ? 'settled' : 'open' };
}

// "Forget it": the remainder becomes spending under Gifts and events, dated the
// original lend date (not today), and the record is closed.
function writeOff(record) {
  return { remaining: Math.max(0, record.amount - (record.repaid || 0)), status: 'written_off', category: 'Gifts and events' };
}

module.exports = { lendRecord, isPaybackCandidate, applyPayback, writeOff };
