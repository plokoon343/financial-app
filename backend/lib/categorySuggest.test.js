// Tests for the answers offered on a category card (round 6, Block 4).

const assert = require('assert');
const { suggest, popularCategories, isCatchAll } = require('./categorySuggest');

let pass = 0;
const eq = (name, got, want) => { assert.deepStrictEqual(got, want, `${name}: got ${JSON.stringify(got)}`); pass += 1; };
const check = (name, cond) => { assert.ok(cond, name); pass += 1; };

eq('the user\'s own answer leads', suggest({ learned: 'Food', global: 'Groceries', ruleGuess: 'Shopping' }), ['Food', 'Groceries', 'Shopping']);
eq('consensus leads when the user has never answered', suggest({ global: 'Groceries', ruleGuess: 'Shopping', popular: ['Transport'] }), ['Groceries', 'Shopping', 'Transport']);
eq('a catch-all rule guess is not offered as a suggestion', suggest({ ruleGuess: 'Other', popular: ['Food', 'Transport'] }), ['Food', 'Transport']);
eq('nothing known still gives one tappable answer', suggest({}), ['Other']);
eq('no duplicates when every source agrees', suggest({ learned: 'Food', global: 'Food', ruleGuess: 'Food', popular: ['Food'] }), ['Food']);
eq('a rejected category is never offered again', suggest({ learned: 'Food', global: 'Groceries', exclude: ['Food'] }), ['Groceries']);
eq('a grouped card asks for two', suggest({ learned: 'Food', global: 'Groceries', ruleGuess: 'Shopping', limit: 2 }), ['Food', 'Groceries']);
check('never more than asked for', suggest({ popular: ['A', 'B', 'C', 'D', 'E'] }).length === 3);

eq('popular categories, most used first', popularCategories([
  { category: 'Food' }, { category: 'Food' }, { category: 'Transport' }, { category: 'Other' }, { category: '' },
]), ['Food', 'Transport']);
eq('catch-alls are not popular', popularCategories([{ category: 'Other' }, { category: 'Other Income' }]), []);

check('catch-alls are recognised', isCatchAll('Other') && isCatchAll('') && !isCatchAll('Food'));

console.log(`categorySuggest: ${pass} checks passed`);
