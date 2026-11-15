'use strict';
// Announcements (Round 10, Part D). Pure, dependency-free rules so the same code
// decides who an announcement reaches whether the admin is looking at the live
// count or the send path is delivering it: both call matchesAudience().
//
// Hard rules from the brief: never a push, never covers the numbers, every card
// has an end date, one card on Home at a time (priority by kind, then newest).

const { compareVersions } = require('./appVersion');

const KINDS = ['update', 'feature', 'event', 'maintenance', 'outage', 'security', 'must_update'];
const CHANNELS = ['card', 'email', 'fullscreen'];
const STATUSES = ['draft', 'scheduled', 'live', 'ended'];

// Full-screen is only for these kinds.
const FULLSCREEN_KINDS = ['outage', 'security', 'must_update'];
// Product kinds go only to users who allowed product emails. Everything else is a
// service message about the app or the user's account and goes to the whole audience.
// (update is treated as product: it is not about a fault or the account.)
const PRODUCT_EMAIL_KINDS = ['update', 'feature', 'event'];

// Home shows one card: highest priority first, newest within a priority.
const KIND_PRIORITY = { must_update: 0, security: 1, outage: 2, maintenance: 3, event: 4, feature: 5, update: 6 };

const LIMITS = { title: 60, body: 240, emailBody: 5000, buttonLabel: 30, buttonLink: 300 };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const isServiceKind = (kind) => !PRODUCT_EMAIL_KINDS.includes(kind);

// Which client a user last used, from the X-Client header the apps send.
function platformOf(client) {
  const c = String(client || '').toLowerCase();
  if (c === 'web') return 'web';
  if (c === 'ios') return 'ios';
  if (c.startsWith('android')) return 'android';
  return '';
}

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const strList = (v, allowed) => (Array.isArray(v) ? v : [])
  .map((x) => String(x || '').trim().toLowerCase())
  .filter((x) => x && (!allowed || allowed.includes(x)));

// Clean an audience filter from the admin form. Anything unknown is dropped, so what
// is stored is exactly what the resolver understands.
function sanitizeAudience(raw) {
  const a = raw && typeof raw === 'object' ? raw : {};
  const out = {
    plans: strList(a.plans, ['free', 'pro', 'student', 'sync', 'power']),
    audiences: strList(a.audiences, ['student', 'corper', 'none']),
    platforms: strList(a.platforms, ['android', 'ios', 'web']),
    minVersion: String(a.minVersion || '').trim().slice(0, 20),
    maxVersion: String(a.maxVersion || '').trim().slice(0, 20),
    banks: strList(a.banks),
    signedUpFrom: toDate(a.signedUpFrom),
    signedUpTo: toDate(a.signedUpTo),
    activity: null,
    betaOnly: !!a.betaOnly,
  };
  const act = a.activity;
  if (act && ['active', 'inactive'].includes(act.mode) && Number(act.days) >= 1) {
    out.activity = { mode: act.mode, days: Math.min(Math.floor(Number(act.days)), 730) };
  }
  return out;
}

// Does this user belong to the audience? Empty filter means everyone.
// user: { plan, audience, lastClient, lastAppVersion, banksUsed, customBanks, createdAt,
//         lastActiveAt, lastLogin, betaTester, isActive }
function matchesAudience(user, filter, now = new Date()) {
  if (!user || user.isActive === false) return false;
  const f = sanitizeAudience(filter);
  if (f.plans.length && !f.plans.includes(user.plan || 'free')) return false;
  if (f.audiences.length && !f.audiences.includes(user.audience || 'none')) return false;
  if (f.platforms.length && !f.platforms.includes(platformOf(user.lastClient))) return false;
  if (f.minVersion || f.maxVersion) {
    // A build too old to report its version counts as 0.0.0: it can be reached by a
    // maximum ("everyone below 1.4") but never by a minimum.
    const v = user.lastAppVersion || '0.0.0';
    if (f.minVersion && compareVersions(v, f.minVersion) < 0) return false;
    if (f.maxVersion && compareVersions(v, f.maxVersion) > 0) return false;
  }
  if (f.banks.length) {
    const have = [...(user.banksUsed || []), ...(user.customBanks || []).map((b) => b && b.code)]
      .map((b) => String(b || '').toLowerCase());
    if (!f.banks.some((b) => have.includes(b))) return false;
  }
  if (f.signedUpFrom || f.signedUpTo) {
    const c = toDate(user.createdAt);
    if (!c) return false;
    if (f.signedUpFrom && c < f.signedUpFrom) return false;
    if (f.signedUpTo && c > f.signedUpTo) return false;
  }
  if (f.activity) {
    const last = toDate(user.lastActiveAt) || toDate(user.lastLogin);
    const recent = !!last && now.getTime() - last.getTime() <= f.activity.days * DAY_MS;
    if (f.activity.mode === 'active' && !recent) return false;
    if (f.activity.mode === 'inactive' && recent) return false;
  }
  if (f.betaOnly && !user.betaTester) return false;
  return true;
}

// 'draft' | 'scheduled' | 'live' | 'ended', from the stored status and the clock.
function effectiveStatus(a, now = new Date()) {
  if (!a) return 'ended';
  if (a.status === 'ended') return 'ended';
  const ends = toDate(a.endsAt);
  if (ends && ends.getTime() <= now.getTime()) return 'ended';
  if (a.status === 'draft') return 'draft';
  const starts = toDate(a.startsAt);
  if (starts && starts.getTime() > now.getTime()) return 'scheduled';
  return 'live';
}

// Full-screen needs a second superadmin when the kind is security or the channel is on.
function needsSecondApproval(a) {
  return a.kind === 'security' || (a.channels || []).includes('fullscreen');
}

// Everything wrong with an announcement as written (empty when fine). `forSchedule`
// adds the checks that only apply to putting it in front of users.
function validate(a, { forSchedule = false } = {}) {
  const problems = [];
  const channels = a.channels || [];
  if (!a.title || !String(a.title).trim()) problems.push('A title is required.');
  if (String(a.title || '').length > LIMITS.title) problems.push(`The title is over ${LIMITS.title} characters.`);
  if (!KINDS.includes(a.kind)) problems.push('Pick a kind.');
  if (!channels.length) problems.push('Pick at least one channel.');
  if (channels.some((c) => !CHANNELS.includes(c))) problems.push('Unknown channel.');
  if (channels.includes('fullscreen') && !FULLSCREEN_KINDS.includes(a.kind)) {
    problems.push('Full-screen is only for outage, security and must update.');
  }
  if (channels.includes('card') && String(a.body || '').length > LIMITS.body) problems.push(`The card message is over ${LIMITS.body} characters.`);
  if (String(a.emailBody || '').length > LIMITS.emailBody) problems.push('The email body is too long.');
  if (a.buttonLabel && !a.buttonLink) problems.push('A button needs a link.');
  if (a.buttonLink && !/^(https:\/\/|\/)/.test(a.buttonLink)) problems.push('The button link must start with https:// or be an in-app path.');
  const starts = toDate(a.startsAt), ends = toDate(a.endsAt);
  if ((channels.includes('card') || channels.includes('fullscreen')) && !ends) problems.push('Every card needs an end date.');
  if (starts && ends && ends <= starts) problems.push('The end must be after the start.');
  if (forSchedule) {
    if (channels.includes('card') && !String(a.body || '').trim()) problems.push('A card needs a message.');
    if (channels.includes('email') && !String(a.emailBody || a.body || '').trim()) problems.push('An email needs a body.');
    if ((channels.includes('email') || channels.includes('fullscreen')) && !a.testedAt) {
      problems.push('Send yourself a test first. It is required before scheduling email or full-screen.');
    }
    if (needsSecondApproval(a)) {
      if (!a.approvedBy) problems.push('This needs a second superadmin to approve it first.');
      else if (String(a.approvedBy) === String(a.createdBy)) problems.push('The approver must be a different superadmin than the creator.');
    }
  }
  return problems;
}

// Is this approver allowed to approve? Server enforces it; the creator never can.
function canApprove(a, approver) {
  if (!approver || approver.role !== 'superadmin') return { ok: false, message: 'Only a superadmin can approve.' };
  if (!needsSecondApproval(a)) return { ok: false, message: 'This announcement does not need approval.' };
  if (String(a.createdBy) === String(approver._id || approver.id)) return { ok: false, message: 'A second superadmin has to approve it, not its creator.' };
  return { ok: true };
}

// The user's current card: live, card channel, audience match, not dismissed, not
// ended. One only: highest kind priority, then newest.
// states: map of announcementId -> { dismissed, ... } for this user.
function pickActiveCard(announcements, states, user, now = new Date()) {
  const eligible = (announcements || []).filter((a) => (a.channels || []).includes('card')
    && effectiveStatus(a, now) === 'live'
    && !(states && states[String(a._id)] && states[String(a._id)].dismissed)
    && matchesAudience(user, a.audience, now));
  eligible.sort((x, y) => (KIND_PRIORITY[x.kind] - KIND_PRIORITY[y.kind])
    || (toDate(y.startsAt || y.createdAt) - toDate(x.startsAt || x.createdAt)));
  return eligible[0] || null;
}

// Full-screen announcements this user has not been shown yet (shows once each).
function pickFullscreen(announcements, states, user, now = new Date()) {
  return (announcements || []).filter((a) => (a.channels || []).includes('fullscreen')
    && FULLSCREEN_KINDS.includes(a.kind)
    && effectiveStatus(a, now) === 'live'
    && !(states && states[String(a._id)] && states[String(a._id)].fullscreenShown)
    && matchesAudience(user, a.audience, now))
    .sort((x, y) => KIND_PRIORITY[x.kind] - KIND_PRIORITY[y.kind]);
}

// May this user get this announcement's email now? Product kinds need product-email
// consent and at most one announcement email a week; service kinds go to everyone in
// the audience and do not count against the week.
function emailEligible(a, user, now = new Date()) {
  if (isServiceKind(a.kind)) return true;
  if (!user.productEmails) return false;
  const last = toDate(user.lastAnnouncementEmailAt);
  return !(last && now.getTime() - last.getTime() < WEEK_MS);
}

// The email recipients: the audience, narrowed by consent and the weekly limit.
function emailRecipients(a, users, now = new Date()) {
  return users.filter((u) => matchesAudience(u, a.audience, now) && emailEligible(a, u, now));
}

// Starting points for the composer. No emoji, no em dashes.
const TEMPLATES = [
  { id: 'feature', label: 'Feature', kind: 'feature', channels: ['card'], title: 'Something new in automonie', body: 'We added a new way to see your money. Take a look when you have a minute.', buttonLabel: 'Take a look', buttonLink: '/' },
  { id: 'vote', label: 'Vote', kind: 'event', channels: ['card'], title: 'We would love your vote', body: 'automonie is in a startup challenge and votes decide the winner. It takes under a minute.', buttonLabel: 'Vote', buttonLink: 'https://' },
  { id: 'maintenance', label: 'Maintenance', kind: 'maintenance', channels: ['card'], title: 'Short maintenance tonight', body: 'automonie may be slow for a few minutes tonight. Your data is safe and nothing is lost.', buttonLabel: '', buttonLink: '' },
  { id: 'bank-slow', label: 'Bank slow', kind: 'outage', channels: ['card'], title: 'Some bank alerts are arriving late', body: 'Alerts from one bank are delayed on their side. They will appear here as soon as they arrive.', buttonLabel: '', buttonLink: '' },
  { id: 'must-update', label: 'Must update', kind: 'must_update', channels: ['card', 'fullscreen'], title: 'Please update automonie', body: 'This version is no longer supported. Update to keep your records accurate.', buttonLabel: 'Update now', buttonLink: 'https://play.google.com/store/apps/details?id=com.plokoon343.finpilot' },
  { id: 'policy', label: 'Policy change', kind: 'update', channels: ['card', 'email'], title: 'We updated our privacy policy', body: 'We changed how we describe the data we keep. Nothing about your data changed without you.', buttonLabel: 'Read it', buttonLink: 'https://automonie.com/privacy' },
];

module.exports = {
  KINDS, CHANNELS, STATUSES, FULLSCREEN_KINDS, PRODUCT_EMAIL_KINDS, KIND_PRIORITY, LIMITS, TEMPLATES, WEEK_MS,
  isServiceKind, platformOf, sanitizeAudience, matchesAudience, effectiveStatus, needsSecondApproval,
  validate, canApprove, pickActiveCard, pickFullscreen, emailEligible, emailRecipients,
};
