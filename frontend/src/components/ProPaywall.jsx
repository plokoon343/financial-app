import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import { Link } from 'react-router-dom';
import { startProCheckout } from '../lib/pro';

// Reusable Plus paywall (the plan stored as 'pro'). Presents the benefits and price,
// and points students to the Student plan. Checkout is launch-gated on the server, so
// the button is honest when it isn't open yet.

const HEADLINES = {
  report: { title: 'Export your financial report', sub: 'Download a clean, shareable PDF for visa, rent or loan applications.' },
  cancel: { title: 'Cancel subscriptions with guidance', sub: "Get exact cancellation steps for each provider, and we'll confirm the charge actually stops." },
  default: { title: 'Automonie Plus', sub: 'Unlock the tools that turn insight into action.' },
};

export default function ProPaywall({ open, feature = 'default', onClose }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
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
    'Ask questions about your money',
    'Faster automatic bank sync',
  ];
  const onUpgrade = async () => {
    if (!status?.checkoutAvailable) { alert("Plus is launching soon: we'll let you know the moment it's live."); return; }
    setBusy(true);
    try { await startProCheckout(1); } // redirects to Paystack
    catch { alert('Could not start checkout. Try again.'); setBusy(false); }
  };

  return (
    <div className="pro-overlay" onClick={onClose}>
      <div className="pro-modal" onClick={(e) => e.stopPropagation()}>
        <span className="pro-badge"><i className="fas fa-star"></i> AUTOMONIE PLUS</span>
        <h3 className="pro-title">{head.title}</h3>
        <p className="pro-sub">{head.sub}</p>
        <ul className="pro-features">
          {features.map((f) => <li key={f}><i className="fas fa-circle-check"></i> {f}</li>)}
        </ul>
        <button className="pro-cta" onClick={onUpgrade} disabled={busy}>
          {busy ? 'Starting…' : status?.priceNaira ? `Get Plus: ${fmtNaira(status.priceNaira)}/mo` : 'Get Plus'}
        </button>
        <Link className="pro-plans" to="/plans" onClick={onClose}>Student or corps member? See the Student plan</Link>
        <button className="pro-later" onClick={onClose}>Maybe later</button>
      </div>
      <style>{`
        .pro-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1100; padding: 20px; }
        .pro-modal { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 26px; max-width: 420px; width: 100%; text-align: center; box-shadow: var(--shadow-lg); }
        .pro-badge { display: inline-flex; align-items: center; gap: 6px; background: var(--gradient-primary, var(--accent-primary)); color: #04130d; font-weight: 800; font-size: 0.72rem; letter-spacing: 0.5px; padding: 5px 12px; border-radius: 20px; }
        .pro-title { margin: 16px 0 6px; color: var(--text-primary); font-size: 1.5rem; }
        .pro-sub { color: var(--text-secondary); font-size: 0.95rem; line-height: 1.5; margin: 0; }
        .pro-features { list-style: none; padding: 0; margin: 18px 0 0; text-align: left; display: flex; flex-direction: column; gap: 10px; }
        .pro-features li { color: var(--text-primary); font-size: 0.95rem; display: flex; align-items: flex-start; gap: 9px; }
        .pro-features li i { color: var(--accent-primary); margin-top: 3px; }
        .pro-cta { width: 100%; margin-top: 22px; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-full); padding: 13px; font-weight: 800; font-size: 1rem; cursor: pointer; }
        .pro-plans { display: block; margin-top: 12px; color: var(--accent-primary); font-weight: 700; font-size: 0.9rem; }
        .pro-later { width: 100%; margin-top: 10px; background: none; border: none; color: var(--text-secondary); font-weight: 600; cursor: pointer; padding: 8px; }
      `}</style>
    </div>
  );
}
