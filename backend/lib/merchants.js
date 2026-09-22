// Nigerian merchant & biller directory. A high-precision categorisation layer that
// runs BEFORE the generic keyword rules: a known merchant/biller name is a much
// stronger signal than a rail term (e.g. "chowdeck" → Food beats "transfer" →
// Transfer). Pure + dependency-free so it can be corpus-tested.
//
// Each entry uses a word-boundary-ish regex to avoid false hits ("market" must not
// fire on "supermarket"-style partials handled elsewhere). Category names must match
// constants/categories on web + mobile. Ordered most-specific first within a group;
// groups are ordered so a genuinely more-specific brand wins.

'use strict';

// \b is unreliable next to non-word chars common in Nigerian narrations (pipes,
// slashes, hyphens), so we anchor on a non-alphanumeric or string edge instead.
const b = (body) => new RegExp(`(?:^|[^a-z0-9])(?:${body})(?:[^a-z0-9]|$)`, 'i');

// [regex, category, canonicalName]
const MERCHANTS = [
  // ── Telcos: airtime & data ──
  [b('mtn|airtel|glo\\b|globacom|9mobile|etisalat|smile|spectranet|swift ?network|ipnx|tizeti|starlink'), 'Airtime & Data', 'Telecom'],
  [b('airtime|data ?bundle|data ?plan|recharge|top ?up'), 'Airtime & Data', 'Airtime/Data'],

  // ── Electricity DisCos & utilities ──
  [b('ikedc| eko ?elec|ekedc|ibedc|aedc|eedc|phed|kaedco|kedco|jed|bedc|yedc|capricorn|prepaid ?meter|electric(?:ity)?|nepa|phcn'), 'Utilities', 'Electricity'],
  [b('lawma|waste|water ?(?:board|corp|bill)|dstv|gotv|startimes|multichoice'), 'Utilities', 'Utility/TV'],

  // ── Streaming & digital subscriptions ──
  [b('netflix|spotify|apple ?music|youtube ?premium|showmax|prime ?video|amazon ?prime|icloud|google ?one|canva|chatgpt|openai|anthropic|claude|adobe|microsoft ?365|office ?365|linkedin|notion|grammarly|coursera ?plus'), 'Subscriptions', 'Digital subscription'],

  // ── Food delivery & restaurants ──
  [b('chowdeck|glovo|jumia ?food|bolt ?food|food ?court'), 'Food', 'Food delivery'],
  [b('kfc|dominos|domino|pizza ?hut|chicken ?republic|the ?place|coldstone|cold ?stone|burger|shawarma|suya|jollof|mr ?biggs|tantalizers|sweet ?sensation|kilimanjaro|cafe|eatery|restaurant|bukka|buka|kitchen'), 'Food', 'Restaurant'],

  // ── Groceries & supermarkets ──
  [b('shoprite|spar\\b|justrite|ebeano|hubmart|addide|market ?square|prince ?ebeano|grocer(?:y|ies)|supermarket|foodco|game ?store'), 'Groceries', 'Supermarket'],

  // ── Ride-hailing & transport ──
  [b('uber|bolt\\b|taxify|lagride|rida\\b|indrive|in ?drive|cowry\\b|brt\\b|danfo|keke|okada'), 'Transport', 'Ride-hailing'],
  [b('air ?peace|arik|ibom ?air|dana ?air|green ?africa|united ?nigeria|aero ?contractor|max ?air|flight|airway'), 'Transport', 'Airline'],

  // ── Fuel ──
  [b('nnpc|conoil|ardova|forte ?oil|total ?energies|totalenergies|mobil|oando|matrix ?energy|rainoil|petrol|diesel|filling ?station|fuel'), 'Fuel', 'Fuel'],

  // ── E-commerce & shopping ──
  [b('jumia|konga|amazon|aliexpress|ali ?express|temu|shein|slot ?system|slot\\b|pointek|jiji|fashion ?nova'), 'Shopping', 'E-commerce'],

  // ── Betting & gaming ──
  [b('bet9ja|nairabet|sportybet|sporty ?bet|1xbet|betking|merrybet|betway|msport|22bet|parimatch|football ?prediction|betnaija'), 'Entertainment', 'Betting'],
  [b('cinema|filmhouse|film ?house|silverbird|genesis ?cinema|ebonylife|concert|showtime'), 'Entertainment', 'Entertainment'],

  // ── Savings & investing platforms ──
  [b('piggyvest|piggy ?vest|cowrywise|cowry ?wise|risevest|rise ?vest|bamboo|trove|chaka|owealth|palmpay ?cashbox|target ?savings|ajo|esusu|thrift'), 'Savings', 'Savings/Investing'],
  // (Loans/BNPL like OKash, FairMoney, Carbon are handled as transaction KINDS —
  //  loan_in / debt_repayment — by lib/txnKinds, not as a spending category.)

  // ── Healthcare & pharmacy ──
  [b('medplus|med ?plus|healthplus|health ?plus|pharmacy|chemist|hospital|clinic|hmo|reddington|lagoon ?hospital|synlab|clinix'), 'Healthcare', 'Healthcare'],

  // ── Education ──
  [b('waec|jamb|neco|coursera|udemy|udacity|edx\\b|altschool|alt ?school|andela|tuition|school ?fees|university|polytechnic|college'), 'Education', 'Education'],

  // ── Insurance ──
  [b('leadway|aiico|axa ?mansard|cornerstone|custodian ?insurance|mutual ?benefits|nsia|allianz|insurance|assurance'), 'Insurance', 'Insurance'],

  // ── Charges / duties / levies (bank-side, not spending) ──
  [b('stamp ?dut(?:y|ies)|\\bvat\\b|emtl|e-?levy|electronic ?money ?transfer ?levy|nip ?fee|transfer ?fee|maintenance ?fee|account ?maintenance|\\bamf\\b|\\bcot\\b|sms ?(?:alert|charge)|card ?(?:fee|maintenance)|commission ?on'), 'Bank Charges', 'Charge/Levy'],
];

// Returns { category, merchant } for the first matching known merchant/biller, or
// null. Direction-agnostic — the caller decides whether to apply it (merchants are
// overwhelmingly expense-side).
function matchMerchant(description = '') {
  const d = (description || '').toString();
  if (!d.trim()) return null;
  for (const [re, category, merchant] of MERCHANTS) {
    if (re.test(d)) return { category, merchant };
  }
  return null;
}

module.exports = { matchMerchant, MERCHANTS };
