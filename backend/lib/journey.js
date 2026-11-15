'use strict';
// The first-month journey (Round 10, Part E). Pure and dependency-light: the server
// builds a snapshot of one user, loads what has already been served, and asks pick()
// which single planned moment (if any) belongs to this person today.
//
// Rules this file enforces:
//   - at most ONE planned moment per user per Lagos day (a claimed day is final);
//   - counted from the account's created date; a moment has a window (its day plus
//     graceDays) and is never served after it, so a person away for a week comes back
//     to today's moment, never a backlog;
//   - a moment whose job is already done (skipIf) is never served;
//   - a moment is served once, ever;
//   - corpers get the allowance moment instead of the payday one (audience rules);
//   - one push a day across the whole app and quiet hours 10 pm to 8 am: see
//     QUIET_FLOOR and inQuiet(); the per-day ledger itself lives in the server.
//
// The moments are data (data/journey-moments.json) with admin overrides merged over
// them, so a day, a line of copy or an on/off switch changes without an app release.

const nudges = require('./nudges');
const { lagos, lagosDay } = nudges;

const DAY = 86400000;
const QUIET_FLOOR = { from: 22, to: 8 };      // never push between 10 pm and 8 am, whatever the user set
const DEFAULT_JOURNEY_DAYS = 45;

const TRIGGERS = ['day', 'payday', 'allowance', 'month_end', 'month_after'];
const CHECKS = ['better_month'];               // verified on the phone, from its own rows
const SKIPS = ['budget_set', 'rule_made', 'cash_used', 'banks_3plus', 'ask_used'];
const REQUIRES = ['has_txns', 'ai_on', 'recently_active', 'inactive', 'income_set'];
const AUDIENCES = ['student', 'corper'];
const PLANS = ['free', 'pro', 'student', 'sync', 'power'];

// Copy rule: no emoji, no em or en dashes.
const BAD_COPY = /[–—\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const cleanText = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const copyOk = (s) => !BAD_COPY.test(String(s || ''));

const hour = (v, d) => (Number.isInteger(v) && v >= 0 && v <= 24 ? v : d);
const list = (v, allowed) => (Array.isArray(v) ? v : []).map((x) => String(x)).filter((x) => allowed.includes(x));

// One moment from admin input or the file, cleaned to exactly what the scheduler reads.
// Returns { moment } or { error }.
function sanitizeMoment(raw, id) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const trigger = String(r.trigger || '');
  if (!TRIGGERS.includes(trigger)) return { error: `${id}: unknown trigger` };
  const m = {
    id,
    enabled: r.enabled !== false,
    order: Number.isFinite(Number(r.order)) ? Number(r.order) : 500,
    trigger,
    graceDays: Math.max(0, Math.min(7, Math.round(Number(r.graceDays) || 0))),
    channel: r.channel === 'email' ? 'email' : 'card',
    audiences: list(r.audiences, AUDIENCES),
    excludeAudiences: list(r.excludeAudiences, AUDIENCES),
    plans: list(r.plans, PLANS),
    skipIf: list(r.skipIf, SKIPS),
    requires: list(r.requires, REQUIRES),
    check: CHECKS.includes(r.check) ? r.check : '',
    showFromHour: hour(r.showFromHour, 0),
    minAgeDays: Math.max(0, Math.round(Number(r.minAgeDays) || 0)),
    replaces: cleanText(r.replaces, 40),
  };
  if (trigger === 'day') {
    m.day = Math.max(0, Math.min(60, Math.round(Number(r.day))));
    if (!Number.isFinite(m.day)) return { error: `${id}: day is required` };
    m.dayTo = r.dayTo == null || r.dayTo === '' ? m.day : Math.max(m.day, Math.min(60, Math.round(Number(r.dayTo))));
  }
  const c = r.card || {};
  if (m.channel === 'card') {
    m.card = { title: cleanText(c.title, 60), body: cleanText(c.body, 200), button: cleanText(c.button, 30), nav: cleanText(c.nav, 120) };
    if (!m.card.title || !m.card.body) return { error: `${id}: a card needs a title and a message` };
    if (m.card.nav && !m.card.nav.startsWith('/')) return { error: `${id}: nav must be an app route` };
  } else {
    const e = r.email || {};
    m.email = { subject: cleanText(e.subject, 120), text: cleanText(e.text, 1500) };
    if (!m.email.subject || !m.email.text) return { error: `${id}: an email needs a subject and text` };
  }
  const p = r.push;
  if (p && typeof p === 'object' && (p.copyKey || p.text)) {
    m.push = {
      category: nudges.CATEGORIES.includes(p.category) ? p.category : 'tips',
      copyKey: cleanText(p.copyKey, 40), text: cleanText(p.text, 140),
      fromHour: hour(p.fromHour, 9), toHour: hour(p.toHour, 20),
    };
  }
  const texts = [m.card?.title, m.card?.body, m.card?.button, m.email?.subject, m.email?.text, m.push?.text];
  if (!texts.every(copyOk)) return { error: `${id}: copy must not contain emoji or dashes used as punctuation` };
  return { moment: m };
}

// The file's moments with the admin's overrides on top (override fields replace the
// default's; a moment id the file does not know is added if it is complete). Anything
// that fails validation falls back to the default, so a bad edit can never break Home.
function mergeMoments(base, overrides = {}) {
  const out = [];
  const seen = new Set();
  for (const b of base || []) {
    const o = overrides && overrides[b.id];
    const merged = o ? { ...b, ...o, card: { ...(b.card || {}), ...(o.card || {}) }, email: { ...(b.email || {}), ...(o.email || {}) }, ...(b.push || o.push ? { push: { ...(b.push || {}), ...(o.push || {}) } } : {}) } : b;
    let s = sanitizeMoment(merged, b.id);
    if (s.error) s = sanitizeMoment(b, b.id);
    if (s.moment) { out.push(s.moment); seen.add(b.id); }
  }
  for (const [id, o] of Object.entries(overrides || {})) {
    if (seen.has(id) || !/^[a-z0-9_]{3,40}$/.test(id)) continue;
    const s = sanitizeMoment(o, id);
    if (s.moment) out.push(s.moment);
  }
  return out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

// Whole Lagos days since the account was created (0 on the day it was made).
function dayIndex(createdAt, now) {
  if (!createdAt) return -1;
  const a = Date.parse(`${lagosDay(createdAt)}T00:00:00Z`);
  const b = Date.parse(`${lagosDay(now)}T00:00:00Z`);
  return Math.round((b - a) / DAY);
}

const FLAGS = {
  budget_set: (s) => !!s.budgetSet, rule_made: (s) => !!s.ruleMade, cash_used: (s) => !!s.cashUsed,
  banks_3plus: (s) => (s.bankCount || 0) >= 3, ask_used: (s) => !!s.askUsed,
  has_txns: (s) => !!s.hasTxns, ai_on: (s) => !!s.aiOn, income_set: (s) => !!s.incomeSet,
};

// Opened the app in the last 3 days. A person we have never seen active is not.
const activeRecently = (s, now) => !!s.lastActiveAt && now - new Date(s.lastActiveAt) < 3 * DAY;

// Is this moment inside its window today, and does the event it waits for exist?
function isDue(m, snap, now, idx) {
  if (idx < (m.minAgeDays || 0)) return false;
  if (m.trigger === 'day') return idx >= m.day && idx <= m.dayTo + m.graceDays;
  if (m.trigger === 'month_end') {
    // The last day of the Lagos month, plus the grace days after it.
    for (let back = 0; back <= m.graceDays; back++) {
      const d = lagos(new Date(now.getTime() - back * DAY));
      if (d.dom === d.daysInMonth) return true;
    }
    return false;
  }
  if (m.trigger === 'month_after') {
    for (let back = 0; back <= m.graceDays; back++) if (lagos(new Date(now.getTime() - back * DAY)).dom === 1) return true;
    return false;
  }
  // payday / allowance: a pay-like credit that landed after the account existed, within the window.
  const since = snap.createdAt ? new Date(snap.createdAt) : new Date(0);
  const fresh = (snap.txns || []).filter((t) => new Date(t.date) >= since);
  return !!nudges.findPay(fresh, now, (m.graceDays + 1) * DAY);
}

// Does this person qualify (audience, plan, done-already, required facts)?
function qualifies(m, snap, now) {
  const aud = snap.audience || '';
  if (m.audiences.length && !m.audiences.includes(aud)) return false;
  if (m.excludeAudiences.includes(aud)) return false;
  if (m.plans.length && !m.plans.includes(snap.plan || 'free')) return false;
  if (m.skipIf.some((k) => FLAGS[k] && FLAGS[k](snap))) return false;
  for (const k of m.requires) {
    if (k === 'recently_active') { if (!activeRecently(snap, now)) return false; }
    else if (k === 'inactive') { if (activeRecently(snap, now)) return false; }
    else if (FLAGS[k] && !FLAGS[k](snap)) return false;
  }
  return true;
}

// The single moment for this person today, or null.
//   served: [{ momentId, claimDay, status }] everything this person has ever been given
//           (status skipped = the phone found it not real; it never comes back);
//   channel: 'card' (Home card and push) or 'email'.
// Returns { moment, fresh } where fresh=false means it was already claimed for today.
function pick({ moments, snap, served = [], now, channel = 'card', journeyDays = DEFAULT_JOURNEY_DAYS }) {
  const L = lagos(now);
  const idx = dayIndex(snap.createdAt, now);
  if (idx < 0 || idx > journeyDays) return null;
  const byId = new Map(moments.map((m) => [m.id, m]));
  // A day that already has its moment keeps it, and has no other.
  const today = served.find((s) => s.claimDay === L.dateKey);
  if (today) {
    const m = byId.get(today.momentId);
    if (!m || m.channel !== channel || today.status === 'dismissed') return null;
    return { moment: m, fresh: false, state: today };
  }
  const done = new Set(served.map((s) => s.momentId));
  for (const m of moments) {
    if (!m.enabled || m.channel !== channel || done.has(m.id)) continue;
    if (L.hour < (m.showFromHour || 0)) continue;
    if (!isDue(m, snap, now, idx)) continue;
    if (!qualifies(m, snap, now)) continue;
    return { moment: m, fresh: true };
  }
  return null;
}

// Quiet hours: never between 10 pm and 8 am Lagos, and never inside the person's own
// quiet window if that is wider. quiet = { from, to } from txnNotify.quietOf().
function inQuiet(hr, quiet) {
  const within = (h, { from, to }) => (from === to ? false : from > to ? h >= from || h < to : h >= from && h < to);
  return within(hr, QUIET_FLOOR) || (quiet ? within(hr, quiet) : false);
}

// The push text for a moment: reused nudge copy by key (never repeating the person's
// last line), or the moment's own new line. Null when it has no push, the person has
// switched that category off, or copy needs a value we do not have.
function pushText(m, { copy, prefs = {}, lastVariantId, showAmounts = false, rand = Math.random }) {
  const p = m.push;
  if (!p) return null;
  if (prefs[p.category] === false) return null;
  if (p.copyKey) {
    const spec = copy && copy[p.copyKey];
    if (!spec) return null;
    if (spec.category && prefs[spec.category] === false) return null;
    const v = nudges.pickVariant(spec.variants, lastVariantId, rand);
    const body = v && nudges.render(v, {}, { showAmounts });
    return body ? { title: spec.title, body, nav: spec.nav, variantId: v.id } : null;
  }
  return p.text ? { title: m.card ? m.card.title : 'automonie', body: p.text, nav: m.card ? m.card.nav : '/', variantId: '' } : null;
}

// Is it a good moment to push this one? (inside its own hour window and outside quiet)
function pushNow(m, now, quiet) {
  if (!m.push) return false;
  const h = lagos(now).hour;
  return h >= m.push.fromHour && h < m.push.toHour && !inQuiet(h, quiet);
}

module.exports = {
  DAY, QUIET_FLOOR, DEFAULT_JOURNEY_DAYS, TRIGGERS, CHECKS, SKIPS, REQUIRES,
  sanitizeMoment, mergeMoments, dayIndex, isDue, qualifies, pick, inQuiet, pushText, pushNow, copyOk,
};
