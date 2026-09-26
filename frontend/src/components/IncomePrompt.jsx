import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const DISMISS_KEY = 'income_prompt_seen';

// Progressive profiling (onboarding spec): ask for monthly income ONCE, and only
// AFTER the user has data to look at — it's the most sensitive question, so it waits
// until the product has already given value. Powers safe-to-spend. Web parity with
// mobile IncomePrompt.tsx. Renders nothing unless it's the right moment.
const IncomePrompt = ({ hasData }) => {
  const { user, updateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return !!localStorage.getItem(DISMISS_KEY); } catch { return false; }
  });

  // Only when there's data to look at, income isn't set, and it wasn't dismissed.
  if (!hasData || !user || user.monthlyIncome || dismissed) return null;

  const remember = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  const dismiss = () => { setDismissed(true); remember(); };

  const save = async () => {
    const val = parseFloat(String(amount).replace(/,/g, ''));
    if (!(val > 0)) return;
    setSaving(true);
    try {
      await axios.put(`${API_URL}/api/me`, { monthlyIncome: val }, auth());
      updateUser({ monthlyIncome: val });
      setOpen(false); setDismissed(true); remember();
    } catch { /* leave the card so they can retry */ }
    finally { setSaving(false); }
  };

  const onAmount = (e) => {
    const digits = e.target.value.replace(/[^\d]/g, '');
    setAmount(digits ? Number(digits).toLocaleString('en-NG') : '');
  };

  return (
    <div className="ip-card">
      <div className="ip-icon"><i className="fas fa-sack-dollar"></i></div>
      <div className="ip-body">
        <div className="ip-title">What’s safe to spend?</div>
        <div className="ip-sub">Add your monthly income and we’ll show what’s left after your usual bills. Only you can see this.</div>
        <div className="ip-actions">
          <button className="ip-add" onClick={() => setOpen(true)}>Add income</button>
          <button className="ip-not-now" onClick={dismiss}>Not now</button>
        </div>
      </div>

      {open && (
        <div className="ip-modal-overlay" onClick={() => setOpen(false)}>
          <div className="ip-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Your monthly income</h3>
            <p className="ip-sub">Roughly what comes in each month. Only you can see this.</p>
            <div className="ip-input-wrap">
              <span className="ip-naira">₦</span>
              <input
                className="ip-input"
                inputMode="numeric"
                value={amount}
                onChange={onAmount}
                placeholder="250,000"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
              />
            </div>
            <div className="ip-modal-actions">
              <button className="ip-ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</button>
              <button className="ip-primary" onClick={save} disabled={saving || !amount}>{saving ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx="true">{`
        .ip-card { display: flex; gap: 12px; background: var(--card-bg); border: 1px solid color-mix(in srgb, var(--accent-primary, #008751) 40%, transparent); border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 1.5rem; }
        .ip-icon { width: 34px; height: 34px; border-radius: 11px; background: color-mix(in srgb, var(--accent-primary, #008751) 16%, transparent); display: flex; align-items: center; justify-content: center; color: var(--accent-primary, #008751); flex-shrink: 0; }
        .ip-title { font-weight: 800; font-size: 0.98rem; color: var(--text-primary); }
        .ip-sub { color: var(--text-secondary); font-size: 0.82rem; line-height: 1.45; margin-top: 3px; }
        .ip-actions { display: flex; align-items: center; gap: 16px; margin-top: 10px; }
        .ip-add { background: var(--gradient-primary, var(--accent-primary, #008751)); color: #fff; border: none; border-radius: 10px; padding: 8px 15px; font-weight: 800; font-size: 0.82rem; cursor: pointer; }
        .ip-not-now { background: none; border: none; color: var(--text-secondary); font-weight: 600; font-size: 0.82rem; cursor: pointer; }

        .ip-modal-overlay { position: fixed; inset: 0; z-index: 3600; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; padding: 24px; }
        .ip-modal { width: 100%; max-width: 400px; background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 22px; box-shadow: var(--shadow-lg); }
        .ip-modal h3 { margin: 0 0 4px; font-size: 1.2rem; }
        .ip-input-wrap { display: flex; align-items: center; gap: 8px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); padding: 4px 14px; margin: 14px 0; }
        .ip-naira { color: var(--text-secondary); font-size: 1.1rem; font-weight: 800; }
        .ip-input { flex: 1; background: none; border: none; outline: none; color: var(--text-primary); font-size: 1.2rem; font-weight: 700; padding: 10px 0; }
        .ip-modal-actions { display: flex; gap: 10px; }
        .ip-modal-actions button { flex: 1; padding: 12px; border-radius: var(--radius-md); font-weight: 800; cursor: pointer; }
        .ip-ghost { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); }
        .ip-primary { background: var(--gradient-primary, var(--accent-primary, #008751)); color: #fff; border: none; }
        .ip-primary:disabled, .ip-ghost:disabled { opacity: 0.6; cursor: default; }
      `}</style>
    </div>
  );
};

export default IncomePrompt;
