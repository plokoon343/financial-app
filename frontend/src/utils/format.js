// Shared Naira formatter used across ALL pages. Round 10 C3: an amount in text is always the
// FULL amount (₦34,900, ₦1,250,000). The short form ("₦12k") exists only as fmtNairaCompact,
// for chart axes and nothing else. Whole naira has no decimals; kobo only shows when not zero.
export const HIDDEN_AMOUNT = '₦••••';

export const fmtNairaFull = (n, { hideAmount = false } = {}) => {
  if (hideAmount) return HIDDEN_AMOUNT;
  const num = Number(n) || 0;
  const rounded = Math.round(num * 100) / 100;
  const hasKobo = Math.abs(rounded - Math.round(rounded)) > 1e-9;
  const body = hasKobo
    ? Math.abs(rounded).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : Math.abs(Math.round(rounded)).toLocaleString('en-NG');
  return (rounded < 0 ? '-' : '') + '₦' + body;
};

export const fmtNaira = (n) => fmtNairaFull(n);

// Chart axes only (10k / 1.2M / 3.4B). Never use this for an amount in text.
export const fmtNairaCompact = (n) => {
  const num = Number(n) || 0;
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 10000) {
    return sign + '₦' + new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(abs);
  }
  return sign + '₦' + abs.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

// Same rules but without the ₦ symbol (for places that render the symbol separately).
export const fmtAmount = (n) => fmtNaira(n).replace('₦', '');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LAGOS_OFFSET_MS = 60 * 60 * 1000; // Africa/Lagos is UTC+1 all year, no DST.
const lagosParts = (date) => {
  const d = new Date(new Date(date).getTime() + LAGOS_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() };
};
const lagosDayKey = (date) => { const p = lagosParts(date); return `${p.year}-${p.month}-${p.day}`; };

// Today, Yesterday, then "Mon 2 Nov" - the year only when it is a past year
// (round 6, 13.9). Mirrors backend/lib/moneyFormat.js so server copy (pushes,
// emails) and the app never disagree about how a date reads.
export const formatDateLabel = (date, { now = new Date() } = {}) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const todayKey = lagosDayKey(now);
  const yesterdayKey = lagosDayKey(new Date(now.getTime() - 86400000));
  const dKey = lagosDayKey(d);
  if (dKey === todayKey) return 'Today';
  if (dKey === yesterdayKey) return 'Yesterday';
  const p = lagosParts(d);
  const nowP = lagosParts(now);
  const base = `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month]}`;
  return p.year === nowP.year ? base : `${base} ${p.year}`;
};
