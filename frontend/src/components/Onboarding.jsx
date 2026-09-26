import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

// Read-only trust specifics (slide 2). Honest wording: Automonie can SEE the data,
// never MOVE money — true at launch (no wallet). Web parity with mobile onboarding.tsx.
const TRUST = [
  { title: 'We never hold your bank login', sub: 'Bank connections run through licensed partners' },
  { title: 'Read-only, always', sub: 'Automonie can see it, it can’t move your money' },
  { title: 'Locked to your device', sub: 'PIN, fingerprint and screen privacy built in' },
];

// The "What brings you here?" options → stored as primaryGoal, which shapes the first
// screen. NOT income — that's asked later, after the first insight lands (IncomePrompt).
const REASONS = [
  { key: 'See where my money goes', icon: 'fa-eye' },
  { key: 'Stop overspending', icon: 'fa-arrow-trend-down' },
  { key: 'Save for something', icon: 'fa-flag' },
  { key: 'Clear a debt', icon: 'fa-credit-card' },
  { key: 'Just looking', icon: 'fa-wand-magic-sparkles' },
];

const Onboarding = () => {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);       // slide 0..2
  const [asking, setAsking] = useState(false);  // showing the one personalisation question
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [replay, setReplay] = useState(false);  // "Replay the app tour" → slides only

  // Replay from the sidebar / Settings: show the honest intro slides again, no
  // question, no flag change, "Done" closes. (Replaces the old Walkthrough modal.)
  const startReplay = useCallback(() => { setIndex(0); setAsking(false); setReplay(true); }, []);
  useEffect(() => {
    window.addEventListener('finpilot:start-tour', startReplay);
    return () => window.removeEventListener('finpilot:start-tour', startReplay);
  }, [startReplay]);

  const firstRun = !!user && !user.onboarded;
  if (!replay && !firstRun) return null;

  const persist = async (primaryGoal) => {
    try {
      await axios.put(`${API_URL}/api/me`, {
        onboarded: true,
        ...(primaryGoal && primaryGoal !== 'Just looking' ? { primaryGoal } : {}),
      }, auth());
    } catch { /* non-fatal: still mark locally so we don't nag */ }
    updateUser({ onboarded: true, ...(primaryGoal && primaryGoal !== 'Just looking' ? { primaryGoal } : {}) });
  };

  const closeReplay = () => setReplay(false);

  // Slides → question (first run) or close (replay).
  const next = () => {
    if (index < 2) { setIndex(index + 1); return; }
    if (replay) { closeReplay(); return; }
    setAsking(true);
  };

  // Finish first-run: save the answer, then hand off to the import flow so the first
  // thing the user does is see their own money — never a blank dashboard.
  const finish = async (primaryGoal) => {
    setSaving(true);
    await persist(primaryGoal);
    setSaving(false);
    navigate('/import-statement');
  };

  // ── The one personalisation question ──────────────────────────────────────
  if (asking) {
    return (
      <div className="ob-overlay">
        <div className="ob-card ob-q">
          <h2>What brings you here?</h2>
          <p className="ob-sub">Just one question. It decides what we show you first, and you can change it anytime.</p>
          <div className="ob-reasons">
            {REASONS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`ob-reason ${reason === r.key ? 'on' : ''}`}
                onClick={() => setReason(r.key)}
              >
                <span className="ob-reason-icon"><i className={`fas ${r.icon}`}></i></span>
                <span className="ob-reason-label">{r.key}</span>
                {reason === r.key && <i className="fas fa-circle-check ob-reason-check"></i>}
              </button>
            ))}
          </div>
          <button className="ob-primary" disabled={!reason || saving} onClick={() => finish(reason)}>
            {saving ? 'Setting up…' : 'Continue'}
          </button>
          <button className="ob-text-btn" disabled={saving} onClick={() => finish('')}>Skip for now</button>
        </div>
      </div>
    );
  }

  // ── The three intro slides (each a different layout) ──────────────────────
  return (
    <div className="ob-overlay">
      <div className="ob-card ob-slides">
        <button className="ob-skip" onClick={() => (replay ? closeReplay() : setAsking(true))} disabled={saving}>
          {replay ? 'Done' : 'Skip'}
        </button>

        {index === 0 && (
          <div className="ob-slide">
            <h1 className="ob-hook">Where did your money <span className="ob-accent">actually go?</span></h1>
            <p className="ob-body">It’s never one big purchase. It’s a transfer here, a top-up there, small things that never felt like spending.</p>
            <p className="ob-body ob-faint">Automonie shows you the truth, in seconds.</p>
          </div>
        )}

        {index === 1 && (
          <div className="ob-slide">
            <div className="ob-mark"><i className="fas fa-shield-halved"></i></div>
            <h1 className="ob-hook ob-hook-sm">Your money data stays yours</h1>
            <div className="ob-trust">
              {TRUST.map((t) => (
                <div key={t.title} className="ob-trust-row">
                  <span className="ob-tick"><i className="fas fa-check"></i></span>
                  <div>
                    <div className="ob-trust-title">{t.title}</div>
                    <div className="ob-trust-sub">{t.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {index === 2 && (
          <div className="ob-slide">
            <h1 className="ob-hook ob-hook-sm">See it. Then control it.</h1>
            <p className="ob-body">Budgets that warn you early. Goals you can track. Bills you’ll never forget again.</p>
            <div className="ob-prev">
              <div className="ob-prev-label">AUGUST BUDGET</div>
              <div className="ob-prev-row">
                <span className="ob-prev-cat">Food &amp; drink</span>
                <span className="ob-prev-pct over">92%</span>
              </div>
              <div className="ob-bar"><span className="ob-bar-fill over" style={{ width: '92%' }} /></div>
              <div className="ob-prev-row">
                <span className="ob-prev-cat">Transport</span>
                <span className="ob-prev-pct">64%</span>
              </div>
              <div className="ob-bar"><span className="ob-bar-fill" style={{ width: '64%' }} /></div>
              <div className="ob-prev-foot"><span className="ob-accent-strong">₦4,100</span> left before you hit your food limit</div>
            </div>
          </div>
        )}

        <div className="ob-dots">
          {[0, 1, 2].map((i) => <span key={i} className={i === index ? 'on' : ''} />)}
        </div>

        <button className="ob-primary" onClick={next} disabled={saving}>
          {index >= 2 ? (replay ? 'Done' : 'Get started') : 'Next'}
        </button>
      </div>

      <style jsx="true">{`
        .ob-overlay { position: fixed; inset: 0; z-index: 3500; background: rgba(0,0,0,0.6); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .ob-card { position: relative; width: 100%; max-width: 460px; background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 30px 28px 24px; box-shadow: var(--shadow-lg); color: var(--text-primary); }
        .ob-skip { position: absolute; top: 14px; right: 16px; background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.85rem; font-weight: 600; }
        .ob-slide { min-height: 288px; }
        .ob-hook { font-size: 2rem; font-weight: 800; letter-spacing: -0.8px; line-height: 1.15; margin: 8px 0 0; }
        .ob-hook-sm { font-size: 1.7rem; }
        .ob-accent { color: var(--accent-primary, #008751); }
        .ob-accent-strong { color: var(--accent-primary, #008751); font-weight: 800; }
        .ob-body { color: var(--text-secondary); font-size: 0.98rem; line-height: 1.55; margin: 14px 0 0; }
        .ob-faint { color: var(--text-secondary); opacity: 0.7; font-size: 0.9rem; }

        .ob-mark { width: 52px; height: 52px; border-radius: 16px; display: flex; align-items: center; justify-content: center; background: var(--glass-bg); border: 1px solid var(--accent-primary, #008751); margin-bottom: 6px; }
        .ob-mark i { color: var(--accent-primary, #008751); font-size: 1.4rem; }
        .ob-trust { margin-top: 18px; }
        .ob-trust-row { display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--border-color, var(--glass-border)); }
        .ob-trust-row:last-child { border-bottom: none; }
        .ob-tick { width: 22px; height: 22px; border-radius: 7px; background: var(--glass-bg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
        .ob-tick i { color: var(--accent-primary, #008751); font-size: 0.72rem; }
        .ob-trust-title { font-weight: 700; font-size: 0.92rem; }
        .ob-trust-sub { color: var(--text-secondary); font-size: 0.8rem; margin-top: 2px; line-height: 1.4; }

        .ob-prev { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); padding: 16px; margin-top: 20px; }
        .ob-prev-label { color: var(--text-secondary); font-size: 0.62rem; font-weight: 700; letter-spacing: 1.2px; }
        .ob-prev-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
        .ob-prev-cat { color: var(--text-secondary); font-size: 0.82rem; }
        .ob-prev-pct { font-size: 0.82rem; font-weight: 700; }
        .ob-prev-pct.over { color: #e53e3e; }
        .ob-bar { height: 6px; border-radius: 3px; background: var(--border-color, var(--glass-border)); margin-top: 7px; overflow: hidden; }
        .ob-bar-fill { display: block; height: 100%; border-radius: 3px; background: var(--accent-primary, #008751); }
        .ob-bar-fill.over { background: #e53e3e; }
        .ob-prev-foot { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color, var(--glass-border)); color: var(--text-secondary); font-size: 0.8rem; }

        .ob-q h2 { margin: 4px 0 6px; font-size: 1.5rem; font-weight: 800; letter-spacing: -0.5px; }
        .ob-sub { margin: 0 0 18px; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5; }
        .ob-reasons { display: flex; flex-direction: column; gap: 10px; margin-bottom: 18px; }
        .ob-reason { display: flex; align-items: center; gap: 13px; padding: 13px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color, var(--glass-border)); background: var(--glass-bg); color: var(--text-primary); cursor: pointer; text-align: left; }
        .ob-reason.on { border-color: var(--accent-primary, #008751); background: color-mix(in srgb, var(--accent-primary, #008751) 12%, transparent); }
        .ob-reason-icon { width: 36px; height: 36px; border-radius: 11px; background: var(--card-bg); display: flex; align-items: center; justify-content: center; color: var(--text-secondary); flex-shrink: 0; }
        .ob-reason.on .ob-reason-icon { color: var(--accent-primary, #008751); }
        .ob-reason-label { flex: 1; font-size: 0.92rem; font-weight: 600; }
        .ob-reason.on .ob-reason-label { color: var(--accent-primary, #008751); font-weight: 700; }
        .ob-reason-check { color: var(--accent-primary, #008751); }

        .ob-dots { display: flex; gap: 6px; justify-content: center; margin: 20px 0 16px; }
        .ob-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--border-color, var(--glass-border)); transition: all 0.2s; }
        .ob-dots span.on { background: var(--accent-primary, #008751); width: 22px; border-radius: 4px; }

        .ob-primary { width: 100%; padding: 14px; border-radius: var(--radius-md); font-weight: 800; font-size: 1rem; cursor: pointer; border: none; color: #fff; background: var(--gradient-primary, var(--accent-primary, #008751)); }
        .ob-primary:disabled { opacity: 0.55; cursor: default; }
        .ob-text-btn { width: 100%; margin-top: 10px; padding: 8px; background: none; border: none; color: var(--text-secondary); font-weight: 600; font-size: 0.9rem; cursor: pointer; }
        .dark-theme .ob-reason { color-scheme: dark; }
      `}</style>
    </div>
  );
};

export default Onboarding;
