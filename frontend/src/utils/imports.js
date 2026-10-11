// Group what the user brought in, by the bank that sent it (never by the channel):
// - statements: each uploaded file (one importBatch), deletable as a whole;
// - alerts: SMS, email, shared and notification alerts, one group per bank.
// Each group shows the dates it covers so gaps between imports are easy to spot.
const ALERT = new Set(['sms', 'email', 'share', 'notification']);
const CHANNEL_WORD = /^\s*(sms|e-?mails?|shared?|texts?|alerts?|notifications?)\s*$/i;
const SOURCE_CHANNEL = { import: 'statement', sms: 'sms', email: 'email', share: 'share', notification: 'notification', receipt: 'receipt', manual: 'manual' };

export const channelOf = (t) => t.channel || (t.source === 'import' && CHANNEL_WORD.test(t.bank || '') ? 'sms' : SOURCE_CHANNEL[t.source] || 'manual');
const bankOf = (t) => (t.bank && !CHANNEL_WORD.test(t.bank) ? t.bank : '');
export const CHANNEL_LABEL = { sms: 'SMS', email: 'email', share: 'shared', notification: 'app notification' };
export const UNKNOWN_BANK = 'Bank not known yet';

const span = (g, d) => {
  const t = +new Date(d);
  if (Number.isNaN(t)) return;
  if (!g.from || t < g.from) g.from = t;
  if (!g.to || t > g.to) g.to = t;
};

export function groupImports(txns) {
  const statements = new Map();
  const alerts = new Map();
  for (const t of txns || []) {
    const channel = channelOf(t);
    if (channel === 'statement' && t.importBatch) {
      const g = statements.get(t.importBatch) || { id: t.importBatch, banks: {}, count: 0, total: 0, importedAt: t.importedAt, from: 0, to: 0 };
      const b = bankOf(t);
      if (b) g.banks[b] = (g.banks[b] || 0) + 1;
      g.count += 1; g.total += Math.abs(t.amount || 0);
      span(g, t.date);
      statements.set(t.importBatch, g);
    } else if (ALERT.has(channel)) {
      const bank = bankOf(t) || UNKNOWN_BANK;
      const g = alerts.get(bank) || { bank, count: 0, total: 0, channels: {}, from: 0, to: 0 };
      g.count += 1; g.total += Math.abs(t.amount || 0);
      g.channels[channel] = (g.channels[channel] || 0) + 1;
      span(g, t.date);
      alerts.set(bank, g);
    }
  }
  const top = (banks) => Object.entries(banks).sort((a, b) => b[1] - a[1])[0]?.[0] || UNKNOWN_BANK;
  return {
    statements: [...statements.values()]
      .map((g) => ({ ...g, bank: top(g.banks) }))
      .sort((a, b) => new Date(b.importedAt || 0) - new Date(a.importedAt || 0)),
    alerts: [...alerts.values()].sort((a, b) => (a.bank === UNKNOWN_BANK) - (b.bank === UNKNOWN_BANK) || b.count - a.count),
  };
}

// "3 Sep to 28 Oct 2026" (or one date).
export function rangeLabel(from, to) {
  if (!from) return '';
  const f = new Date(from), t = new Date(to || from);
  const sameYear = f.getFullYear() === t.getFullYear();
  const d = (x, withYear) => x.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  if (f.toDateString() === t.toDateString()) return d(f, true);
  return `${d(f, !sameYear)} to ${d(t, true)}`;
}
