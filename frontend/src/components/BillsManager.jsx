import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import PayBill from './PayBill';

const BillsManager = () => {
  const [debts, setDebts] = useState([]);
  const [recurringBills, setRecurringBills] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);

  // Selected items to pay (keys: `bill_<id>`, `debt_<id>`)
  const [selected, setSelected] = useState(new Set());
  const [paySource, setPaySource] = useState('wallet'); // 'wallet' | 'account'

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const fetchAll = async () => {
    try {
      const [debtsRes, billsRes, goalsRes] = await Promise.all([
        axios.get(`${API_URL}/api/debts`, authHeaders()),
        axios.get(`${API_URL}/api/bills`, authHeaders()),
        axios.get(`${API_URL}/api/goals`, authHeaders()),
      ]);
      setDebts(debtsRes.data || []);
      setRecurringBills(billsRes.data || []);
      setGoals(goalsRes.data || []);
    } catch (err) {
      console.error('Failed to fetch data:', err);
      flash('Could not load your obligations. The server may be waking up — try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const toggle = (key) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const removeItem = async (type, id) => {
    if (!window.confirm('Delete this item?')) return;
    try {
      const ep = type === 'debt' ? `/api/debts/${id}` : `/api/bills/${id}`;
      await axios.delete(`${API_URL}${ep}`, authHeaders());
      fetchAll();
    } catch (err) {
      flash('Could not delete the item.', 'error');
    }
  };

  const paySelected = async () => {
    const billIds = [...selected].filter((k) => k.startsWith('bill_')).map((k) => k.slice(5));
    const debtIds = [...selected].filter((k) => k.startsWith('debt_')).map((k) => k.slice(5));
    if (billIds.length === 0 && debtIds.length === 0) { flash('Select at least one item to pay.', 'error'); return; }
    if (paySource !== 'wallet') { flash('Paying from a bank account arrives with bank integration. Use Wallet for now.', 'error'); return; }
    if (!window.confirm(`Pay ${billIds.length + debtIds.length} selected item(s) from your wallet?`)) return;
    setProcessing(true);
    try {
      const res = await axios.post(`${API_URL}/api/payments/pay-selected`, { billIds, debtIds }, authHeaders());
      flash(res.data.message || 'Payment complete.');
      setSelected(new Set());
      fetchAll();
      window.dispatchEvent(new CustomEvent('wallet-updated', { detail: { balance: res.data.balance } }));
    } catch (err) {
      flash(err.response?.data?.message || 'Payment failed.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <div className="loading">Loading your obligations...</div>;

  const selectedCount = selected.size;

  return (
    <div className="bills-manager">
      <div className="bills-head">
        <div>
          <h2><i className="fas fa-receipt"></i> Bills & Obligations</h2>
          <p>Choose what to pay, settle it from your wallet, and track your debts & goals.</p>
        </div>
        <button onClick={fetchAll} className="btn-ghost"><i className="fas fa-sync-alt"></i> Refresh</button>
      </div>

      {message && <div className={`bills-msg ${message.type}`}>{message.text}</div>}

      {/* In-app bill payments (airtime, data, TV, electricity) */}
      <PayBill />

      {/* Pay bar */}
      <div className="pay-bar">
        <div className="pay-from">
          <label>Pay from</label>
          <select value={paySource} onChange={(e) => setPaySource(e.target.value)}>
            <option value="wallet">Wallet</option>
            <option value="account">Bank account (with bank integration)</option>
          </select>
        </div>
        <button className="btn-pay" onClick={paySelected} disabled={processing || selectedCount === 0}>
          <i className="fas fa-bolt"></i> {processing ? 'Processing…' : `Pay Selected${selectedCount ? ` (${selectedCount})` : ''}`}
        </button>
      </div>

      {/* Recurring bills */}
      <section className="bills-section">
        <h3><i className="fas fa-receipt"></i> Recurring Bills</h3>
        {recurringBills.length === 0 ? (
          <p className="muted">No recurring bills.</p>
        ) : recurringBills.map((b) => {
          const key = `bill_${b._id}`;
          return (
            <div key={key} className={`pay-row ${selected.has(key) ? 'on' : ''}`}>
              <label className="pay-check">
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} />
              </label>
              <div className="pay-main">
                <span className="pay-name">{b.name}</span>
                <span className="pay-meta">Due day {b.dueDate} · {b.frequency === 'yearly' ? 'yearly' : 'monthly'}</span>
              </div>
              <span className="pay-amount">{fmtNaira(b.amount)}</span>
              <button className="row-del" onClick={() => removeItem('bill', b._id)} title="Delete"><i className="fas fa-trash"></i></button>
            </div>
          );
        })}
      </section>

      {/* Debts */}
      <section className="bills-section">
        <h3><i className="fas fa-credit-card"></i> Debts</h3>
        {debts.length === 0 ? (
          <p className="muted">No debts tracked.</p>
        ) : debts.map((d) => {
          const key = `debt_${d._id}`;
          const pay = d.scheduledPayment?.amount || d.minPayment;
          return (
            <div key={key} className={`pay-row ${selected.has(key) ? 'on' : ''}`}>
              <label className="pay-check">
                <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} disabled={d.balance <= 0} />
              </label>
              <div className="pay-main">
                <span className="pay-name">{d.name}</span>
                <span className="pay-meta">Balance {fmtNaira(d.balance)} · pays {fmtNaira(pay)}</span>
              </div>
              <span className="pay-amount">{fmtNaira(pay)}</span>
              <button className="row-del" onClick={() => removeItem('debt', d._id)} title="Delete"><i className="fas fa-trash"></i></button>
            </div>
          );
        })}
      </section>

      {/* Goals — tracked only (contribute from the Goals page) */}
      <section className="bills-section">
        <h3><i className="fas fa-flag-checkered"></i> Goals <span className="track-tag">tracked</span></h3>
        {goals.length === 0 ? (
          <p className="muted">No goals yet. <Link to="/goals" className="inline-link">Create one</Link>.</p>
        ) : goals.map((g) => {
          const pct = g.target > 0 ? Math.min((g.current / g.target) * 100, 100) : 0;
          return (
            <div key={g._id} className="track-row">
              <div className="pay-main">
                <span className="pay-name">{g.name}</span>
                <span className="pay-meta">{fmtNaira(g.current)} / {fmtNaira(g.target)} · {pct.toFixed(0)}%</span>
                <div className="track-bar"><div className="track-fill" style={{ width: `${pct}%` }} /></div>
              </div>
              <Link to="/goals" className="inline-link">Contribute</Link>
            </div>
          );
        })}
      </section>

      <style jsx="true">{`
        .bills-manager { padding: 20px; max-width: 900px; margin: 0 auto; }
        .bills-head { display: flex; justify-content: space-between; align-items: center; gap: 15px; flex-wrap: wrap; margin-bottom: 16px; }
        .bills-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); }
        .bills-head p { color: var(--text-secondary); font-size: 0.9rem; margin-top: 4px; }
        .btn-ghost { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 8px 18px; cursor: pointer; font-weight: 600; }
        .bills-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; }
        .bills-msg.success { background: rgba(34,197,94,0.12); color: #22c55e; }
        .bills-msg.error { background: rgba(239,68,68,0.12); color: #ef4444; }
        .pay-bar { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 20px; }
        .pay-from { display: flex; flex-direction: column; gap: 6px; }
        .pay-from label { font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; }
        .pay-from select { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 14px; min-width: 240px; }
        .btn-pay { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 12px 22px; font-weight: 700; cursor: pointer; }
        .btn-pay:disabled { opacity: 0.5; cursor: default; }
        .bills-section { margin-bottom: 22px; }
        .bills-section h3 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); font-size: 1.1rem; margin-bottom: 10px; }
        .track-tag { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; background: var(--glass-bg); color: var(--text-secondary); padding: 2px 8px; border-radius: var(--radius-full); }
        .muted { color: var(--text-secondary); font-size: 0.9rem; }
        .inline-link { color: var(--accent-primary); font-weight: 600; text-decoration: none; }
        .pay-row, .track-row { display: flex; align-items: center; gap: 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 14px; margin-bottom: 8px; }
        .pay-row.on { border-color: var(--accent-primary); background: var(--glass-bg); }
        .pay-check input { width: 18px; height: 18px; accent-color: var(--accent-primary); cursor: pointer; }
        .pay-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .pay-name { color: var(--text-primary); font-weight: 600; }
        .pay-meta { color: var(--text-secondary); font-size: 0.8rem; }
        .pay-amount { color: var(--text-primary); font-weight: 700; white-space: nowrap; }
        .row-del { background: none; border: none; color: var(--text-faint); cursor: pointer; padding: 6px; }
        .row-del:hover { color: #ef4444; }
        .track-bar { height: 6px; border-radius: 4px; background: var(--glass-bg); overflow: hidden; margin-top: 6px; }
        .track-fill { height: 100%; background: var(--gradient-primary); border-radius: 4px; }
        .loading { text-align: center; padding: 60px; color: var(--text-secondary); }
        @media (max-width: 600px) { .pay-bar { flex-direction: column; align-items: stretch; } .pay-from select { min-width: 0; width: 100%; } .btn-pay { width: 100%; } }
      `}</style>
    </div>
  );
};

export default BillsManager;
