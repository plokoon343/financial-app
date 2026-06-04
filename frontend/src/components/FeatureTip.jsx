import React, { useState, useEffect } from 'react';
import { tipsEnabled, hasSeenTip, markTipSeen, setTipsEnabled } from '../utils/tips';

// A dismissible info banner shown the FIRST time a page/feature is used.
// Usage: <FeatureTip tipKey="page:transactions" title="Transactions">What it does…</FeatureTip>
export const FeatureTip = ({ tipKey, title, children }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (tipsEnabled() && !hasSeenTip(tipKey)) setShow(true);
  }, [tipKey]);

  if (!show) return null;

  const close = () => { markTipSeen(tipKey); setShow(false); };
  const disableAll = () => { setTipsEnabled(false); setShow(false); };

  return (
    <div className="feature-tip">
      <i className="fas fa-lightbulb ft-bulb"></i>
      <div className="ft-body">
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </div>
      <div className="ft-actions">
        <button onClick={close} className="ft-got">Got it</button>
        <button onClick={disableAll} className="ft-off" title="Stop showing tips">Don't show again</button>
      </div>
      <style jsx="true">{`
        .feature-tip { display: flex; align-items: flex-start; gap: 12px; background: rgba(99,102,241,0.10);
          border: 1px solid rgba(99,102,241,0.35); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 16px; }
        .ft-bulb { color: #6366f1; margin-top: 2px; }
        .ft-body { flex: 1; color: var(--text-primary); font-size: 0.88rem; line-height: 1.5; }
        .ft-body strong { display: block; margin-bottom: 2px; }
        .ft-actions { display: flex; flex-direction: column; gap: 6px; white-space: nowrap; }
        .ft-got { background: var(--gradient-primary); color: #fff; border: none; border-radius: 8px; padding: 6px 12px; font-weight: 600; cursor: pointer; font-size: 0.8rem; }
        .ft-off { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.72rem; text-decoration: underline; }
        @media (max-width: 640px) { .feature-tip { flex-wrap: wrap; } .ft-actions { flex-direction: row; } }
      `}</style>
    </div>
  );
};

// A small "?" icon with a hover/tap tooltip — for explaining advanced features inline.
export const InfoTip = ({ text }) => (
  <span className="info-tip" tabIndex={0}>
    <i className="fas fa-circle-info"></i>
    <span className="info-tip-bubble">{text}</span>
    <style jsx="true">{`
      .info-tip { position: relative; display: inline-flex; margin-left: 6px; color: var(--text-secondary); cursor: help; outline: none; }
      .info-tip-bubble { position: absolute; bottom: 130%; left: 50%; transform: translateX(-50%);
        background: #1f2937; color: #f8fafc; padding: 8px 10px; border-radius: 8px; font-size: 0.78rem; font-weight: 500;
        width: max-content; max-width: 240px; line-height: 1.4; opacity: 0; pointer-events: none; transition: opacity 0.15s; z-index: 50; box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
      .info-tip:hover .info-tip-bubble, .info-tip:focus .info-tip-bubble { opacity: 1; }
    `}</style>
  </span>
);

export default FeatureTip;
