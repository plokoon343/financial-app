// Student plan verification helpers. Pure; tested in student.test.js.
'use strict';

// A school email counts when its domain is an allow-listed institution domain or a
// subdomain of one (student addresses often sit on a subdomain: stu.cu.edu.ng).
function schoolDomainFor(email, allowed) {
  const m = String(email || '').trim().toLowerCase().match(/^[^\s@]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (!m) return null;
  const domain = m[1];
  const list = (allowed || []).map((d) => String(d).toLowerCase().replace(/^\*?\.?/, ''));
  return list.find((d) => domain === d || domain.endsWith(`.${d}`)) || null;
}

// NYSC state codes: the two-letter state, the two-digit year with the batch letter,
// and the corps member's number, e.g. LA/25A/1234 (stream suffixes like 25A0 aren't
// used on state codes).
const NYSC_STATES = new Set(['AB', 'AD', 'AK', 'AN', 'BA', 'BY', 'BN', 'BO', 'CR', 'DT', 'EB', 'ED', 'EK', 'EN', 'FC', 'GM', 'IM', 'JG', 'KD', 'KN', 'KT', 'KB', 'KG', 'KW', 'LA', 'NS', 'NG', 'OG', 'OD', 'OS', 'OY', 'PL', 'RV', 'SO', 'TR', 'YB', 'ZM']);
function normalizeStateCode(code) {
  const m = String(code || '').trim().toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{2})\/(\d{2}[ABC])\/(\d{3,5})$/);
  if (!m || !NYSC_STATES.has(m[1])) return null;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

// A 6-digit one-time code and its comparison (codes are stored hashed by the caller).
const newCode = (rand = Math.random) => String(Math.floor(rand() * 1e6)).padStart(6, '0');

module.exports = { schoolDomainFor, normalizeStateCode, newCode, NYSC_STATES };
