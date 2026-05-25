import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
const BillsManager = () => {
  const { darkMode } = useAuth();
  const [debts, setDebts] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [recurringBills, setRecurringBills] = useState([]);
  const [banks, setBanks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingPayment, setProcessingPayment] = useState(false);

  // Local form state
  const [formState, setFormState] = useState({});

  // Fetch all bills and bank list
  const fetchAll = async () => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      const [debtsRes, subsRes, billsRes, banksRes] = await Promise.all([
        axios.get(`${API_URL}/api/debts`, { headers }),
        axios.get(`${API_URL}/api/subscriptions`, { headers }),
        axios.get(`${API_URL}/api/bills`, { headers }),
        axios.get(`${API_URL}/api/banks`, { headers }),
      ]);
      setDebts(debtsRes.data);
      setSubscriptions(subsRes.data);
      setRecurringBills(billsRes.data);
      setBanks(banksRes.data);

      // Initialize form state
      const initialFormState = {};
      const allItems = [
        ...debtsRes.data.map(d => ({ ...d, type: 'debt' })),
        ...subsRes.data.map(s => ({ ...s, type: 'subscription' })),
        ...billsRes.data.map(b => ({ ...b, type: 'bill' })),
      ];
      allItems.forEach(item => {
        const key = `${item.type}_${item._id}`;
        initialFormState[key] = {
          bankCode: item.bankCode || '',
          accountNumber: item.accountNumber || '',
          isVerifying: false,
        };
      });
      setFormState(initialFormState);
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // Delete a bill/debt/subscription
  const removeItem = async (type, id) => {
    if (!window.confirm('Are you sure you want to delete this item?')) return;
    try {
      const token = localStorage.getItem('token');
      let endpoint = '';
      if (type === 'debt') endpoint = `${API_URL}/api/debts/${id}`;
      else if (type === 'subscription') endpoint = `${API_URL}/api/subscriptions/${id}`;
      else if (type === 'bill') endpoint = `${API_URL}/api/bills/${id}`;
      await axios.delete(endpoint, { headers: { Authorization: `Bearer ${token}` } });
      await fetchAll(); // refresh list
    } catch (err) {
      console.error('Failed to delete item:', err);
      alert('Could not delete the item. Please try again.');
    }
  };

  // Update local form field
  const updateLocalField = (type, id, field, value) => {
    const key = `${type}_${id}`;
    setFormState(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value,
      },
    }));
  };

  // Resolve account name and save
  const verifyAndSave = async (type, id, bankCode, accountNumber) => {
    const key = `${type}_${id}`;
    if (!bankCode || !accountNumber || accountNumber.length !== 10) {
      alert('Please select a bank and enter a valid 10-digit account number');
      return;
    }

    setFormState(prev => ({
      ...prev,
      [key]: { ...prev[key], isVerifying: true },
    }));

    try {
      const token = localStorage.getItem('token');
      const resolveRes = await axios.get(`${API_URL}/api/bank/resolve`, {
        params: { bank_code: bankCode, account_number: accountNumber },
        headers: { Authorization: `Bearer ${token}` }
      });
      const accountName = resolveRes.data.account_name;

      const selectedBank = banks.find(b => b.code === bankCode);
      const bankName = selectedBank?.name || '';

      let endpoint = '';
      if (type === 'debt') endpoint = `${API_URL}/api/debts/${id}`;
      else if (type === 'subscription') endpoint = `${API_URL}/api/subscriptions/${id}`;
      else if (type === 'bill') endpoint = `${API_URL}/api/bills/${id}`;

      await axios.put(endpoint, {
        bankCode,
        bankName,
        accountNumber,
        accountName,
        recipient: accountName,
      }, { headers: { Authorization: `Bearer ${token}` } });

      await fetchAll();
      alert('Payment details saved successfully!');
    } catch (err) {
      console.error('Verification failed:', err);
      alert(err.response?.data?.message || 'Account verification failed');
    } finally {
      setFormState(prev => ({
        ...prev,
        [key]: { ...prev[key], isVerifying: false },
      }));
    }
  };

  // Pay all due bills
  const payAllDueBills = async () => {
    if (!window.confirm('Pay all pending bills, debts, and subscriptions due today or earlier?')) return;
    setProcessingPayment(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const response = await axios.post(`${API_URL}/api/payments/pay-all-due`, {}, { headers });
      alert(response.data.message || 'All due bills have been paid successfully!');
      await fetchAll();
    } catch (err) {
      console.error('Failed to pay bills:', err);
      alert(err.response?.data?.message || 'Error processing payments. Please try again.');
    } finally {
      setProcessingPayment(false);
    }
  };

  const formatCurrency = (amount) => `₦${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const allItems = [
    ...debts.map(d => ({ ...d, type: 'debt', dueDate: d.scheduledPayment?.dayOfMonth || null, amount: d.minPayment })),
    ...subscriptions.map(s => ({ ...s, type: 'subscription', dueDate: s.scheduledPayment?.dayOfMonth || null, amount: s.cost })),
    ...recurringBills.map(b => ({ ...b, type: 'bill', dueDate: b.dueDate, amount: b.amount })),
  ];

  if (loading) return <div className="loading">Loading bills...</div>;

  return (
    <div className="bills-manager">
      <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px', marginBottom: '20px' }}>
        <div>
          <h2><i className="fas fa-receipt"></i> Bills & Obligations</h2>
          <p>All your recurring payments – debts, subscriptions, and bills</p>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={fetchAll} className="action-button secondary" style={{ padding: '8px 20px', borderRadius: '30px', border: 'none', cursor: 'pointer', fontWeight: '500' }}>
            <i className="fas fa-sync-alt"></i> Refresh
          </button>
          <button onClick={payAllDueBills} disabled={processingPayment} className="action-button primary" style={{ padding: '8px 20px', borderRadius: '30px', border: 'none', background: '#e53e3e', color: 'white', cursor: 'pointer', fontWeight: '500' }}>
            <i className="fas fa-bolt"></i> {processingPayment ? 'Processing...' : 'Pay All Due'}
          </button>
        </div>
      </div>

      <div className="bills-list glass-effect">
        {allItems.length === 0 ? (
          <div className="empty-state">No bills, debts, or subscriptions added yet.</div>
        ) : (
          allItems.map((item) => {
            const key = `${item.type}_${item._id}`;
            const localData = formState[key] || { bankCode: item.bankCode || '', accountNumber: item.accountNumber || '', isVerifying: false };

            return (
              <div key={key} className="bill-item">
                <div className="bill-info">
                  <div className="bill-name">
                    <i className={`fas ${item.type === 'debt' ? 'fa-credit-card' : item.type === 'subscription' ? 'fa-calendar-alt' : 'fa-receipt'}`}></i>
                    {item.name}
                    <span className="bill-type">{item.type}</span>
                    {/* Delete button */}
                    <button
                      onClick={() => removeItem(item.type, item._id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#e53e3e',
                        cursor: 'pointer',
                        fontSize: '1rem',
                        marginLeft: 'auto',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        transition: 'background 0.2s'
                      }}
                      title="Delete this item"
                    >
                      <i className="fas fa-trash-alt"></i>
                    </button>
                  </div>
                  <div className="bill-details">
                    <span className="bill-amount">{formatCurrency(item.amount)}</span>
                    {item.frequency && <span className="bill-frequency">{item.frequency === 'monthly' ? '/month' : '/year'}</span>}
                    {item.dueDate && <span className="bill-due">Due on day {item.dueDate}</span>}
                    {item.balance !== undefined && <span className="debt-balance">Remaining: ₦{item.balance.toLocaleString()}</span>}
                  </div>

                  {/* Recipient/Payee */}
                  <div className="bill-field">
                    <label>Recipient/Payee:</label>
                    <span className="readonly-value">
                      {item.accountName || 'Not set (verify account first)'}
                      {item.accountName && <i className="fas fa-check-circle" style={{ color: '#48bb78', marginLeft: '8px' }}></i>}
                    </span>
                  </div>

                  {/* Bank Selection */}
                  <div className="bill-field">
                    <label>Bank:</label>
                    <select
                      value={localData.bankCode}
                      onChange={(e) => updateLocalField(item.type, item._id, 'bankCode', e.target.value)}
                      className="bank-select"
                      style={{
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '20px',
                        padding: '8px 16px',
                        color: 'var(--text-primary)'
                      }}
                    >
                      <option value="">Select bank</option>
                      {banks.map(bank => (
                        <option key={bank.code} value={bank.code} style={{ background: darkMode ? '#2d3748' : 'white', color: darkMode ? '#e2e8f0' : '#1a202c' }}>
                          {bank.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Account Number */}
                  <div className="bill-field">
                    <label>Account Number:</label>
                    <input
                      type="text"
                      value={localData.accountNumber}
                      onChange={(e) => updateLocalField(item.type, item._id, 'accountNumber', e.target.value)}
                      placeholder="10-digit account number"
                      maxLength="10"
                      style={{
                        background: 'var(--glass-bg)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '20px',
                        padding: '8px 16px',
                        color: 'var(--text-primary)',
                        width: '200px'
                      }}
                    />
                  </div>

                  {/* Verify & Save Button */}
                  <div className="bill-field" style={{ borderBottom: 'none', marginTop: '12px' }}>
                    <button
                      onClick={() => verifyAndSave(item.type, item._id, localData.bankCode, localData.accountNumber)}
                      disabled={localData.isVerifying}
                      className="verify-button"
                      style={{
                        padding: '8px 24px',
                        borderRadius: '30px',
                        border: 'none',
                        background: '#4299e1',
                        color: 'white',
                        cursor: 'pointer',
                        fontWeight: '500',
                        opacity: localData.isVerifying ? 0.7 : 1,
                      }}
                    >
                      {localData.isVerifying ? 'Verifying...' : 'Verify & Save'}
                    </button>
                    {item.accountName && (
                      <span style={{ marginLeft: '12px', fontSize: '0.85rem', color: '#48bb78' }}>
                        <i className="fas fa-check"></i> Verified
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <style jsx="true">{`
        .bills-manager { padding: 20px; max-width: 1100px; margin: 0 auto; }
        .action-button { transition: all 0.2s ease; }
        .action-button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.15); }
        .action-button.primary:hover { background: #c53030 !important; }
        .action-button.secondary { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); }
        .action-button.secondary:hover { background: var(--glass-border); }
        .bill-item {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 20px;
          margin-bottom: 15px;
          border: 1px solid var(--glass-border);
          transition: transform 0.2s;
        }
        .bill-item:hover { transform: translateY(-3px); box-shadow: var(--shadow-md); }
        .bill-name { font-size: 1.2rem; font-weight: 600; display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .bill-type { font-size: 0.7rem; background: var(--glass-bg); padding: 2px 8px; border-radius: 20px; color: var(--text-secondary); }
        .bill-details { margin: 10px 0; display: flex; flex-wrap: wrap; gap: 15px; color: var(--text-secondary); font-size: 0.9rem; }
        .bill-field {
          margin-top: 12px;
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          padding: 8px 0;
          border-bottom: 1px dashed var(--glass-border);
        }
        .bill-field label { font-weight: 600; min-width: 130px; color: var(--text-primary); }
        .readonly-value {
          background: var(--glass-bg);
          padding: 6px 16px;
          border-radius: 20px;
          color: var(--text-primary);
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        select.bank-select option {
          background-color: ${darkMode ? '#2d3748' : '#ffffff'};
          color: ${darkMode ? '#e2e8f0' : '#1a202c'};
        }
        select.bank-select {
          cursor: pointer;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%234a5568' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          appearance: none;
          padding-right: 32px;
        }
        .empty-state { text-align: center; padding: 60px 20px; color: var(--text-secondary); background: var(--glass-bg); border-radius: var(--radius-lg); }
        @media (max-width: 768px) {
          .bill-field { flex-direction: column; align-items: flex-start; }
          .bill-field label { min-width: auto; }
          .section-header > div { flex-direction: column; width: 100%; }
        }
      `}</style>
    </div>
  );
};

export default BillsManager;