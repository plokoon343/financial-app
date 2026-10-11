// Bank registry + identification cascade (spec Addendum A): backend port of the
// mobile lib, so email forwarding, web SMS-paste and statements resolve banks the
// same way. Nigerian sender IDs are aggressively abbreviated ("PREMIUMTRST" = Premium
// Trust); resolveBank runs exact/contains → domain → fuzzy(sender only) and returns
// the canonical bank + confidence, or null when unsure (unknown > wrong).

// The list lives in data/banks.json (commercial banks, microfinance banks and
// fintechs/wallets, each with a type) so adding a bank is a data change, not code.
const BANKS = require('../data/banks.json');
const TYPES = { bank: 'Banks', mfb: 'Microfinance banks', fintech: 'Fintechs and wallets' };

const up = (s) => (s || '').toUpperCase();
const alnum = (s) => up(s).replace(/[^A-Z0-9]/g, '');

function jaro(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb);
    for (let j = lo; j < hi; j++) { if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; matches++; break; } }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) { if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; } }
  t /= 2;
  return (matches / la + matches / lb + (matches - t) / matches) / 3;
}
function jaroWinkler(a, b) {
  a = up(a); b = up(b);
  const j = jaro(a, b);
  let p = 0;
  while (p < 4 && p < a.length && p < b.length && a[p] === b[p]) p++;
  return j + p * 0.1 * (1 - j);
}

const FUZZY = 0.88;

function resolveBank(text, sender) {
  const hayAlnum = alnum(`${sender || ''} ${text || ''}`);
  const hayRaw = up(`${sender || ''} ${text || ''}`);
  const tokens = new Set(hayRaw.match(/[A-Z0-9]+/g) || []);

  for (const b of BANKS) {
    if (b.aliases.some((a) => tokens.has(a) || (a.length >= 6 && hayAlnum.includes(a)))) {
      return { code: b.code, name: b.name, confidence: 'high' };
    }
  }
  for (const b of BANKS) {
    if (b.domains && b.domains.some((d) => hayRaw.includes(d.toUpperCase()))) return { code: b.code, name: b.name, confidence: 'high' };
  }
  if (sender) {
    const sTok = alnum(sender);
    if (sTok.length >= 4) {
      let best = null, ambiguous = false;
      for (const b of BANKS) {
        for (const a of b.aliases) {
          if (Math.abs(a.length - sTok.length) > 3) continue;
          const s = jaroWinkler(sTok, a);
          if (s >= FUZZY) {
            if (!best || s > best.score) { best = { b, score: s }; ambiguous = false; }
            else if (best.b.code !== b.code && Math.abs(s - best.score) < 0.02) ambiguous = true;
          }
        }
      }
      if (best && !ambiguous) return { code: best.b.code, name: best.b.name, confidence: 'medium' };
    }
  }
  return null;
}

// A looser guess for a sender we could not resolve, used only to pre-select the bank
// in the "Which bank sent these?" picker (the user still confirms). Prefix match on
// an alias or the bank's name ("ALLWORKERS" -> Allworkers MFB), else the closest
// alias by Jaro-Winkler above 0.8.
function guessBank(sender) {
  const s = alnum(sender);
  if (s.length < 3) return null;
  const hit = resolveBank('', sender);
  if (hit) return { code: hit.code, name: hit.name };
  let best = null;
  for (const b of BANKS) {
    const names = [...b.aliases, alnum(b.name)];
    for (const a of names) {
      const score = (a.length >= 4 && (s.startsWith(a) || a.startsWith(s))) ? 0.95 : jaroWinkler(s, a);
      if (score >= 0.8 && (!best || score > best.score)) best = { code: b.code, name: b.name, score };
    }
  }
  return best ? { code: best.code, name: best.name } : null;
}

function extractAccountMask(text) {
  const m = (text || '').match(/(?:acc(?:t|ount)?|a\/c)\s*[:.]?\s*[\dx*•]*[*x•](\d{3,4})\b/i);
  return m ? m[1] : null;
}

module.exports = { BANKS, TYPES, resolveBank, guessBank, extractAccountMask, jaroWinkler };
