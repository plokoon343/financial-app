import React, { useState } from 'react';
import { fmtNaira } from '../utils/format';

// Number explainer (round6 Block 9): tap any total to see how it was worked out,
// one line each, so "my numbers look wrong" has an answer before the user asks.
// `lines` is [{ label, amount, isResult? }]; pass null when there is nothing to
// explain yet (e.g. no stated income), and the button renders nothing.
export default function NumberExplainer({ title, lines, style }) {
  const [open, setOpen] = useState(false);
  if (!lines || !lines.length) return null;
  return (
    <>
      <button
        type="button"
        className="ne-btn"
        aria-label={`How ${title} was worked out`}
        onClick={() => setOpen(true)}
        style={style}
      >
        <i className="fas fa-calculator" aria-hidden="true"></i>
      </button>
      {open && (
        <div className="ne-backdrop" onClick={() => setOpen(false)}>
          <div className="ne-sheet" onClick={(e) => e.stopPropagation()}>
            <h4>How we got this</h4>
            <div className="ne-lines">
              {lines.map((l, i) => (
                <div key={i} className={`ne-row${l.isResult ? ' ne-result' : ''}`}>
                  <span>{l.label}</span>
                  <span style={l.amount < 0 && !l.isResult ? { color: 'var(--danger-color)' } : undefined}>
                    {l.amount < 0 && !l.isResult ? '-' : ''}{fmtNaira(Math.abs(l.amount))}
                  </span>
                </div>
              ))}
            </div>
            <button type="button" className="ne-close" onClick={() => setOpen(false)}>Got it</button>
          </div>
        </div>
      )}
      <style>{`
        .ne-btn { background: none; border: none; color: inherit; cursor: pointer; font-size: 0.9rem; padding: 2px 4px; line-height: 1; opacity: 0.85; }
        .ne-btn:hover { opacity: 1; }
        .ne-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
        .ne-sheet { background: var(--bg-card); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 20px; width: 100%; max-width: 480px; box-shadow: 0 -4px 20px rgba(0,0,0,0.2); }
        .ne-sheet h4 { margin: 0 0 10px; color: var(--text-primary); }
        .ne-lines { display: grid; }
        .ne-row { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-size: 0.92rem; }
        .ne-row span:last-child { font-weight: 700; color: var(--text-primary); }
        .ne-result { border-bottom: none; padding-top: 14px; }
        .ne-result span { color: var(--text-primary); font-weight: 800; font-size: 1.05rem; }
        .ne-close { margin-top: 16px; width: 100%; background: var(--bg-elevated, var(--bg-card)); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-md); padding: 12px 0; font-weight: 700; cursor: pointer; }
        @media (min-width: 560px) { .ne-backdrop { align-items: center; } .ne-sheet { border-radius: var(--radius-lg); } }
      `}</style>
    </>
  );
}
