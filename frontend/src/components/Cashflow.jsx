import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

const RANGES = [30, 60, 90];
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

// Small self-contained area chart with an optional zero baseline.
function AreaChart({ values, height = 170 }) {
  const w = 640;
  const pad = 14;
  if (!values || values.length < 2) return <div style={{ height, opacity: 0.5 }} />;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const n = values.length;
  const x = (i) => pad + (i / (n - 1)) * (w - pad * 2);
  const y = (v) => height - pad - ((v - min) / range) * (height - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${height - pad} L ${x(0).toFixed(1)} ${height - pad} Z`;
  const zeroY = y(0);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none">
      <defs>
        <linearGradient id="cf-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent-primary)" stopOpacity="0.30" />
          <stop offset="1" stopColor="var(--accent-primary)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {min < 0 && max > 0 && (
        <line x1={pad} y1={zeroY} x2={w - pad} y2={zeroY} stroke="var(--expense-color)" strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
      )}
      <path d={area} fill="url(#cf-fill)" />
      <path d={line} fill="none" stroke="var(--accent-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ flex: '1 1 200px', background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 16 }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ color: color || 'var(--text-primary)', fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function Cashflow() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (d) => {
    setLoading(true); setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/cashflow/forecast`, {
        params: { days: d }, headers: { Authorization: `Bearer ${token}` },
      });
      setData(res.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load your cashflow forecast.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  // Downsample the daily series to ~40 points for the chart.
  const { vals, firstPt, lastPt } = useMemo(() => {
    const series = data?.series || [];
    if (!series.length) return { vals: [], firstPt: null, lastPt: null };
    const step = Math.max(1, Math.ceil(series.length / 40));
    const pts = [];
    for (let i = 0; i < series.length; i += step) pts.push(series[i]);
    if (pts[pts.length - 1] !== series[series.length - 1]) pts.push(series[series.length - 1]);
    return { vals: pts.map((p) => p.balance), firstPt: pts[0], lastPt: pts[pts.length - 1] };
  }, [data]);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ margin: 0, color: 'var(--text-primary)' }}>Cashflow</h1>
        <p style={{ color: 'var(--text-secondary)', margin: '4px 0 0' }}>
          Where your wallet balance is heading, based on your income, bills and recent spending.
        </p>
      </div>

      {loading && !data ? (
        <div className="loading">Loading your forecast…</div>
      ) : error && !data ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : data ? (
        <>
          {/* Safe to spend hero */}
          <div style={{ borderRadius: 20, padding: 22, color: '#fff', background: 'var(--gradient-primary, linear-gradient(135deg,#0e9f88,#075f4d))' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, opacity: 0.9 }}>SAFE TO SPEND TODAY</div>
            <div style={{ fontSize: 38, fontWeight: 800, marginTop: 4 }}>{fmtNaira(data.safeToSpend)}</div>
            <div style={{ fontSize: 13.5, opacity: 0.9, marginTop: 2 }}>
              after committed bills, before your next income (≈ day {data.payDay})
            </div>
          </div>

          {/* Range tabs */}
          <div style={{ display: 'flex', gap: 8 }}>
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setDays(r)}
                style={{
                  flex: 1, padding: '10px 0', borderRadius: 999, cursor: 'pointer', fontWeight: 700, fontSize: 14,
                  border: '1px solid ' + (days === r ? 'var(--accent-primary)' : 'var(--border-color)'),
                  background: days === r ? 'var(--accent-primary)' : 'var(--card-bg)',
                  color: days === r ? '#04130d' : 'var(--text-secondary)',
                }}
              >{r} days</button>
            ))}
          </div>

          {/* Projection chart */}
          <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--text-primary)' }}>Projected balance</strong>
              <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>next {days} days</span>
            </div>
            <div style={{ marginTop: 8 }}><AreaChart values={vals} /></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-faint)', fontSize: 12 }}>
              <span>{firstPt ? fmtDate(firstPt.date) : ''}</span>
              <span>{lastPt ? fmtDate(lastPt.date) : ''}</span>
            </div>
          </div>

          {/* Shortfall warning */}
          {data.shortfallDate && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 14, borderRadius: 14, border: '1px solid var(--expense-color)', background: 'rgba(239,68,68,0.08)', color: 'var(--text-primary)' }}>
              <span className="material-symbols-outlined" style={{ color: 'var(--expense-color)' }}>warning</span>
              <span>Balance dips below zero around <strong style={{ color: 'var(--expense-color)' }}>{fmtDate(data.shortfallDate)}</strong>. Trim spending or move a bill.</span>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Stat label={`Projected in ${days}d`} value={fmtNaira(data.projectedEnd)} color={data.projectedEnd >= data.currentBalance ? 'var(--income-color)' : 'var(--expense-color)'} />
            <Stat label="Lowest point" value={fmtNaira(data.lowest?.balance)} sub={data.lowest ? fmtDate(data.lowest.date) : ''} color={(data.lowest?.balance ?? 0) < 0 ? 'var(--expense-color)' : 'var(--text-primary)'} />
            <Stat label="Avg daily spend" value={fmtNaira(data.dailyBurn)} />
            <Stat label="Expected income" value={fmtNaira(data.totals?.income)} color="var(--income-color)" />
          </div>

          <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center' }}>
            Estimates use your recurring items and recent spending. Add bills, subscriptions and monthly income (in Settings) for a sharper forecast.
          </p>
        </>
      ) : null}
    </div>
  );
}
