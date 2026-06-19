import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts';
import { fmtNaira } from '../utils/format';

const INCOME = '#10b981';
const EXPENSE = '#ef4444';
const ACCENT = '#3b82f6';
const CAT_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' });
};

const REPORTS = [
  { key: 'incexp', label: 'Income vs Expense', icon: 'fa-scale-balanced' },
  { key: 'savings', label: 'Monthly Savings', icon: 'fa-piggy-bank' },
  { key: 'expense', label: 'Expense Breakdown', icon: 'fa-tags' },
  { key: 'cashflow', label: 'Cumulative Cashflow', icon: 'fa-chart-area' },
];

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rep-tip">
      {label && <div className="rep-tip-label">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="rep-tip-row">
          <span style={{ color: p.color || p.fill }}>{p.name}</span>
          <strong>{fmtNaira(p.value)}</strong>
        </div>
      ))}
    </div>
  );
};

const FinancialReports = ({ transactions = [] }) => {
  const [report, setReport] = useState('incexp');

  const { months, categories, totals } = useMemo(() => {
    const byMonth = {};
    const byCat = {};
    let totalIncome = 0, totalExpense = 0;
    for (const t of transactions) {
      const amt = Math.abs(t.amount);
      const m = new Date(t.date).toISOString().slice(0, 7);
      byMonth[m] = byMonth[m] || { ym: m, income: 0, expense: 0 };
      if (t.type === 'income') { byMonth[m].income += amt; totalIncome += amt; }
      else {
        byMonth[m].expense += amt; totalExpense += amt;
        const c = t.category || 'Other';
        byCat[c] = (byCat[c] || 0) + amt;
      }
    }
    let running = 0;
    const months = Object.values(byMonth)
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .map((r) => {
        const savings = r.income - r.expense;
        running += savings;
        return { ...r, label: monthLabel(r.ym), savings, cumulative: running };
      });
    const categories = Object.entries(byCat)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);
    return { months, categories, totals: { totalIncome, totalExpense, net: totalIncome - totalExpense } };
  }, [transactions]);

  const avgSavings = months.length ? months.reduce((s, m) => s + m.savings, 0) / months.length : 0;
  const topCat = categories[0];

  const headline = {
    incexp: { label: 'Net across period', value: fmtNaira(totals.net), color: totals.net >= 0 ? INCOME : EXPENSE },
    savings: { label: 'Avg. monthly savings', value: fmtNaira(avgSavings), color: avgSavings >= 0 ? INCOME : EXPENSE },
    expense: { label: 'Top category', value: topCat ? `${topCat.name} · ${fmtNaira(topCat.value)}` : '—', color: EXPENSE },
    cashflow: { label: 'Ending balance (period)', value: fmtNaira(months.length ? months[months.length - 1].cumulative : 0), color: ACCENT },
  }[report];

  if (transactions.length === 0) {
    return <div className="rep-empty">Add or import some transactions to see reports.</div>;
  }

  return (
    <div className="reports">
      <div className="rep-selector">
        {REPORTS.map((r) => (
          <button key={r.key} className={`rep-chip ${report === r.key ? 'active' : ''}`} onClick={() => setReport(r.key)}>
            <i className={`fas ${r.icon}`}></i> <span>{r.label}</span>
          </button>
        ))}
      </div>

      <div className="rep-card">
        <div className="rep-head">
          <h3>{REPORTS.find((r) => r.key === report).label}</h3>
          <div className="rep-headline" style={{ color: headline.color }}>
            <span className="rep-headline-label">{headline.label}</span>
            <span className="rep-headline-value">{headline.value}</span>
          </div>
        </div>

        <div className="rep-chart">
          <ResponsiveContainer width="100%" height={340}>
            {report === 'incexp' ? (
              <BarChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis tickFormatter={(v) => fmtNaira(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={70} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                <Legend />
                <Bar dataKey="income" name="Income" fill={INCOME} radius={[4, 4, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill={EXPENSE} radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : report === 'savings' ? (
              <AreaChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSav" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={INCOME} stopOpacity={0.5} />
                    <stop offset="100%" stopColor={INCOME} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis tickFormatter={(v) => fmtNaira(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="savings" name="Savings" stroke={INCOME} strokeWidth={2.5} fill="url(#gSav)" />
              </AreaChart>
            ) : report === 'expense' ? (
              <BarChart data={categories} layout="vertical" margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => fmtNaira(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(148,163,184,0.08)' }} />
                <Bar dataKey="value" name="Spent" radius={[0, 4, 4, 0]}>
                  {categories.map((_, i) => <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />)}
                </Bar>
              </BarChart>
            ) : (
              <LineChart data={months} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.18)" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                <YAxis tickFormatter={(v) => fmtNaira(v)} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={70} />
                <Tooltip content={<ChartTooltip />} />
                <Line type="monotone" dataKey="cumulative" name="Cumulative" stroke={ACCENT} strokeWidth={2.5} dot={{ r: 3 }} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>

        {report === 'expense' && (
          <div className="rep-legend">
            {categories.map((c, i) => (
              <div key={c.name} className="rep-legend-item">
                <span className="rep-dot" style={{ background: CAT_COLORS[i % CAT_COLORS.length] }}></span>
                <span className="rep-legend-name">{c.name}</span>
                <span className="rep-legend-val">{fmtNaira(c.value)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx="true">{`
        .reports { display: flex; flex-direction: column; gap: 16px; }
        .rep-selector { display: flex; flex-wrap: wrap; gap: 10px; }
        .rep-chip { display: inline-flex; align-items: center; gap: 8px; padding: 10px 16px; border-radius: var(--radius-full); border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-secondary); font-weight: 600; font-size: 0.9rem; cursor: pointer; transition: all var(--transition-fast); }
        .rep-chip:hover { transform: translateY(-2px); color: var(--text-primary); }
        .rep-chip.active { background: var(--gradient-primary); color: #fff; border-color: transparent; box-shadow: var(--shadow-md); }
        .rep-card { background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); }
        .rep-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; }
        .rep-head h3 { font-family: var(--font-heading); font-size: 1.35rem; color: var(--text-primary); margin: 0; }
        .rep-headline { display: flex; flex-direction: column; align-items: flex-end; }
        .rep-headline-label { font-size: 0.8rem; color: var(--text-secondary); }
        .rep-headline-value { font-family: var(--font-accent); font-weight: 800; font-size: 1.3rem; }
        .rep-chart { width: 100%; }
        .rep-tip { background: var(--bg-elevated, #1a2540); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px; box-shadow: var(--shadow-md); }
        .rep-tip-label { color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 6px; }
        .rep-tip-row { display: flex; gap: 16px; justify-content: space-between; font-size: 0.9rem; color: var(--text-primary); }
        .rep-legend { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin-top: 14px; }
        .rep-legend-item { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; color: var(--text-primary); }
        .rep-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
        .rep-legend-name { flex: 1; color: var(--text-secondary); }
        .rep-legend-val { font-family: var(--font-accent); font-weight: 700; }
        .rep-empty { text-align: center; padding: 50px 20px; color: var(--text-secondary); background: var(--glass-bg); border-radius: var(--radius-lg); }
      `}</style>
    </div>
  );
};

export default FinancialReports;
