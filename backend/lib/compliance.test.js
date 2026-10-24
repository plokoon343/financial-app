'use strict';
// Run: node backend/lib/compliance.test.js
const c = require('./compliance');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

check('consent types cover the ones the policy names', ['terms', 'privacy', 'training', 'notification_access', 'email_forwarding'].every(c.isConsentType));
check('unknown consent type is rejected', !c.isConsentType('marketing_spam'));
check('security event types cover sign-in, resets, logout-all', ['login', 'password_reset', 'password_change', 'logout_all'].every(c.isSecurityEventType));
check('unknown security event type is rejected', !c.isSecurityEventType('delete_account'));
check('policy version is set and looks like a date', /^\d{4}-\d{2}-\d{2}$/.test(c.POLICY_VERSION));

const rows = [
  { date: '2026-10-01T00:00:00Z', description: 'Chicken Republic', amount: -4500, type: 'expense', category: 'Food', bank: 'GTBank', source: 'sms' },
  { date: '2026-10-02T00:00:00Z', description: 'Salary, Oct', amount: 250000, type: 'income', category: 'Income', bank: 'OPay', source: 'manual' },
];
const out = c.transactionsToCSV(rows);
const lines = out.trim().split('\r\n');
check('CSV: header row first', lines[0] === 'date,description,amount,type,category,bank,source');
check('CSV: one line per transaction, plus header', lines.length === 3, lines);
check('CSV: amount and date carried through', lines[1] === '2026-10-01,Chicken Republic,-4500,expense,Food,GTBank,sms', lines[1]);

const withComma = c.transactionsToCSV([{ date: '2026-10-03', description: 'Shoprite, Ikeja', amount: -1000, type: 'expense', category: 'Groceries', bank: '', source: 'manual' }]);
check('CSV: a comma in the description is quoted', withComma.includes('"Shoprite, Ikeja"'), withComma);

const withQuote = c.transactionsToCSV([{ date: '2026-10-04', description: 'John "Big J" Doe', amount: -500, type: 'expense', category: '', bank: '', source: 'manual' }]);
check('CSV: a quote in the description is escaped', withQuote.includes('"John ""Big J"" Doe"'), withQuote);

check('CSV: empty list is just the header', c.transactionsToCSV([]).trim() === 'date,description,amount,type,category,bank,source');
check('CSV: missing transactions arg does not throw', c.transactionsToCSV(undefined).trim() === 'date,description,amount,type,category,bank,source');

console.log(`compliance: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
