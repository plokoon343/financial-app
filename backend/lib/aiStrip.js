'use strict';

// What may go to a FREE-tier AI provider: text with names, account numbers, phone
// numbers, emails and amounts removed. Free tiers may keep and read what they're
// sent, so only these stripped words ever reach them (see lib/aiProviders).
//
//   stripText('POS PURCHASE SHOPRITE LEKKI 08031234567 NGN 4,500.00')  -> 'POS PURCHASE SHOPRITE LEKKI'
//   merchantForAi('NIP TRF TO ADEBAYO OKONKWO 0123456789')              -> null (a person: never sent)

const { extractCounterparty } = require('./counterparty');

// Words around a person's name in bank narrations, and the name that follows them.
const NAME_AFTER = /\b(?:to|from|by|frm|benef(?:iciary)?|sender|cashier|served by|attendant|customer|name)\b[:\s]+(?:[A-Z][A-Za-z'.-]+\s*){1,4}/gi;
// Narrations that are person-to-person transfers, not purchases.
const TRANSFER = /\b(nip|neft|rtgs|trf|transfer|trsf|inward|outward|ussd|mobile trf|p2p|sent to|received from)\b/i;

function stripText(s) {
  return String(s || '')
    .replace(/\S+@\S+/g, ' ')                       // emails
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')     // links
    .replace(/[₦$£€]/g, ' ')                        // currency signs
    .replace(/\b(?:ngn|naira)\b/gi, ' ')
    .replace(/\d[\d,.:/*-]*/g, ' ')                  // every number: amounts, accounts, phones, dates
    .replace(NAME_AFTER, ' ')                         // "to Ada Obi", "cashier: Musa"
    .replace(/[^\w&'.\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A transaction description reduced to a merchant for categorisation, or null when it
// is a person-to-person transfer (a name we must not send) or nothing useful is left.
function merchantForAi(description) {
  const raw = String(description || '');
  if (TRANSFER.test(raw) || extractCounterparty(raw)) return null;
  const s = stripText(raw).slice(0, 60);
  return /[a-z]{3,}/i.test(s) ? s : null;
}

// The last line of defence before a free-tier call: refuse anything still carrying
// a digit or an @ (an amount, account, phone or email slipped through).
const isStripped = (s) => !/[\d@₦]/.test(String(s || ''));

module.exports = { stripText, merchantForAi, isStripped };
