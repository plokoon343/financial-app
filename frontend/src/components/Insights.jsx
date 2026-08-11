import React, { useMemo, useState } from 'react';
import { fmtNaira } from '../utils/format';

// Palette for category legend dots (categories carry no colour of their own).
const PALETTE = ['#14b8a6', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#84cc16', '#ec4899'];

const monthKey = (iso) => String(iso).slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
};
const shiftMonth = (key, delta) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const currentMonth = () => monthKey(new Date().toISOString());

// Trim bank-statement noise into a readable merchant name.
const prettyMerchant = (desc = '') => {
  let s = String(desc).replace(/\b\d[\d,]{3,}\b/g, ' ').replace(/[^\w &.-]/g, ' ').replace(/\s+/g, ' ').trim();
  const stop = /^(nip|transfer|trf|to|from|pos|web|vat|charge|payment|purchase|ref|txn)$/i;
  const words = s.split(' ').filter((w) => w && !stop.test(w)).slice(0, 3);
  s = words.join(' ') || (String(desc).trim().split(' ')[0] || 'Payment');
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
};

function AreaChart({ values, height = 120 }) {
  const w = 640, pad = 12;
  if (!values || values.length < 2) return <div style={{ height, opacity: 0.4 }} />;
  const min = Math.min(0, ...values), max = Math.max(0, ...values), range = (max - min) || 1, n = values.length;
  const x = (i) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v) => height - pad - ((v - min) / range) * (height - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs><linearGradient id="ins-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--accent-primary)" stopOpacity="0.28" />
        <stop offset="1" stopColor="var(--accent-primary)" stopOpacity="0.02" />
      </linearGradient></defs>
      {min < 0 && max > 0 && <line x1={pad} y1={y(0)} x2={w - pad} y2={y(0)} stroke="var(--text-faint)" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />}
      <path d={area} fill="url(#ins-fill)" />
      <path d={line} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const Card = ({ title, right, children }) => (
  <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 18 }}>
    {(title || right) && (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        {title && <strong style={{ color: 'var(--text-primary)', fontSize: 16 }}>{title}</strong>}
        {right}
      </div>
    )}
    {children}
  </div>
);

export default function Insights({ transactions = [] }) {
  const [month, setMonth] = useState(currentMonth());
  const isCurrent = month === currentMonth();

  const inMonth = useMemo(
    () => transactions.filter((t) => monthKey(t.date) === month),
    [transactions, month],
  );

  const income = useMemo(() => inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0), [inMonth]);
  const expense = useMemo(() => inMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0), [inMonth]);
  const net = income - expense;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;

  const cats = useMemo(() => {
    const map = new Map();
    inMonth.filter((t) => t.type === 'expense').forEach((t) => map.set(t.category || 'Other', (map.get(t.category || 'Other') || 0) + Math.abs(t.amount)));
    const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 6);
    const otherSum = sorted.slice(6).reduce((s, [, v]) => s + v, 0);
    const rows = top.map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }));
    if (otherSum > 0) rows.push({ label: 'Other', value: otherSum, color: 'var(--text-faint)' });
    return { rows, total: sorted.reduce((s, [, v]) => s + v, 0) };
  }, [inMonth]);

  const merchants = useMemo(() => {
    const map = new Map();
    inMonth.filter((t) => t.type === 'expense').forEach((t) => { const k = prettyMerchant(t.description); map.set(k, (map.get(k) || 0) + Math.abs(t.amount)); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [inMonth]);

  const spotlight = useMemo(() => {
    if (income <= 0) return null;
    const m = merchants[0]; const c = cats.rows.filter((r) => r.label !== 'Other')[0];
    const mPct = m ? m[1] / income : 0; const cPct = c ? c.value / income : 0;
    if (Math.max(mPct, cPct) < 0.05) return null;
    const useM = mPct >= cPct;
    const name = useM ? m[0] : c.label; const value = useM ? m[1] : c.value; const pct = Math.round((useM ? mPct : cPct) * 100);
    const line = pct >= 40 ? 'That is a serious chunk of your income.'
      : pct >= 25 ? 'A big slice of what came in this month.'
      : pct >= 15 ? 'Worth keeping an eye on.' : 'Your biggest single drain this month.';
    return { name, value, pct, line };
  }, [income, merchants, cats]);

  const projection = useMemo(() => {
    if (!isCurrent || expense <= 0) return null;
    const now = new Date(); const day = now.getDate();
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    if (day < 3) return null;
    const projected = Math.round((expense / day) * dim);
    return { projected, pctIncome: income > 0 ? Math.round((projected / income) * 100) : null };
  }, [isCurrent, expense, income]);

  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => shiftMonth(month, -(5 - i))), [month]);
  const trend = useMemo(() => months.map((mk) => {
    const t = transactions.filter((x) => monthKey(x.date) === mk);
    const inc = t.filter((x) => x.type === 'income').reduce((s, x) => s + Math.abs(x.amount), 0);
    const exp = t.filter((x) => x.type === 'expense').reduce((s, x) => s + Math.abs(x.amount), 0);
    return inc - exp;
  }), [months, transactions]);

  if (!transactions.length) {
    return <div className="empty-state"><h3>No insights yet</h3><p>Add or import some transactions to see where your money goes.</p></div>;
  }

  const monthNav = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="icon-btn" style={btnStyle}>‹</button>
      <span style={{ color: 'var(--text-primary)', fontWeight: 700, minWidth: 140, textAlign: 'center' }}>{monthLabel(month)}</span>
      <button onClick={() => { if (!isCurrent) setMonth((m) => shiftMonth(m, 1)); }} disabled={isCurrent} style={{ ...btnStyle, opacity: isCurrent ? 0.4 : 1 }}>›</button>
    </div>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, color: 'var(--text-primary)' }}>Insights</h1>
          <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>Where your money went, and where it's heading.</p>
        </div>
        {monthNav}
      </div>

      {/* Spotlight */}
      {spotlight && (
        <div style={{ background: 'color-mix(in srgb, var(--accent-primary) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 40%, transparent)', borderRadius: 18, padding: 18 }}>
          <div style={{ color: 'var(--accent-primary)', fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Spotlight{isCurrent ? ' · this month' : ''}</div>
          <div style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 700, lineHeight: 1.35, marginTop: 6 }}>
            <span style={{ color: 'var(--accent-primary)', fontSize: 26, fontWeight: 900 }}>{spotlight.pct}%</span> of your income went to <span style={{ fontWeight: 900 }}>{spotlight.name}</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>{fmtNaira(spotlight.value)} · {spotlight.line}</div>
        </div>
      )}

      {/* Income vs Expense */}
      <Card title="Income vs Expense">
        <Bar label="Income" value={income} max={Math.max(income, expense, 1)} color="var(--income-color)" />
        <Bar label="Expense" value={expense} max={Math.max(income, expense, 1)} color="var(--expense-color)" />
        <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-color)', marginTop: 12, paddingTop: 12 }}>
          <div><div style={dim}>Net</div><div style={{ ...big, color: net >= 0 ? 'var(--income-color)' : 'var(--expense-color)' }}>{net >= 0 ? '+' : '−'}{fmtNaira(Math.abs(net))}</div></div>
          <div style={{ textAlign: 'right' }}><div style={dim}>Savings rate</div><div style={{ ...big, color: savingsRate >= 0 ? 'var(--income-color)' : 'var(--expense-color)' }}>{savingsRate}%</div></div>
        </div>
        {projection && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: '1px solid var(--border-color)', marginTop: 12, paddingTop: 12, color: 'var(--text-secondary)', fontSize: 14 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>trending_up</span>
            <span>On track for <strong style={{ color: 'var(--text-primary)' }}>{fmtNaira(projection.projected)}</strong> by month end{projection.pctIncome != null ? ` (${projection.pctIncome}% of income)` : ''}</span>
          </div>
        )}
      </Card>

      {/* Where it went */}
      <Card title="Where it went">
        {cats.rows.length === 0 ? <p style={{ color: 'var(--text-secondary)' }}>No expenses this month.</p> : cats.rows.map((r) => (
          <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: r.color, flex: 'none' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{r.label}</div>
              {income > 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{Math.round((r.value / income) * 100)}% of income</div>}
            </div>
            <div style={{ color: 'var(--text-faint)', fontSize: 13, width: 44, textAlign: 'right' }}>{Math.round((r.value / (cats.total || 1)) * 100)}%</div>
            <div style={{ color: 'var(--text-secondary)', fontWeight: 700, width: 96, textAlign: 'right' }}>{fmtNaira(r.value)}</div>
          </div>
        ))}
      </Card>

      {/* Top merchants */}
      {merchants.length > 0 && (
        <Card title="Top merchants">
          {merchants.map(([name, v], i) => (
            <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0' }}>
              <span style={{ width: 24, height: 24, borderRadius: 8, background: 'var(--bg-elevated, var(--secondary-bg))', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <div style={{ flex: 1, color: 'var(--text-primary)', fontWeight: 600 }}>{name}</div>
              {income > 0 && <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{Math.round((v / income) * 100)}% of income</div>}
              <div style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{fmtNaira(v)}</div>
            </div>
          ))}
        </Card>
      )}

      {/* Net trend */}
      <Card title="Net trend · last 6 months">
        <AreaChart values={trend} />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          {months.map((mk) => <span key={mk} style={{ color: 'var(--text-faint)', fontSize: 11, flex: 1, textAlign: 'center' }}>{monthLabel(mk).slice(0, 3)}</span>)}
        </div>
      </Card>
    </div>
  );
}

const dim = { color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600 };
const big = { fontSize: 20, fontWeight: 800, marginTop: 2 };
const btnStyle = { width: 32, height: 32, borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 18, lineHeight: 1 };

function Bar({ label, value, max, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '6px 0' }}>
      <span style={{ color: 'var(--text-secondary)', fontSize: 13, width: 64 }}>{label}</span>
      <div style={{ flex: 1, height: 10, borderRadius: 6, background: 'var(--secondary-bg)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${(value / max) * 100}%`, background: color, borderRadius: 6 }} />
      </div>
      <span style={{ color, fontSize: 13, fontWeight: 700, width: 96, textAlign: 'right' }}>{fmtNaira(value)}</span>
    </div>
  );
}
