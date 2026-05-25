import React, { useState, useEffect } from 'react';
import axios from 'axios';
//import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
const DebtManager = () => {
  //const { darkMode } = useAuth();
  const [debts, setDebts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newDebt, setNewDebt] = useState({
    name: '',
    balance: '',
    interest: '',
    minPayment: '',
    scheduledPayment: { enabled: false, amount: '', dayOfMonth: 1 }
  });

  // Fetch debts from backend
  const fetchDebts = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/debts`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setDebts(res.data);
    } catch (err) {
      console.error('Failed to fetch debts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDebts();
  }, []);

  // Add new debt
  const addDebt = async () => {
  if (!newDebt.name || !newDebt.balance || !newDebt.minPayment) {
    alert('Please fill in all required fields');
    return;
  }
  const balanceNum = parseFloat(newDebt.balance);
  const minPayNum = parseFloat(newDebt.minPayment);
  const interestNum = parseFloat(newDebt.interest) || 0;

  if (isNaN(balanceNum) || isNaN(minPayNum)) {
    alert('Balance and minimum payment must be valid numbers');
    return;
  }

  try {
    const token = localStorage.getItem('token');
    const payload = {
      name: newDebt.name,
      balance: balanceNum,
      interest: interestNum,
      minPayment: minPayNum,
      scheduledPayment: {
        enabled: newDebt.scheduledPayment.enabled,
        amount: parseFloat(newDebt.scheduledPayment.amount) || 0,
        dayOfMonth: parseInt(newDebt.scheduledPayment.dayOfMonth, 10) || 1,
      }
    };
    await axios.post(`${API_URL}/api/debts`, payload, {
      headers: { Authorization: `Bearer ${token}` }
    });
    fetchDebts();
    setNewDebt({ name: '', balance: '', interest: '', minPayment: '', scheduledPayment: { enabled: false, amount: '', dayOfMonth: 1 } });
    setIsAdding(false);
  } catch (err) {
    console.error('Failed to add debt:', err);
    alert(err.response?.data?.message || 'Error adding debt. Please check your input.');
  }
};
  // Delete debt
  const removeDebt = async (id) => {
    if (!window.confirm('Delete this debt?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/debts/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDebts();
    } catch (err) {
      console.error('Failed to delete debt:', err);
    }
  };

  // Update scheduled payment for a debt
  const updateScheduledPayment = async (id, scheduledPayment) => {
    try {
      const token = localStorage.getItem('token');
      await axios.put(`${API_URL}/api/debts/${id}`, { scheduledPayment }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchDebts();
    } catch (err) {
      console.error('Failed to update scheduled payment:', err);
    }
  };

  // Calculations for overview cards
  const totalDebt = debts.reduce((sum, d) => sum + d.balance, 0);
  const totalMonthlyPayment = debts.reduce((sum, d) => sum + d.minPayment, 0);
  const highestInterestDebt = debts.reduce((h, d) => (d.interest > h.interest ? d : h), { interest: 0, name: 'No debts' });

  if (loading) {
    return <div className="loading">Loading debts...</div>;
  }

  return (
    <div className="debt-page">
      <div className="section-header">
        <h2>Debt Management</h2>
        <p className="section-subtitle">Track and manage your debts effectively</p>
      </div>

      {/* Debt Overview Cards */}
      <div className="debt-overview">
        <div className="overview-card glass-card">
          <div className="overview-icon"><i className="fas fa-money-bill-wave"></i></div>
          <div className="overview-content">
            <h3>Total Debt</h3>
            <div className="amount highlight-danger">₦{totalDebt.toLocaleString()}</div>
          </div>
        </div>
        <div className="overview-card glass-card">
          <div className="overview-icon"><i className="fas fa-calendar-alt"></i></div>
          <div className="overview-content">
            <h3>Monthly Payments</h3>
            <div className="amount">₦{totalMonthlyPayment.toLocaleString()}</div>
            <div className="subtext">/ month</div>
          </div>
        </div>
        <div className="overview-card glass-card">
          <div className="overview-icon"><i className="fas fa-chart-line"></i></div>
          <div className="overview-content">
            <h3>Highest Interest</h3>
            <div className="amount highlight-warning">{highestInterestDebt.interest}%</div>
            <div className="subtext">{highestInterestDebt.name}</div>
          </div>
        </div>
      </div>

      {/* Strategy Card (only show if there are debts) */}
      {debts.length > 0 && (
        <div className="strategy-card glass-card">
          <div className="strategy-header"><i className="fas fa-lightbulb"></i><h3>Recommended Payoff Strategy</h3></div>
          <div className="strategy-content">
            <h4 className="strategy-title">Avalanche Method</h4>
            <p className="strategy-description">
              Focus on paying off your highest interest debt first ({highestInterestDebt.name} at {highestInterestDebt.interest}%) while making minimum payments on others.
            </p>
            <div className="strategy-steps">
              <div className="step"><span className="step-number">1</span><span>Pay minimum on all debts</span></div>
              <div className="step"><span className="step-number">2</span><span>Extra payments to highest interest</span></div>
              <div className="step"><span className="step-number">3</span><span>Repeat until debt-free</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Debts List */}
      <div className="debts-section glass-card">
        <div className="section-title">
          <h3>Your Debts</h3>
          {debts.length > 0 && <span className="count-badge">{debts.length}</span>}
          <button className={`add-toggle-btn ${isAdding ? 'active' : ''}`} onClick={() => setIsAdding(!isAdding)}>
            <i className={`fas fa-${isAdding ? 'times' : 'plus'}`}></i>
            <span>{isAdding ? 'Cancel' : 'Add Debt'}</span>
          </button>
        </div>

        {debts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon"><i className="fas fa-credit-card"></i></div>
            <h4>No Debts Found</h4>
            <p>Add your first debt to start tracking and get personalized payoff strategies.</p>
            <button className="cta-btn" onClick={() => setIsAdding(true)}><i className="fas fa-plus"></i> Add Your First Debt</button>
          </div>
        ) : (
          <div className="debts-list">
            {debts.sort((a, b) => b.interest - a.interest).map((debt) => (
              <div key={debt._id} className="debt-item glass-card">
                <div className="debt-header">
                  <div className="debt-name"><i className="fas fa-credit-card"></i><span>{debt.name}</span></div>
                  <div className="debt-actions">
                    <span className="interest-badge">{debt.interest}%</span>
                    <button className="remove-btn" onClick={() => removeDebt(debt._id)}><i className="fas fa-trash"></i></button>
                  </div>
                </div>
                <div className="debt-details">
                  <div className="detail"><span className="label">Balance</span><span className="value">₦{debt.balance.toLocaleString()}</span></div>
                  <div className="detail"><span className="label">Min Payment</span><span className="value">₦{debt.minPayment.toLocaleString()}/mo</span></div>
                  <div className="detail"><span className="label">Priority</span>
                    <span className={`priority ${debt.interest > 15 ? 'high' : debt.interest > 8 ? 'medium' : 'low'}`}>
                      {debt.interest > 15 ? 'High' : debt.interest > 8 ? 'Medium' : 'Low'}
                    </span>
                  </div>
                </div>

                {/* Scheduled Payment Toggle */}
                <div className="scheduled-payment-toggle">
                  <label className="schedule-checkbox">
                    <input
                      type="checkbox"
                      checked={debt.scheduledPayment?.enabled || false}
                      onChange={(e) => updateScheduledPayment(debt._id, {
                        ...debt.scheduledPayment,
                        enabled: e.target.checked,
                        amount: debt.scheduledPayment?.amount || 0,
                        dayOfMonth: debt.scheduledPayment?.dayOfMonth || 1
                      })}
                    />
                    <span>Auto‑pay from wallet</span>
                  </label>
                  {debt.scheduledPayment?.enabled && (
                    <div className="schedule-details">
                      <div className="schedule-field">
                        <label>Amount per payment (₦)</label>
                        <input
                          type="number"
                          min="0"
                          step="100"
                          value={debt.scheduledPayment?.amount || 0}
                          onChange={(e) => updateScheduledPayment(debt._id, {
                            ...debt.scheduledPayment,
                            amount: parseFloat(e.target.value),
                            dayOfMonth: debt.scheduledPayment?.dayOfMonth || 1
                          })}
                        />
                      </div>
                      <div className="schedule-field">
                        <label>Day of month</label>
                        <input
                          type="number"
                          min="1"
                          max="31"
                          value={debt.scheduledPayment?.dayOfMonth || 1}
                          onChange={(e) => updateScheduledPayment(debt._id, {
                            ...debt.scheduledPayment,
                            amount: debt.scheduledPayment?.amount || 0,
                            dayOfMonth: parseInt(e.target.value)
                          })}
                        />
                      </div>
                      <small>Auto‑deducted from wallet monthly</small>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Debt Form */}
      {isAdding && (
        <div className="add-debt-form glass-card slide-in">
          <div className="form-header">
            <h3><i className="fas fa-plus-circle"></i> Add New Debt</h3>
            <p className="form-subtitle">Enter the details of your debt</p>
          </div>
          <div className="form-grid">
            <div className="input-group">
              <label><i className="fas fa-tag"></i> Debt Name</label>
              <input type="text" value={newDebt.name} onChange={(e) => setNewDebt({...newDebt, name: e.target.value})} className="glass-input" placeholder="e.g., Credit Card, Car Loan, Mortgage" />
            </div>
            <div className="input-group">
              <label><i className="fas fa-wallet"></i> Current Balance</label>
              <div className="input-with-symbol"><span className="symbol">₦</span><input type="number" value={newDebt.balance} onChange={(e) => setNewDebt({...newDebt, balance: e.target.value})} className="glass-input" min="0" step="1000" placeholder="0.00" /></div>
            </div>
            <div className="input-group">
              <label><i className="fas fa-chart-line"></i> Interest Rate</label>
              <div className="input-with-symbol"><input type="number" value={newDebt.interest} onChange={(e) => setNewDebt({...newDebt, interest: e.target.value})} className="glass-input" min="0" max="100" step="0.1" placeholder="0.0" /><span className="symbol">%</span></div>
            </div>
            <div className="input-group">
              <label><i className="fas fa-calendar-check"></i> Minimum Payment</label>
              <div className="input-with-symbol"><span className="symbol">₦</span><input type="number" value={newDebt.minPayment} onChange={(e) => setNewDebt({...newDebt, minPayment: e.target.value})} className="glass-input" min="0" step="100" placeholder="0.00" /><span className="symbol suffix">/month</span></div>
            </div>
          </div>
          {/* Scheduled payment options in add form */}
          <div className="scheduled-payment-option">
            <label className="schedule-checkbox">
              <input type="checkbox" checked={newDebt.scheduledPayment.enabled} onChange={(e) => setNewDebt({...newDebt, scheduledPayment: { ...newDebt.scheduledPayment, enabled: e.target.checked }})} />
              <span>Schedule auto‑pay from wallet</span>
            </label>
            {newDebt.scheduledPayment.enabled && (
              <div className="schedule-details">
                <div className="schedule-field"><label>Amount per payment (₦)</label><input type="number" value={newDebt.scheduledPayment.amount} onChange={(e) => setNewDebt({...newDebt, scheduledPayment: { ...newDebt.scheduledPayment, amount: e.target.value }})} placeholder="0.00" /></div>
                <div className="schedule-field"><label>Day of month</label><input type="number" min="1" max="31" value={newDebt.scheduledPayment.dayOfMonth} onChange={(e) => setNewDebt({...newDebt, scheduledPayment: { ...newDebt.scheduledPayment, dayOfMonth: parseInt(e.target.value) }})} /></div>
              </div>
            )}
          </div>
          <div className="form-actions">
            <button className="cancel-btn" onClick={() => setIsAdding(false)}>Cancel</button>
            <button className="submit-btn" onClick={addDebt} disabled={!newDebt.name || !newDebt.balance || !newDebt.minPayment}><i className="fas fa-check"></i> Add Debt</button>
          </div>
        </div>
      )}

      <style jsx="true">{`
        /* Debt Page Styles */
        .debt-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
          animation: fadeIn 0.5s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slideIn {
          from { opacity: 0; transform: translateY(-20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .slide-in {
          animation: slideIn 0.3s ease;
        }

        /* Section Header */
        .section-header {
          text-align: center;
          margin-bottom: 40px;
          padding: 30px;
          background: var(--card-bg);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }

        .section-header h2 {
          font-family: var(--font-heading);
          font-size: 2.5rem;
          font-weight: 700;
          margin-bottom: 10px;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .section-subtitle {
          color: var(--text-secondary);
          font-size: 1.1rem;
          max-width: 600px;
          margin: 0 auto;
          line-height: 1.6;
        }

        /* Glass Card Base */
        .glass-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 25px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }

        .glass-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }

        /* Overview Cards */
        .debt-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }

        .overview-card {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 25px;
        }

        .overview-icon {
          width: 60px;
          height: 60px;
          border-radius: var(--radius-md);
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 1.5rem;
        }

        .overview-content h3 {
          font-size: 1rem;
          color: var(--text-secondary);
          margin-bottom: 8px;
          font-weight: 500;
        }

        .amount {
          font-family: var(--font-accent);
          font-size: 1.8rem;
          font-weight: 700;
          margin-bottom: 5px;
        }

        .highlight-danger {
          color: #ff4757;
        }

        .highlight-warning {
          color: #ffa502;
        }

        .subtext {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        /* Strategy Card */
        .strategy-card {
          margin-bottom: 30px;
          border-left: 5px solid #667eea;
        }

        .strategy-header {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 20px;
        }

        .strategy-header i {
          color: #667eea;
          font-size: 1.5rem;
        }

        .strategy-header h3 {
          font-family: var(--font-heading);
          font-size: 1.5rem;
          color: var(--text-primary);
        }

        .strategy-title {
          font-size: 1.3rem;
          font-weight: 600;
          margin-bottom: 10px;
          color: var(--text-primary);
        }

        .strategy-description {
          color: var(--text-secondary);
          line-height: 1.6;
          margin-bottom: 20px;
        }

        .strategy-steps {
          display: flex;
          gap: 20px;
          flex-wrap: wrap;
        }

        .step {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          flex: 1;
          min-width: 200px;
        }

        .step-number {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: var(--gradient-primary);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
        }

        /* Debts Section */
        .debts-section {
          margin-bottom: 30px;
        }

        .section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 25px;
          padding-bottom: 15px;
          border-bottom: 2px solid var(--glass-border);
        }

        .section-title h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .count-badge {
          background: var(--gradient-primary);
          color: white;
          padding: 5px 12px;
          border-radius: var(--radius-full);
          font-size: 0.9rem;
          font-weight: 600;
          margin-left: 10px;
        }

        /* Add Toggle Button */
        .add-toggle-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 24px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-full);
          color: var(--text-primary);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .add-toggle-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
          border-color: #667eea;
        }

        .add-toggle-btn.active {
          background: var(--gradient-primary);
          color: white;
          border-color: transparent;
        }

        /* Empty State */
        .empty-state {
          text-align: center;
          padding: 60px 40px;
          background: var(--glass-bg);
          border-radius: var(--radius-lg);
        }

        .empty-icon {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 2rem;
          margin: 0 auto 20px;
        }

        .empty-state h4 {
          font-size: 1.5rem;
          margin-bottom: 10px;
          color: var(--text-primary);
        }

        .empty-state p {
          color: var(--text-secondary);
          max-width: 400px;
          margin: 0 auto 30px;
          line-height: 1.6;
        }

        .cta-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 15px 30px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-full);
          font-weight: 600;
          font-size: 1rem;
          cursor: pointer;
          transition: all var(--transition-base);
          margin: 0 auto;
        }

        .cta-btn:hover {
          transform: translateY(-3px);
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }

        /* Debts List */
        .debts-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
          max-height: 400px;
          overflow-y: auto;
          padding-right: 10px;
        }

        .debt-item {
          padding: 20px;
        }

        .debt-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }

        .debt-name {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 1.2rem;
          font-weight: 600;
          color: var(--text-primary);
        }

        .debt-name i {
          color: #667eea;
        }

        .debt-actions {
          display: flex;
          align-items: center;
          gap: 15px;
        }

        .interest-badge {
          background: linear-gradient(135deg, #ff6b6b, #ffa502);
          color: white;
          padding: 5px 15px;
          border-radius: var(--radius-full);
          font-weight: 600;
          font-size: 0.9rem;
        }

        .remove-btn {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: rgba(255, 71, 87, 0.1);
          border: 2px solid rgba(255, 71, 87, 0.3);
          color: #ff4757;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .remove-btn:hover {
          background: #ff4757;
          color: white;
          transform: scale(1.1);
        }

        .debt-details {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
        }

        .detail {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .detail .label {
          font-size: 0.9rem;
          color: var(--text-secondary);
        }

        .detail .value {
          font-family: var(--font-accent);
          font-weight: 600;
          font-size: 1.1rem;
          color: var(--text-primary);
        }

        .priority {
          padding: 5px 12px;
          border-radius: var(--radius-full);
          font-size: 0.9rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          width: fit-content;
        }

        .priority.high {
          background: rgba(255, 71, 87, 0.1);
          color: #ff4757;
          border: 1px solid rgba(255, 71, 87, 0.3);
        }

        .priority.medium {
          background: rgba(255, 165, 2, 0.1);
          color: #ffa502;
          border: 1px solid rgba(255, 165, 2, 0.3);
        }

        .priority.low {
          background: rgba(39, 174, 96, 0.1);
          color: #27ae60;
          border: 1px solid rgba(39, 174, 96, 0.3);
        }

        /* Add Debt Form */
        .add-debt-form {
          position: relative;
          margin-top: 30px;
          border: 2px solid var(--glass-border);
          background: var(--card-bg);
        }

        .form-header {
          margin-bottom: 25px;
        }

        .form-header h3 {
          display: flex;
          align-items: center;
          gap: 10px;
          font-family: var(--font-heading);
          font-size: 1.8rem;
          color: var(--text-primary);
          margin-bottom: 5px;
        }

        .form-header h3 i {
          color: #667eea;
        }

        .form-subtitle {
          color: var(--text-secondary);
          font-size: 1rem;
        }

        /* Form Grid */
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 25px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .input-group label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .input-group label i {
          color: #667eea;
        }

        /* Glass Input */
        .glass-input {
          padding: 14px 16px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 1rem;
          font-family: var(--font-body);
          transition: all var(--transition-base);
          width: 100%;
        }

        .glass-input:focus {
          outline: none;
          border-color: #667eea;
          box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        .glass-input::placeholder {
          color: var(--text-tertiary);
        }

        /* Input with Symbol */
        .input-with-symbol {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-with-symbol .symbol {
          position: absolute;
          left: 16px;
          color: var(--text-secondary);
          font-weight: 600;
          pointer-events: none;
        }

        .input-with-symbol .suffix {
          left: auto;
          right: 16px;
        }

        .input-with-symbol input {
          padding-left: 40px;
          padding-right: 40px;
        }

        /* Form Actions */
        .form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 15px;
          padding-top: 20px;
          border-top: 2px solid var(--glass-border);
        }

        .cancel-btn {
          padding: 12px 24px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .cancel-btn:hover {
          background: rgba(255, 71, 87, 0.1);
          border-color: #ff4757;
          color: #ff4757;
        }

        .submit-btn {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 30px;
          background: var(--gradient-primary);
          border: none;
          border-radius: var(--radius-md);
          color: white;
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
        }

        .submit-btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px rgba(102, 126, 234, 0.3);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Scrollbar */
        .debts-list::-webkit-scrollbar {
          width: 6px;
        }

        .debts-list::-webkit-scrollbar-track {
          background: var(--glass-bg);
          border-radius: var(--radius-full);
        }

        .debts-list::-webkit-scrollbar-thumb {
          background: var(--gradient-primary);
          border-radius: var(--radius-full);
        }

        /* Responsive Design */
        @media (max-width: 768px) {
          .debt-page {
            padding: 15px;
          }

          .section-header {
            padding: 20px 15px;
          }

          .section-header h2 {
            font-size: 2rem;
          }

          .debt-overview {
            grid-template-columns: 1fr;
          }

          .form-grid {
            grid-template-columns: 1fr;
          }

          .strategy-steps {
            flex-direction: column;
          }

          .step {
            min-width: 100%;
          }

          .section-title {
            flex-direction: column;
            align-items: flex-start;
            gap: 15px;
          }

          .add-toggle-btn {
            width: 100%;
            justify-content: center;
          }

          .debt-details {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 480px) {
          .section-header h2 {
            font-size: 1.8rem;
          }

          .amount {
            font-size: 1.5rem;
          }

          .form-actions {
            flex-direction: column;
          }

          .form-actions button {
            width: 100%;
          }
        }
          .scheduled-payment-toggle, .scheduled-payment-option {
          margin-top: 15px;
          padding-top: 10px;
          border-top: 1px solid var(--glass-border);
        }
        .schedule-checkbox {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .schedule-details {
          display: flex;
          gap: 15px;
          flex-wrap: wrap;
        }
        .schedule-field {
          flex: 1;
          min-width: 120px;
        }
        .schedule-field label {
          display: block;
          font-size: 0.8rem;
          margin-bottom: 4px;
          color: var(--text-secondary);
        }
        .schedule-field input {
          width: 100%;
          padding: 8px;
          background: var(--glass-bg);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          color: var(--text-primary);
        }
        small {
          font-size: 0.7rem;
          color: var(--text-secondary);
          display: block;
          margin-top: 5px;
        }

      `}</style>
    </div>
  );
};

export default DebtManager;