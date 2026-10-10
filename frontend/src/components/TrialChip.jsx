import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

// "Plus trial: 9 days left", or a calm note once it has ended, linking to Plans.
// Renders nothing on a paid plan or long after the trial.
export default function TrialChip({ onNavigate }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    const load = () => axios.get(`${API_URL}/api/billing/status`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => setS(r.data)).catch(() => {});
    load();
    window.addEventListener('automonie:plan-changed', load);
    return () => window.removeEventListener('automonie:plan-changed', load);
  }, []);
  if (!s || !(s.source === 'trial' || s.trialEnded)) return null;
  const text = s.source === 'trial'
    ? `Plus trial: ${s.trialDaysLeft} day${s.trialDaysLeft === 1 ? '' : 's'} left`
    : 'Your Plus trial ended';
  return (
    <Link to="/plans" className="trial-chip" onClick={onNavigate}>
      <i className="fas fa-star" aria-hidden="true"></i> {text}
      <style>{`
        .trial-chip { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; margin-bottom: 8px; border-radius: var(--radius-md); background: rgba(19, 157, 160, 0.12); border: 1px solid rgba(19, 157, 160, 0.35); color: var(--text-primary); font-size: 0.85rem; font-weight: 600; text-decoration: none; }
        .trial-chip i { color: var(--accent-primary); }
      `}</style>
    </Link>
  );
}
