// Subscription brands as banks actually print them. Card statements and alerts
// truncate and mangle merchant names ("N FLX", "NFLX.COM", "SPOTIFY AB",
// "GOOGLE *YouTube", "GOOGLEClaudebyAnth"), so one service shows up under several
// descriptions. Resolving each charge to its brand lets every source land on one
// subscription. Order matters: specific services sold through an app store (Claude,
// YouTube via Google) come before the store itself. Pure and dependency-free.
'use strict';

// Match on a non-alphanumeric or string edge, or glued after a store prefix
// ("GOOGLEClaude"), since bank narrations rarely have clean word breaks.
const re = (body) => new RegExp(`(?:^|[^a-z0-9]|google|apple)(?:${body})`, 'i');

const BRANDS = [
  ['Netflix', 'netflix', re('netflix|nflx|n ?flx|netflx')],
  ['Spotify', 'spotify', re('spotify|sptfy')],
  ['YouTube Premium', 'youtube', re('youtube|yt ?premium')],
  ['ChatGPT', 'chatgpt', re('chatgpt|openai')],
  ['Claude', 'claude', re('claude|anthropic')],
  ['Showmax', 'showmax', re('showmax')],
  ['GOtv', 'gotv', re('gotv')],
  ['DStv', 'dstv', re('dstv|multichoice')],
  ['StarTimes', 'startimes', re('startimes|star ?times')],
  ['Amazon Prime', 'amazon-prime', re('amazon ?prime|prime ?video|amzn ?prime|primevideo')],
  ['Disney+', 'disney', re('disney')],
  ['Apple TV', 'apple-tv', re('apple ?tv')],
  ['Apple Music', 'apple-music', re('apple ?music')],
  ['iCloud', 'icloud', re('icloud')],
  ['Audiomack', 'audiomack', re('audiomack')],
  ['Boomplay', 'boomplay', re('boomplay')],
  ['Deezer', 'deezer', re('deezer')],
  ['Canva', 'canva', re('canva(?:[^a-z]|$)|canva ?pro')],
  ['Adobe', 'adobe', re('adobe')],
  ['Microsoft 365', 'microsoft-365', re('microsoft|msft|office ?365')],
  ['LinkedIn Premium', 'linkedin', re('linkedin')],
  ['Notion', 'notion', re('notion(?:[^a-z]|$)|notion ?labs')],
  ['Grammarly', 'grammarly', re('grammarly')],
  ['Duolingo', 'duolingo', re('duolingo')],
  ['CapCut', 'capcut', re('capcut')],
  ['Zoom', 'zoom', re('zoom ?video|zoom\\.us|zoom ?us')],
  ['Dropbox', 'dropbox', re('dropbox')],
  ['Google One', 'google-one', re('google ?one|google ?storage')],
  ['Google Play', 'google-play', re('google ?play|google ?\\*')],
  ['App Store', 'app-store', re('apple\\.com|apple ?com ?bill|itunes|app ?store')],
];

// The brand a charge belongs to, or null when we can't tell.
function brandFor(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const [name, slug, pattern] of BRANDS) {
    if (pattern.test(t)) return { name, slug };
  }
  return null;
}

module.exports = { brandFor, BRANDS };
