import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { categoriesFor, ALL_CATEGORIES } from '../constants/categories';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const money = (n) => `₦${Math.abs(Number(n)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthKey = (d) => { const x = new Date(d); return isNaN(x) ? '' : x.toISOString().slice(0, 7); };
const monthLabel = (m) => {
  if (!m) return 'Unknown';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

const Transactions = () => {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});

  // filters
  const [fMonth, setFMonth] = useState('all');
  const [fBank, setFBank] = useState('all');
  const [fCategory, setFCategory] = useState('all');
  const [fType, setFType] = useState('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const fetchAll = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_URL}/api/transactions`, auth());
      setAll(res.data || []);
    } catch (e) {
      flash('Could not load transactions. The server may be waking up — try again.', 'error');
    } finally { setLoading(false); }
  };
  useEffect(() => { fetchAll(); }, []);

  // distinct filter options
  const months = useMemo(() => [...new Set(all.map(t => monthKey(t.date)).filter(Boolean))].sort().reverse(), [all]);
  const bankOptions = useMemo(() => [...new Set(all.map(t => t.bank).filter(Boolean))].sort(), [all]);
  const catOptions = useMemo(() => [...new Set(all.map(t => t.category).filter(Boolean))].sort(), [all]);

  // import batches (each upload = a deletable statement)
  const batches = useMemo(() => {
    const map = new Map();
    for (const t of all) {
      if (t.source !== 'import' || !t.importBatch) continue;
      const g = map.get(t.importBatch) || { id: t.importBatch, bank: t.bank || 'Unknown', month: monthKey(t.date), count: 0, total: 0, importedAt: t.importedAt };
      g.count += 1; g.total += Math.abs(t.amount);
      if (monthKey(t.date) !== g.month) g.month = ''; // spans months
      map.set(t.importBatch, g);
    }
    return [...map.values()].sort((a, b) => new Date(b.importedAt || 0) - new Date(a.importedAt || 0));
  }, [all]);

  const filtered = useMemo(() => {
    let rows = all.filter(t => {
      if (fMonth !== 'all' && monthKey(t.date) !== fMonth) return false;
      if (fBank !== 'all' && (t.bank || '') !== fBank) return false;
      if (fCategory !== 'all' && t.category !== fCategory) return false;
      if (fType !== 'all' && t.type !== fType) return false;
      if (search && !(`${t.description} ${t.category} ${t.bank}`.toLowerCase().includes(search.toLowerCase()))) return false;
      return true;
    });
    rows = rows.sort((a, b) => {
      const v = sortBy === 'amount' ? Math.abs(a.amount) - Math.abs(b.amount) : new Date(a.date) - new Date(b.date);
      return sortDir === 'asc' ? v : -v;
    });
    return rows;
  }, [all, fMonth, fBank, fCategory, fType, search, sortBy, sortDir]);

  const totals = useMemo(() => {
    const income = filtered.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
    const expense = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
    return { income, expense };
  }, [filtered]);

  // selection
  const toggleSel = (id) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allVisibleSelected = filtered.length > 0 && filtered.every(t => selected.has(t._id));
  const toggleSelAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allVisibleSelected) filtered.forEach(t => n.delete(t._id));
    else filtered.forEach(t => n.add(t._id));
    return n;
  });

  // actions
  const removeFromState = (ids) => { const s = new Set(ids); setAll(prev => prev.filter(t => !s.has(t._id))); setSelected(new Set()); };

  const deleteOne = async (id) => {
    if (!window.confirm('Delete this transaction?')) return;
    try { await axios.delete(`${API_URL}/api/transactions/${id}`, auth()); removeFromState([id]); flash('Transaction deleted'); }
    catch { flash('Delete failed', 'error'); }
  };
  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected transaction(s)?`)) return;
    try { await axios.post(`${API_URL}/api/transactions/batch-delete`, { ids }, auth()); removeFromState(ids); flash(`Deleted ${ids.length} transaction(s)`); }
    catch { flash('Batch delete failed', 'error'); }
  };
  const deleteBatch = async (b) => {
    if (!window.confirm(`Delete the entire "${b.bank}" statement (${b.count} transactions)?`)) return;
    try {
      await axios.delete(`${API_URL}/api/transactions/batch/${b.id}`, auth());
      setAll(prev => prev.filter(t => t.importBatch !== b.id));
      flash(`Deleted ${b.count} transaction(s) from ${b.bank}`);
    } catch { flash('Statement delete failed', 'error'); }
  };

  const quickCategory = async (t, category) => {
    setAll(prev => prev.map(x => x._id === t._id ? { ...x, category } : x));
    try { await axios.put(`${API_URL}/api/transactions/${t._id}`, { category }, auth()); }
    catch { flash('Could not update category', 'error'); fetchAll(); }
  };

  const startEdit = (t) => {
    setEditingId(t._id);
    setEditForm({ date: monthKey(t.date) ? new Date(t.date).toISOString().slice(0, 10) : '', description: t.description, amount: Math.abs(t.amount), type: t.type, category: t.category });
  };
  const saveEdit = async (id) => {
    try {
      const res = await axios.put(`${API_URL}/api/transactions/${id}`, editForm, auth());
      setAll(prev => prev.map(t => t._id === id ? res.data : t));
      setEditingId(null);
      flash('Transaction updated');
    } catch { flash('Update failed', 'error'); }
  };

  const resetFilters = () => { setFMonth('all'); setFBank('all'); setFCategory('all'); setFType('all'); setSearch(''); };

  if (loading) return <div className="loading">Loading transactions...</div>;

  return (
    <div className="tx-page">
      <div className="section-header">
        <h2><i className="fas fa-receipt"></i> Transactions</h2>
        <p>View, edit, group and delete every transaction across your statements.</p>
      </div>

      {message && <div className={`tx-msg ${message.type}`}>{message.text}</div>}

      {/* Statements (import batches) */}
      {batches.length > 0 && (
        <div className="tx-card">
          <h3>Imported statements</h3>
          <div className="batch-list">
            {batches.map(b => (
              <div className="batch-chip" key={b.id}>
                <div>
                  <strong>{b.bank}</strong>
                  <span className="batch-meta">{b.month ? monthLabel(b.month) : 'multiple months'} · {b.count} txns · {money(b.total)}</span>
                </div>
                <button className="btn-danger-sm" onClick={() => deleteBatch(b)}><i className="fas fa-trash"></i> Delete statement</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="tx-card filters">
        <select value={fMonth} onChange={e => setFMonth(e.target.value)}>
          <option value="all">All months</option>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <select value={fBank} onChange={e => setFBank(e.target.value)}>
          <option value="all">All banks</option>
          {bankOptions.map(b => <option key={b} value={b}>{b}</option>)}
          {bankOptions.length === 0 && <option value="" disabled>No bank tags yet</option>}
        </select>
        <select value={fCategory} onChange={e => setFCategory(e.target.value)}>
          <option value="all">All categories</option>
          {catOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={fType} onChange={e => setFType(e.target.value)}>
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <input type="text" placeholder="Search description…" value={search} onChange={e => setSearch(e.target.value)} />
        <select value={`${sortBy}:${sortDir}`} onChange={e => { const [s, d] = e.target.value.split(':'); setSortBy(s); setSortDir(d); }}>
          <option value="date:desc">Newest first</option>
          <option value="date:asc">Oldest first</option>
          <option value="amount:desc">Amount high → low</option>
          <option value="amount:asc">Amount low → high</option>
        </select>
        <button className="btn-secondary" onClick={resetFilters}>Reset</button>
      </div>

      {/* Summary + bulk actions */}
      <div className="tx-summary">
        <span>{filtered.length} shown</span>
        <span className="pos">In {money(totals.income)}</span>
        <span className="neg">Out {money(totals.expense)}</span>
        {selected.size > 0 && (
          <button className="btn-danger-sm" onClick={deleteSelected}><i className="fas fa-trash"></i> Delete selected ({selected.size})</button>
        )}
      </div>

      {/* Table */}
      <div className="tx-card table-wrap">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelAll} /></th>
              <th>Date</th><th>Description</th><th>Amount</th><th>Type</th><th>Category</th><th>Bank</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(t => editingId === t._id ? (
              <tr key={t._id} className="editing">
                <td></td>
                <td><input type="date" value={editForm.date} onChange={e => setEditForm({ ...editForm, date: e.target.value })} /></td>
                <td><input type="text" value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} /></td>
                <td><input type="number" step="0.01" value={editForm.amount} onChange={e => setEditForm({ ...editForm, amount: e.target.value })} style={{ width: '90px' }} /></td>
                <td>
                  <select value={editForm.type} onChange={e => setEditForm({ ...editForm, type: e.target.value })}>
                    <option value="expense">Expense</option><option value="income">Income</option>
                  </select>
                </td>
                <td>
                  <select value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
                    {categoriesFor(editForm.type).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td>{t.bank || '—'}</td>
                <td className="row-actions">
                  <button className="icon-btn save" onClick={() => saveEdit(t._id)}><i className="fas fa-check"></i></button>
                  <button className="icon-btn" onClick={() => setEditingId(null)}><i className="fas fa-times"></i></button>
                </td>
              </tr>
            ) : (
              <tr key={t._id} className={selected.has(t._id) ? 'sel' : ''}>
                <td><input type="checkbox" checked={selected.has(t._id)} onChange={() => toggleSel(t._id)} /></td>
                <td className="nowrap">{new Date(t.date).toLocaleDateString()}</td>
                <td className="desc" title={t.description}>{t.description}</td>
                <td className={`nowrap ${t.type === 'income' ? 'pos' : 'neg'}`}>{t.type === 'income' ? '+' : '−'}{money(t.amount)}</td>
                <td className="nowrap">{t.type === 'income' ? 'Income' : 'Expense'}</td>
                <td>
                  <select className="cat-select" value={ALL_CATEGORIES.includes(t.category) ? t.category : ''} onChange={e => quickCategory(t, e.target.value)}>
                    {!ALL_CATEGORIES.includes(t.category) && <option value="">{t.category}</option>}
                    {categoriesFor(t.type).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </td>
                <td className="nowrap">{t.bank || '—'}</td>
                <td className="row-actions">
                  <button className="icon-btn" onClick={() => startEdit(t)} title="Edit"><i className="fas fa-pen"></i></button>
                  <button className="icon-btn del" onClick={() => deleteOne(t._id)} title="Delete"><i className="fas fa-trash"></i></button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan="8" className="empty">No transactions match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx="true">{`
        .tx-page { max-width: 1100px; margin: 0 auto; padding: 16px; }
        .tx-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px; }
        .tx-card h3 { margin: 0 0 12px; font-size: 1rem; }
        .tx-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; text-align: center; }
        .tx-msg.success { background: rgba(56,161,105,0.12); color: #38a169; }
        .tx-msg.error { background: rgba(229,62,62,0.12); color: #e53e3e; }
        .batch-list { display: flex; flex-wrap: wrap; gap: 10px; }
        .batch-chip { display: flex; align-items: center; gap: 14px; justify-content: space-between; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); padding: 10px 12px; min-width: 260px; }
        .batch-meta { display: block; font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px; }
        .filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
        .filters select, .filters input { padding: 8px 10px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); font-size: 0.85rem; }
        .filters input[type=text] { flex: 1; min-width: 160px; }
        .tx-summary { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; margin-bottom: 10px; font-size: 0.85rem; color: var(--text-secondary); padding: 0 4px; }
        .pos { color: #38a169; font-weight: 600; }
        .neg { color: #e53e3e; font-weight: 600; }
        .table-wrap { overflow-x: auto; padding: 0; }
        table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
        th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid var(--glass-border); }
        th { position: sticky; top: 0; background: var(--card-bg); font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
        td.desc { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        td.nowrap { white-space: nowrap; }
        tr.sel { background: rgba(99,102,241,0.08); }
        tr.editing td { background: rgba(99,102,241,0.05); }
        tr.editing input, tr.editing select { padding: 6px 8px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: 8px; color: var(--text-primary); width: 100%; }
        .cat-select { padding: 4px 6px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: 8px; color: var(--text-primary); font-size: 0.78rem; max-width: 150px; cursor: pointer; }
        .row-actions { display: flex; gap: 6px; white-space: nowrap; }
        .icon-btn { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: 8px; padding: 6px 8px; cursor: pointer; color: var(--text-primary); }
        .icon-btn.del:hover { color: #e53e3e; border-color: #e53e3e; }
        .icon-btn.save { color: #38a169; }
        .btn-danger-sm { background: rgba(229,62,62,0.1); color: #e53e3e; border: 1px solid rgba(229,62,62,0.3); border-radius: var(--radius-md); padding: 7px 12px; cursor: pointer; font-size: 0.8rem; font-weight: 600; }
        .btn-secondary { padding: 8px 14px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); cursor: pointer; font-size: 0.85rem; }
        td.empty { text-align: center; color: var(--text-secondary); padding: 28px; }
      `}</style>
    </div>
  );
};

export default Transactions;
