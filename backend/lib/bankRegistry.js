// Bank registry + identification cascade (spec Addendum A) — backend port of the
// mobile lib, so email forwarding, web SMS-paste and statements resolve banks the
// same way. Nigerian sender IDs are aggressively abbreviated ("PREMIUMTRST" = Premium
// Trust); resolveBank runs exact/contains → domain → fuzzy(sender only) and returns
// the canonical bank + confidence, or null when unsure (unknown > wrong).

const BANKS = [
  { code: 'gtbank', name: 'GTBank', aliases: ['GTBANK', 'GTB', 'GTWORLD', 'GUARANTYTRUST', 'GTBANKPLC'], domains: ['gtbank.com', 'gtworld.com'] },
  { code: 'access', name: 'Access', aliases: ['ACCESSBANK', 'ACCESS', 'ACCESSMORE', 'DIAMONDXTRA', 'ACCESSBANKPLC'], domains: ['accessbankplc.com'] },
  { code: 'uba', name: 'UBA', aliases: ['UBA', 'UBAGROUP', 'UBAMOBILE', 'LEO'], domains: ['ubagroup.com'] },
  { code: 'zenith', name: 'Zenith', aliases: ['ZENITH', 'ZENITHBANK', 'ZENITHDIRECT', 'EAZYBANKING'], domains: ['zenithbank.com'] },
  { code: 'firstbank', name: 'First Bank', aliases: ['FIRSTBANK', 'FBN', 'FIRSTONLINE', 'FIRSTMONIE', 'FIRSTBANKNG'], domains: ['firstbanknigeria.com'] },
  { code: 'fidelity', name: 'Fidelity', aliases: ['FIDELITY', 'FIDELITYBANK'], domains: ['fidelitybank.ng'] },
  { code: 'fcmb', name: 'FCMB', aliases: ['FCMB', 'FCMBMOBILE'], domains: ['fcmb.com'] },
  { code: 'union', name: 'Union', aliases: ['UNIONBANK', 'UNION', 'UNIONBANKNG', 'UNIONMOBILE'], domains: ['unionbankng.com'] },
  { code: 'wema', name: 'Wema (ALAT)', aliases: ['WEMA', 'WEMABANK', 'ALAT'], domains: ['wemabank.com', 'alat.ng'] },
  { code: 'sterling', name: 'Sterling', aliases: ['STERLING', 'STERLINGBANK', 'ONESTERLING'], domains: ['sterling.ng', 'sterlingbankng.com'] },
  { code: 'stanbic', name: 'Stanbic IBTC', aliases: ['STANBIC', 'STANBICIBTC', 'IBTC'], domains: ['stanbicibtc.com'] },
  { code: 'ecobank', name: 'Ecobank', aliases: ['ECOBANK', 'ECOMOBILE'], domains: ['ecobank.com'] },
  { code: 'polaris', name: 'Polaris', aliases: ['POLARIS', 'POLARISBANK', 'POLARISBANKLTD'], domains: ['polarisbanklimited.com'] },
  { code: 'keystone', name: 'Keystone', aliases: ['KEYSTONE', 'KEYSTONEBANK'], domains: ['keystonebankng.com'] },
  { code: 'unity', name: 'Unity', aliases: ['UNITYBANK', 'UNITY'], domains: ['unitybankng.com'] },
  { code: 'providus', name: 'Providus', aliases: ['PROVIDUS', 'PROVIDUSBANK'], domains: ['providusbank.com'] },
  { code: 'globus', name: 'Globus', aliases: ['GLOBUS', 'GLOBUSBANK'], domains: ['globusbank.com'] },
  { code: 'suntrust', name: 'SunTrust', aliases: ['SUNTRUST', 'SUNTRUSTBANK'] },
  { code: 'titan', name: 'Titan Trust', aliases: ['TITANTRUST', 'TITAN'] },
  { code: 'premiumtrust', name: 'Premium Trust', aliases: ['PREMIUMTRUST', 'PREMIUMTRST', 'PREMIUMTRUSTBANK', 'PTB'], domains: ['premiumtrustbank.com'] },
  { code: 'jaiz', name: 'Jaiz', aliases: ['JAIZ', 'JAIZBANK'], domains: ['jaizbankplc.com'] },
  { code: 'lotus', name: 'Lotus', aliases: ['LOTUS', 'LOTUSBANK'] },
  { code: 'taj', name: 'TAJ Bank', aliases: ['TAJBANK', 'TAJ'] },
  { code: 'opay', name: 'OPay', aliases: ['OPAY', 'PAYCOM'], domains: ['opayweb.com', 'opay-inc.com'] },
  { code: 'palmpay', name: 'PalmPay', aliases: ['PALMPAY'], domains: ['palmpay.com'] },
  { code: 'kuda', name: 'Kuda', aliases: ['KUDA', 'KUDABANK'], domains: ['kuda.com'] },
  { code: 'moniepoint', name: 'Moniepoint', aliases: ['MONIEPOINT', 'MONIE'], domains: ['moniepoint.com'] },
  { code: 'carbon', name: 'Carbon', aliases: ['CARBON', 'GETCARBON'], domains: ['getcarbon.co'] },
  { code: 'fairmoney', name: 'FairMoney', aliases: ['FAIRMONEY'] },
  { code: 'vfd', name: 'VBank', aliases: ['VBANK', 'VFD', 'VFDBANK'], domains: ['vbank.ng', 'vfdgroup.com'] },
  { code: 'rubies', name: 'Rubies', aliases: ['RUBIES', 'RUBIESBANK'] },
  { code: 'sparkle', name: 'Sparkle', aliases: ['SPARKLE'] },
  { code: 'eyowo', name: 'Eyowo', aliases: ['EYOWO'] },
  { code: '9psb', name: '9PSB', aliases: ['9PSB', '9PAYMENTSB', '9MOBILEPSB'] },
  { code: 'momo', name: 'MoMo PSB', aliases: ['MOMOPSB', 'MOMO'] },
  { code: 'smartcash', name: 'SmartCash PSB', aliases: ['SMARTCASH', 'SMARTCASHPSB'] },
];

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

function extractAccountMask(text) {
  const m = (text || '').match(/(?:acc(?:t|ount)?|a\/c)\s*[:.]?\s*[\dx*•]*[*x•](\d{3,4})\b/i);
  return m ? m[1] : null;
}

module.exports = { BANKS, resolveBank, extractAccountMask, jaroWinkler };
