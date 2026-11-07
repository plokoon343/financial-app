import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNairaFull } from '../utils/format';
import { undoable } from '../lib/undo';
import Select from './Select';

// Alerts we could not read (round 6, Block 4), web half of 13.11 parity.
//
// WHY THIS IS NOT IN THE ACTION CENTER ANY MORE
// The Action Center is one question, one click. An alert the parser could not read is
// neither: we do not know the amount or even whether money moved, so there is no
// question to put on a card. Research section 14 names the old version of this - raw
// bank text in editable fields inside the Action Center - as a rule break, because it
// hands the user the parser's job.
//
// It cannot be dropped either: one of these may be a real transaction. So it lives
// here, off the queue, reached from the end of the Action Center.

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const SOURCE = { email: 'Email alert', notification: 'Bank app notification', sms: 'Bank text', share: 'Shared receipt', import: 'Statement', manual: 'Added by you' };

export default function AlertsToCheck() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [drafts, setDrafts] = useState({});

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/pending-alerts`, auth());
      setItems(data.items || []);
      setError('');
    } catch {
      setError('Could not load these alerts.');
      setItems([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const draftOf = (it) => drafts[it.id] ?? {
    amount: it.parsed?.amount ? String(it.parsed.amount) : '',
    type: it.parsed?.directionKnown ? (it.parsed.type ?? '') : '',
    description: it.parsed?.description ?? '',
  };
  const setDraft = (it, patch) => setDrafts((d) => ({ ...d, [it.id]: { ...draftOf(it), ...patch } }));
  const drop = (id) => setItems((prev) => (prev ? prev.filter((i) => i.id !== id) : prev));

  return (
    <div className="atc-page">
      <header>
        <h2>Alerts to check</h2>
        <p>
          We could not read these clearly, so nothing was added to your money. Fill in what is
          missing to keep one, or tell us it was not a transaction.
        </p>
      </header>

      {error && <p className="atc-error" role="alert">{error}</p>}
      {items === null && !error && <div className="loading-container"><div className="loading-spinner"></div></div>}
      {items && items.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><i className="fas fa-circle-check" aria-hidden="true"></i></div>
          <h3>Nothing to check</h3>
          <p>Every alert we received was read and filed.</p>
        </div>
      )}

      {(items || []).map((it) => {
        const d = draftOf(it);
        const ready = Number(d.amount) > 0 && (d.type === 'income' || d.type === 'expense');
        return (
          <section key={it.id} className="atc-card">
            <pre className="atc-raw">{it.raw}</pre>
            <p className="atc-meta">
              {SOURCE[it.source] || 'Alert'}{it.parsed?.bank ? ` · ${it.parsed.bank}` : ''}
              {it.parsed?.amount ? ` · we read ${fmtNairaFull(it.parsed.amount)}, but were not sure enough to save it` : ''}
            </p>
            <div className="atc-fields">
              <input
                aria-label="Description" placeholder="What was it?" maxLength={140}
                value={d.description} onChange={(e) => setDraft(it, { description: e.target.value })}
              />
              <input
                aria-label="Amount" type="number" min="0" step="0.01" placeholder="Amount"
                value={d.amount} onChange={(e) => setDraft(it, { amount: e.target.value })}
              />
              <Select aria-label="Money in or out" value={d.type} onChange={(e) => setDraft(it, { type: e.target.value })}>
                <option value="">Money in or out?</option>
                <option value="expense">Money out</option>
                <option value="income">Money in</option>
              </Select>
            </div>
            <div className="atc-actions">
              <button
                type="button" className="btn-primary" disabled={!ready}
                onClick={async () => {
                  drop(it.id);
                  try {
                    await axios.post(`${API_URL}/api/pending-alerts/${it.id}/confirm`,
                      { amount: Number(d.amount), type: d.type, description: d.description, date: it.parsed?.date }, auth());
                  } catch { setError('That did not save. Try again.'); }
                  load();
                }}
              >Save it</button>
              <button
                type="button" className="btn-secondary"
                onClick={() => {
                  drop(it.id);
                  undoable('Got it. Alerts like this will be left out.',
                    () => axios.post(`${API_URL}/api/pending-alerts/${it.id}/not-transaction`, {}, auth()), load);
                }}
              >Not a transaction</button>
            </div>
          </section>
        );
      })}

      <style>{`
        .atc-page { max-width: 680px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; }
        .atc-page header h2 { color: var(--text-primary); margin: 0 0 6px; }
        .atc-page header p, .atc-meta { color: var(--text-secondary); font-size: 0.88rem; margin: 0; }
        .atc-error { color: var(--expense-color); }
        .atc-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; display: grid; gap: 10px; }
        .atc-raw { margin: 0; padding: 12px; border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font: 0.82rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 180px; overflow: auto; }
        .atc-fields { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; }
        .atc-fields input, .atc-fields select { background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 9px 11px; font: inherit; min-width: 0; }
        .atc-actions { display: flex; flex-wrap: wrap; gap: 8px; }
        @media (max-width: 640px) { .atc-fields { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
