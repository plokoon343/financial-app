'use strict';
// Round 6, Block 3, section 5.2: the widened, [config] merchant catalogue.
const { brandFor, catalogueMatch, allEntries } = require('./merchantCatalogue');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

// brandFor() must behave exactly as the pre-round-6 subscriptionBrands.js did: only
// subscription-kind entries, never a general merchant.
check('brandFor: Netflix still resolves', brandFor('NETFLIX.COM LAGOS NG')?.slug === 'netflix');
check('brandFor: a verification hold is never a brand', brandFor('GOOGLE *TEMPORARY HOLD') === null);
check('brandFor: Shoprite (a new, general-merchant entry) is NOT a subscription brand', brandFor('POS PURCHASE SHOPRITE IKEJA') === null);
check('brandFor: Chowdeck is NOT a subscription brand', brandFor('CHOWDECK LAGOS') === null);

// catalogueMatch() is the section 5.2 widening: every kind, with the richer record.
const shoprite = catalogueMatch('POS PURCHASE SHOPRITE IKEJA');
check('catalogueMatch: finds Shoprite', shoprite?.service === 'Shoprite');
check('catalogueMatch: Shoprite is a general merchant, not a subscription', shoprite?.kind === 'merchant' && shoprite?.subscriptionOnly === false);
check('catalogueMatch: Shoprite carries a category', shoprite?.category === 'Groceries');

const netflix = catalogueMatch('NETFLIX.COM LAGOS NG');
check('catalogueMatch: also finds subscription-kind entries', netflix?.slug === 'netflix' && netflix?.kind === 'subscription');

check('catalogueMatch: a verification hold is never matched', catalogueMatch('GOOGLE *TEMPORARY HOLD') === null);
check('catalogueMatch: no match returns null, not undefined-shaped', catalogueMatch('completely unrelated text') === null);
check('catalogueMatch: empty input is null', catalogueMatch('') === null);

// Never show a logo on a guess (5.2's hard rule): close-spelling / fuzzy matches are
// out of catalogueMatch()'s scope entirely - it is exact-pattern only, so anything it
// returns is a real catalogue match and may show a logo; anything it does NOT match
// must fall through to a suggestion-only path elsewhere (lib/cleanName.js), never a
// logo. This just confirms a near-miss truly misses rather than fuzzy-matching here.
check('catalogueMatch: a misspelling does not match (fuzzy matching belongs to cleanName.js, not here)', catalogueMatch('SHOPRTIE IKEJA') === null);

// The catalogue is config, not code: every entry round-trips with its full shape.
const entries = allEntries();
check('allEntries: every entry exposes the 5.2 field set', entries.every((e) => (
  'service' in e && 'category' in e && 'patterns' in e && 'subscriptionOnly' in e
  && 'cadence' in e && 'plans' in e && 'lastChecked' in e && 'cancelLink' in e && 'logo' in e
)));
check('allEntries: unverified patterns are marked, per 5.2', entries.filter((e) => /unverified/i.test(e.patternStatus || '')).length > 0);
check('allEntries: compiled regexes are not leaked out', entries.every((e) => !('compiled' in e)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
