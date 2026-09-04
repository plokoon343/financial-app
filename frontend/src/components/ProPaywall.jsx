import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Reusable Pro paywall (monetization gating for the C6 report export + C1 subscription
// cancellation). Presents the benefits + price. Checkout isn't wired yet (Paystack
// keys-pending), so the CTA is honest about that; the server gate is already real.

const HEADLINES = {
  report: { title: 'Export your financial report', sub: 'Download a clean, shareable PDF for visa, rent or loan applications.' },
  cancel: { title: 'Cancel subscriptions with guidance', sub: "Get exact cancellation steps for each provider — and we'll confirm the charge actually stops." },
  default: { title: 'Automonie Pro', sub: 'Unlock the tools that turn insight into action.' },
};

export default function ProPaywall({ open, feature = 'default', onClose }) {
  const [status, setStatus] = useState(null);
  const head = HEADLINES[feature] || HEADLINES.default;

  useEffect(() => {
    if (!open) return;
    const token = localStorage.getItem('token');
    axios.get(`${API_URL}/api/billing/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setStatus(r.data)).catch(() => {});
  }, [open]);

  if (!open) return null;
  const features = status?.features || [
    'Export your income & financial report as a PDF',
    'Guided subscription cancellation + charge tracking',
    'AI money assistant',
    'Faster automatic bank sync',
  ];
  const onUpgrade = () => {
    if (status?.checkoutAvailable) alert('Opening checkout…');
    else alert("Pro is launching soon — we'll let you know the moment it's live.");
  };

  return (
    <div className="pro-overlay" onClick={onClose}>
      <div className="pro-modal" onClick={(e) => e.stopPropagation()}>
        <span className="pro-badge"><i className="fas fa-star"></i> AUTOMONIE PRO</span>
        <h3 className="pro-title">{head.title}</h3>
        <p className="pro-sub">{head.sub}</p>
        <ul className="pro-features">
          {features.map((f) => <li key={f}><i className="fas fa-circle-check"></i> {f}</li>)}
        </ul>
        <button className="pro-cta" onClick={onUpgrade}>
          {status?.priceNaira ? `Get Pro — ${fmtNaira(status.priceNaira)}/mo` : 'Get Pro'}
        </button>
        <button className="pro-later" onClick={onClose}>Maybe later</button>
      </div>
      <style jsx="true">{`
        .pro-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px; }
        .pro-modal { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 26px; max-width: 420px; width: 100%; text-align: center; box-shadow: var(--shadow-lg); }
        .pro-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--gradient-primary, var(--accent-primary)); color: #04130d; font-weight: 800; font-size: 0.72rem; letter-spacing: 0.5px; padding: 5px 12px; border-radius: 20px; }
        .pro-title { margin: 16px 0 6px; color: var(--text-primary); font-size: 1.5rem; }
        .pro-sub { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; margin: 0; }
        .pro-features { list-style: none; padding: 0; margin: 18px 0 0; text-align: left; display: flex; flex-direction: column; gap: 10px; }
        .pro-features li { color: var(--text-primary); font-size: 0.95rem; display: flex; align-items: flex-start; gap: 9px; }
        .pro-features li i { color: var(--accent-primary); margin-top: 3px; }
        .pro-cta { width: 100%; margin-top: 22px; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-full); padding: 13px; font-weight: 800; font-size: 1rem; cursor: pointer; }
        .pro-later { width: 100%; margin-top: 10px; background: none; border: none; color: var(--text-secondary); font-weight: 600; cursor: pointer; padding: 8px; }
      `}</style>
    </div>
  );
}
