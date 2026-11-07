'use strict';
// Signed, remotely-delivered parser rules and catalogue (round 6, section 6.3;
// research doc 13.12).
//
// Most alert-format fixes should reach every user without an app build: a bank
// tweaks its SMS wording, and a new rule published through the config endpoint
// fixes it for everyone the next time their app refreshes its config - no store
// release needed. Rules are signed with HMAC so a client can trust data it did
// not ship with and reject anything tampered with in transit or storage.
//
// These rules stay strictly deterministic, same as every other parser in this
// codebase: a rule extracts an amount only via a regex capture group, and decides
// debit or credit only from a fixed `direction`, or a `directionMap` of exact
// words to 'credit'/'debit' that WE wrote into the rule. There is no path here
// that calls an AI model, and there must never be one: amount and direction are
// never a judgement call, remote or local.
//
// Pure and dependency-free apart from node's own 'crypto'.

const { createHmac, timingSafeEqual } = require('crypto');

// A stable, order-independent serialisation, so the same rules always sign the
// same way regardless of how the caller built the object.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(rules, secret) {
  return createHmac('sha256', String(secret || '')).update(canonical(rules)).digest('hex');
}

function verify(rules, signature, secret) {
  if (!signature || !secret) return false;
  const expected = sign(rules, secret);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signature), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Apply one rule to a line of text. Returns { amount, direction, ruleId } or null.
// A rule never returns a direction it was not explicitly told: `direction` fixes
// it outright (a rule scoped to one wording that is always, say, a debit), or
// `directionGroup` + `directionMap` reads it from a captured word against a map
// we wrote ourselves. Nothing here infers direction from free text.
function applyRule(rule, text) {
  if (!rule || !rule.pattern) return null;
  let re;
  try { re = new RegExp(rule.pattern, rule.flags || 'i'); } catch { return null; }
  const m = re.exec(String(text || ''));
  if (!m) return null;

  const amountRaw = rule.amountGroup != null ? m[rule.amountGroup] : null;
  if (!amountRaw) return null;
  const amount = Number(String(amountRaw).replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  let direction = rule.direction || null;
  if (!direction && rule.directionGroup != null && rule.directionMap) {
    const word = String(m[rule.directionGroup] || '').toLowerCase();
    direction = rule.directionMap[word] || null;
  }
  if (direction !== 'credit' && direction !== 'debit') return null;

  return { amount, direction, ruleId: rule.id || null };
}

// Try every rule that applies to this bank (or has no bank restriction), in the
// order given; the first match wins. Used as a fallback alongside the existing
// hardcoded parser, never in place of it.
function applyRuleset(rules, bankCode, text) {
  const list = (rules || []).filter((r) => !bankCode || !r.bankCode || r.bankCode === bankCode);
  for (const rule of list) {
    const r = applyRule(rule, text);
    if (r) return r;
  }
  return null;
}

// Build the payload a client receives: rules plus a signature over exactly those
// rules, so the client can verify before trusting anything in them.
function buildSignedPayload({ rulesVersion, catalogueVersion, rules }, secret) {
  const body = { rulesVersion, catalogueVersion, rules: rules || [] };
  return { ...body, signature: sign(body, secret) };
}

// Verify a payload exactly as buildSignedPayload shaped it (the signature covers
// rulesVersion, catalogueVersion and rules together, so none can be swapped in
// isolation).
function verifySignedPayload(payload, secret) {
  if (!payload) return false;
  const { signature, ...body } = payload;
  return verify(body, signature, secret);
}

module.exports = {
  canonical, sign, verify, applyRule, applyRuleset,
  buildSignedPayload, verifySignedPayload,
};
