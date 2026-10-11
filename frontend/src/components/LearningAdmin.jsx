import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Admin, Learning (Round 3, 3.2 and 3.3): how much the rules read on their own, the
// test-set coverage per bank, what users correct most, and the queue of shared
// merchant rules waiting for approval (5+ users agree, then an admin approves).
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '–');

export default function LearningAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    axios.get(`${API_URL}/api/admin/learning`, auth()).then((r) => { setData(r.data); setError(''); })
      .catch(() => setError('Could not load the learning report.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (key, decision) => {
    setBusy(key);
    try { await axios.post(`${API_URL}/api/admin/global-rules/${encodeURIComponent(key)}/${decision}`, {}, auth()); load(); }
    catch { setError('Could not save that decision.'); }
    finally { setBusy(''); }
  };

  if (error) return <div className="la-card"><p>{error}</p></div>;
  if (!data) return <div className="la-card"><p>Loading…</p></div>;

  return (
    <div className="la">
      <div className="la-tiles">
        <div className="la-card"><span className="la-k">Read by rules alone (7 days)</span><span className="la-v">{data.ruleOnlyRate == null ? '–' : `${data.ruleOnlyRate}%`}</span><span className="la-s">SMS and email alerts users reviewed</span></div>
        <div className="la-card"><span className="la-k">Alerts waiting in review stacks</span><span className="la-v">{data.heldAlerts}</span><span className="la-s">rules weren’t sure; nothing added yet</span></div>
        <div className="la-card"><span className="la-k">Shared rules to review</span><span className="la-v">{data.pendingRules.length}</span><span className="la-s">5+ users agree</span></div>
        <div className="la-card"><span className="la-k">Corrections (7 days)</span><span className="la-v">{Object.values(data.corrections || {}).reduce((a, b) => a + b, 0)}</span><span className="la-s">{Object.entries(data.corrections || {}).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(' · ') || 'none yet'}</span></div>
      </div>

      <section className="la-card">
        <h3>Shared rules waiting for approval</h3>
        {!data.pendingRules.length ? <p className="la-s">Nothing waiting. A rule appears here once 5 different users file the same merchant under the same category.</p> : (
          <table><thead><tr><th>Merchant key</th><th>Category</th><th>Users</th><th>Live now</th><th /></tr></thead><tbody>
            {data.pendingRules.map((r) => (
              <tr key={r.key}><td>{r.key}</td><td>{r.category}</td><td>{r.users} of {r.totalVotes}</td><td>{r.live || 'no'}</td>
                <td className="la-act"><button type="button" className="btn-primary" disabled={busy === r.key} onClick={() => decide(r.key, 'approve')}>Approve</button><button type="button" className="btn-secondary" disabled={busy === r.key} onClick={() => decide(r.key, 'reject')}>Reject</button></td></tr>
            ))}
          </tbody></table>
        )}
      </section>

      <section className="la-card">
        <h3>Parser coverage on the test set</h3>
        <p className="la-s">Anonymised real alerts per bank (corpus/alerts). Amount, direction and non-transactions are gated at 100% in the test suite.</p>
        {data.corpus ? (
          <table><thead><tr><th>Bank</th><th>Alerts</th><th>Rules only</th><th>Amount</th><th>Direction</th><th>Date</th><th>Non-transactions dropped</th><th>Parser entry</th></tr></thead><tbody>
            {data.corpus.map((r) => <tr key={r.bank}><td>{r.bank}</td><td>{r.n}</td><td>{pct(r.ruled, r.txn)}</td><td>{pct(r.amount, r.txn)}</td><td>{pct(r.direction, r.txn)}</td><td>{pct(r.date, r.txn)}</td><td>{r.ign ? `${r.ignOk}/${r.ign}` : '–'}</td><td>{r.entry}</td></tr>)}
          </tbody></table>
        ) : <p className="la-s">The test set isn’t available on this server.</p>}
      </section>

      <section className="la-card">
        <h3>Read by rules alone, by bank (live, 7 days)</h3>
        {!data.ruleOnlyByBank.length ? <p className="la-s">No reviewed alerts this week yet.</p> : (
          <table><thead><tr><th>Bank</th><th>Alerts</th><th>By rules</th><th>Rate</th></tr></thead><tbody>
            {data.ruleOnlyByBank.map((b) => <tr key={b.bank}><td>{b.bank}</td><td>{b.total}</td><td>{b.rules}</td><td>{b.rate == null ? '–' : `${b.rate}%`}</td></tr>)}
          </tbody></table>
        )}
      </section>

      <div className="la-two">
        <section className="la-card">
          <h3>Top uncategorised merchants</h3>
          {!data.uncategorised.length ? <p className="la-s">None shared by 2+ users this week.</p> : (
            <ol>{data.uncategorised.map((u) => <li key={u.key}>{u.key} <span className="la-s">({u.rows} rows, {u.users} users)</span></li>)}</ol>
          )}
        </section>
        <section className="la-card">
          <h3>Top corrections</h3>
          {!data.topCorrections.length ? <p className="la-s">No corrections this week.</p> : (
            <ol>{data.topCorrections.map((c, i) => <li key={i}>{c.kind}: {c.from || '(none)'} to {c.to} <span className="la-s">({c.times} times, {c.users} users)</span></li>)}</ol>
          )}
        </section>
      </div>
      <p className="la-s">This report is also emailed to superadmins every Monday morning.</p>

      <style>{`
        .la { display: grid; gap: 16px; color: var(--text-primary); }
        .la-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; overflow-x: auto; }
        .la-card h3 { margin: 0 0 10px; font-size: 1rem; }
        .la-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
        .la-tiles .la-card { display: grid; gap: 4px; }
        .la-k { font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; }
        .la-v { font-size: 1.6rem; font-weight: 800; color: var(--accent-primary); }
        .la-s { font-size: 0.8rem; color: var(--text-secondary); }
        .la table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
        .la th, .la td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-color); white-space: nowrap; }
        .la th { color: var(--text-secondary); font-weight: 600; font-size: 0.8rem; }
        .la-act { display: flex; gap: 6px; }
        .la-two { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; }
        .la ol { margin: 0; padding-left: 1.2rem; display: grid; gap: 4px; font-size: 0.9rem; }
      `}</style>
    </div>
  );
}
