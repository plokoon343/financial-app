'use strict';
// Round 11 pre-upload bug fixes: eight problems seen on a real phone, on preview build
// 1799244d (docs/briefs/round11-ui.md, "Bugs visible in the same screenshots"). Each
// check uses the exact strings from the screenshots.

const assert = require('assert');
const { build, MIN_ASK } = require('./actionCards');
const { suggest } = require('./categorySuggest');
const { cleanName } = require('./cleanName');
const { extractCounterparty } = require('./counterparty');
const { isPlausiblePerson, inferHolderName, paysHolder } = require('./personName');

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass += 1; };

const who = (name) => build({ who_is_this: [{ id: name, contactKey: `name:${name}`, name, amount: 5000 }] }).cards;

// 1. Banks are not people.
for (const n of ['ACCESS', 'UBA', 'ZBN', 'Zenith', 'Access Bank', 'OPay', 'Kuda']) {
  check(`"Who is ${n}?" is never asked`, who(n).length === 0);
}
check('a person who shares a bank word in their name is still asked', who('Zenith Okafor').length === 1);

// 2. Shops are not people.
for (const n of ['FROZO FOOD SUPER STORE', 'Mama Ngozi Ventures', 'Bright Global Enterprises', 'Eko Trading Ltd', 'Mega Mart PLC']) {
  check(`"Who is ${n}?" is never asked`, who(n).length === 0);
}
check('an ordinary two-name person is asked', who('Ada Okafor').length === 1 && isPlausiblePerson('Ada Okafor'));

// 3. No answer looks pre-selected on a question with no best guess.
{
  const c = who('Ada Okafor')[0];
  check('who-is-this offers Family, Friend, Work and none is primary', c.answers.length === 4 && !c.answers.some((a) => a.primary));
  const cat = build({ category: [{ id: 'c', txnId: 'c', name: 'Some Shop', amount: 9000, suggestions: ['Food'] }] }).cards[0];
  check('a real best guess is still drawn as primary', cat.answers[0].primary === true);
}

// 4. A retired category is never an answer.
check('suggest never returns Transfer', !suggest({ learned: 'Transfer', popular: ['Transfer', 'ATM/POS', 'Food'] }).some((c) => ['Transfer', 'ATM/POS'].includes(c)));
check('suggest falls back to Other when only retired ones exist', suggest({ learned: 'Transfer' }).join() === 'Other');
{
  const q = build({ category: [{ id: 'c', txnId: 'c', name: 'Some Shop', amount: 9000, suggestions: ['Transfer', 'Food', 'ATM/POS'] }] }).cards;
  const labels = q[0].answers.map((a) => a.label);
  check('a card built from a retired suggestion drops it', !labels.includes('Transfer') && !labels.includes('ATM/POS') && labels.includes('Food'));
  const g = build({ category: [
    { id: 'a', txnId: 'a', name: 'Some Shop', merchantKey: 'k', amount: 9000, suggestions: ['Transfer', 'Food'] },
    { id: 'b', txnId: 'b', name: 'Some Shop', merchantKey: 'k', amount: 9000, suggestions: ['Transfer', 'Food'] },
  ] }).cards;
  check('a grouped card drops it too', g[0].kind === 'grouped_category' && !g[0].answers.some((a) => a.label === 'Transfer'));
}

// 5. A sub-naira question never reaches the queue; a real own move still does.
{
  const own = (amount) => ({ own_move: [{ id: 'm', txnId: 'm', title: 'Moved to another account of yours', name: 'OPay', amount, pair: { from: 'Access', to: 'OPay' } }] });
  const tiny = build(own(0.75));
  check('a 0.75 own-move is not asked', tiny.cards.length === 0);
  check('...and is recorded as auto-resolved, not lost', tiny.autoResolve.some((r) => r.reason === 'below_sanity_floor'));
  check('a 0.09 amount is not asked', build(own(0.09)).cards.length === 0);
  check('the floor is small enough that a real own-move is still asked', build(own(MIN_ASK)).cards.length === 1 && build(own(500)).cards.length === 1);
}

// 6. A name is never duplicated in a title, and a self-named payment is recognised.
{
  const q = build({ category: [
    { id: 'a', txnId: 'a', name: 'Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu', merchantKey: 'k', amount: 9000, suggestions: ['Other'] },
    { id: 'b', txnId: 'b', name: 'Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu', merchantKey: 'k', amount: 9000, suggestions: ['Other'] },
    { id: 'c', txnId: 'c', name: 'Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu', merchantKey: 'k', amount: 9000, suggestions: ['Other'] },
  ] }).cards[0];
  check('the card title carries the name once', q.item.title === 'Chidumebi Vincent Onukogu' && q.vars.name === 'Chidumebi Vincent Onukogu');
  const narration = 'TRF TO CHIDUMEBI VINCENT ONUKOGU CHIDUMEBI VINCENT ONUKOGU';
  check('the counterparty parser folds a repeated name', extractCounterparty(narration).name === 'CHIDUMEBI VINCENT ONUKOGU');
  check('cleanName gives the name once', cleanName({ raw: narration }).name === 'Chidumebi Vincent Onukogu');
  // The account stores one word; the narrations name the holder in full, twice.
  const history = [narration, 'NIP Transfer from CHIDUMEBI VINCENT ONUKOGU to CHIDUMEBI VINCENT ONUKOGU', 'POS PUR SHOPRITE'];
  const holder = inferHolderName('Chidumebi', history);
  check('a one-word stored name is completed from the narrations', holder === 'CHIDUMEBI VINCENT ONUKOGU');
  check('payments to that name are recognised as self', paysHolder(narration, holder));
  check('a different person with the same first name is not self', !paysHolder('TRF TO CHIDUMEBI OKAFOR', holder));
  check('a name already in two parts is left alone', inferHolderName('Chidumebi Onukogu', history) === 'Chidumebi Onukogu');
  check('one occurrence is not enough to infer a holder', inferHolderName('Chidumebi', [narration]) === 'Chidumebi');
}

// 7. Two refund options that would render the same line are told apart, or merged.
{
  const label = 'Via Gtworld Onukogu, Chidumebi Vincent Onukogu Uzodimma Roberts on 3 Nov';
  const refund = (candidates) => build({ refund_match: [{ id: 'r', txnId: 'r', name: 'Gtworld', amount: 5000, candidates }] }).cards[0];
  const c = refund([
    { id: 't1', label, amountText: '₦5,000', dayText: '3 Nov' },
    { id: 't2', label, amountText: '₦7,500', dayText: '3 Nov' },
  ]);
  const shown = c.answers.map((a) => a.label.slice(0, 24));
  check('the two options differ within the part that is not truncated', new Set(shown).size === shown.length);
  check('the difference is the amount', c.answers[0].label.startsWith('₦5,000') && c.answers[1].label.startsWith('₦7,500'));
  const same = refund([
    { id: 't1', label, amountText: '₦5,000', dayText: '3 Nov' },
    { id: 't2', label, amountText: '₦5,000', dayText: '3 Nov' },
  ]);
  check('truly identical options are one choice, not two', same.answers.length === 2 && same.answers[1].id === 'neither');
  const fine = refund([
    { id: 't1', label: 'Jumia on 3 Nov', amountText: '₦5,000', dayText: '3 Nov' },
    { id: 't2', label: 'Konga on 4 Nov', amountText: '₦7,500', dayText: '4 Nov' },
  ]);
  check('options that already differ are left exactly as they were', fine.answers[0].label === 'Jumia on 3 Nov' && fine.answers[1].label === 'Konga on 4 Nov');
}

// 8. A POS narration's location and terminal number are not the merchant's name.
{
  const raw = 'POS PUR 11 PLC FESTAC 23RD Lagos LANG 38';
  const name = cleanName({ raw, type: 'expense' }).name;
  check('the title is not the raw narration', name !== raw && !/\b(POS|PUR|23RD|LANG|38|Lagos)\b/i.test(name));
  check('the merchant part survives', /festac/i.test(name));
  check('a merchant called Lagos Island is not trimmed', /lagos island/i.test(cleanName({ raw: 'POS PUR LAGOS ISLAND PHARMACY' }).name));
}

console.log(`cardBugs: ${pass} checks passed`);
