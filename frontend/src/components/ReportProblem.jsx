import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// "Report a problem" from the spot (round6 Block 9): a short note plus the item's
// own IDs and source status, attached automatically. The raw alert text, if any,
// is only sent when the user ticks the box - it never goes by default.
export default function ReportProblem({ screen, transactionId, sourceLabel, sourceStatus, rawText, trigger }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [includeRaw, setIncludeRaw] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    if (!message.trim()) return;
    setSending(true); setError('');
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/support/tickets`, {
        subject: `Report from ${sourceLabel || screen}`,
        message: includeRaw && rawText ? `${message.trim()}\n\n--- raw text ---\n${rawText}` : message.trim(),
        topic: 'report-a-problem',
        context: { screen, transactionId: transactionId || '', sourceLabel: sourceLabel || '', sourceStatus: sourceStatus || '', rawTextIncluded: includeRaw },
      }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage(''); setIncludeRaw(false); setOpen(false);
    } catch {
      setError('Could not send. Try again.');
    } finally { setSending(false); }
  };

  return (
    <>
      {trigger ? trigger(() => setOpen(true)) : (
        <button type="button" className="btn-secondary-sm" onClick={() => setOpen(true)}>
          <i className="fas fa-flag" aria-hidden="true"></i> Report a problem
        </button>
      )}
      {open && (
        <div className="rp-backdrop" onClick={() => setOpen(false)}>
          <div className="rp-sheet" onClick={(e) => e.stopPropagation()}>
            <h4>Report a problem</h4>
            <p className="rp-sub">We attach what we can see on our side (status, IDs) so you do not have to explain it. We never send the raw alert text unless you turn it on.</p>
            <textarea
              className="rp-input"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What went wrong?"
              rows={4}
              autoFocus
            />
            {rawText && (
              <label className="rp-raw-row">
                <input type="checkbox" checked={includeRaw} onChange={(e) => setIncludeRaw(e.target.checked)} />
                Include the raw alert text
              </label>
            )}
            {error && <p className="rp-error">{error}</p>}
            <div className="rp-actions">
              <button type="button" className="btn-secondary-sm" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn-primary-sm" disabled={sending || !message.trim()} onClick={send}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .rp-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: flex-end; justify-content: center; z-index: 1100; }
        .rp-sheet { background: var(--bg-card); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: 20px; width: 100%; max-width: 480px; box-shadow: 0 -4px 20px rgba(0,0,0,0.2); }
        .rp-sheet h4 { margin: 0 0 8px; color: var(--text-primary); }
        .rp-sub { margin: 0 0 12px; color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5; }
        .rp-input { width: 100%; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-elevated, var(--bg-card)); color: var(--text-primary); padding: 10px 12px; font-size: 0.9rem; resize: vertical; }
        .rp-raw-row { display: flex; align-items: center; gap: 8px; margin-top: 10px; font-size: 0.85rem; color: var(--text-secondary); }
        .rp-error { color: var(--danger-color, var(--warning-color)); font-size: 0.82rem; margin-top: 8px; }
        .rp-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
        @media (min-width: 560px) { .rp-backdrop { align-items: center; } .rp-sheet { border-radius: var(--radius-lg); } }
      `}</style>
    </>
  );
}
