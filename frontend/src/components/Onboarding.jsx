import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const GOALS = [
  'Build an emergency fund',
  'Save for rent',
  'Pay off debt',
  'Save for a big purchase',
  'Track my spending',
  'Grow my investments',
  'Other',
];

const SLIDES = [
  { icon: 'fa-chart-line', title: 'Your Dashboard', body: 'See your balances, recent activity and insights at a glance. Add transactions manually, or import a bank statement (CSV, Excel, or PDF — even password-protected).' },
  { icon: 'fa-receipt', title: 'Transactions & Budgets', body: 'Every transaction is grouped by bank and month. Set monthly budgets per category and watch your spending stay on track with alerts.' },
  { icon: 'fa-robot', title: 'Automate your savings', body: 'Set a fixed amount or round-up rule to save automatically, link it to a goal, and let FinPilot do the work. You can replay this tour anytime from the sidebar.' },
];

const Onboarding = () => {
  const { user, updateUser } = useAuth();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: user?.name || '',
    phone: '',
    monthlyIncome: '',
    primaryGoal: '',
  });

  // Only show for a logged-in user who hasn't been onboarded.
  if (!user || user.onboarded) return null;

  const TOTAL = 2 + SLIDES.length; // profile, goal, then slides

  const persist = async (extra = {}) => {
    try {
      await axios.put(`${API_URL}/api/me`, {
        name: form.name,
        phone: form.phone,
        monthlyIncome: form.monthlyIncome === '' ? 0 : Number(form.monthlyIncome),
        primaryGoal: form.primaryGoal,
        onboarded: true,
        ...extra,
      }, auth());
    } catch { /* non-fatal: still mark locally so we don't nag */ }
    updateUser({ name: form.name || user.name, onboarded: true });
  };

  const finish = async () => { setSaving(true); await persist(); setSaving(false); };
  const skip = async () => { setSaving(true); await persist(); setSaving(false); };

  return (
    <div className="ob-overlay">
      <div className="ob-card">
        <button className="ob-skip" onClick={skip} disabled={saving}>Skip</button>

        {step === 0 && (
          <>
            <div className="ob-icon"><i className="fas fa-user-pen"></i></div>
            <h2>Welcome{form.name ? `, ${form.name.split(' ')[0]}` : ''}! 👋</h2>
            <p className="ob-sub">Let's set up your profile. This takes 20 seconds.</p>
            <div className="ob-field"><label>Full name</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Your name" /></div>
            <div className="ob-field"><label>Phone <span className="opt">(optional)</span></label>
              <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 0801 234 5678" /></div>
            <div className="ob-field"><label>Monthly income (₦) <span className="opt">(optional)</span></label>
              <input type="number" min="0" value={form.monthlyIncome} onChange={e => setForm({ ...form, monthlyIncome: e.target.value })} placeholder="Helps tailor budgets & savings" /></div>
          </>
        )}

        {step === 1 && (
          <>
            <div className="ob-icon"><i className="fas fa-bullseye"></i></div>
            <h2>What's your main goal?</h2>
            <p className="ob-sub">We'll personalize FinPilot around it.</p>
            <div className="ob-goals">
              {GOALS.map(g => (
                <button key={g} type="button"
                  className={`ob-goal ${form.primaryGoal === g ? 'on' : ''}`}
                  onClick={() => setForm({ ...form, primaryGoal: g })}>{g}</button>
              ))}
            </div>
          </>
        )}

        {step >= 2 && (() => {
          const s = SLIDES[step - 2];
          return (
            <>
              <div className="ob-icon"><i className={`fas ${s.icon}`}></i></div>
              <h2>{s.title}</h2>
              <p className="ob-sub">{s.body}</p>
            </>
          );
        })()}

        <div className="ob-dots">
          {Array.from({ length: TOTAL }).map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}
        </div>

        <div className="ob-actions">
          {step > 0
            ? <button className="ob-secondary" onClick={() => setStep(step - 1)} disabled={saving}>Back</button>
            : <span />}
          {step < TOTAL - 1
            ? <button className="ob-primary" onClick={() => setStep(step + 1)} disabled={saving}>Next</button>
            : <button className="ob-primary" onClick={finish} disabled={saving}>{saving ? 'Finishing…' : 'Finish'}</button>}
        </div>
      </div>

      <style jsx="true">{`
        .ob-overlay { position: fixed; inset: 0; z-index: 3500; background: rgba(0,0,0,0.6); backdrop-filter: blur(5px); display: flex; align-items: center; justify-content: center; padding: 20px; }
        .ob-card { position: relative; width: 100%; max-width: 460px; background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 30px 28px 22px; box-shadow: var(--shadow-lg); color: var(--text-primary); text-align: center; }
        .ob-skip { position: absolute; top: 14px; right: 16px; background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.85rem; }
        .ob-icon { width: 62px; height: 62px; margin: 0 auto 14px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; }
        .ob-icon i { color: #fff; font-size: 1.7rem; }
        .ob-card h2 { margin: 0 0 6px; font-size: 1.3rem; }
        .ob-sub { margin: 0 0 18px; color: var(--text-primary); opacity: 0.8; font-size: 0.9rem; line-height: 1.5; }
        .ob-field { text-align: left; margin-bottom: 14px; }
        .ob-field label { display: block; font-weight: 600; font-size: 0.85rem; margin-bottom: 6px; }
        .ob-field .opt { color: var(--text-secondary); font-weight: 400; }
        .ob-field input { width: 100%; padding: 11px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color, var(--glass-border)); background: var(--glass-bg); color: var(--text-primary); }
        .ob-goals { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 6px; }
        .ob-goal { padding: 11px; border-radius: var(--radius-md); border: 1px solid var(--border-color, var(--glass-border)); background: var(--glass-bg); color: var(--text-primary); cursor: pointer; font-size: 0.85rem; font-weight: 600; }
        .ob-goal.on { background: var(--gradient-primary); color: #fff; border-color: transparent; }
        .ob-dots { display: flex; gap: 6px; justify-content: center; margin: 20px 0 16px; }
        .ob-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--border-color, var(--glass-border)); }
        .ob-dots span.on { background: var(--accent-primary, #6366f1); width: 22px; border-radius: 4px; }
        .ob-actions { display: flex; justify-content: space-between; gap: 10px; }
        .ob-actions button { flex: 1; padding: 11px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; }
        .ob-primary { background: var(--gradient-primary); color: #fff; border: none; }
        .ob-secondary { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); }
        .dark-theme .ob-field input, .dark-theme .ob-goal { color-scheme: dark; }
      `}</style>
    </div>
  );
};

export default Onboarding;
