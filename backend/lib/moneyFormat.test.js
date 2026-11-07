'use strict';
// Run: node backend/lib/moneyFormat.test.js
// Research doc 13.9 (money and date formatting on the server). No lettered test
// exists for this section; these assert the formatting table directly.

const { formatNaira, formatCompact, formatDateLabel, formatTime, periodPhrase, HIDDEN_AMOUNT } = require('./moneyFormat');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── Whole naira / with kobo / hidden ──────────────────────────────────────────
{
  check('format: whole naira', formatNaira(4500) === '₦4,500');
  check('format: kobo shown only when not zero', formatNaira(4500.5) === '₦4,500.50');
  check('format: an exact-integer float has no kobo', formatNaira(4500.0) === '₦4,500');
  check('format: hidden amount', formatNaira(4500, { hideAmount: true }) === HIDDEN_AMOUNT);
}

// ── Compact (charts/tight spaces only) ────────────────────────────────────────
{
  check('compact: 1.25m', formatCompact(1250000) === '₦1.25m', formatCompact(1250000));
  check('compact: 850k', formatCompact(850000) === '₦850k', formatCompact(850000));
  check('compact: below 1,000 falls back to the full format', formatCompact(500) === '₦500');
}

// ── Dates: Today, Yesterday, then "Mon 2 Nov", year only in the past ─────────
{
  const now = new Date('2026-11-06T10:00:00+01:00');
  check('date: today', formatDateLabel('2026-11-06T09:00:00+01:00', { now }) === 'Today');
  check('date: yesterday', formatDateLabel('2026-11-05T09:00:00+01:00', { now }) === 'Yesterday');
  check('date: this year has no year suffix', formatDateLabel('2026-11-02T09:00:00+01:00', { now }) === 'Mon 2 Nov', formatDateLabel('2026-11-02T09:00:00+01:00', { now }));
  check('date: a past year adds the year', formatDateLabel('2025-11-02T09:00:00+01:00', { now }) === 'Sun 2 Nov 2025', formatDateLabel('2025-11-02T09:00:00+01:00', { now }));
}

// ── Times follow the 12/24-hour choice, in Lagos time ─────────────────────────
{
  check('time: 12-hour', formatTime('2026-11-06T13:05:00Z', { hour12: true }) === '2:05pm', formatTime('2026-11-06T13:05:00Z', { hour12: true }));
  check('time: 24-hour', formatTime('2026-11-06T13:05:00Z', { hour12: false }) === '14:05', formatTime('2026-11-06T13:05:00Z', { hour12: false }));
}

// ── Every number says its period ──────────────────────────────────────────────
{
  check('period: this month', periodPhrase('month') === 'this month');
  check('period: this week', periodPhrase('week') === 'this week');
  check('period: a named month', periodPhrase('month', { named: 'November' }) === 'in November');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
