import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Admin: core metrics. Acquisition, activation, engagement, retention, money and
// import health from GET /api/admin/metrics (aggregates only, no personal data).
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const SOURCES = { manual: 'Typed in', import: 'Statement', sms: 'SMS', email: 'Email forwarding', share: 'Shared alert', notification: 'Bank app notification', receipt: 'Receipt scan' };
const CLIENTS = { web: 'Web', 'android-beta': 'Android (website APK)', 'android-play': 'Android (Play)', ios: 'iPhone', unknown: 'Not recorded' };
const PLAN_NAMES = { pro: 'Plus', student: 'Student', sync: 'Pro', power: 'Power' };
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
const pctText = (v) => (v == null ? '–' : `${v}%`);

// One series of bars with a hover tooltip. Single series: the title names it, no legend.
function Bars({ data, label, valueOf, labelOf, tipOf }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...data.map(valueOf));
  return (
    <figure className="ma-chart" aria-label={label}>
      <div className="ma-bars" onMouseLeave={() => setHover(null)}>
        {data.map((d, i) => (
          <div key={labelOf(d)} className="ma-hit" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
            aria-label={tipOf(d)}>
            <div className="ma-bar" style={{ height: `${(valueOf(d) / max) * 100}%` }} />
          </div>
        ))}
        {hover != null && (
          <div className="ma-tip" style={{ left: `${((hover + 0.5) / data.length) * 100}%` }} role="status">{tipOf(data[hover])}</div>
        )}
      </div>
      <div className="ma-axis"><span>{labelOf(data[0])}</span><span>max {max}</span><span>{labelOf(data[data.length - 1])}</span></div>
    </figure>
  );
}

function Tile({ label, value, sub }) {
  return <div className="ma-tile"><div className="ma-tile-label">{label}</div><div className="ma-tile-value">{value}</div>{sub && <div className="ma-muted">{sub}</div>}</div>;
}

export default function MetricsAdmin() {
  const [m, setM] = useState(null);
  const [weeks, setWeeks] = useState(8);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    axios.get(`${API_URL}/api/admin/metrics?weeks=${weeks}`, auth()).then((r) => setM(r.data)).catch(() => setError('Could not load the metrics.'));
  }, [weeks]);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="message error">{error}</div>;
  if (!m) return <div className="loading-container"><div className="loading-spinner"></div></div>;
  const { active, money, activation, imports: im } = m;
  const firstTotal = Object.values(activation.firstSource).reduce((s, n) => s + n, 0);

  return (
    <div className="ma">
      <div className="ma-row">
        <label className="ma-muted">Weeks shown{' '}
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
            {[4, 8, 12, 26].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <span className="ma-muted">Lagos time · updated {new Date(m.generatedAt).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      <div className="ma-tiles">
        <Tile label="Active today" value={active.dau} />
        <Tile label="Active this week" value={active.wau} sub="last 7 days" />
        <Tile label="Active this month" value={active.mau} sub="last 30 days" />
        <Tile label="Stickiness" value={pctText(active.stickiness)} sub="average day ÷ month" />
        <Tile label="Users" value={m.totals.users} sub={`${m.totals.waitlist} on the waitlist`} />
        <Tile label="Ever added a transaction" value={pctText(activation.everActivated)} />
        <Tile label="On the Plus trial" value={money.onTrial} />
        <Tile label="Paying" value={money.paidTotal} sub={`trial to paid ${pctText(money.conversion)}`} />
        <Tile label="Monthly revenue" value={fmtNaira(money.mrr)} sub="from active paid plans" />
      </div>

      <section className="ma-card">
        <h3>Active users per day</h3>
        <Bars data={active.series} label="Active users per day, last 30 days" valueOf={(d) => d.users} labelOf={(d) => shortDay(d.day)} tipOf={(d) => `${shortDay(d.day)}: ${d.users} active`} />
      </section>

      <section className="ma-card">
        <h3>Signups per week</h3>
        <Bars data={m.signups} label="Signups per week" valueOf={(d) => d.total} labelOf={(d) => shortDay(d.week)} tipOf={(d) => `Week of ${shortDay(d.week)}: ${d.total} signups`} />
        <table className="ma-table">
          <thead><tr><th>Week of</th><th>Signups</th><th>By app</th><th>Added a transaction in 7 days</th></tr></thead>
          <tbody>{m.signups.map((s, i) => {
            const a = activation.cohorts[i];
            return (
              <tr key={s.week}>
                <td>{shortDay(s.week)}</td><td>{s.total}</td>
                <td className="ma-muted">{Object.entries(s.byClient).map(([c, n]) => `${CLIENTS[c] || c} ${n}`).join(' · ') || '–'}</td>
                <td>{a.eligible ? `${pctText(a.rate)} (${a.activated} of ${a.eligible})` : <span className="ma-muted">{a.size ? 'too new' : '–'}</span>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>

      <section className="ma-card">
        <h3>Retention</h3>
        <p className="ma-muted">Of each week’s signups, the share who used the app in each week after. Week 0 is the signup week.</p>
        <div className="ma-scroll">
          <table className="ma-table ma-ret">
            <thead><tr><th>Week of</th><th>Users</th>{m.retention[0].rates.map((_, k) => <th key={k}>Wk {k}</th>)}</tr></thead>
            <tbody>{m.retention.map((r) => (
              <tr key={r.week}>
                <td>{shortDay(r.week)}</td><td>{r.size}</td>
                {r.rates.map((v, k) => (
                  <td key={k} className="ma-cell" style={v == null ? undefined : { background: `rgba(19, 157, 160, ${0.08 + (v / 100) * 0.62})` }}>{v == null ? '' : `${Math.round(v)}%`}</td>
                ))}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <div className="ma-two">
        <section className="ma-card">
          <h3>How the first transaction came in</h3>
          {!firstTotal && <p className="ma-muted">No transactions yet.</p>}
          {Object.entries(activation.firstSource).sort((a, b) => b[1] - a[1]).map(([src, n]) => (
            <div key={src} className="ma-hrow" title={`${SOURCES[src] || src}: ${n} users`}>
              <span>{SOURCES[src] || src}</span>
              <div className="ma-htrack"><div className="ma-hbar" style={{ width: `${(n / firstTotal) * 100}%` }} /></div>
              <span className="ma-num">{n}</span>
            </div>
          ))}
        </section>
        <section className="ma-card">
          <h3>Imports, last 30 days</h3>
          <p className="ma-muted">{im.total} transactions · {pctText(im.reviewShare)} needed review · {pctText(im.correctionRate)} corrected by the user</p>
          <table className="ma-table">
            <thead><tr><th>Source</th><th>Transactions</th><th>Share</th><th>Needed review</th></tr></thead>
            <tbody>{im.sources.map((s) => (
              <tr key={s.source}><td>{SOURCES[s.source] || s.source}</td><td>{s.total}</td><td>{pctText(s.share)}</td><td>{s.review}</td></tr>
            ))}</tbody>
          </table>
        </section>
      </div>

      <section className="ma-card">
        <h3>Plans</h3>
        <table className="ma-table">
          <thead><tr><th>Plan</th><th>Active</th></tr></thead>
          <tbody>
            <tr><td>Plus trial</td><td>{money.onTrial}</td></tr>
            {Object.entries(money.paid).map(([code, n]) => <tr key={code}><td>{PLAN_NAMES[code] || code}</td><td>{n}</td></tr>)}
            <tr><td>Verified students</td><td>{money.studentsVerified}</td></tr>
            <tr><td>Trials ended</td><td>{money.trialEnded} ({money.converted} went on to pay)</td></tr>
          </tbody>
        </table>
      </section>

      <style>{`
        .ma { display: grid; gap: 16px; color: var(--text-primary); }
        .ma h3 { margin: 0 0 10px; font-size: 1rem; }
        .ma-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .ma-row select { margin-left: 6px; min-height: 36px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); font: inherit; }
        .ma-muted { color: var(--text-secondary); font-size: 0.85rem; font-weight: 500; }
        .ma-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
        .ma-tile, .ma-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 14px; min-width: 0; }
        .ma-tile-label { color: var(--text-secondary); font-size: 0.8rem; font-weight: 600; }
        .ma-tile-value { font-size: 1.5rem; font-weight: 700; margin-top: 4px; overflow-wrap: anywhere; }
        .ma-chart { margin: 0; }
        .ma-bars { position: relative; height: 140px; display: flex; align-items: flex-end; gap: 2px; border-bottom: 1px solid var(--border-color); }
        .ma-hit { flex: 1; height: 100%; display: flex; align-items: flex-end; cursor: default; outline: none; }
        .ma-hit:focus-visible { box-shadow: inset 0 0 0 2px var(--accent-primary); }
        .ma-bar { width: 100%; min-height: 2px; background: #139DA0; border-radius: 4px 4px 0 0; }
        .ma-hit:hover .ma-bar, .ma-hit:focus .ma-bar { background: #0f7f82; }
        .ma-tip { position: absolute; top: -6px; transform: translate(-50%, -100%); background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; white-space: nowrap; pointer-events: none; box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .ma-axis { display: flex; justify-content: space-between; color: var(--text-secondary); font-size: 0.75rem; margin-top: 4px; }
        .ma-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.88rem; }
        .ma-table th, .ma-table td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border-color); }
        .ma-table th { color: var(--text-secondary); font-weight: 600; font-size: 0.8rem; }
        .ma-scroll { overflow-x: auto; }
        .ma-ret td.ma-cell { text-align: center; font-variant-numeric: tabular-nums; min-width: 48px; }
        .ma-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
        .ma-hrow { display: grid; grid-template-columns: 150px 1fr 40px; align-items: center; gap: 8px; padding: 5px 0; font-size: 0.88rem; }
        .ma-htrack { height: 10px; }
        .ma-hbar { height: 100%; min-width: 2px; background: #139DA0; border-radius: 0 4px 4px 0; }
        .ma-num { text-align: right; font-variant-numeric: tabular-nums; }
        @media (max-width: 640px) { .ma-hrow { grid-template-columns: 110px 1fr 32px; } }
      `}</style>
    </div>
  );
}
