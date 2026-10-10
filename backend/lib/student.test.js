'use strict';
// Run: node backend/lib/student.test.js
const { schoolDomainFor, normalizeStateCode, newCode } = require('./student');
const { domains } = require('../data/student-domains.json');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

check('a listed school email counts', schoolDomainFor('ada.obi@unilag.edu.ng', domains) === 'unilag.edu.ng');
check('a subdomain of a listed school counts', schoolDomainFor('ada@stu.cu.edu.ng', domains) === 'cu.edu.ng');
check('upper case is fine', schoolDomainFor('ADA@LIVE.UNILAG.EDU.NG', domains) === 'unilag.edu.ng');
check('Gmail does not count', schoolDomainFor('ada@gmail.com', domains) === null);
check('a lookalike domain does not count', schoolDomainFor('ada@fakeunilag.edu.ng', domains) === null && schoolDomainFor('ada@unilag.edu.ng.evil.com', domains) === null);
check('not an email', schoolDomainFor('unilag.edu.ng', domains) === null);
check('seed list has no duplicates', new Set(domains).size === domains.length);

check('a state code is accepted and tidied', normalizeStateCode(' la/25a/1234 ') === 'LA/25A/1234');
check('FCT code', normalizeStateCode('FC/24C/00123') === 'FC/24C/00123');
check('unknown state is refused', normalizeStateCode('XX/25A/1234') === null);
check('bad batch letter is refused', normalizeStateCode('LA/25D/1234') === null);
check('wrong shape is refused', normalizeStateCode('LA251234') === null && normalizeStateCode('') === null);

const c = newCode(() => 0.000042);
check('codes are 6 digits', /^\d{6}$/.test(c) && /^\d{6}$/.test(newCode()));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
