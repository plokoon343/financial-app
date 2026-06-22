import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';

const STEPS = [
  { icon: 'fa-rocket', title: 'Welcome to Automonie', body: 'Your personal finance copilot. Here\'s a 30-second tour of what you can do. You can replay this anytime from the sidebar.' },
  { icon: 'fa-chart-line', title: 'Dashboard', body: 'Your overview: balances, recent activity and insights. Add a transaction manually, or import a bank statement (CSV, Excel, or PDF — even password-protected ones).' },
  { icon: 'fa-receipt', title: 'Transactions', body: 'Your full ledger. Filter by month, bank or category, sort by any column, edit inline, and delete single rows, a selection, or a whole imported statement.' },
  { icon: 'fa-chart-pie', title: 'Budget', body: 'Pick a month and set spending limits per category. As transactions come in, each budget shows spent vs. limit with alerts at 80% and 100%.' },
  { icon: 'fa-robot', title: 'Auto-Savings & Goals', body: 'Save automatically — a fixed amount from each income or a round-up on expenses — and link it to a savings goal.' },
  { icon: 'fa-life-ring', title: 'Need help?', body: 'The Support page has FAQs and a contact form. That\'s it — you\'re ready to fly!' },
];

const Walkthrough = () => {
  const { user } = useAuth();
  const storageKey = user?.id ? `finpilot_tour_done_${user.id}` : null;
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  // First-run is handled by the detailed Onboarding flow; this quick tour now only
  // opens on demand via the "Take a tour" button.

  // Allow replay from anywhere via a custom event.
  const startTour = useCallback(() => { setStep(0); setShow(true); }, []);
  useEffect(() => {
    window.addEventListener('finpilot:start-tour', startTour);
    return () => window.removeEventListener('finpilot:start-tour', startTour);
  }, [startTour]);

  const finish = () => {
    if (storageKey) localStorage.setItem(storageKey, '1');
    setShow(false);
  };

  if (!show) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div className="wt-overlay" onClick={finish}>
      <div className="wt-card" onClick={(e) => e.stopPropagation()}>
        <button className="wt-skip" onClick={finish} title="Skip">✕</button>
        <div className="wt-icon"><i className={`fas ${s.icon}`}></i></div>
        <h2>{s.title}</h2>
        <p>{s.body}</p>

        <div className="wt-dots">
          {STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>

        <div className="wt-actions">
          {step > 0
            ? <button className="wt-secondary" onClick={() => setStep(step - 1)}>Back</button>
            : <button className="wt-secondary" onClick={finish}>Skip</button>}
          {last
            ? <button className="wt-primary" onClick={finish}>Get started</button>
            : <button className="wt-primary" onClick={() => setStep(step + 1)}>Next</button>}
        </div>
        <div className="wt-count">{step + 1} of {STEPS.length}</div>
      </div>

      <style jsx="true">{`
        .wt-overlay { position: fixed; inset: 0; z-index: 3000; background: rgba(0,0,0,0.55); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .wt-card { position: relative; width: 100%; max-width: 420px; background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 30px 26px 22px; text-align: center; box-shadow: var(--shadow-lg); color: var(--text-primary); }
        .wt-skip { position: absolute; top: 12px; right: 14px; background: none; border: none; font-size: 1.1rem; color: var(--text-secondary); cursor: pointer; }
        .wt-icon { width: 60px; height: 60px; margin: 0 auto 14px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; }
        .wt-icon i { color: #fff; font-size: 1.6rem; }
        .wt-card h2 { margin: 0 0 10px; font-size: 1.25rem; }
        .wt-card p { margin: 0 0 18px; color: var(--text-primary); opacity: 0.85; line-height: 1.55; font-size: 0.92rem; }
        .wt-dots { display: flex; gap: 6px; justify-content: center; margin-bottom: 18px; }
        .wt-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--border-color, var(--glass-border)); transition: all 0.2s; }
        .wt-dots span.on { background: var(--accent-primary, var(--accent-primary)); width: 22px; border-radius: 4px; }
        .wt-actions { display: flex; gap: 10px; }
        .wt-actions button { flex: 1; padding: 11px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; }
        .wt-primary { background: var(--gradient-primary); color: #fff; border: none; }
        .wt-secondary { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); }
        .wt-count { margin-top: 12px; font-size: 0.75rem; color: var(--text-secondary); }
      `}</style>
    </div>
  );
};

export default Walkthrough;
