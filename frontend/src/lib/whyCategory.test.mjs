// Run: node src/lib/whyCategory.test.mjs
import { whyCategory } from './whyCategory.js';

let pass = 0, fail = 0;
const check = (label, ok) => { if (ok) pass++; else { fail++; console.log('FAIL', label); } };
const w = (categorySource, category = 'Food', name = 'Chowdeck') => whyCategory({ categorySource, category }, name);

check('rule', w('rule').line === 'Your rule' && !w('rule').check);
check('contact', w('contact', 'Family & Friends', 'Ada Obi').line === 'Ada Obi is Family');
check('learned', w('learned').line === 'You picked this twice');
check('catalogue', w('catalogue').line === 'Chowdeck is always Food');
check('consensus', w('consensus', 'Shopping', 'Jumia').line === 'Jumia is always Shopping');
for (const s of ['keyword', 'person', 'default', 'ai']) check(`${s} is a guess to check`, w(s).line === 'Our guess' && w(s).check === true);
check('an old row says nothing', whyCategory({ category: 'Food' }, 'x') === null);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
