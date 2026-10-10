'use strict';
// Run: node backend/lib/bankMethods.test.js
const { bankMethods, methodTable } = require('./bankMethods');
const { BANK_EMAIL_DOMAINS } = require('./inboundEmail');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const find = (list, code) => list.find((b) => b.code === code);
const methodsOf = (b) => b.methods.map((m) => m.method);

const web = bankMethods({ platform: 'web' });
const android = bankMethods({ platform: 'android' });
const withMono = bankMethods({ platform: 'web', monoEnabled: true });

check('GTBank on web: email first', find(web, 'gtbank').best === 'email');
check('GTBank email is marked tested on real alerts', find(web, 'gtbank').methods[0].tested === true);
check('OPay on Android: app notifications first', find(android, 'opay').best === 'notifications');
check('Access on Android: email first, then notifications', methodsOf(find(android, 'access')).slice(0, 2).join() === 'email,notifications');
check('no notifications offered on web or iPhone', web.every((b) => !methodsOf(b).includes('notifications')) && bankMethods({ platform: 'ios' }).every((b) => !methodsOf(b).includes('notifications')));
check('a bank without a known alert domain never offers email', !methodsOf(find(web, 'suntrust')).includes('email') && find(web, 'suntrust').best === 'statement');
check('every bank can upload a statement and share alerts', web.every((b) => methodsOf(b).includes('statement') && methodsOf(b).includes('share')));
check('Mono only once switched on, and Pro only', !web.some((b) => methodsOf(b).includes('mono')) && find(withMono, 'gtbank').methods.find((m) => m.method === 'mono').proOnly);
check('Paga and Parallex are pickable', !!find(web, 'paga') && !!find(web, 'parallex'));
check('email offered only for allow-listed domains', web.filter((b) => methodsOf(b).includes('email')).every((b) => {
  const reg = require('./bankRegistry').BANKS.find((x) => x.code === b.code);
  return (reg?.domains || []).some((d) => BANK_EMAIL_DOMAINS.includes(d));
}));
const table = methodTable();
check('table covers every bank', table.length === web.length);
check('table says SunTrust has no email forwarding', table.find((r) => r.bank === 'SunTrust').email === 'no');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
