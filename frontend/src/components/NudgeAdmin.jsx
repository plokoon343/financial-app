import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Admin: the push nudge copy, with sends, opens and open rate per line over the
// chosen window (the weekly report). Lines can be edited, switched off or added
// without a release; the main line can't carry an amount or emoji.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const CATEGORY_LABEL = { spending: 'Spending alerts', budgets: 'Budgets', bills: 'Bills & subscriptions', streaks: 'Streaks & wins', recap: 'Weekly recap', tips: 'Tips' };

export default function NudgeAdmin() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // { trigger, id, text, withAmount, complete, active, isNew }
  const [msg, setMsg] = useState(null);
  const flash = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  const load = useCallback(() => {
    axios.get(`${API_URL}/api/admin/nudges?days=${days}`, auth()).then((r) => setData(r.data)).catch(() => flash('Could not load the report.', 'error'));
  }, [days]);
  useEffect(() => { load(); }, [load]);

  const save = async (v) => {
    try {
      await axios.put(`${API_URL}/api/admin/nudges/${v.trigger}/${v.id}`, { text: v.text, withAmount: v.withAmount || '', complete: !!v.complete, active: v.active !== false }, auth());
      setEditing(null); flash('Saved. It takes effect on the next hourly run.'); load();
    } catch (e) { flash(e.response?.data?.message || 'Could not save.', 'error'); }
  };

  if (!data) return <p className="na-muted">Loading…</p>;
  const rate = data.totals.sent ? Math.round((data.totals.opened / data.totals.sent) * 1000) / 10 : null;

  return (
    <div className="na">
      {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}
      <div className="na-head">
        <div>
          <h3>Push nudges</h3>
          <p className="na-muted">{data.totals.sent} sent, {data.totals.opened} opened{rate != null ? ` (${rate}%)` : ''} in the last {data.days} days. Retire lines that people don’t open.</p>
        </div>
        <label className="na-days">Window
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {data.triggers.map((t) => (
        <section key={t.trigger} className="na-trigger">
          <h4>{t.title} <span className="na-muted">· {t.trigger} · {CATEGORY_LABEL[t.category] || t.category}</span></h4>
          <table>
            <thead><tr><th>Line</th><th>Sent</th><th>Opened</th><th>Rate</th><th></th></tr></thead>
            <tbody>
              {t.variants.map((v) => (
                editing && editing.trigger === t.trigger && editing.id === v.id ? (
                  <tr key={v.id}><td colSpan={5}><Editor value={editing} onChange={setEditing} onSave={() => save(editing)} onCancel={() => setEditing(null)} /></td></tr>
                ) : (
                  <tr key={v.id} className={v.active ? '' : 'na-off'}>
                    <td>
                      <div>{v.text}</div>
                      {v.withAmount && <div className="na-muted">With amounts on: {v.withAmount}</div>}
                      <div className="na-muted">{v.id}{v.complete ? ' · goal reached' : ''}{v.active ? '' : ' · switched off'}</div>
                    </td>
                    <td>{v.sent}</td><td>{v.opened}</td><td>{v.openRate == null ? '-' : `${v.openRate}%`}</td>
                    <td><button type="button" className="btn-secondary" onClick={() => setEditing({ trigger: t.trigger, ...v })}>Edit</button></td>
                  </tr>
                )
              ))}
              {editing && editing.trigger === t.trigger && editing.isNew && (
                <tr><td colSpan={5}><Editor value={editing} onChange={setEditing} onSave={() => save(editing)} onCancel={() => setEditing(null)} /></td></tr>
              )}
            </tbody>
          </table>
          {!(editing && editing.trigger === t.trigger) && (
            <button type="button" className="btn-secondary na-add" onClick={() => setEditing({ trigger: t.trigger, id: `${t.trigger.split('_')[0]}-${Date.now().toString(36).slice(-4)}`, text: '', withAmount: '', active: true, isNew: true })}>Add a line</button>
          )}
        </section>
      ))}

      <style>{`
        .na { display: grid; gap: 18px; }
        .na-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; }
        .na-head h3 { margin: 0 0 4px; color: var(--text-primary); }
        .na-muted { color: var(--text-secondary); font-size: 0.82rem; }
        .na-days { display: grid; gap: 4px; color: var(--text-secondary); font-size: 0.82rem; }
        .na-days select, .na-edit input { background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 8px 10px; font: inherit; }
        .na-trigger h4 { margin: 0 0 6px; color: var(--text-primary); }
        .na-trigger table { width: 100%; border-collapse: collapse; }
        .na-trigger th { text-align: left; font-size: 0.78rem; color: var(--text-secondary); padding: 6px 8px; border-bottom: 1px solid var(--border-color); }
        .na-trigger td { padding: 8px; border-bottom: 1px solid var(--border-color); color: var(--text-primary); vertical-align: top; font-size: 0.9rem; }
        .na-trigger td:nth-child(n+2) { white-space: nowrap; font-variant-numeric: tabular-nums; }
        .na-off td { opacity: 0.55; }
        .na-add { margin-top: 8px; }
        .na-edit { display: grid; gap: 8px; }
        .na-edit label { display: grid; gap: 4px; color: var(--text-secondary); font-size: 0.82rem; }
        .na-edit-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
      `}</style>
    </div>
  );
}

function Editor({ value, onChange, onSave, onCancel }) {
  return (
    <div className="na-edit">
      <label>Line (no amounts, no emoji; variables like {'{category}'} are filled in)
        <input value={value.text} maxLength={200} onChange={(e) => onChange({ ...value, text: e.target.value })} />
      </label>
      <label>With amounts on (optional; may use {'{amount}'} or {'{remaining}'})
        <input value={value.withAmount || ''} maxLength={200} onChange={(e) => onChange({ ...value, withAmount: e.target.value })} />
      </label>
      <div className="na-edit-actions">
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={value.active !== false} onChange={(e) => onChange({ ...value, active: e.target.checked })} /> In use
        </label>
        <button type="button" className="btn-primary" disabled={!value.text.trim()} onClick={onSave}>Save</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
