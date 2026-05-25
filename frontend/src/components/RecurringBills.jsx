import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const RecurringBills = () => {
  const { darkMode } = useAuth();
  const [bills, setBills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({
    name: '', amount: '', dueDate: 1, frequency: 'monthly', category: 'Bills', autoPay: false
  });

  useEffect(() => {
    fetchBills();
  }, []);

  const fetchBills = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get('http://localhost:5000/api/bills', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBills(res.data);
      setLoading(false);
    } catch (err) {
      console.error(err);
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.name || !formData.amount || !formData.dueDate) return;
    try {
      const token = localStorage.getItem('token');
      if (editingId) {
        await axios.put(`http://localhost:5000/api/bills/${editingId}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setMessage({ text: 'Bill updated', type: 'success' });
      } else {
        await axios.post('http://localhost:5000/api/bills', formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setMessage({ text: 'Bill added', type: 'success' });
      }
      fetchBills();
      setShowForm(false);
      resetForm();
    } catch (err) {
      setMessage({ text: 'Failed to save bill', type: 'error' });
    } finally {
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const deleteBill = async (id) => {
    if (!window.confirm('Delete this bill?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`http://localhost:5000/api/bills/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchBills();
      setMessage({ text: 'Bill deleted', type: 'success' });
    } catch (err) {
      setMessage({ text: 'Failed to delete', type: 'error' });
    }
  };

  const processDueBills = async () => {
    setProcessing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.post('http://localhost:5000/api/bills/process', {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ text: `Processed ${res.data.processed} bills`, type: 'success' });
      fetchBills();
    } catch (err) {
      setMessage({ text: 'Error processing bills', type: 'error' });
    } finally {
      setProcessing(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const resetForm = () => {
    setFormData({ name: '', amount: '', dueDate: 1, frequency: 'monthly', category: 'Bills', autoPay: false });
    setEditingId(null);
  };

  const editBill = (bill) => {
    setFormData({
      name: bill.name,
      amount: bill.amount,
      dueDate: bill.dueDate,
      frequency: bill.frequency,
      category: bill.category,
      autoPay: bill.autoPay
    });
    setEditingId(bill._id);
    setShowForm(true);
  };

  const formatCurrency = (value) => `₦${value.toLocaleString()}`;
  const getDueStatus = (nextDue) => {
    const today = new Date();
    const due = new Date(nextDue);
    const diffDays = Math.ceil((due - today) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: 'Overdue', class: 'danger' };
    if (diffDays <= 3) return { text: `${diffDays} days left`, class: 'warning' };
    return { text: `${diffDays} days left`, class: 'normal' };
  };

  if (loading) return <div className="loading-container"><div className="loading-spinner"></div><p>Loading bills...</p></div>;

  return (
    <div className="recurring-bills-page">
      <div className="section-header">
        <h2><i className="fas fa-receipt"></i> Recurring Bills & Reminders</h2>
        <p className="section-subtitle">Track your monthly/yearly bills and set up auto‑pay from wallet</p>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="action-bar">
        <button className="btn-primary" onClick={() => { resetForm(); setShowForm(!showForm); }}>
          <i className="fas fa-plus"></i> Add Bill
        </button>
        <button className="btn-secondary" onClick={processDueBills} disabled={processing}>
          <i className="fas fa-sync-alt"></i> {processing ? 'Processing...' : 'Check Due Bills'}
        </button>
      </div>

      {showForm && (
        <div className="bill-form glass-effect">
          <h3>{editingId ? 'Edit Bill' : 'New Recurring Bill'}</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <div className="form-group">
                <label>Bill Name</label>
                <input type="text" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Amount (₦)</label>
                <input type="number" step="0.01" min="0" value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})} required />
              </div>
              <div className="form-group">
                <label>Due Date (day of month)</label>
                <input type="number" min="1" max="31" value={formData.dueDate} onChange={(e) => setFormData({...formData, dueDate: parseInt(e.target.value)})} required />
              </div>
              <div className="form-group">
                <label>Frequency</label>
                <select value={formData.frequency} onChange={(e) => setFormData({...formData, frequency: e.target.value})}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div className="form-group">
                <label>Category</label>
                <input type="text" value={formData.category} onChange={(e) => setFormData({...formData, category: e.target.value})} />
              </div>
              <div className="form-group">
                <label>Auto‑pay from Wallet</label>
                <input type="checkbox" checked={formData.autoPay} onChange={(e) => setFormData({...formData, autoPay: e.target.checked})} />
                <small>If enabled, bill will be deducted automatically on due date</small>
              </div>
            </div>
            <div className="form-buttons">
              <button type="submit" className="btn-submit">Save</button>
              <button type="button" className="btn-cancel" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="bills-list glass-effect">
        <h3>Your Bills</h3>
        {bills.length === 0 ? (
          <div className="empty-state"><p>No recurring bills added yet.</p></div>
        ) : (
          <div className="bills-table">
            {bills.map(bill => {
              const dueStatus = getDueStatus(bill.nextDue);
              return (
                <div key={bill._id} className={`bill-item ${dueStatus.class}`}>
                  <div className="bill-info">
                    <div className="bill-name">{bill.name}</div>
                    <div className="bill-details">
                      <span className="bill-amount">{formatCurrency(bill.amount)}</span>
                      <span className="bill-frequency">{bill.frequency === 'monthly' ? '/month' : '/year'}</span>
                      <span className="bill-due">Due on day {bill.dueDate}</span>
                      <span className={`bill-status ${dueStatus.class}`}>{dueStatus.text}</span>
                      {bill.autoPay && <span className="bill-autopay">🔁 Auto‑pay enabled</span>}
                    </div>
                  </div>
                  <div className="bill-actions">
                    <button className="edit-btn" onClick={() => editBill(bill)}><i className="fas fa-edit"></i></button>
                    <button className="delete-btn" onClick={() => deleteBill(bill._id)}><i className="fas fa-trash"></i></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style jsx="true">{`
        .recurring-bills-page { padding: 20px; max-width: 900px; margin: 0 auto; }
        .action-bar { display: flex; gap: 15px; margin-bottom: 25px; }
        .btn-primary, .btn-secondary { padding: 10px 20px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; }
        .btn-primary { background: var(--gradient-primary); color: white; border: none; }
        .btn-secondary { background: var(--glass-bg); border: 1px solid var(--border-color); color: var(--text-primary); }
        .bill-form { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 25px; margin-bottom: 30px; border: 1px solid var(--glass-border); }
        .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
        .form-group { display: flex; flex-direction: column; gap: 5px; }
        .form-group label { font-weight: 600; }
        .form-group input, .form-group select { padding: 10px; background: var(--glass-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); }
        .form-group input[type="checkbox"] { width: auto; }
        .form-buttons { display: flex; gap: 15px; justify-content: flex-end; }
        .btn-submit, .btn-cancel { padding: 10px 20px; border-radius: var(--radius-md); cursor: pointer; }
        .btn-submit { background: var(--gradient-success); color: white; border: none; }
        .btn-cancel { background: var(--glass-bg); border: 1px solid var(--border-color); }
        .bills-list { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 25px; border: 1px solid var(--glass-border); }
        .bill-item { display: flex; justify-content: space-between; align-items: center; padding: 15px; border-bottom: 1px solid var(--border-color); }
        .bill-item:last-child { border-bottom: none; }
        .bill-item.warning { background: rgba(243,156,18,0.05); }
        .bill-item.danger { background: rgba(231,76,60,0.05); }
        .bill-info { flex: 1; }
        .bill-name { font-weight: 600; font-size: 1.1rem; margin-bottom: 5px; }
        .bill-details { display: flex; flex-wrap: wrap; gap: 15px; font-size: 0.85rem; color: var(--text-secondary); }
        .bill-status { padding: 2px 8px; border-radius: 20px; background: var(--glass-bg); }
        .bill-status.warning { color: #f39c12; background: rgba(243,156,18,0.1); }
        .bill-status.danger { color: #e74c3c; background: rgba(231,76,60,0.1); }
        .bill-autopay { color: #27ae60; }
        .edit-btn, .delete-btn { background: none; border: none; cursor: pointer; padding: 5px; margin: 0 3px; color: var(--text-secondary); }
        .edit-btn:hover { color: var(--accent-primary); }
        .delete-btn:hover { color: #e74c3c; }
        .message { padding: 10px; border-radius: var(--radius-md); margin-bottom: 15px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
      `}</style>
    </div>
  );
};

export default RecurringBills;