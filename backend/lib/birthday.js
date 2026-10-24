'use strict';
// Birthdays: day and month only, never the year. Pure so the rules are tested.
//
// The email goes out at 9 am Lagos time on the day (the hourly job runs inside the
// 9 o'clock hour). Someone born on 29 February gets theirs on 28 February in years
// that have no 29th. A birthday is stored as two small numbers on the user; the only
// thing sent to Brevo is "DD-MM" as a contact attribute.

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]; // February allows the 29th

// A real day and month, or null. Accepts numbers or numeric strings.
function clean(day, month) {
  const d = Number(day), m = Number(month);
  if (!Number.isInteger(d) || !Number.isInteger(m)) return null;
  if (m < 1 || m > 12 || d < 1 || d > DAYS_IN_MONTH[m - 1]) return null;
  return { day: d, month: m };
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// The Lagos calendar date for an instant (Lagos is UTC+1, no daylight saving).
function lagosParts(now = new Date()) {
  const l = new Date(now.getTime() + 3600000);
  return { year: l.getUTCFullYear(), month: l.getUTCMonth() + 1, day: l.getUTCDate(), hour: l.getUTCHours() };
}

// Is it this person's birthday in Lagos right now?
function isBirthdayToday(user, now = new Date()) {
  const b = clean(user && user.birthdayDay, user && user.birthdayMonth);
  if (!b) return false;
  const t = lagosParts(now);
  if (b.month === 2 && b.day === 29 && !isLeap(t.year)) return t.month === 2 && t.day === 28;
  return b.month === t.month && b.day === t.day;
}

// Who should get the email in this run: it is the 9 o'clock hour in Lagos, the birthday is
// today, they have not asked to stop (the Birthday messages switch, email alerts), they
// have an email and we have not already sent one this year.
function dueBirthdayEmails(users, now = new Date()) {
  const t = lagosParts(now);
  if (t.hour !== 9) return [];
  return users.filter((u) => u && u.email
    && u.birthdayEmails !== false && u.emailAlerts !== false
    && u.birthdayEmailYear !== t.year
    && isBirthdayToday(u, now));
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The built-in email, used when BREVO_TEMPLATE_BIRTHDAY is not set. Short and warm; no
// mention of money, spending or anything to do.
function birthdayEmail(name) {
  const first = firstName(name);
  const subject = first ? `Happy birthday, ${first}` : 'Happy birthday';
  const hello = first ? `Happy birthday, ${first}.` : 'Happy birthday.';
  const text = `${hello}\n\nWishing you a good day and a good year ahead. Nothing to do today; just enjoy it.\n\nThe Automonie team\n\nYou get this because you added your birthday in Automonie. To stop birthday messages, switch off Birthday messages in the app under Notifications.`;
  const html = `<div style="font-family:Poppins,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1B2430;line-height:1.6">
<p style="font-size:20px;font-weight:600;margin:0 0 12px">${esc(hello)}</p>
<p style="margin:0 0 12px">Wishing you a good day and a good year ahead. Nothing to do today; just enjoy it.</p>
<p style="margin:0 0 20px">The Automonie team</p>
<p style="font-size:12px;color:#5B6B7A;margin:0">You get this because you added your birthday in Automonie. To stop birthday messages, switch off Birthday messages in the app under Notifications.</p>
</div>`;
  return { subject, text, html };
}

// The Brevo contact attribute: day and month only.
const brevoAttribute = (day, month) => { const b = clean(day, month); return b ? `${String(b.day).padStart(2, '0')}-${String(b.month).padStart(2, '0')}` : ''; };

module.exports = { clean, isLeap, lagosParts, isBirthdayToday, dueBirthdayEmails, birthdayEmail, brevoAttribute, firstName };
