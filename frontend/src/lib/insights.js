// Web port of the mobile "identity engine" (finpilot-mobile/src/lib/*): the
// Voice, spending Archetypes, the clarity streak + season, and salary-day
// detection. All pure and on-device — computed from the user's own transactions,
// nothing leaves the browser, no AI cost. Icons are material-symbols names (the
// web app's icon font); no emoji. Keep this in sync with the mobile libs.

// ---------------------------------------------------------------------------
// prettyMerchant — turn a raw (often bank-imported) description into a friendly
// name. Ported from finpilot-mobile/src/lib/txnDisplay.ts.
// ---------------------------------------------------------------------------
const NOISE = /^(NIP|NXG|NEFT|RTGS|TRF|TRANSFER|TRANSFERTO|TRFTO|TO|FRM|FROM|REF|USSD|POS|WEB|MOB|MOBILE|VISA|MC|MASTERCARD|VERVE|ATM|CASH|WD|GTB|GTBANK|KUDA|UBA|ACCESS|ZENITH|FIRSTBANK|FBN|OPAY|PALMPAY|MONIEPOINT|WEMA|FIDELITY|STANBIC|UNION|POLARIS|FCMB|STERLING|ECOBANK|JAIZ|KEYSTONE|PROVIDUS|BANK|PLC|MFB|LTD|LIMITED|NG|NGN|VAT|CHARGE|CHARGES|FEE|FEES|COMM|LEVY|SESSION|SESSIONID|RRN|APPROVED|SUCCESSFUL|PAYMENT|PMT|DR|CR)$/i;
const titleCase = (s) => s.toLowerCase().replace(/\b[\w']/g, (c) => c.toUpperCase());
const cap = (s) => (s.length > 26 ? s.slice(0, 26) + '…' : s);

export function prettyMerchant(raw) {
  if (!raw || !String(raw).trim()) return 'Transaction';
  const original = String(raw).trim();
  if (!/[/|\\:]/.test(original)) {
    return cap(/[a-z]/.test(original) ? original : titleCase(original));
  }
  const parts = original.split(/[/|\\:]+/).map((p) => p.trim()).filter(Boolean);
  const stripCode = (p) => p.replace(/\b(?=[a-z0-9]*\d)[a-z0-9]{5,}\b/gi, '').replace(/\s+/g, ' ').trim();
  const candidates = parts
    .map(stripCode)
    .filter((p) => /[a-zA-Z]/.test(p) && !NOISE.test(p.replace(/\s+/g, '')) && p.length > 1);
  const nameLike = candidates.filter((p) => /^[a-zA-Z][a-zA-Z .'&]+$/.test(p) && p.split(/\s+/).length >= 2);
  const pick = nameLike.sort((a, b) => b.length - a.length)[0]
    || candidates.sort((a, b) => b.length - a.length)[0];
  return pick ? cap(titleCase(pick)) : cap(original);
}

// ---------------------------------------------------------------------------
// Archetypes — a month's pattern as a shareable money personality. Never shows a
// naira figure, so it's safe to screenshot. Ported from archetype.ts (Ionicons
// glyphs swapped for material-symbols names).
// ---------------------------------------------------------------------------
const LIFESTYLE = new Set(['Food', 'Shopping', 'Entertainment', 'Subscriptions']);
const UNTRACEABLE = new Set(['Transfer', 'Other', 'ATM/POS']);

export function computeArchetype(all, income, monthKey) {
  const month = all.filter((t) => (t.date || '').slice(0, 7) === monthKey);
  const expenses = month.filter((t) => t.type === 'expense');
  const totalExpense = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  if (expenses.length < 4 || totalExpense <= 0) return null;

  const inc = income > 0 ? income : month.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = inc - totalExpense;
  const savingsRate = inc > 0 ? net / inc : 0;
  const expenseToIncome = inc > 0 ? totalExpense / inc : 1.2;

  const shareOf = (pred) =>
    expenses.filter((t) => pred(t.category || 'Other')).reduce((s, t) => s + Math.abs(t.amount), 0) / totalExpense;
  const lifestyleShare = shareOf((c) => LIFESTYLE.has(c));
  const untraceableShare = shareOf((c) => UNTRACEABLE.has(c) || !c);
  const subShare = shareOf((c) => c === 'Subscriptions');
  const savingsShare = shareOf((c) => c === 'Savings');
  const subCount = expenses.filter((t) => (t.category || '') === 'Subscriptions').length;

  const y = +monthKey.slice(0, 4), mo = +monthKey.slice(5, 7);
  const daysInMonth = new Date(y, mo, 0).getDate();
  const lastWeek = expenses.filter((t) => +(t.date || '0000-00-00').slice(8, 10) > daysInMonth - 7)
    .reduce((s, t) => s + Math.abs(t.amount), 0) / totalExpense;

  const signals = { savingsRate, lifestyleShare, untraceableShare, lastWeekShare: lastWeek, expenseToIncome };

  let a;
  if (untraceableShare >= 0.5) {
    a = { key: 'ghost', name: 'The Ghost Spender', icon: 'visibility_off', color: '#6b7280',
      tagline: 'Money enter, money disappear. No receipts, no memory.',
      blurb: 'Most of your spending vanished into transfers and untracked cash.' };
  } else if (lastWeek >= 0.5) {
    a = { key: 'detonator', name: 'The Last-Week Detonator', icon: 'local_fire_department', color: '#ef4444',
      tagline: "Three weeks of calm, then the last week said 'hold my drink.'",
      blurb: 'Half your month’s spending detonated in the final seven days.' };
  } else if (subShare >= 0.15 || subCount >= 4) {
    a = { key: 'subs', name: 'The Subscription Collector', icon: 'repeat', color: '#8b5cf6',
      tagline: 'You’re funding apps you forgot you married.',
      blurb: 'A big slice of your money goes to recurring subscriptions.' };
  } else if (savingsRate >= 0.25 || savingsShare >= 0.15) {
    a = { key: 'ajo', name: 'The Ajo Loyalist', icon: 'verified_user', color: '#0ea5e9',
      tagline: 'Discipline na your middle name. Small small, consistently.',
      blurb: 'You put a healthy chunk away before spending. Steady hands.' };
  } else if (lifestyleShare >= 0.4 && savingsRate > 0) {
    a = { key: 'softlife', name: 'The Soft-Life Economist', icon: 'diamond', color: '#f59e0b',
      tagline: 'Soft life, but the maths still maths. Enjoyment with sense.',
      blurb: 'You enjoy the finer things — and still finished the month in the green.' };
  } else if (expenseToIncome > 1) {
    a = { key: 'sapa', name: 'The Sapa Survivor', icon: 'fitness_center', color: '#f97316',
      tagline: 'You stretched the last change into a full week. Legend.',
      blurb: 'You spent more than came in — but you’re surviving on strategy.' };
  } else if (expenseToIncome >= 0.9 && lifestyleShare >= 0.25) {
    a = { key: 'detty', name: 'The Detty Prophet', icon: 'auto_awesome', color: '#ec4899',
      tagline: 'You planned to save. You spent. No regrets, prophet.',
      blurb: 'Nearly everything that came in went back out — and you enjoyed it.' };
  } else {
    a = { key: 'steady', name: 'The Steady Hand', icon: 'workspace_premium', color: '#14b8a6',
      tagline: 'No drama, no chaos — just a balanced month.',
      blurb: 'Your spending was spread out and under control. Quietly winning.' };
  }
  return { archetype: a, signals };
}

// ---------------------------------------------------------------------------
// The Voice — witty, Naija-flavoured reactions to the month. Ported from voice.ts.
// `fmt` is the caller's money formatter (respects hide-balance).
// ---------------------------------------------------------------------------
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function seededOrder(arr, seedStr) {
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
  const a = arr.map((v, i) => ({ v, k: ((seed ^ (i * 2654435761)) >>> 0) }));
  a.sort((x, y) => x.k - y.k);
  return a.map((x) => x.v);
}

export function buildVoiceLines(all, income, monthKey, fmt) {
  const month = all.filter((t) => (t.date || '').slice(0, 7) === monthKey);
  const expenses = month.filter((t) => t.type === 'expense');
  const totalExpense = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  if (expenses.length < 3 || totalExpense <= 0) return [];

  const inc = income > 0 ? income : month.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = inc - totalExpense;
  const savingsRate = inc > 0 ? pct(net, inc) : 0;

  const byM = new Map();
  expenses.forEach((t) => { const k = prettyMerchant(t.description); byM.set(k, (byM.get(k) || 0) + Math.abs(t.amount)); });
  const topM = [...byM.entries()].sort((a, b) => b[1] - a[1])[0];
  const byC = new Map();
  expenses.forEach((t) => { const c = t.category || 'Other'; byC.set(c, (byC.get(c) || 0) + Math.abs(t.amount)); });
  const topC = [...byC.entries()].sort((a, b) => b[1] - a[1])[0];
  const catAmt = (c) => byC.get(c) || 0;

  const biggest = expenses.reduce((m, t) => (Math.abs(t.amount) > Math.abs((m && m.amount) || 0) ? t : m), null);
  const topMCount = topM ? expenses.filter((t) => prettyMerchant(t.description) === topM[0]).length : 0;

  const spentDays = new Set(expenses.map((t) => t.date));
  const now = new Date();
  const isCurrent = monthKey === now.toISOString().slice(0, 7);
  const elapsed = isCurrent ? now.getDate() : new Date(+monthKey.slice(0, 4), +monthKey.slice(5, 7), 0).getDate();
  const noSpendDays = Math.max(0, elapsed - spentDays.size);

  const lines = [];
  const add = (id, text, tone) => lines.push({ id, text, tone });

  if (topM && topM[1] > 0) {
    if (topMCount >= 4) add('merch-loyal', `${topMCount} visits to ${topM[0]} this month. Una relationship don pass friendship.`, 'roast');
    else add('merch-top', `${topM[0]} collected ${fmt(topM[1])} from you this month. Send them a thank-you card.`, 'roast');
  }
  if (topC) {
    const share = pct(topC[1], totalExpense);
    if (topC[0] === 'Food') add('cat-food', `${share}% of your money went to chop. The streets dey chop your salary well well.`, 'roast');
    else if (topC[0] === 'Transport') add('cat-trans', `Transport swallowed ${share}% this month. The road no be your padi.`, 'observe');
    else if (topC[0] === 'Airtime & Data') add('cat-data', `You fed the network ${fmt(topC[1])} in airtime & data. MTN sends its regards.`, 'roast');
    else add('cat-top', `${topC[0]} took the biggest bite — ${share}% of everything you spent.`, 'observe');
  }
  const subs = catAmt('Subscriptions');
  if (subs > 0) add('subs', `Subscriptions quietly removed ${fmt(subs)}. Check the ones wey you don forget.`, 'nudge');

  if (biggest) {
    const share = pct(Math.abs(biggest.amount), totalExpense);
    if (share >= 25) add('big', `One transaction carried ${share}% of your month's spend. That one na statement.`, 'observe');
  }
  if (savingsRate >= 20) add('save-good', `You kept ${savingsRate}% this month. Future you is standing up to clap.`, 'praise');
  else if (net < 0) add('overspend', `You spent pass wetin enter this month. Sapa dey plan attendance — lock something small away.`, 'nudge');
  else if (savingsRate > 0 && savingsRate < 10) add('save-low', `You saved ${savingsRate}%. Small progress still be progress — push am reach 20%.`, 'nudge');

  if (noSpendDays >= 3) add('nospend', `${noSpendDays} days you spent nothing at all. Monk behaviour. Respect.`, 'praise');

  const [yy, mm] = monthKey.split('-').map(Number);
  const prevD = new Date(yy, mm - 2, 1);
  const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, '0')}`;
  const prevExp = all.filter((t) => t.type === 'expense' && (t.date || '').slice(0, 7) === prevKey).reduce((s, t) => s + Math.abs(t.amount), 0);
  if (prevExp > 0) {
    const daysThis = isCurrent ? now.getDate() : new Date(yy, mm, 0).getDate();
    const daysPrev = new Date(prevD.getFullYear(), prevD.getMonth() + 1, 0).getDate();
    const thisPace = totalExpense / daysThis;
    const prevPace = prevExp / daysPrev;
    if (thisPace < prevPace * 0.9) add('better', `You're spending ${Math.round((1 - thisPace / prevPace) * 100)}% less per day than last month. This na growth — keep going.`, 'praise');
    let bestCut = { cat: '', drop: 0 };
    byC.forEach((amt, c) => {
      const prevCat = all.filter((t) => t.type === 'expense' && (t.category || 'Other') === c && (t.date || '').slice(0, 7) === prevKey).reduce((s, t) => s + Math.abs(t.amount), 0);
      if (prevCat > 0 && amt < prevCat * 0.85) { const drop = Math.round((1 - amt / prevCat) * 100); if (drop > bestCut.drop) bestCut = { cat: c, drop }; }
    });
    if (bestCut.cat) add('cat-better', `You cut ${bestCut.cat} spend by ${bestCut.drop}% vs last month. Discipline is showing.`, 'praise');
  }

  return seededOrder(lines, monthKey).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Clarity streak (consecutive days the user opened Insights) — localStorage, the
// browser equivalent of the mobile AsyncStorage version. Plus the playful season.
// ---------------------------------------------------------------------------
const STREAK_KEY = 'clarity_checkins';
const dayStr = (d) => d.toISOString().slice(0, 10);

export function recordCheckin() {
  try {
    let days = JSON.parse(localStorage.getItem(STREAK_KEY) || '[]');
    const t = dayStr(new Date());
    if (!days.includes(t)) days.push(t);
    days = [...new Set(days)].sort().slice(-400);
    localStorage.setItem(STREAK_KEY, JSON.stringify(days));
  } catch { /* ignore */ }
}

export function getStreak() {
  try {
    const set = new Set(JSON.parse(localStorage.getItem(STREAK_KEY) || '[]'));
    let streak = 0;
    const d = new Date();
    while (set.has(dayStr(d))) { streak += 1; d.setDate(d.getDate() - 1); }
    return streak;
  } catch { return 0; }
}

export function seasonFor(monthKey) {
  switch (+monthKey.slice(5, 7)) {
    case 12: return 'Detty December';
    case 1: return 'January-is-a-scam';
    case 2: return 'Val-month economics';
    case 3: return 'End-of-semester survival';
    case 4: case 5: return 'Rainy-season budgeting';
    case 6: case 7: case 8: return 'Mid-year hustle';
    case 9: return 'Back-to-school season';
    case 10: case 11: return 'Ember-months alert';
    default: return 'Regular programming';
  }
}

// ---------------------------------------------------------------------------
// Salary-day detection — a large recent income that looks like a paycheck.
// Ported from salaryDay.ts (seen-state via localStorage). For a future Home
// prompt on the web.
// ---------------------------------------------------------------------------
const SALARY_SEEN_KEY = 'salary_prompt_seen';

export function detectSalary(all, monthlyIncome) {
  const now = new Date();
  const cutoff = new Date(now); cutoff.setDate(now.getDate() - 4);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const recent = all.filter((t) => t.type === 'income' && (t.date || '') >= cutoffStr);
  if (!recent.length) return null;

  const top = recent.reduce((m, t) => (Math.abs(t.amount) > Math.abs(m.amount) ? t : m));
  const amt = Math.abs(top.amount);
  const looksSalary = top.category === 'Salary' || (!!monthlyIncome && amt >= monthlyIncome * 0.5) || amt >= 30000;
  if (!looksSalary) return null;

  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
  const pm = all.filter((t) => (t.date || '').slice(0, 7) === prevKey);
  const pmInc = pm.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const pmExp = pm.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const lastMonthSpentPct = pmInc > 0 ? Math.round((pmExp / pmInc) * 100) : null;

  return { id: `${top.date}-${Math.round(amt)}`, date: top.date, amount: amt, lastMonthSpentPct };
}

export function salaryPromptSeen(id) {
  try { return localStorage.getItem(SALARY_SEEN_KEY) === id; } catch { return false; }
}
export function markSalaryPromptSeen(id) {
  try { localStorage.setItem(SALARY_SEEN_KEY, id); } catch { /* ignore */ }
}
