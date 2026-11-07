'use strict';
// Round 6, Block 3, section 5.3. Tests M1 to M4 exactly as the brief states them.
const { cleanName } = require('./cleanName');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// ── M1: a transfer narration ending in a person's name in capitals -> that name in
//    Title Case, flagged for "Sent to people" (never a raw-caps title). ──
{
  const r = cleanName({ raw: 'MOBILE TRF TO ADA OKAFOR', type: 'expense' });
  check('M1: Title Case, not the bank\'s shouted caps', r.name === 'Ada Okafor', r.name);
  check('M1: flagged as a person, for "Sent to people"', r.counterpartyType === 'person');
  check('M1: source is the counterparty extractor', r.source === 'person');
}

// ── M2: a POS narration with a terminal ID and a shop name -> the shop name only. ──
{
  const r = cleanName({ raw: 'POS PUR TERM00482910 SHOPRITE IKEJA LAG NG', type: 'expense' });
  check('M2: the shop name only, nothing else from the narration', r.name === 'Shoprite', r.name);
  check('M2: a real catalogue match, so a logo is allowed', r.source === 'catalogue' && r.logo === 'shoprite');
}

// ── M3: only digits and codes -> "Card payment" (never digits as a title). ──
{
  const r = cleanName({ raw: '0123456789012 REF99881234 00000', type: 'expense' });
  check('M3: falls all the way back to "Card payment"', r.name === 'Card payment', r.name);
  check('M3: never shows raw digits as the title', !/\d/.test(r.name));
}

// ── M4: a narration close to SHOPRITE but misspelled -> suggestion "Shoprite?" in
//    the Action Center, no logo until confirmed. ──
{
  const r = cleanName({ raw: 'POS PUR SHOPRTIE IKEJA LAG NG', type: 'expense' });
  check('M4: does not silently auto-correct the name', r.name !== 'Shoprite');
  check('M4: offers Shoprite as a suggestion only', r.suggestion && r.suggestion.name === 'Shoprite', JSON.stringify(r.suggestion));
  check('M4: a suggestion never carries a logo', r.logo === null);
  check('M4: source is not "catalogue" (that would imply an exact, logo-eligible match)', r.source !== 'catalogue');
}

// ── Bank charges: agree with merchants.js's own Bank Charges categorisation, and
//    read as a short label, not the bank's shouted narration (section 5.4). ──
{
  check('charge: "Vat" -> "VAT"', cleanName({ raw: 'VAT' }).name === 'VAT');
  check('charge: stamp duty gets a clean label', cleanName({ raw: 'STAMP DUTY CHARGE FOR TRXN REF 88213' }).name === 'Stamp duty');
  check('charge: both are categorised Bank Charges', cleanName({ raw: 'VAT' }).category === 'Bank Charges');
}

// ── 13.2 match order: a user's own rule beats everything, including a catalogue
//    match for the same text. ──
{
  const r = cleanName({ raw: 'NETFLIX.COM LAGOS NG', userRule: 'Movie night fund' });
  check('match order: the user\'s rule wins over the catalogue', r.name === 'Movie night fund' && r.source === 'user_rule');
}

// ── 13.2 rule 2: a learned merchant (confirmed twice) applies automatically; once
//    is not enough. ──
{
  const once = cleanName({ raw: 'SHOPRTIE IKEJA', learnedMerchant: { name: 'Shoprite', confirmations: 1 } });
  check('learned: one confirmation is not enough to auto-apply', once.source !== 'learned');
  const twice = cleanName({ raw: 'SHOPRTIE IKEJA', learnedMerchant: { name: 'Shoprite', confirmations: 2 } });
  check('learned: two confirmations auto-apply, with a logo', twice.name === 'Shoprite' && twice.source === 'learned');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
