'use strict';
// Public, owner-controlled notices shown on the website and in the app.
// Nothing here is a reward or incentive: it only asks for a vote.

const DEFAULT_VOTE_URL = 'https://the-impact-innovation-challenge-3.votenaija.ng/6ad4cf35287ff026e5e472a5/vote';
const DEFAULT_CHANNEL_URL = 'https://whatsapp.com/channel/0029Vb8r6k4BVJl7QBs5Sb12';

// The one WhatsApp destination for the whole product (app, web, emails, site).
const channelUrl = (env = process.env) => env.WHATSAPP_CHANNEL_URL || DEFAULT_CHANNEL_URL;

// The PIXLCO vote notice, or null. Off unless PIXLCO_VOTE_ENABLED=true; hides itself
// once PIXLCO_VOTE_ENDS (an ISO date, end of that day counts) has passed.
function pixlcoVote(env = process.env, now = new Date()) {
  if (String(env.PIXLCO_VOTE_ENABLED || '').toLowerCase() !== 'true') return null;
  let endsAt = null;
  if (env.PIXLCO_VOTE_ENDS) {
    const d = new Date(env.PIXLCO_VOTE_ENDS);
    if (Number.isNaN(d.getTime())) return null;           // a bad date must not leave it up forever
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(env.PIXLCO_VOTE_ENDS).trim())) d.setUTCHours(23, 59, 59, 999);
    if (now.getTime() > d.getTime()) return null;
    endsAt = d.toISOString();
  }
  return {
    id: 'pixlco-vote',
    text: 'Automonie is in the PIXLCO Impact Innovation Challenge. Vote for us',
    linkText: 'Vote',
    url: env.PIXLCO_VOTE_URL || DEFAULT_VOTE_URL,
    endsAt,
  };
}

module.exports = { pixlcoVote, channelUrl, DEFAULT_VOTE_URL, DEFAULT_CHANNEL_URL };
