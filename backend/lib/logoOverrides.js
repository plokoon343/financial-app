// Round 11 Part J: the manual override list. The most common Nigerian merchants and banks
// are pinned to a known domain, so the logo service never has to guess a name match for
// them (a wrong logo on a row is worse than the glyph fallback). `id` is the stable cache
// key; `re` matches the cleaned merchant name or the raw narration; `domain` is what the
// provider is asked for. To pin a hand-made image instead, drop `<id>.png|webp|jpg` into
// backend/data/logos/ and it is served as is, with no provider call at all.
// `domain` values marked (check) are from memory and need one look with a live key.
'use strict';

const O = (id, re, domain) => ({ id, re, domain });

const OVERRIDES = [
  // Telcos and bills
  O('mtn', /\bmtn\b/i, 'mtn.ng'),
  O('airtel', /\bairtel\b/i, 'airtel.com.ng'),
  O('glo', /\bglo(?:bacom)?\b/i, 'gloworld.com'),
  O('9mobile', /\b9 ?mobile\b/i, '9mobile.com.ng'),
  O('dstv', /\bdstv\b/i, 'dstv.com'),
  O('gotv', /\bgotv\b/i, 'gotvafrica.com'),
  O('startimes', /\bstartimes\b/i, 'startimes.com'),
  O('showmax', /\bshowmax\b/i, 'showmax.com'),
  // Rides and food
  O('bolt', /\bbolt\b/i, 'bolt.eu'),
  O('uber', /\buber\b/i, 'uber.com'),
  O('indrive', /\bin ?drive\b/i, 'indrive.com'),
  O('chowdeck', /\bchowdeck\b/i, 'chowdeck.com'),
  O('glovo', /\bglovo\b/i, 'glovoapp.com'),
  O('chicken-republic', /chicken ?republic/i, 'chickenrepublic.com'),
  O('dominos', /domino'?s/i, 'dominos.com'),
  O('kfc', /\bkfc\b/i, 'kfc.com'),
  // Shops
  O('jumia', /\bjumia\b/i, 'jumia.com.ng'),
  O('konga', /\bkonga\b/i, 'konga.com'),
  O('shoprite', /\bshoprite\b/i, 'shoprite.com.ng'),
  // Subscriptions
  O('netflix', /netflix|n ?flx|netflx/i, 'netflix.com'),
  O('spotify', /spotify|sptfy/i, 'spotify.com'),
  O('youtube', /youtube/i, 'youtube.com'),
  O('apple', /\bapple\b|itunes|icloud/i, 'apple.com'),
  O('google', /\bgoogle\b/i, 'google.com'),
  O('amazon', /\bamazon\b/i, 'amazon.com'),
  // Wallets and fintechs
  O('opay', /\bo ?pay\b/i, 'opay.com'),
  O('palmpay', /\bpalm ?pay\b/i, 'palmpay.com'),
  O('moniepoint', /\bmoniepoint\b/i, 'moniepoint.com'),
  O('kuda', /\bkuda\b/i, 'kuda.com'),
  O('paystack', /\bpaystack\b/i, 'paystack.com'),
  O('flutterwave', /\bflutterwave\b|\bflw\b/i, 'flutterwave.com'),
  O('piggyvest', /\bpiggy ?vest\b/i, 'piggyvest.com'),
  O('cowrywise', /\bcowrywise\b/i, 'cowrywise.com'),
  // Banks
  O('gtbank', /\bgt ?bank\b|\bgtco\b|guaranty trust|\bgtb\b/i, 'gtbank.com'),
  O('access-bank', /\baccess bank\b/i, 'accessbankplc.com'),
  O('zenith-bank', /\bzenith\b/i, 'zenithbank.com'),
  O('uba', /\buba\b|united bank for africa/i, 'ubagroup.com'),
  O('first-bank', /\bfirst ?bank\b|\bfbn\b/i, 'firstbanknigeria.com'),
  O('fcmb', /\bfcmb\b/i, 'fcmb.com'),
  O('fidelity-bank', /\bfidelity\b/i, 'fidelitybank.ng'),
  O('sterling-bank', /\bsterling\b/i, 'sterling.ng'),
  O('stanbic', /\bstanbic\b/i, 'stanbicibtcbank.com'),
  O('union-bank', /\bunion bank\b/i, 'unionbankng.com'),
  O('wema-bank', /\bwema\b/i, 'wemabank.com'),
  O('polaris-bank', /\bpolaris\b/i, 'polarisbanklimited.com'),
  O('ecobank', /\becobank\b/i, 'ecobank.com'),
  O('keystone-bank', /\bkeystone\b/i, 'keystonebankng.com'),
  O('unity-bank', /\bunity bank\b/i, 'unitybankng.com'),
];

// First override whose pattern matches. The list is ordered so a specific brand wins.
function overrideFor(text) {
  const t = String(text || '');
  if (!t.trim()) return null;
  for (const o of OVERRIDES) if (o.re.test(t)) return o;
  return null;
}

module.exports = { OVERRIDES, overrideFor };
