import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Subscriptions: manage your own (manual add/delete) AND see recurring charges
// auto-detected from your statements. Manual ones are saved on the backend;
// detected ones are computed live and read-only.
const SUB_CATEGORIES = ['Entertainment', 'Utilities', 'Health', 'Work', 'Shopping', 'Education', 'Other'];

const SubscriptionManager = () => {
  const [saved, setSaved] = useState([]);       // manual, persisted
  const [detected, setDetected] = useState([]); // auto, read-only
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', cost: '', frequency: 'monthly', category: 'Entertainment' });

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [savedRes, detectRes] = await Promise.all([
        axios.get(`${API_URL}/api/subscriptions`, authHeaders()),
        axios.get(`${API_URL}/api/subscriptions/detect`, authHeaders()),
      ]);
      setSaved(savedRes.data || []);
      setDetected(detectRes.data || []);
    } catch (err) {
      setError('Could not load your subscriptions. The server may be waking up — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addSub = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.cost || Number(form.cost) <= 0) { flash('Enter a name and a valid cost.', 'error'); return; }
    setAdding(true);
    try {
      await axios.post(`${API_URL}/api/subscriptions`, {
        name: form.name.trim(), cost: Number(form.cost), frequency: form.frequency, category: form.category,
      }, authHeaders());
      flash('Subscription added.');
      setForm({ name: '', cost: '', frequency: 'monthly', category: 'Entertainment' });
      setShowForm(false);
      load();
    } catch (err) {
      flash(err.response?.data?.message || 'Could not add subscription.', 'error');
    } finally {
      setAdding(false);
    }
  };

  const deleteSub = async (id) => {
    if (!window.confirm('Delete this subscription?')) return;
    try {
      await axios.delete(`${API_URL}/api/subscriptions/${id}`, authHeaders());
      setSaved((prev) => prev.filter((s) => s._id !== id));
      flash('Subscription removed.');
    } catch {
      flash('Could not delete.', 'error');
    }
  };

  const monthlyOf = (s) => (s.frequency === 'yearly' ? s.cost / 12 : s.cost);
  const combined = [...saved, ...detected];
  const monthlyCost = combined.reduce((t, s) => t + monthlyOf(s), 0);
  const yearlyCost = monthlyCost * 12;

  const getCategoryColor = (category) => ({
    Entertainment: '#FF6B8B', Health: '#4ECDC4', Work: '#45B7D1', Education: '#9B8AFB',
    Shopping: '#FFA07A', Utilities: '#98D8C8', Other: '#C9C9C9',
  }[category] || '#C9C9C9');

  return (
    <div className="subscriptions-page">
      <div className="section-header">
        <h2><i className="fas fa-calendar-alt"></i> Subscriptions</h2>
        <p className="section-subtitle">Add your own subscriptions and see recurring charges detected from your statements.</p>
        <div className="header-actions">
          <button className="btn-primary" onClick={() => setShowForm((v) => !v)}>
            <i className="fas fa-plus"></i> {showForm ? 'Close' : 'Add subscription'}
          </button>
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <i className="fas fa-sync-alt"></i> {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="subs-error">{error}</div>}
      {message && <div className={`subs-msg ${message.type}`}>{message.text}</div>}

      {/* Add form */}
      {showForm && (
        <form className="add-form" onSubmit={addSub}>
          <div className="af-grid">
            <div className="af-field">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Netflix" autoFocus />
            </div>
            <div className="af-field">
              <label>Cost (₦)</label>
              <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="e.g. 4400" inputMode="decimal" />
            </div>
            <div className="af-field">
              <label>Billing</label>
              <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="af-field">
              <label>Category</label>
              <input list="sub-cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
              <datalist id="sub-cats">{SUB_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
          </div>
          <button className="btn-primary af-submit" type="submit" disabled={adding}>
            <i className="fas fa-check"></i> {adding ? 'Adding…' : 'Add subscription'}
          </button>
        </form>
      )}

      {/* Overview */}
      <div className="overview-grid">
        <div className="overview-card">
          <div className="overview-icon monthly-cost"><i className="fas fa-calendar-day"></i></div>
          <div className="overview-content"><h3>Monthly</h3><div className="overview-amount">{fmtNaira(monthlyCost)}</div></div>
        </div>
        <div className="overview-card">
          <div className="overview-icon yearly-cost"><i className="fas fa-calendar"></i></div>
          <div className="overview-content"><h3>Yearly</h3><div className="overview-amount">{fmtNaira(yearlyCost)}</div></div>
        </div>
        <div className="overview-card">
          <div className="overview-icon active-subs"><i className="fas fa-bell"></i></div>
          <div className="overview-content"><h3>Tracked</h3><div className="overview-amount">{combined.length}</div></div>
        </div>
      </div>

      {/* Your subscriptions (manual) */}
      <div className="subscriptions-list-container">
        <div className="list-header">
          <h3><i className="fas fa-user-check"></i> Added by you</h3>
          <span className="subscription-count">{saved.length}</span>
        </div>
        {loading ? (
          <div className="subs-loading">Loading…</div>
        ) : saved.length === 0 ? (
          <div className="empty-state small">
            <p>No subscriptions added yet. Tap <strong>Add subscription</strong> to track one manually.</p>
          </div>
        ) : (
          <div className="subscriptions-list">
            {saved.map((s) => (
              <div key={s._id} className="subscription-item">
                <div className="sub-name">
                  <i className="fas fa-receipt"></i>
                  <span>{s.name}</span>
                </div>
                <div className="sub-details">
                  <span className="sub-cost"><i className="fas fa-money-bill"></i>{fmtNaira(s.cost)}/{s.frequency === 'monthly' ? 'mo' : 'yr'}</span>
                  <span className="sub-category" style={{ backgroundColor: `${getCategoryColor(s.category)}20`, color: getCategoryColor(s.category), border: `1px solid ${getCategoryColor(s.category)}` }}>
                    <i className="fas fa-tag"></i>{s.category}
                  </span>
                  <button className="sub-del" onClick={() => deleteSub(s._id)} title="Delete"><i className="fas fa-trash"></i></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-detected */}
      <div className="subscriptions-list-container">
        <div className="list-header">
          <h3><i className="fas fa-wand-magic-sparkles"></i> Auto-detected from statements</h3>
          <span className="subscription-count">{detected.length} found</span>
        </div>
        {loading ? (
          <div className="subs-loading">Scanning your transactions…</div>
        ) : detected.length === 0 ? (
          <div className="empty-state small">
            <p>No recurring charges detected yet. Import more bank statements and refresh.</p>
          </div>
        ) : (
          <div className="subscriptions-list">
            {detected.map((s, i) => (
              <div key={`${s.name}-${i}`} className="subscription-item">
                <div className="sub-name">
                  <i className="fas fa-receipt"></i>
                  <span>{s.name}</span>
                  <span className="seen-badge">seen {s.occurrences}×</span>
                </div>
                <div className="sub-details">
                  <span className="sub-cost"><i className="fas fa-money-bill"></i>{fmtNaira(s.cost)}/{s.frequency === 'monthly' ? 'mo' : 'yr'}</span>
                  <span className="sub-category" style={{ backgroundColor: `${getCategoryColor(s.category)}20`, color: getCategoryColor(s.category), border: `1px solid ${getCategoryColor(s.category)}` }}>
                    <i className="fas fa-tag"></i>{s.category}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx="true">{`
        .subscriptions-page { padding: 20px; max-width: 1100px; margin: 0 auto; }
        .section-header { text-align: center; margin-bottom: 24px; padding: 18px 14px; background: var(--bg-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); border: 1px solid var(--border-color); }
        .section-header h2 { font-family: var(--font-heading); font-size: 2rem; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--text-primary); }
        .section-subtitle { color: var(--text-secondary); font-size: 1rem; max-width: 600px; margin: 0 auto 14px; }
        .header-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .btn-primary { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-full); padding: 9px 20px; cursor: pointer; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
        .btn-ghost { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 8px 18px; cursor: pointer; font-weight: 600; }
        .btn-ghost:disabled { opacity: 0.6; cursor: default; }
        .subs-error { background: rgba(239,68,68,0.12); color: #ef4444; padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; }
        .subs-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: center; }
        .subs-msg.success { background: rgba(34,197,94,0.12); color: #22c55e; }
        .subs-msg.error { background: rgba(239,68,68,0.12); color: #ef4444; }
        .subs-loading { text-align: center; padding: 40px; color: var(--text-secondary); }
        .add-form { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; margin-bottom: 22px; box-shadow: var(--shadow-md); }
        .af-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
        .af-field { display: flex; flex-direction: column; gap: 6px; }
        .af-field label { font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; }
        .af-field input, .af-field select { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; font-size: 0.95rem; }
        .af-submit { margin-top: 14px; }
        .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .overview-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; gap: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--border-color); }
        .overview-icon { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; flex-shrink: 0; }
        .overview-icon.monthly-cost { background: var(--gradient-primary); }
        .overview-icon.yearly-cost { background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%); }
        .overview-icon.active-subs { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
        .overview-content h3 { font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }
        .overview-amount { font-size: 1.6rem; font-weight: 700; font-family: var(--font-accent); color: var(--text-primary); }
        .subscriptions-list-container { background: var(--bg-card); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--border-color); margin-bottom: 24px; }
        .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color); }
        .list-header h3 { font-family: var(--font-heading); font-size: 1.2rem; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .subscription-count { font-size: 0.85rem; background: var(--glass-bg); padding: 6px 14px; border-radius: var(--radius-full); color: var(--text-secondary); font-weight: 600; }
        .empty-state { text-align: center; padding: 50px 30px; }
        .empty-state.small { padding: 26px; }
        .empty-state p { color: var(--text-secondary); max-width: 460px; margin: 0 auto; line-height: 1.6; }
        .subscriptions-list { display: flex; flex-direction: column; gap: 12px; }
        .subscription-item { background: var(--glass-bg); border-radius: var(--radius-md); padding: 18px; border-left: 4px solid var(--accent-primary); }
        .sub-name { display: flex; align-items: center; gap: 12px; font-size: 1.1rem; font-weight: 600; color: var(--text-primary); margin-bottom: 10px; }
        .seen-badge { font-size: 0.72rem; padding: 3px 10px; border-radius: var(--radius-full); background: var(--glass-bg); color: var(--text-secondary); font-weight: 600; }
        .sub-details { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
        .sub-details span { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; padding: 7px 14px; background: var(--glass-bg); border-radius: var(--radius-full); color: var(--text-secondary); }
        .sub-del { margin-left: auto; background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-md); padding: 7px 12px; cursor: pointer; }
        @media (max-width: 768px) { .overview-grid { grid-template-columns: 1fr; } .sub-details { gap: 8px; } }
      `}</style>
    </div>
  );
};

export default SubscriptionManager;
