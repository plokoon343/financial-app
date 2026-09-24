'use strict';
// Run: node backend/lib/counterparty.test.js
const { extractCounterparty, normalizeName, contactKey, familySignal } = require('./counterparty');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };
const ex = (d) => extractCounterparty(d);

// --- real OPay narrations ---
const a = ex('Transfer to UCHENDU JULIUS OKWUCHUKWU | First Bank Of Nigeria | 3049402864');
check('to: direction', a && a.direction === 'to');
check('to: name', a && a.name === 'UCHENDU JULIUS OKWUCHUKWU');
check('to: bank', a && /First Bank/i.test(a.bank));
check('to: account', a && a.account === '3049402864');

const b = ex('Transfer from CHIMDALU MIRIAM ONUKOGU | MONIE POINT | 503****065 | AT139');
check('from: direction', b && b.direction === 'from');
check('from: name', b && b.name === 'CHIMDALU MIRIAM ONUKOGU');
check('from: masked account kept', b && b.account === '503****065');

const c = ex('Transfer to CHOWDECK/KOON PLO | PAYSTACK- TITAN | 9982425026');
check('business name extracted', c && c.name === 'CHOWDECK' && c.account === '9982425026');

// --- must NOT create contacts for billers / internal / non-transfers ---
check('airtime -> null', ex('Airtime | 9052493659 | Glo') === null);
check('electricity -> null', ex('Electricity | 0195130023409 | capricorn_eko_prepaid | 47.3 kWh') === null);
check('owealth -> null', ex('Auto-save to OWealth Balance') === null);
check('stamp duty -> null', ex('Stamp Duty') === null);
check('bare narration -> null', ex('POS PURCHASE SHOPRITE LEKKI') === null);

// --- GTBank-style non-pipe narration ---
const g = ex('NIP TRANSFER TO ADEBAYO SAMUEL OLUWASEUN 0123456789 GTB');
check('non-pipe: name captured', g && g.direction === 'to' && /ADEBAYO SAMUEL OLUWASEUN/.test(g.name));
check('non-pipe: account captured', g && g.account === '0123456789');

// --- keying: account is identity across name spellings ---
check('same account -> same key despite name diff',
  contactKey({ account: '3049402864', name: 'UCHENDU J O' }) === contactKey({ account: '3049402864', name: 'UCHENDU JULIUS' }));
check('no account -> name key', contactKey({ account: '', name: 'Ada Mary' }) === 'name:ADA MARY');

// --- family signal (shared surname, any position) ---
const holder = 'CHIDUMEBI VINCENT ONUKOGU';
check('family: shared surname last', familySignal(holder, 'CHIMDALU MIRIAM ONUKOGU') === true);
check('family: shared surname first', familySignal(holder, 'ONUKOGU UNEZE VINCENT') === true);
check('family: unrelated -> false', familySignal(holder, 'UCHENDU JULIUS OKWUCHUKWU') === false);
check('family: short tokens ignored', familySignal('AB CD', 'CD EF') === false);

// --- normalizeName ---
check('normalize strips digits + pipes', normalizeName('ADA MARY | Access | 0123456789') === 'ADA MARY');
check('normalize rejects junk', normalizeName('12345') === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
