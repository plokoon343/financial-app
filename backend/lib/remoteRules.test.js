'use strict';
// Run: node backend/lib/remoteRules.test.js
// Test V2 from research doc 13.12's acceptance table.

const { sign, verify, applyRule, applyRuleset, buildSignedPayload, verifySignedPayload } = require('./remoteRules');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

const SECRET = 'test-secret-do-not-use-in-prod';

// ── V2: a new parser rule for a changed alert format is published ────────────
// Expected: old and new alerts both parse without an app update.
{
  // The OLD format this bank has always used.
  const oldStyleAlert = 'GTB: Your a/c ...6083 has been debited with NGN2,000.00. Desc: TRF to ADA OKAFOR';
  // A CHANGED format the bank started sending, which the shipped parser (not
  // simulated here) does not recognise - exactly the case a remote rule exists
  // to cover without waiting for an app release.
  const newStyleAlert = 'GTB Alert: Debit NGN3,500.00 on acct 6083 - TRF to BOLA ADE';

  const rules = [
    { id: 'gtb-debit-old', bankCode: 'gtb', pattern: 'debited with ngn([\\d,]+\\.\\d{2})', amountGroup: 1, direction: 'debit' },
    { id: 'gtb-debit-new', bankCode: 'gtb', pattern: 'debit ngn([\\d,]+\\.\\d{2})', amountGroup: 1, direction: 'debit' },
  ];

  const oldResult = applyRuleset(rules, 'gtb', oldStyleAlert);
  const newResult = applyRuleset(rules, 'gtb', newStyleAlert);
  check('V2: the old alert format still parses', oldResult && oldResult.amount === 2000 && oldResult.direction === 'debit', JSON.stringify(oldResult));
  check('V2: the new alert format parses too, from the newly published rule', newResult && newResult.amount === 3500 && newResult.direction === 'debit', JSON.stringify(newResult));
  check('V2: the new rule reports its own id', newResult.ruleId === 'gtb-debit-new');
}

// ── Deterministic direction only, never inferred ──────────────────────────────
{
  const rule = {
    id: 'credit-or-debit', pattern: '(credited|debited) with ngn([\\d,.]+)',
    amountGroup: 2, directionGroup: 1, directionMap: { credited: 'credit', debited: 'debit' },
  };
  const credit = applyRule(rule, 'Your account was credited with NGN500.00');
  const debit = applyRule(rule, 'Your account was debited with NGN500.00');
  check('direction: a mapped word resolves to credit', credit && credit.direction === 'credit');
  check('direction: a mapped word resolves to debit', debit && debit.direction === 'debit');

  const unmapped = { id: 'bad', pattern: '(reversed) ngn([\\d,.]+)', amountGroup: 2, directionGroup: 1, directionMap: { credited: 'credit' } };
  check('direction: an unmapped word never guesses a direction', applyRule(unmapped, 'Transaction reversed NGN500.00') === null);

  const noDirectionAtAll = { id: 'no-dir', pattern: 'ngn([\\d,.]+)', amountGroup: 1 };
  check('direction: a rule with no direction information at all never matches', applyRule(noDirectionAtAll, 'NGN500.00 moved') === null);
}

// ── Signing ────────────────────────────────────────────────────────────────────
{
  const rules = [{ id: 'r1', bankCode: 'gtb', pattern: 'x', amountGroup: 1, direction: 'debit' }];
  const sig = sign(rules, SECRET);
  check('sign: verifies against the same rules and secret', verify(rules, sig, SECRET));
  check('sign: fails against a different secret', !verify(rules, sig, 'wrong-secret'));
  const tampered = [{ id: 'r1', bankCode: 'gtb', pattern: 'y', amountGroup: 1, direction: 'debit' }];
  check('sign: fails when the rules were tampered with after signing', !verify(tampered, sig, SECRET));
  // Key order must not change the signature: a client and server building the
  // same object in a different order still have to agree.
  const sameRulesDifferentKeyOrder = [{ bankCode: 'gtb', id: 'r1', direction: 'debit', amountGroup: 1, pattern: 'x' }];
  check('sign: key order does not affect the signature', verify(sameRulesDifferentKeyOrder, sig, SECRET));
}

// ── Signed payload round-trip ────────────────────────────────────────────────
{
  const payload = buildSignedPayload({ rulesVersion: 3, catalogueVersion: 1, rules: [{ id: 'r1', pattern: 'x', amountGroup: 1, direction: 'debit' }] }, SECRET);
  check('payload: verifies as published', verifySignedPayload(payload, SECRET));
  const tampered = { ...payload, rulesVersion: 4 };
  check('payload: a bumped version with the old signature fails', !verifySignedPayload(tampered, SECRET));
  check('payload: a missing signature never verifies', !verifySignedPayload({ ...payload, signature: undefined }, SECRET));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
