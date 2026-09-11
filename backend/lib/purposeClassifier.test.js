'use strict';
// Run: node backend/lib/purposeClassifier.test.js
const { classifyPurpose, proposalFrom } = require('./purposeClassifier');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const cand = (over) => ({ counterparty: 'Someone', txnIds: ['1'], count: 1, avgAmount: 5000, totalAmount: 5000, direction: 'out', cadence: 'occasional', samples: [], ...over });

// --- prior learned/consensus category is the strongest signal ---
const r0 = classifyPurpose(cand({ counterparty: 'ACME' }), 'Rent & Housing');
check('prior category -> rent, high', r0 && r0.purpose === 'rent' && r0.confidence === 'high' && r0.source === 'learned');
check('prior unknown category ignored', classifyPurpose(cand({ counterparty: 'ACME' }), 'Food') === null);

// --- keyword rules ---
check('savings app', classifyPurpose(cand({ counterparty: 'PiggyVest' })).purpose === 'savings');
check('rent wording', classifyPurpose(cand({ counterparty: 'MR LANDLORD house rent' })).purpose === 'rent');
check('school fees', classifyPurpose(cand({ counterparty: 'BRIGHT ACADEMY school fees' })).purpose === 'school');
check('loan repayment', classifyPurpose(cand({ counterparty: 'FairMoney loan repayment' })).purpose === 'loan_repayment');
check('utilities disco', classifyPurpose(cand({ counterparty: 'IKEDC prepaid meter' })).purpose === 'utilities');
check('gift/tithe', classifyPurpose(cand({ counterparty: 'RCCG tithe' })).purpose === 'gift');
check('family', classifyPurpose(cand({ counterparty: 'My Brother' })).purpose === 'family');
check('business ltd', classifyPurpose(cand({ counterparty: 'DangoteGlobal Ltd' })).purpose === 'business');

// --- whole-token matching: no false positives ---
check('"current" is not rent', (() => { const r = classifyPurpose(cand({ counterparty: 'Current Account Move' })); return !r || r.purpose !== 'rent'; })());
check('"brother" is caught, not blocked', classifyPurpose(cand({ counterparty: 'brother' })).purpose === 'family');

// --- direction gating ---
check('incoming "rent" is skipped', (() => { const r = classifyPurpose(cand({ counterparty: 'rent', direction: 'in' })); return !r || r.purpose !== 'rent'; })());
check('salary keyword incoming -> high', classifyPurpose(cand({ counterparty: 'ACME payroll salary', direction: 'in' })).confidence === 'high');
check('salary keyword outgoing -> medium', classifyPurpose(cand({ counterparty: 'staff salary', direction: 'out' })).confidence === 'medium');

// --- heuristics (no keyword) ---
const salaryH = classifyPurpose(cand({ counterparty: 'ACME LTD', direction: 'in', cadence: 'monthly', count: 4, avgAmount: 250000 }));
// note: "ltd" would hit the business rule; use a name with no keyword
const salaryH2 = classifyPurpose(cand({ counterparty: 'Zenith Payments', direction: 'in', cadence: 'monthly', count: 4, avgAmount: 250000 }));
check('regular income -> salary (heuristic, medium)', salaryH2 && salaryH2.purpose === 'salary' && salaryH2.confidence === 'medium' && salaryH2.source === 'heuristic');
const rentH = classifyPurpose(cand({ counterparty: 'Musa Ibrahim', direction: 'out', cadence: 'monthly', count: 3, avgAmount: 150000 }));
check('large round monthly outflow -> rent (heuristic)', rentH && rentH.purpose === 'rent' && rentH.source === 'heuristic');
check('small occasional -> null', classifyPurpose(cand({ counterparty: 'Random Person', avgAmount: 3000, cadence: 'occasional' })) === null);
check('non-round monthly not rent', (() => { const r = classifyPurpose(cand({ counterparty: 'Person X', direction: 'out', cadence: 'monthly', count: 3, avgAmount: 73450 })); return !r || r.purpose !== 'rent'; })());

// --- proposalFrom shaping ---
const prop = proposalFrom(cand({ counterparty: 'PiggyVest', txnIds: ['a', 'b'], count: 2 }), classifyPurpose(cand({ counterparty: 'PiggyVest' })));
check('proposalFrom maps category', prop && prop.category === 'Savings' && prop.txnIds.length === 2 && prop.source === 'rules');
check('proposalFrom null passthrough', proposalFrom(cand({}), null) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
