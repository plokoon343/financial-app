'use strict';
// Run: node backend/lib/birthday.test.js
const b = require('./birthday');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };

check('a real day and month is kept', JSON.stringify(b.clean('14', 3)) === '{"day":14,"month":3}');
check('31 April is not a date', b.clean(31, 4) === null);
check('29 February is allowed (leap babies)', b.clean(29, 2) !== null);
check('month 13, day 0 and text are refused', b.clean(1, 13) === null && b.clean(0, 1) === null && b.clean('x', 1) === null && b.clean(null, null) === null);

// Lagos is UTC+1: 08:30 UTC on 14 March is 09:30 in Lagos.
const nine = new Date('2026-03-14T08:30:00Z');
const u = { email: 'a@example.test', name: 'Ada Obi', birthdayDay: 14, birthdayMonth: 3 };
check('lagos parts use UTC+1', b.lagosParts(nine).hour === 9 && b.lagosParts(new Date('2026-03-14T23:30:00Z')).day === 15);
check('birthday today in Lagos', b.isBirthdayToday(u, nine));
check('not on another day', !b.isBirthdayToday(u, new Date('2026-03-15T08:30:00Z')));
check('no birthday set means never', !b.isBirthdayToday({ email: 'x' }, nine));

check('sent in the 9 o\'clock hour', b.dueBirthdayEmails([u], nine).length === 1);
check('not at 10 am', b.dueBirthdayEmails([u], new Date('2026-03-14T09:30:00Z')).length === 0);
check('not at 8 am', b.dueBirthdayEmails([u], new Date('2026-03-14T07:30:00Z')).length === 0);
check('switch off means none', b.dueBirthdayEmails([{ ...u, birthdayEmails: false }], nine).length === 0);
check('email alerts off means none', b.dueBirthdayEmails([{ ...u, emailAlerts: false }], nine).length === 0);
check('once a year', b.dueBirthdayEmails([{ ...u, birthdayEmailYear: 2026 }], nine).length === 0 && b.dueBirthdayEmails([{ ...u, birthdayEmailYear: 2025 }], nine).length === 1);
check('no email address means none', b.dueBirthdayEmails([{ ...u, email: '' }], nine).length === 0);

const leap = { email: 'l@example.test', birthdayDay: 29, birthdayMonth: 2 };
check('29 Feb: on the 28th in a normal year', b.isBirthdayToday(leap, new Date('2027-02-28T08:30:00Z')) && !b.isBirthdayToday(leap, new Date('2027-03-01T08:30:00Z')));
check('29 Feb: on the 29th in a leap year, not the 28th', b.isBirthdayToday(leap, new Date('2028-02-29T08:30:00Z')) && !b.isBirthdayToday(leap, new Date('2028-02-28T08:30:00Z')));

const mail = b.birthdayEmail('Ada Obi');
check('subject is Happy birthday, first name', mail.subject === 'Happy birthday, Ada');
check('no name still reads well', b.birthdayEmail('').subject === 'Happy birthday' && b.birthdayEmail('').text.startsWith('Happy birthday.'));
check('no money guilt, no emoji, no em dash', !/spend|money|budget|₦|—/i.test(mail.text + mail.subject) && !/[\u{1F300}-\u{1FAFF}]/u.test(mail.text));
check('the name is escaped in html', b.birthdayEmail('<b>x</b>').html.includes('&lt;b&gt;'));
check('only day and month go to Brevo', b.brevoAttribute(5, 3) === '05-03' && b.brevoAttribute(31, 4) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
