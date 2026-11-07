'use strict';
// Money and date formatting rules (round 6, section 6.3; research doc 13.9).
//
// This is for copy the SERVER writes (push notifications, emails, digests). The
// app's own screens format on the client (frontend/src/utils/format.js mirrors
// these same rules for the web app); this file is the one place the server turns
// a number or a date into words, so a push and an email never disagree with each
// other about how "today" or "4,500" should read.
//
// Pure and dependency-free.

const HIDDEN_AMOUNT = '₦••••';

// Whole naira: N4,500. With kobo (only when it is not zero): N4,500.50.
function formatNaira(amount, { hideAmount = false } = {}) {
  if (hideAmount) return HIDDEN_AMOUNT;
  const n = Number(amount) || 0;
  const rounded = Math.round(n * 100) / 100;
  const hasKobo = Math.abs(rounded - Math.round(rounded)) > 1e-9;
  const body = hasKobo
    ? rounded.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.round(rounded).toLocaleString('en-NG');
  return `₦${body}`;
}

// For charts and tight spaces only - never in a total (13.9: "Full amounts in
// totals, short forms only on charts").
function formatCompact(amount) {
  const n = Number(amount) || 0;
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e6) {
    const v = Math.round((abs / 1e6) * 100) / 100;
    return `${sign}₦${v}m`;
  }
  if (abs >= 1e3) {
    return `${sign}₦${Math.round(abs / 1e3)}k`;
  }
  return formatNaira(n);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year, no DST.

function lagosParts(date) {
  const d = new Date(new Date(date).getTime() + LAGOS_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
}
function lagosDayKey(date) {
  const p = lagosParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// Today, Yesterday, then "Mon 2 Nov" - the year only when it is a past year
// (13.9). `now` is injectable so this is testable without the system clock.
function formatDateLabel(date, { now = new Date() } = {}) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const todayKey = lagosDayKey(now);
  const yesterdayKey = lagosDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const dKey = lagosDayKey(d);
  if (dKey === todayKey) return 'Today';
  if (dKey === yesterdayKey) return 'Yesterday';
  const p = lagosParts(d);
  const nowP = lagosParts(now);
  const base = `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
  return p.year === nowP.year ? base : `${base} ${p.year}`;
}

// Follows the phone's 12/24-hour setting (the caller passes which, since the
// server cannot know a particular device's setting); always Lagos time.
function formatTime(date, { hour12 = true } = {}) {
  const d = new Date(date);
  if (!Number.isFinite(d.getTime())) return '';
  const p = new Date(d.getTime() + LAGOS_OFFSET_MS);
  let h = p.getUTCHours();
  const m = String(p.getUTCMinutes()).padStart(2, '0');
  if (!hour12) return `${String(h).padStart(2, '0')}:${m}`;
  const suffix = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${m}${suffix}`;
}

// Every number says its period (13.9's "approved rule"): e.g. periodPhrase('month')
// -> "this month"; periodPhrase('month', { named: 'November' }) -> "in November".
function periodPhrase(unit, { named = '' } = {}) {
  if (named) return `in ${named}`;
  if (unit === 'week') return 'this week';
  if (unit === 'month') return 'this month';
  if (unit === 'year') return 'this year';
  return '';
}

module.exports = { HIDDEN_AMOUNT, formatNaira, formatCompact, formatDateLabel, formatTime, periodPhrase };
