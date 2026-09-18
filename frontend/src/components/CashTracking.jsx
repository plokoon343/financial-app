import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { allCategoriesFor } from '../utils/categoryStore';

// Cash tracking (spec C4) — web parity with the mobile /cash screen. A cash withdrawal
// leaves the bank as one opaque "cash_withdrawal" (excluded from spend). Here the user
// breaks it into what the cash was actually spent on; each row becomes a categorised
// expense linked to the withdrawal (cashParentId), so the spending is counted while
// the withdrawal itself stays excluded (no double-count).

const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const blankRow = () => ({ category: '', amount: '', description: '' });

export default function CashTracking() {
  const [pending, setPending] = useState([]);
  const [rows, setRows] = useState({});       // withdrawalId -> [{category, amount, description}]
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const cats = allCategoriesFor('expense');
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2000); };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/cash/pending`, headers);
      const list = data || [];
      setPending(list);
      setRows(Object.fromEntries(list.map((w) => [w._id, [blankRow()]])));
    } catch { setError('Could not load your cash withdrawals.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { load(); }, [load]);

  const setRow = (wid, idx, patch) =>
    setRows((r) => ({ ...r, [wid]: r[wid].map((row, i) => (i === idx ? { ...row, ...patch } : row)) }));
  const addRow = (wid) => setRows((r) => ({ ...r, [wid]: [...r[wid], blankRow()] }));
  const removeRow = (wid, idx) => setRows((r) => ({ ...r, [wid]: r[wid].filter((_, i) => i !== idx) }));
  const total = (wid) => (rows[wid] || []).reduce((s, x) => s + (parseFloat(x.amount) || 0), 0);

  const save = async (w) => {
    const items = (rows[w._id] || [])
      .map((x) => ({ category: x.category || 'Other', amount: parseFloat(x.amount) || 0, description: x.description }))
      .filter((x) => x.amount > 0);
    if (!items.length) { flash('Add at least one cash expense'); return; }
    if (total(w._id) > w.amount + 0.5) { flash(`That's more than the ${naira(w.amount)} you withdrew`); return; }
    setBusy(w._id); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/transactions/${w._id}/allocate-cash`, { items }, headers);
      flash(`Tracked ${data.created} expense${data.created === 1 ? '' : 's'}${data.remaining > 0 ? ` · ${naira(data.remaining)} left untracked` : ''}`);
      setPending((prev) => prev.filter((x) => x._id !== w._id));
    } catch (e) { setError(e.response?.data?.message || 'Could not save that breakdown.'); }
    finally { setBusy(''); }
  };

  const skip = async (w) => {
    setBusy(w._id);
    try {
      await axios.post(`${API_URL}/api/transactions/${w._id}/skip-cash`, {}, headers);
      setPending((prev) => prev.filter((x) => x._id !== w._id));
    } catch { setError('Could not skip that one.'); }
    finally { setBusy(''); }
  };

  return (
    <div className="cash-page">
      <div className="cash-head">
        <h2><i className="fas fa-money-bill-wave"></i> Track your cash</h2>
        <p>Cash you withdrew is money we can&apos;t see. Break each withdrawal into what you actually spent it on, so your budget stays honest.</p>
      </div>

      {toast && <div className="cash-toast">{toast}</div>}
      {loading ? <div className="cash-card">Loading…</div> : (
        <>
          {pending.length === 0 ? (
            <div className="cash-card cash-empty">
              <i className="fas fa-check-circle" style={{ fontSize: '2rem', color: '#22c55e' }}></i>
              <p>No cash to track right now.</p>
              <p className="cash-sub">When you withdraw cash, it&apos;ll show up here to break down.</p>
            </div>
          ) : pending.map((w) => {
            const t = total(w._id);
            const remaining = w.amount - t;
            const over = t > w.amount + 0.5;
            return (
              <div key={w._id} className="cash-card">
                <div className="cash-top">
                  <div>
                    <div className="cash-amt">{naira(w.amount)} <span className="cash-tag">cash out</span></div>
                    <div className="cash-meta">{new Date(w.date).toLocaleDateString()}{w.bank ? ` · ${w.bank}` : ''}{w.description ? ` · ${w.description}` : ''}</div>
                  </div>
                </div>

                {(rows[w._id] || []).map((row, idx) => (
                  <div key={idx} className="cash-row">
                    <select className="cash-cat" value={row.category} onChange={(e) => setRow(w._id, idx, { category: e.target.value })}>
                      <option value="">Category…</option>
                      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input className="cash-num" type="number" inputMode="decimal" placeholder="Amount" value={row.amount} onChange={(e) => setRow(w._id, idx, { amount: e.target.value })} />
                    <input className="cash-desc" placeholder="Note (optional)" value={row.description} onChange={(e) => setRow(w._id, idx, { description: e.target.value })} />
                    {(rows[w._id].length > 1) && (
                      <button className="cash-x" title="Remove" onClick={() => removeRow(w._id, idx)}><i className="fas fa-times"></i></button>
                    )}
                  </div>
                ))}

                <button className="cash-addrow" onClick={() => addRow(w._id)}><i className="fas fa-plus"></i> Add another</button>

                <div className={`cash-bar ${over ? 'over' : ''}`}>
                  <span>Tracked {naira(t)} of {naira(w.amount)}</span>
                  <span>{over ? 'Over by ' + naira(t - w.amount) : naira(remaining) + ' left'}</span>
                </div>

                <div className="cash-actions">
                  <button className="cash-skip" disabled={busy === w._id} onClick={() => skip(w)}>Don&apos;t track this</button>
                  <button className="cash-save" disabled={busy === w._id || over || t <= 0} onClick={() => save(w)}>
                    {busy === w._id ? 'Saving…' : 'Save breakdown'}
                  </button>
                </div>
              </div>
            );
          })}
          {error && <div className="cash-card cash-err">{error}</div>}
        </>
      )}

      <style jsx="true">{`
        .cash-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .cash-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .cash-head p { color: var(--text-secondary); margin: 0 0 18px; }
        .cash-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; color: var(--text-primary); }
        .cash-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .cash-amt { font-size: 1.3rem; font-weight: 800; color: var(--text-primary); }
        .cash-tag { font-size: 0.7rem; font-weight: 800; text-transform: uppercase; color: #d97706; background: rgba(217,119,6,0.12); padding: 2px 8px; border-radius: 8px; vertical-align: middle; margin-left: 6px; }
        .cash-meta { color: var(--text-secondary); font-size: 0.83rem; margin-top: 2px; }
        .cash-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
        .cash-cat, .cash-num, .cash-desc { background: var(--bg-primary, var(--bg-card)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 9px 11px; color: var(--text-primary); font-size: 0.9rem; }
        .cash-cat { flex: 0 0 34%; }
        .cash-num { flex: 0 0 24%; }
        .cash-desc { flex: 1; }
        .cash-x { background: transparent; border: none; color: #e53e3e; cursor: pointer; padding: 6px; }
        .cash-addrow { background: transparent; border: 1px dashed var(--accent-primary); color: var(--accent-primary); border-radius: var(--radius-md); padding: 8px 14px; font-weight: 700; cursor: pointer; font-size: 0.85rem; }
        .cash-bar { display: flex; justify-content: space-between; margin: 12px 0; font-size: 0.85rem; font-weight: 700; color: var(--text-secondary); }
        .cash-bar.over { color: #e53e3e; }
        .cash-actions { display: flex; gap: 10px; justify-content: flex-end; }
        .cash-skip { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: var(--radius-md); padding: 10px 16px; font-weight: 700; cursor: pointer; }
        .cash-save { background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 10px 20px; font-weight: 800; cursor: pointer; }
        .cash-save:disabled { opacity: 0.5; cursor: default; }
        .cash-empty { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .cash-sub { color: var(--text-secondary); font-size: 0.85rem; }
        .cash-err { color: #e53e3e; }
        .cash-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: var(--radius-full); text-align: center; font-weight: 600; margin-bottom: 12px; z-index: 5; }
      `}</style>
    </div>
  );
}
