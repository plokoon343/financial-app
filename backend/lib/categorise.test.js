'use strict';
// Run: node backend/lib/categorise.test.js
// Round 10, Part A: the single categoriser. Covers the precedence order (K1 to K5),
// the realistic narrations the old substring matcher misfiled, the guarantee that no
// row ever comes back as "Transfer" or "ATM/POS", and that a user rule applies the
// same way on every ingestion path.
const fs = require('fs');
const path = require('path');
const { categorise, SOURCES } = require('./categorise');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };
const cat = (description, type = 'expense', more = {}, maps = null) => categorise({ txn: { description, type, ...more }, maps });

// ── The 17 narrations the substring matcher got wrong (rent/current, vat/private ...) ──
const SEVENTEEN = [
  ['Payment on current account maintenance', 'expense', 'Bank Charges'],
  ['Private school run', 'expense', 'Other'],
  ['Salvation Army donation', 'expense', 'Other'],
  ['Trf to Farida Okafor', 'expense', 'Sent to people'],
  ['Scott and Sons hardware', 'expense', 'Other'],
  ['Mobile recharge top up', 'expense', 'Airtime & Data'],
  ['Training workshop materials', 'expense', 'Other'],
  ['Rent for the flat, November', 'expense', 'Housing'],
  ['Transfer from Ada Obi', 'income', 'Money from People'],
  ['Transfer to Ada Obi', 'expense', 'Sent to people'],
  ['POS PUR UNKNOWN SHOP LAGOS', 'expense', 'Other'],
  ['ATM WITHDRAWAL GTB LAGOS', 'expense', 'Other'],
  ['NYSC allowance for October', 'income', 'Allowance'],
  ['DSTV renewal', 'expense', 'Subscriptions'],
  ['GOTV Jolli payment', 'expense', 'Subscriptions'],
  ['Stamp duty', 'expense', 'Bank Charges'],
  ['Salary for November', 'income', 'Salary'],
];
check('there are 17 narrations', SEVENTEEN.length === 17);
for (const [d, t, want] of SEVENTEEN) {
  const got = cat(d, t).category;
  check(`17 | ${d}`, got === want, `got '${got}', want '${want}'`);
}

// ── K1 to K5: the precedence order, one case each ──
const key = require('./merchantKey').deriveCategoryKey;
const { extractCounterparty, contactKey } = require('./counterparty');
const SHOP = 'POS PURCHASE SHOPRITE IKEJA';
// K1: a user rule beats a catalogue merchant.
check('K1 user rule beats the catalogue', cat(SHOP, 'expense', {}, { userRules: new Map([[key(SHOP), 'Entertainment']]) }).category === 'Entertainment'
  && cat(SHOP, 'expense', {}, { userRules: new Map([[key(SHOP), 'Entertainment']]) }).source === 'rule');
// K2: a contact label beats keywords and the person step.
const PERSON = 'Transfer to Ada Obi 0123456789';
const ck = contactKey(extractCounterparty(PERSON));
check('K2 contact category applies', ck && cat(PERSON, 'expense', {}, { contacts: new Map([[ck, { category: 'Giving', relationship: 'unknown' }]]) }).category === 'Giving');
check('K2 contact relationship family', ck && cat(PERSON, 'expense', {}, { contacts: new Map([[ck, { category: '', relationship: 'family' }]]) }).category === 'Family & Friends');
// K3: a learned merchant (name accepted twice) maps through the catalogue.
const LOCAL = 'POS PURCHASE CHOWDXK LAGOS';
const lk = key(LOCAL);
check('K3 learned merchant needs two confirmations',
  cat(LOCAL, 'expense', {}, { nameRules: new Map([[lk, { learnedName: 'Chowdeck', confirmations: 1 }]]) }).source !== 'learned'
  && cat(LOCAL, 'expense', {}, { nameRules: new Map([[lk, { learnedName: 'Chowdeck', confirmations: 2 }]]) }).source === 'learned');
// K4: approved consensus beats the catalogue and keywords.
check('K4 consensus beats the catalogue', cat(SHOP, 'expense', {}, { consensus: new Map([[key(SHOP), 'Shopping']]) }).category === 'Shopping');
// K5: with nothing taught, the user-free order holds and the guess is flagged.
const k5 = cat('SOME RANDOM NARRATION XYZ');
check('K5 unknown row is Other, a default, guessed', k5.category === 'Other' && k5.source === 'default' && k5.guessed === true);
check('K5 a catalogue hit is not a guess', cat(SHOP).source === 'catalogue' && cat(SHOP).guessed === false);
check('K5 a keyword hit is a guess', cat('House rent').source === 'keyword' && cat('House rent').guessed === true);
check('K5 a person is a guess', cat('Transfer to Ada Obi').source === 'person');
check('K5 an AI suggestion is only taken for its own direction', cat('XYZ QWERTY', 'expense', { aiSuggestion: 'Food' }).source === 'ai'
  && cat('XYZ QWERTY', 'expense', { aiSuggestion: 'Salary' }).source === 'default');

// ── A user rule never lands on the wrong side of the money, never a retired category ──
check('an income label on an expense is ignored', cat(SHOP, 'expense', {}, { userRules: new Map([[key(SHOP), 'Salary']]) }).category === 'Groceries');
check('a retired category from a rule is ignored', cat(SHOP, 'expense', {}, { userRules: new Map([[key(SHOP), 'Transfer']]) }).category === 'Groceries');

// ── One rule, six paths ──
// SMS, notification, email, share (confirm), statement and manual all end in categorise
// with the user's maps. Each shape of row below is what that path hands it.
const RULE_MAPS = { userRules: new Map([[key('KOON PLOT 4 LEKKI'), 'Giving']]) };
const PATHS = {
  sms: { description: 'KOON PLOT 4 LEKKI', type: 'expense' },
  notification: { description: 'KOON PLOT 4 LEKKI', type: 'expense', internal: false },
  email: { description: 'KOON PLOT 4 LEKKI', type: 'expense', isFee: false },
  share: { description: 'KOON PLOT 4 LEKKI', type: 'expense', amount: 5000 },
  statement: { description: 'KOON PLOT 4 LEKKI', type: 'expense', amount: 5000, balance: 1 },
  manual: { description: 'KOON PLOT 4 LEKKI', type: 'expense' },
};
for (const [name, txn] of Object.entries(PATHS)) {
  const r = categorise({ txn, maps: RULE_MAPS });
  check(`user rule applies on the ${name} path`, r.category === 'Giving' && r.source === 'rule');
}
// ...and the server really routes every path through it (no direct keyword call left).
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const parser = fs.readFileSync(path.join(__dirname, 'alertParser.js'), 'utf8');
check('no direct categorizeTransaction( call in server.js', !/categorizeTransaction\(/.test(server.replace(/\/\/.*$/gm, '')));
check('no direct categorizeTransaction( call in alertParser.js', !/categorizeTransaction\(/.test(parser));
const ingest = server.slice(server.indexOf('async function ingestAlert('), server.indexOf('// ─── Share-to-Automonie ingestion'));
check('SMS, notification and email (ingestAlert) load the user maps', /loadCategoriseMaps\(user\._id/.test(ingest));
const share = server.slice(server.indexOf("app.post('/api/ingest/share'"), server.indexOf('// Inbound providers (SendGrid'));
check('share applies the user maps', /applyCategorise\(req\.user, rows\)/.test(share));
const stmt = server.slice(server.indexOf('app.post(\'/api/upload'), server.indexOf('app.post(\'/api/upload') + 12000);
check('statement import applies the user maps', /applyCategorise\(req\.user, transactions\)/.test(server));
const manual = server.slice(server.indexOf("app.post('/api/transactions', auth"), server.indexOf('// Receipt scanning (Plus)'));
check('manual entry loads the user maps', /loadCategoriseMaps\(req\.user\._id/.test(manual));
check('statement and in-app SMS import (import-transactions) load the user maps', /importMaps = await loadCategoriseMaps\(req\.user\._id/.test(server));
check('Mono import applies the user maps', /mapped = await applyCategorise\(user, mapped\)/.test(server));

// ── Never Transfer, never ATM/POS ──
const NASTY = [
  ['TRANSFER TO OPAY', 'expense'], ['NIP TRANSFER FROM PALMPAY', 'income'], ['POS/WEB PURCHASE LAGOS NG', 'expense'],
  ['ATM WITHDRAWAL', 'expense'], ['VPOS 1234', 'expense'], ['Transfer', 'expense'], ['Transfer', 'income'], ['POS', 'expense'],
  ['Moved to savings pocket', 'expense'], ['', 'expense'], ['OUTWARD TRANSFER TO OPAY - CHIDUMEBI VINCENT ONUKOGU', 'expense'],
];
for (const [d, t] of NASTY) {
  for (const extra of [{}, { internal: true }, { type: 'cash_withdrawal' }]) {
    const r = categorise({ txn: { description: d, type: t, ...extra, ...(extra.type ? { amount: -100 } : {}) } });
    check(`never Transfer/ATM-POS: '${d}' ${JSON.stringify(extra)}`, r.category !== 'Transfer' && r.category !== 'ATM/POS');
  }
}

// Person detection with dashes, initials and relationship words
check('dash form with an initial is a person', cat('NIP Transfer In - Chukwuemeka O.', 'income').category === 'Money from People');
check('a relationship word is a person', cat('NIP Transfer In - Family Support', 'income').category === 'Money from People' && cat('Transfer Out - Mum').category === 'Sent to people');
check('a purpose label is not a person', cat('NIP Transfer In - Rental Income', 'income').category === 'Other Income' && cat('NIP Transfer In - Business Partner', 'income').category === 'Other Income');
check('piggybank is Savings', cat('Transfer Out - Savings (Piggybank)').category === 'Savings');
// Shapes measured on a real production account, 15 Nov 2026, that used to fall through
// to Other. The sender comes BEFORE the verb and there is no to/from in the narration.
check('"<name> has sent you" is a person', cat('Incoming Transfer Successful\nADA OBI has sent you .', 'income').category === 'Money from People');
check('a long full name before "has sent you" is a person', cat('AUGUSTINE KENECHUKWU OFORAH has sent you . Get up to', 'income').category === 'Money from People');
check('a business before "has sent you" is not a person', cat('Paystack has sent you . Get up to 6% bonus', 'income').category !== 'Money from People');
check('a bank name before "sent you" is not a person', cat('OPay has sent you .', 'income').category !== 'Money from People');
// Masked account numbers and reference blobs glued to the name no longer hide it.
check('star-masked noise after a name still reads as a person', cat('TRANSFER TO GABRIEL UDOKA EDWARD OPay *****1234/TRF|2MPTj4vl2|99Debit').category === 'Sent to people');
// The data file is what drives the keywords (A4).
check('keywords live in data/keywordRules.json', fs.existsSync(path.join(__dirname, '..', 'data', 'keywordRules.json')));
check('SOURCES lists the nine sources', SOURCES.length === 9);
for (const s of ['rule', 'contact', 'learned', 'consensus', 'catalogue', 'keyword', 'person', 'default', 'ai']) check(`source ${s} exists`, SOURCES.includes(s));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
