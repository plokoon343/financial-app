'use strict';
// Run: node backend/lib/announcements.test.js
// Round 10 Part D: the audience filter and the rules around it.

const A = require('./announcements');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

const NOW = new Date('2026-11-15T12:00:00Z');
const day = (n) => new Date(NOW.getTime() - n * 86400000);
const user = (o = {}) => ({ _id: 'u', plan: 'free', audience: '', lastClient: 'android-play', lastAppVersion: '1.5.0',
  banksUsed: [], customBanks: [], createdAt: day(100), lastActiveAt: day(1), betaTester: false, isActive: true, ...o });
const ids = (users, f) => users.filter((u) => A.matchesAudience(u, f, NOW)).map((u) => u._id);

// ── Audience filter: each filter returns the right users ───────────────────────
{
  const everyone = [user({ _id: 'a' }), user({ _id: 'b', plan: 'pro' }), user({ _id: 'c', isActive: false })];
  check('empty filter is every active user', ids(everyone, {}).join() === 'a,b');
  check('plan filter', ids(everyone, { plans: ['pro'] }).join() === 'b');
  check('plan filter accepts several', ids(everyone, { plans: ['free', 'pro'] }).join() === 'a,b');
}
{
  const us = [user({ _id: 's', audience: 'student' }), user({ _id: 'c', audience: 'corper' }), user({ _id: 'n', audience: '' })];
  check('audience student', ids(us, { audiences: ['student'] }).join() === 's');
  check('audience none', ids(us, { audiences: ['none'] }).join() === 'n');
  check('audience student or corper', ids(us, { audiences: ['student', 'corper'] }).join() === 's,c');
}
{
  const us = [user({ _id: 'an', lastClient: 'android-play' }), user({ _id: 'ab', lastClient: 'android-beta' }),
    user({ _id: 'io', lastClient: 'ios' }), user({ _id: 'we', lastClient: 'web' }), user({ _id: 'un', lastClient: '' })];
  check('platform android covers play and beta', ids(us, { platforms: ['android'] }).join() === 'an,ab');
  check('platform ios', ids(us, { platforms: ['ios'] }).join() === 'io');
  check('platform web', ids(us, { platforms: ['web'] }).join() === 'we');
  check('an unknown client matches no platform filter', !ids(us, { platforms: ['android', 'ios', 'web'] }).includes('un'));
}
{
  const us = [user({ _id: 'old', lastAppVersion: '1.2.0' }), user({ _id: 'mid', lastAppVersion: '1.5.0' }),
    user({ _id: 'new', lastAppVersion: '2.0.0' }), user({ _id: 'none', lastAppVersion: '' })];
  check('version min', ids(us, { minVersion: '1.5.0' }).join() === 'mid,new');
  check('version max', ids(us, { maxVersion: '1.5.0' }).join() === 'old,mid,none');
  check('version range', ids(us, { minVersion: '1.3.0', maxVersion: '1.9.9' }).join() === 'mid');
  check('a build that never reported a version is reached by max, never by min', ids(us, { maxVersion: '1.0.0' }).join() === 'none');
}
{
  const us = [user({ _id: 'g', banksUsed: ['gtbank'] }), user({ _id: 'o', banksUsed: ['opay', 'kuda'] }),
    user({ _id: 'x', customBanks: [{ code: 'mybank', name: 'My Bank' }] }), user({ _id: 'z' })];
  check('banks: any match', ids(us, { banks: ['opay', 'gtbank'] }).join() === 'g,o');
  check('banks: custom bank code counts', ids(us, { banks: ['mybank'] }).join() === 'x');
  check('banks: case insensitive', ids(us, { banks: ['OPAY'] }).join() === 'o');
}
{
  const us = [user({ _id: 'a', createdAt: day(200) }), user({ _id: 'b', createdAt: day(50) }), user({ _id: 'c', createdAt: day(5) })];
  check('signup from', ids(us, { signedUpFrom: day(60) }).join() === 'b,c');
  check('signup to', ids(us, { signedUpTo: day(60) }).join() === 'a');
  check('signup range', ids(us, { signedUpFrom: day(60), signedUpTo: day(10) }).join() === 'b');
}
{
  const us = [user({ _id: 'hot', lastActiveAt: day(2) }), user({ _id: 'cold', lastActiveAt: day(40) }),
    user({ _id: 'login', lastActiveAt: null, lastLogin: day(3) }), user({ _id: 'never', lastActiveAt: null })];
  check('active in the last 7 days', ids(us, { activity: { mode: 'active', days: 7 } }).join() === 'hot,login');
  check('inactive for 30 days', ids(us, { activity: { mode: 'inactive', days: 30 } }).join() === 'cold,never');
  check('a bad activity filter is ignored', ids(us, { activity: { mode: 'sideways', days: 7 } }).length === 4);
}
{
  const us = [user({ _id: 'b', betaTester: true }), user({ _id: 'n' })];
  check('beta testers only', ids(us, { betaOnly: true }).join() === 'b');
}
{
  const u = user({ plan: 'pro', audience: 'student', lastClient: 'ios', lastAppVersion: '2.1.0', banksUsed: ['opay'], betaTester: true });
  const f = { plans: ['pro'], audiences: ['student'], platforms: ['ios'], minVersion: '2.0.0', banks: ['opay'], betaOnly: true, activity: { mode: 'active', days: 7 } };
  check('all filters together match', A.matchesAudience(u, f, NOW));
  check('one failing filter excludes', !A.matchesAudience(user({ ...u, plan: 'free' }), f, NOW));
  check('garbage in the filter is dropped, not trusted', A.matchesAudience(u, { plans: ['$ne'], $where: 'x' }, NOW) === true);
}

// ── A card past endsAt never shows; dismissed never returns; priority; one card ─
const ann = (o = {}) => ({ _id: 'x1', kind: 'feature', channels: ['card'], status: 'scheduled', startsAt: day(1),
  endsAt: new Date(NOW.getTime() + 86400000), createdAt: day(1), audience: {}, ...o });
{
  const u = user();
  check('a live card shows', A.pickActiveCard([ann()], {}, u, NOW));
  check('a card past endsAt never shows', A.pickActiveCard([ann({ endsAt: day(0.01) })], {}, u, NOW) === null);
  check('a card before startsAt does not show yet', A.pickActiveCard([ann({ startsAt: new Date(NOW.getTime() + 3600000) })], {}, u, NOW) === null);
  check('a draft never shows', A.pickActiveCard([ann({ status: 'draft' })], {}, u, NOW) === null);
  check('an ended card never shows', A.pickActiveCard([ann({ status: 'ended' })], {}, u, NOW) === null);
  check('dismissed never returns', A.pickActiveCard([ann()], { x1: { dismissed: true } }, u, NOW) === null);
  check('a card outside the audience does not show', A.pickActiveCard([ann({ audience: { plans: ['pro'] } })], {}, u, NOW) === null);
  check('an email-only announcement is not a card', A.pickActiveCard([ann({ channels: ['email'] })], {}, u, NOW) === null);
  const picked = A.pickActiveCard([
    ann({ _id: 'f', kind: 'feature' }), ann({ _id: 'o', kind: 'outage' }),
    ann({ _id: 'f2', kind: 'feature', startsAt: day(0.5), createdAt: day(0.5) }),
  ], {}, u, NOW);
  check('priority by kind first', picked._id === 'o');
  const two = A.pickActiveCard([ann({ _id: 'old', startsAt: day(3), createdAt: day(3) }), ann({ _id: 'new', startsAt: day(1), createdAt: day(1) })], {}, u, NOW);
  check('then newest', two._id === 'new');
  check('dismissing the top card reveals the next, one at a time',
    A.pickActiveCard([ann({ _id: 'o', kind: 'outage' }), ann({ _id: 'f' })], { o: { dismissed: true } }, u, NOW)._id === 'f');
}

// ── Full-screen shows once ─────────────────────────────────────────────────────
{
  const u = user();
  const fs = ann({ _id: 'fs', kind: 'outage', channels: ['card', 'fullscreen'] });
  check('an unseen full-screen is returned', A.pickFullscreen([fs], {}, u, NOW).length === 1);
  check('full-screen shows once', A.pickFullscreen([fs], { fs: { fullscreenShown: true } }, u, NOW).length === 0);
  check('a full-screen on a feature kind is never served even if stored', A.pickFullscreen([ann({ kind: 'feature', channels: ['fullscreen'] })], {}, u, NOW).length === 0);
  check('an ended full-screen is not served', A.pickFullscreen([ann({ ...fs, endsAt: day(0.1) })], {}, u, NOW).length === 0);
}

// ── End now removes it on the next fetch ───────────────────────────────────────
{
  const a = ann();
  check('before End now it shows', !!A.pickActiveCard([a], {}, user(), NOW));
  check('after End now it is gone on the next fetch', A.pickActiveCard([{ ...a, status: 'ended' }], {}, user(), NOW) === null);
  check('effectiveStatus: ended wins', A.effectiveStatus({ ...a, status: 'ended' }, NOW) === 'ended');
  check('effectiveStatus: live', A.effectiveStatus(a, NOW) === 'live');
}

// ── Email: consent, weekly limit, service kinds ───────────────────────────────
{
  const consented = user({ _id: 'yes', productEmails: true });
  const refused = user({ _id: 'no', productEmails: false });
  const recent = user({ _id: 'recent', productEmails: true, lastAnnouncementEmailAt: day(2) });
  const old = user({ _id: 'old', productEmails: true, lastAnnouncementEmailAt: day(9) });
  const all = [consented, refused, recent, old];
  const names = (a) => A.emailRecipients(a, all, NOW).map((u) => u._id).join();
  check('a feature email skips users without product-email consent', names(ann({ kind: 'feature', channels: ['email'] })) === 'yes,old');
  check('an event email skips users without consent', !names(ann({ kind: 'event', channels: ['email'] })).includes('no'));
  check('one announcement email a week for product kinds', !names(ann({ kind: 'feature', channels: ['email'] })).includes('recent'));
  check('service kinds go to everyone in the audience', names(ann({ kind: 'outage', channels: ['email'] })) === 'yes,no,recent,old');
  check('service kinds respect the audience', A.emailRecipients(ann({ kind: 'security', channels: ['email'], audience: { betaOnly: true } }), all, NOW).length === 0);
  check('maintenance and must_update are service kinds', A.isServiceKind('maintenance') && A.isServiceKind('must_update'));
}

// ── Validation and approval ───────────────────────────────────────────────────
{
  const base = { title: 'Hi', body: 'b', kind: 'feature', channels: ['card'], endsAt: new Date(NOW.getTime() + 86400000), createdBy: 'adminA' };
  check('a valid card passes', A.validate(base).length === 0);
  check('a card needs an end date', A.validate({ ...base, endsAt: null }).some((p) => /end date/.test(p)));
  check('full-screen is refused for a feature', A.validate({ ...base, channels: ['card', 'fullscreen'] }).some((p) => /Full-screen is only/.test(p)));
  check('full-screen is allowed for an outage', !A.validate({ ...base, kind: 'outage', channels: ['card', 'fullscreen'] }).some((p) => /Full-screen is only/.test(p)));
  check('the title is capped at 60', A.validate({ ...base, title: 'x'.repeat(61) }).length > 0);
  check('the card body is capped at 240', A.validate({ ...base, body: 'x'.repeat(241) }).length > 0);
  check('a button needs a link', A.validate({ ...base, buttonLabel: 'Go' }).length > 0);
  check('a javascript: link is refused', A.validate({ ...base, buttonLabel: 'Go', buttonLink: 'javascript:alert(1)' }).length > 0);

  const email = { ...base, channels: ['card', 'email'] };
  check('email cannot be scheduled without a test', A.validate(email, { forSchedule: true }).some((p) => /test first/.test(p)));
  check('email can be scheduled once tested', A.validate({ ...email, testedAt: NOW }, { forSchedule: true }).length === 0);

  const fs = { ...base, kind: 'outage', channels: ['card', 'fullscreen'], testedAt: NOW };
  check('full-screen cannot be scheduled without approval', A.validate(fs, { forSchedule: true }).some((p) => /second superadmin/.test(p)));
  check('the creator cannot approve their own', A.validate({ ...fs, approvedBy: 'adminA' }, { forSchedule: true }).some((p) => /different superadmin/.test(p)));
  check('a second superadmin approval lets it schedule', A.validate({ ...fs, approvedBy: 'adminB' }, { forSchedule: true }).length === 0);
  const sec = { ...base, kind: 'security', channels: ['card'] };
  check('security needs approval even as a card', A.needsSecondApproval(sec) && A.validate(sec, { forSchedule: true }).some((p) => /second superadmin/.test(p)));
  check('a plain feature card needs no approval', !A.needsSecondApproval(base));

  check('canApprove: the creator is refused', !A.canApprove(fs, { _id: 'adminA', role: 'superadmin' }).ok);
  check('canApprove: a second superadmin is accepted', A.canApprove(fs, { _id: 'adminB', role: 'superadmin' }).ok);
  check('canApprove: a newsletter editor is refused', !A.canApprove(fs, { _id: 'ed', role: 'user' }).ok);
  check('canApprove: nothing to approve on a plain card', !A.canApprove(base, { _id: 'adminB', role: 'superadmin' }).ok);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
