// Date helpers shared by the statement and alert parsers (moved from server.js).

const MONTH_MAP = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };

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

module.exports = { MONTH_MAP, fixYear, isSaneDate, normalizeAnyDate };
