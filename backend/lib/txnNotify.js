'use strict';
// "New transactions added" notices: for transactions that arrive on their own (bank
// texts, bank-app notifications, forwarded email, statements, linked banks), never for
// ones the user typed in. Pure rules here; the sending lives in server.js.
//
//   batched : one push 2 minutes after the last new transaction
//   daily   : one summary at 8 pm Lagos (the default)
//   off     : nothing
// Nothing is sent inside the user's quiet hours (default 10 pm to 7 am Lagos).

const MODES = ['batched', 'daily', 'off'];
const DEFAULT_MODE = 'daily';
const BATCH_WAIT_MS = 2 * 60 * 1000;
const DAILY_HOUR = 20;
const DEFAULT_QUIET = { from: 22, to: 7 };

const isHour = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
const modeOf = (u) => (MODES.includes(u && u.newTxnNotify) ? u.newTxnNotify : DEFAULT_MODE);
const quietOf = (u) => ({
  from: isHour(u && u.notifQuietFrom) ? u.notifQuietFrom : DEFAULT_QUIET.from,
  to: isHour(u && u.notifQuietTo) ? u.notifQuietTo : DEFAULT_QUIET.to,
});
// from > to wraps midnight (22 to 7); from === to means no quiet hours.
const inQuiet = (hour, { from, to }) => (from === to ? false : from > to ? hour >= from || hour < to : hour >= from && hour < to);

const naira = (n) => `₦${Math.round(Math.abs(Number(n) || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

// Test and demo addresses never get pushes.
const TEST_EMAIL = /(^|[.+_-])test[0-9]*([.+_@-]|$)|@(example|test)\.|^playreview@|_test@/i;
const isTestAccount = (u) => TEST_EMAIL.test(String((u && u.email) || ''));

// rows: [{ description, amount, type, category, needsLook }]
function describe(rows, { showAmounts = false } = {}) {
  const n = rows.length;
  const need = rows.filter((r) => r.needsLook).length;
  const nav = need > 0 ? '/review-transactions' : '/(tabs)/transactions';
  if (n === 1) {
    const r = rows[0];
    const where = r.category && !r.needsLook ? ` to ${r.category}` : '';
    let body;
    if (r.needsLook) body = `${showAmounts ? `${r.description}, ${naira(r.amount)} added` : 'A new transaction was added'}. It needs a quick look.`;
    else if (showAmounts) body = `${r.description}, ${naira(r.amount)} added${where}.`;
    else body = r.type === 'income' ? 'New income added.' : `New spend added${where}.`;
    return { title: 'New transaction added', body, nav };
  }
  const tail = need === 0 ? '' : need === 1 ? ' 1 needs a quick look.' : ` ${need} need a quick look.`;
  return { title: 'New transactions added', body: `${n} new transactions added.${tail}`, nav };
}

// Should this user's pending rows go out now? `hour` is the Lagos hour.
function dueNow({ mode, pending, now, hour, quiet }) {
  if (mode === 'off' || !pending.length) return false;
  if (inQuiet(hour, quiet)) return false;
  if (mode === 'batched') {
    const last = pending.reduce((m, p) => Math.max(m, new Date(p.addedAt).getTime()), 0);
    return now.getTime() - last >= BATCH_WAIT_MS;
  }
  return hour >= DAILY_HOUR;   // daily: the 8 pm summary, or the first run after quiet hours end
}

module.exports = { MODES, DEFAULT_MODE, BATCH_WAIT_MS, DAILY_HOUR, DEFAULT_QUIET, isHour, modeOf, quietOf, inQuiet, describe, dueNow, isTestAccount, naira };
