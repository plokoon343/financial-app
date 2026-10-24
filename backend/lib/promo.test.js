'use strict';
// Run: node backend/lib/promo.test.js
const { pixlcoVote, channelUrl, DEFAULT_VOTE_URL, DEFAULT_CHANNEL_URL } = require('./promo');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const now = new Date('2026-11-10T12:00:00Z');

check('off by default', pixlcoVote({}, now) === null);
check('off when the flag is not true', pixlcoVote({ PIXLCO_VOTE_ENABLED: 'false' }, now) === null);
const on = pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true' }, now);
check('on with the flag and no end date', !!on && on.url === DEFAULT_VOTE_URL && on.endsAt === null, on);
check('copy has no incentive wording', !/win|prize|reward|gift|free/i.test(on.text), on.text);
check('shown before the end date', !!pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true', PIXLCO_VOTE_ENDS: '2026-11-30' }, now));
check('shown on the end day itself', !!pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true', PIXLCO_VOTE_ENDS: '2026-11-10' }, now));
check('hides itself after the end date', pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true', PIXLCO_VOTE_ENDS: '2026-11-09' }, now) === null);
check('a bad end date hides it', pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true', PIXLCO_VOTE_ENDS: 'soon' }, now) === null);
check('url can be overridden', pixlcoVote({ PIXLCO_VOTE_ENABLED: 'true', PIXLCO_VOTE_URL: 'https://x.test/v' }, now).url === 'https://x.test/v');

check('channel default is the new channel', channelUrl({}) === DEFAULT_CHANNEL_URL && DEFAULT_CHANNEL_URL.startsWith('https://whatsapp.com/channel/'));
check('channel env overrides', channelUrl({ WHATSAPP_CHANNEL_URL: 'https://whatsapp.com/channel/x' }) === 'https://whatsapp.com/channel/x');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
