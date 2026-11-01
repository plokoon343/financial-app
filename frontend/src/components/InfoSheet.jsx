import React, { useState } from 'react';
import { trackEvent } from '../lib/analytics';

// 3-5 line explanations for the "?" button on key screens (round9 B2.1). Keyed by
// a short topic id; each links into the matching Help Centre article.
export const INFO_TOPICS = {
  safeToSpend: {
    title: 'Safe to spend',
    lines: [
      'What you can spend for the rest of this month without going short before your next pay day.',
      'It starts from what is left this month, then subtracts your typical daily spend times the days until pay day.',
      'It updates as new transactions come in, so it is always based on your latest numbers.',
    ],
    helpSlug: 'budgets',
  },
  budgets: {
    title: 'Budgets',
    lines: [
      'A monthly spending limit you set per category.',
      'The bar turns amber near the limit and red once you go over.',
      'We nudge you when a budget is nearly used up, if budget notifications are on.',
    ],
    helpSlug: 'budgets',
  },
  automaticTracking: {
    title: 'Automatic tracking',
    lines: [
      'Automonie fills in your transactions from bank alert emails, Android bank-app notifications, or a shared alert text - without you typing anything in.',
      'Email forwarding is a one-time Gmail or Outlook rule; notifications need one Android permission.',
      'Anything we are unsure about waits in the Action Center for a quick confirm.',
    ],
    helpSlug: 'getting-started',
  },
  categories: {
    title: 'Categories',
    lines: [
      'Every transaction is sorted into a category automatically from the merchant or description.',
      'Correct one and Automonie remembers that merchant, so future transactions from it are sorted the same way.',
      'Categories drive your budgets and Insights breakdowns.',
    ],
    helpSlug: 'budgets',
  },
  plus: {
    title: 'Automonie Plus',
    lines: [
      'Plus unlocks extra insights, exports, cancellation help and automations beyond the free plan.',
      'Billed through Google Play on the Play Store app, or Paystack elsewhere.',
      'Cancel any time from the Play Store or Settings > Plus; you keep Plus until the period you already paid for ends.',
    ],
    helpSlug: 'plus-billing',
  },
};

// A small "?" button that opens a short explanatory sheet. `topic` must be a key
// in INFO_TOPICS above.
export default function InfoButton({ topic, style }) {
  const [open, setOpen] = useState(false);
  const info = INFO_TOPICS[topic];
  if (!info) return null;
  const show = () => { setOpen(true); trackEvent('help_opened', { source: `info:${topic}` }); };
  return (
    <>
      <button type="button" className="info-btn" aria-label={`About ${info.title}`} onClick={show} style={style}>
        <i className="fas fa-circle-question" aria-hidden="true"></i>
      </button>
      {open && (
        <div className="info-sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="info-sheet" onClick={(e) => e.stopPropagation()}>
            <h4>{info.title}</h4>
            <ul>{info.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <div className="info-sheet-actions">
              <a href={`/help#${info.helpSlug}`}>Learn more</a>
              <button type="button" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .info-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 0.9rem; padding: 2px 4px; line-height: 1; }
        .info-btn:hover { color: var(--accent-primary); }
        .info-sheet-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: flex-end; justify-content: center; z-index: 1000; }
        .info-sheet { background: var(--bg-card); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 20px; width: 100%; max-width: 480px; box-shadow: 0 -4px 20px rgba(0,0,0,0.2); }
        .info-sheet h4 { margin: 0 0 10px; color: var(--text-primary); }
        .info-sheet ul { margin: 0; padding-left: 18px; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.55; display: grid; gap: 6px; }
        .info-sheet-actions { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
        .info-sheet-actions a { color: var(--accent-primary); font-weight: 700; text-decoration: none; }
        .info-sheet-actions button { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-md); padding: 8px 16px; cursor: pointer; }
        @media (min-width: 560px) { .info-sheet-backdrop { align-items: center; } .info-sheet { border-radius: var(--radius-lg); } }
      `}</style>
    </>
  );
}
