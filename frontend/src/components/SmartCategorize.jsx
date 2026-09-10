import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import ProPaywall from './ProPaywall';

// AI counterparty -> purpose inference (spec 6.1) — web parity with the mobile
// /smart-categorize screen. Lists recurring transfers stuck on a generic label and,
// when the server's model key is live, suggests a purpose per counterparty (rent /
// savings / family…) that the user confirms. STAGED: shows the list + "coming soon"
// until keys are set. Pro-gated (402 -> paywall). Only redacted names/amounts leave.

const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const cadenceLabel = (c) => (c === 'one-off' ? 'once' : c);

export default function SmartCategorize() {
  const [candidates, setCandidates] = useState([]);
  const [available, setAvailable] = useState(false);
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [paywall, setPaywall] = useState(false);
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800); };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/ai/purpose/candidates`, headers);
      setAvailable(!!data.available);
      setCandidates(data.candidates || []);
    } catch (e) {
      if (e.response?.status === 402) { setPaywall(true); return; }
      setError('Could not load your transactions.');
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const analyze = async () => {
    setAnalyzing(true); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/ai/purpose/infer`, {}, headers);
      setProposals(data.proposals || []);
      setAnalyzed(true);
      if (!data.proposals?.length) flash('No confident suggestions this time.');
    } catch (e) {
      if (e.response?.status === 402) { setPaywall(true); return; }
      if (e.response?.status === 503) { setAvailable(false); flash('Smart categorisation is coming soon.'); return; }
      setError('Could not analyse those transactions.');
    } finally { setAnalyzing(false); }
  };

  const apply = async (p) => {
    setBusy(p.counterparty);
    try {
      const { data } = await axios.post(`${API_URL}/api/ai/purpose/apply`, { txnIds: p.txnIds, category: p.category }, headers);
      flash(`${p.counterparty} → ${p.category} (${data.updated} updated)`);
      setProposals((prev) => prev.filter((x) => x.counterparty !== p.counterparty));
      setCandidates((prev) => prev.filter((x) => x.counterparty !== p.counterparty));
    } catch (e) {
      if (e.response?.status === 402) { setPaywall(true); return; }
      setError('Could not apply that.');
    } finally { setBusy(''); }
  };

  return (
    <div className="sc-page">
      <div className="sc-head">
        <h2><i className="fas fa-tags"></i> Smart categorise</h2>
        <p>{available
          ? 'These recurring transfers don’t have a real category yet. Let Automonie suggest what each is for — you confirm before anything changes.'
          : 'These recurring transfers don’t have a category yet. Smart suggestions are coming soon; here’s what we’ll help you sort.'}</p>
      </div>

      {toast && <div className="sc-toast">{toast}</div>}
      {loading ? <div className="sc-card">Loading…</div> : (
        <>
          {candidates.length === 0 ? (
            <div className="sc-card sc-empty">
              <p>Nothing to sort right now.</p>
              <p className="sc-sub">When you have recurring transfers without a category, they’ll show up here.</p>
            </div>
          ) : (
            <>
              {available && !analyzed && (
                <button className="sc-analyze" disabled={analyzing} onClick={analyze}>
                  <i className="fas fa-wand-magic-sparkles"></i> {analyzing ? 'Analysing…' : `Suggest purposes for ${candidates.length}`}
                </button>
              )}
              {!available && (
                <div className="sc-soon"><i className="fas fa-clock"></i> AI suggestions aren’t switched on yet — your list is ready for when they are.</div>
              )}

              {/* Proposals (after analysis) */}
              {proposals.map((p) => (
                <div key={`p-${p.counterparty}`} className="sc-card sc-proposal">
                  <div className="sc-top">
                    <div className="sc-icon"><i className={`fas ${p.count > 1 ? 'fa-repeat' : 'fa-right-left'}`}></i></div>
                    <div style={{ flex: 1 }}>
                      <div className="sc-name">{p.counterparty}</div>
                      <div className="sc-sub">{p.count} txn{p.count === 1 ? '' : 's'}</div>
                    </div>
                    <span className="sc-badge">{p.confidence}</span>
                  </div>
                  <div className="sc-suggest"><i className="fas fa-tag"></i> {p.category}</div>
                  {p.reason && <div className="sc-reason">{p.reason}</div>}
                  <button className="sc-apply" disabled={busy === p.counterparty} onClick={() => apply(p)}>
                    Apply to {p.count} transaction{p.count === 1 ? '' : 's'}
                  </button>
                </div>
              ))}

              {analyzed && proposals.length === 0 && (
                <p className="sc-note">No confident suggestions — the rest are too unclear to guess. You can still categorise them by hand from the transactions list.</p>
              )}

              {/* Candidate preview (before analysis, or keys-pending) */}
              {(!analyzed || !available) && candidates.map((c) => (
                <div key={`c-${c.counterparty}`} className="sc-card">
                  <div className="sc-top">
                    <div className={`sc-icon ${c.direction === 'in' ? 'sc-in' : ''}`}>
                      <i className={`fas ${c.direction === 'in' ? 'fa-arrow-down' : 'fa-arrow-up'}`}></i>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="sc-name">{c.counterparty}</div>
                      <div className="sc-sub">{c.count}× · {cadenceLabel(c.cadence)} · avg {naira(c.avgAmount)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}

          {error && <div className="sc-card sc-err">{error}</div>}
          <p className="sc-privacy">We only send a payee name (with account numbers removed), the amounts and how often — never your full statement.</p>
        </>
      )}

      <ProPaywall open={paywall} feature="ai-purpose" onClose={() => setPaywall(false)} />

      <style jsx="true">{`
        .sc-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .sc-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .sc-head p { color: var(--text-secondary); margin: 0 0 18px; }
        .sc-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; color: var(--text-primary); }
        .sc-proposal { border: 2px solid var(--accent-primary); }
        .sc-top { display: flex; align-items: center; gap: 12px; }
        .sc-icon { width: 40px; height: 40px; border-radius: 11px; background: var(--glass-bg); display: flex; align-items: center; justify-content: center; color: var(--accent-primary); }
        .sc-in { color: #38a169; }
        .sc-name { font-weight: 700; color: var(--text-primary); }
        .sc-sub { color: var(--text-secondary); font-size: 0.83rem; margin-top: 2px; }
        .sc-badge { background: var(--glass-bg); color: var(--accent-primary); border-radius: 8px; padding: 3px 9px; font-size: 0.68rem; font-weight: 800; text-transform: uppercase; }
        .sc-suggest { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 1.02rem; margin-top: 12px; color: var(--text-primary); }
        .sc-reason { color: var(--text-secondary); font-size: 0.83rem; font-style: italic; margin-top: 6px; }
        .sc-analyze { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 13px; font-weight: 800; cursor: pointer; margin-bottom: 14px; }
        .sc-analyze:disabled { opacity: 0.6; cursor: default; }
        .sc-apply { width: 100%; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 11px; font-weight: 800; cursor: pointer; margin-top: 12px; }
        .sc-apply:disabled { opacity: 0.6; cursor: default; }
        .sc-soon { display: flex; align-items: center; gap: 8px; background: var(--glass-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 14px; }
        .sc-note { color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; }
        .sc-empty { text-align: center; }
        .sc-sub { color: var(--text-secondary); font-size: 0.85rem; }
        .sc-err { color: #e53e3e; }
        .sc-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: var(--radius-full); text-align: center; font-weight: 600; margin-bottom: 12px; z-index: 5; }
        .sc-privacy { color: var(--text-secondary); font-size: 0.78rem; text-align: center; margin-top: 8px; }
      `}</style>
    </div>
  );
}
