import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Recurring bills the user wants to be reminded about. Nothing is paid from here:
// on the due day Automonie sends a reminder and moves the bill to its next cycle.
const EMPTY = { name: '', amount: '', dueDate: '', frequency: 'monthly' };

const BillsManager = () => {
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const fetchBills = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/bills`, authHeaders());
      setBills(res.data || []);
    } catch {
      flash('Could not load your bills. The server may be waking up, try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBills(); }, [fetchBills]);

  const addBill = async (e) => {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    const dueDate = parseInt(form.dueDate, 10);
    if (!form.name.trim() || !(amount > 0) || !(dueDate >= 1 && dueDate <= 31)) {
      flash('Add a name, an amount and a due day between 1 and 31.', 'error');
      return;
    }
    setSaving(true);
    try {
      await axios.post(`${API_URL}/api/bills`, { name: form.name.trim(), amount, dueDate, frequency: form.frequency, category: 'Bills' }, authHeaders());
      setForm(EMPTY);
      flash('Bill added. We will remind you when it is due.');
      fetchBills();
    } catch (err) {
      flash(err.response?.data?.message || 'Could not add the bill.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const togglePause = async (bill) => {
    try {
      await axios.put(`${API_URL}/api/bills/${bill._id}`, { status: bill.status === 'paused' ? 'active' : 'paused' }, authHeaders());
      fetchBills();
    } catch {
      flash('Could not update the bill.', 'error');
    }
  };

  const removeBill = async (id) => {
    if (!window.confirm('Delete this bill?')) return;
    try {
      await axios.delete(`${API_URL}/api/bills/${id}`, authHeaders());
      fetchBills();
    } catch {
      flash('Could not delete the bill.', 'error');
    }
  };

  if (loading) return <div className="bm-loading">Loading your bills...</div>;

  const monthlyTotal = bills
    .filter((b) => b.status !== 'paused')
    .reduce((s, b) => s + (b.frequency === 'yearly' ? b.amount / 12 : b.amount), 0);

  return (
    <div className="bm-page">
      <div className="bm-head">
        <h2><i className="fas fa-receipt"></i> Bills</h2>
        <p>Add the bills you pay every month or year and we will remind you before each one is due.</p>
      </div>

      {message && <div className={`bm-msg ${message.type}`}>{message.text}</div>}

      <section className="bm-card">
        <div className="bm-summary">
          <span>About {fmtNaira(monthlyTotal)} a month in bills</span>
          <span className="bm-count">{bills.length} bill{bills.length === 1 ? '' : 's'}</span>
        </div>
        {bills.length === 0 ? (
          <p className="bm-muted">No bills yet. Add rent, data, electricity or anything else you pay regularly.</p>
        ) : bills.map((b) => (
          <div key={b._id} className={`bm-row ${b.status === 'paused' ? 'paused' : ''}`}>
            <div className="bm-main">
              <span className="bm-name">{b.name}</span>
              <span className="bm-meta">
                {b.status === 'paused'
                  ? 'Paused'
                  : `Next due ${new Date(b.nextDue).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}`}
                {' · '}{b.frequency === 'yearly' ? 'yearly' : 'monthly'}
              </span>
            </div>
            <span className="bm-amount">{fmtNaira(b.amount)}</span>
            <button type="button" className="bm-icon" onClick={() => togglePause(b)} title={b.status === 'paused' ? 'Resume reminders' : 'Pause reminders'}>
              <i className={`fas ${b.status === 'paused' ? 'fa-play' : 'fa-pause'}`}></i>
            </button>
            <button type="button" className="bm-icon danger" onClick={() => removeBill(b._id)} title="Delete">
              <i className="fas fa-trash"></i>
            </button>
          </div>
        ))}
      </section>

      <form className="bm-card bm-form" onSubmit={addBill}>
        <h3>Add a bill</h3>
        <div className="bm-grid">
          <label>Name
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rent, DSTV, Data" />
          </label>
          <label>Amount (₦)
            <input type="number" min="0" step="1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </label>
          <label>Due day
            <input type="number" min="1" max="31" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} placeholder="1 to 31" />
          </label>
          <label>How often
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        </div>
        <button type="submit" className="bm-submit" disabled={saving}>{saving ? 'Saving...' : 'Add bill'}</button>
      </form>

      <style>{`
        .bm-page { padding: 20px; max-width: 900px; margin: 0 auto; }
        .bm-head { margin-bottom: 16px; }
        .bm-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); }
        .bm-head p { color: var(--text-secondary); font-size: 0.9rem; margin-top: 4px; }
        .bm-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; }
        .bm-msg.success { background: rgba(34,197,94,0.12); color: #22c55e; }
        .bm-msg.error { background: rgba(239,68,68,0.12); color: #ef4444; }
        .bm-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 20px; }
        .bm-summary { display: flex; justify-content: space-between; align-items: center; color: var(--text-primary); font-weight: 600; margin-bottom: 12px; }
        .bm-count { font-size: 0.8rem; color: var(--text-secondary); font-weight: 500; }
        .bm-muted { color: var(--text-secondary); font-size: 0.9rem; }
        .bm-row { display: flex; align-items: center; gap: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 8px; }
        .bm-row.paused { opacity: 0.6; }
        .bm-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .bm-name { color: var(--text-primary); font-weight: 600; }
        .bm-meta { color: var(--text-secondary); font-size: 0.8rem; }
        .bm-amount { color: var(--text-primary); font-weight: 700; white-space: nowrap; }
        .bm-icon { background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 6px; }
        .bm-icon.danger:hover { color: #ef4444; }
        .bm-form h3 { color: var(--text-primary); font-size: 1.05rem; margin-bottom: 12px; }
        .bm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 14px; }
        .bm-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
        .bm-grid input, .bm-grid select { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; font-size: 0.95rem; }
        .bm-submit { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 12px 22px; font-weight: 700; cursor: pointer; }
        .bm-submit:disabled { opacity: 0.6; cursor: default; }
        .bm-loading { text-align: center; padding: 60px; color: var(--text-secondary); }
        @media (max-width: 600px) { .bm-submit { width: 100%; } }
      `}</style>
    </div>
  );
};

export default BillsManager;
