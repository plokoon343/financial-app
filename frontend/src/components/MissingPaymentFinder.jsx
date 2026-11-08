import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNairaFull } from '../utils/format';
import BankPicker from './BankPicker';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

// Missing-payment finder (round6 Block 9, highest-value support tool): "I sent/got
// money and it's not here." Checks whether a matching transaction already exists
// and, if not, offers the right fix (see backend GET /api/support/missing-payment).
export default function MissingPaymentFinder({ onClose }) {
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    axios.get(`${API_URL}/api/banks`, auth()).then((r) => setBanks(r.data.banks || [])).catch(() => {});
  }, []);

  const check = async () => {
    if (!bankCode) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const { data } = await axios.get(`${API_URL}/api/support/missing-payment`, { ...auth(), params: { bankCode } });
      setResult(data);
    } catch {
      setError('Could not check right now.');
    } finally { setLoading(false); }
  };

  const runAction = (a) => {
    if (a.openSettings) return; // nothing to open on web; shown as copy instead
    if (a.route) window.location.href = a.route;
  };

  return (
    <div className="mpf-backdrop" onClick={onClose}>
      <div className="mpf-sheet" onClick={(e) => e.stopPropagation()}>
        <h3>Find a missing payment</h3>
        <p className="mpf-sub">Tell us which bank, and we will check whether it already made it in and, if not, why.</p>
        <BankPicker banks={banks} setBanks={setBanks} value={bankCode} onChange={setBankCode} aria-label="Which bank?" />
        <button type="button" className="btn-primary-sm" disabled={!bankCode || loading} onClick={check} style={{ marginTop: 12 }}>
          {loading ? 'Checking…' : 'Check'}
        </button>
        {error && <p className="mpf-error">{error}</p>}

        {result && result.found && (
          <div className="mpf-card">
            <h4>Found it - already here</h4>
            {result.matches.map((m) => (
              <div className="mpf-row" key={m.id}>
                <span>{m.description}</span>
                <strong>{fmtNairaFull(Math.abs(m.amount))}</strong>
              </div>
            ))}
          </div>
        )}

        {result && !result.found && (
          <div className="mpf-card">
            <h4><i className="fas fa-triangle-exclamation" aria-hidden="true"></i> Not found yet</h4>
            <p className="mpf-reason">{result.reason}</p>
            <div className="mpf-actions">
              {result.actions.map((a) => (
                a.openSettings
                  ? <p key={a.id} className="mpf-reason">{a.label}: check your phone's battery settings for Automonie.</p>
                  : <a key={a.id} className="mpf-action-btn" href={a.route} onClick={(e) => { e.preventDefault(); runAction(a); }}>{a.label}</a>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn-secondary-sm" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
      </div>
      <style>{`
        .mpf-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 16px; }
        .mpf-sheet { background: var(--bg-card); border-radius: var(--radius-lg); padding: 22px; width: 100%; max-width: 440px; box-shadow: 0 -4px 20px rgba(0,0,0,0.2); }
        .mpf-sheet h3 { margin: 0 0 6px; color: var(--text-primary); }
        .mpf-sub { margin: 0 0 14px; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; }
        .mpf-error { color: var(--danger-color, var(--warning-color)); font-size: 0.85rem; margin-top: 10px; }
        .mpf-card { margin-top: 16px; background: var(--bg-secondary); border-radius: var(--radius-md); padding: 14px; }
        .mpf-card h4 { margin: 0 0 8px; color: var(--text-primary); font-size: 0.95rem; }
        .mpf-row { display: flex; justify-content: space-between; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 0.88rem; }
        .mpf-reason { color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; margin: 0 0 10px; }
        .mpf-actions { display: grid; gap: 8px; }
        .mpf-action-btn { display: block; text-align: left; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 10px 12px; color: var(--text-primary); font-weight: 600; font-size: 0.88rem; text-decoration: none; }
      `}</style>
    </div>
  );
}
