import React, { useState, useEffect } from 'react';
import axios from 'axios';
//import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import { FeatureTip } from './FeatureTip';
const AutoSavings = () => {
  //const { darkMode } = useAuth();
  const [rule, setRule] = useState(null);
  const [type, setType] = useState('fixed'); // 'fixed' or 'roundup'
  const [value, setValue] = useState(1000); // fixed naira amount or roundup step
  const [selectedGoalId, setSelectedGoalId] = useState('');
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInfo, setShowInfo] = useState(false); // for round‑up explanation popup

  useEffect(() => {
    fetchRule();
    fetchGoals();
  }, []);

  const fetchRule = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/savings/rules`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data) {
        setRule(res.data);
        setType(res.data.type);
        setValue(res.data.value);
        setSelectedGoalId(res.data.targetGoalId || '');
      }
    } catch (err) { console.error(err); }
  };

  const fetchGoals = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/goals`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setGoals(res.data);
    } catch (err) { console.error(err); }
  };

  const saveRule = async () => {
    if (type === 'fixed' && value <= 0) {
      setMessage({ text: 'Amount must be greater than 0', type: 'error' });
      return;
    }
    if (type === 'roundup' && value <= 0) {
      setMessage({ text: 'Round‑up step must be greater than 0', type: 'error' });
      return;
    }
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post(`${API_URL}/api/savings/rules`, {
        type,
        value: Number(value),
        active: true,
        targetGoalId: selectedGoalId || null
      }, { headers: { Authorization: `Bearer ${token}` } });
      setMessage({ text: 'Auto‑savings rule saved!', type: 'success' });
      fetchRule();
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save', type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const deleteRule = async () => {
    if (!window.confirm('Disable auto‑savings? You can re‑enable later.')) return;
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/savings/rules`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ text: 'Auto‑savings disabled', type: 'success' });
      setRule(null);
      setType('fixed');
      setValue(1000);
      setSelectedGoalId('');
    } catch (err) {
      setMessage({ text: 'Failed to disable', type: 'error' });
    } finally {
      setLoading(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="auto-savings-page">
      <div className="page-header">
        <h1><i className="fas fa-robot"></i> Auto‑Savings</h1>
        <p>Automatically save money from every income or expense</p>
      </div>

      <FeatureTip tipKey="page:auto-savings" title="Save without thinking">
        Choose a fixed amount to move to savings from each income, or a round‑up rule on
        expenses. Optionally link it to a savings goal and FinPilot does the rest.
      </FeatureTip>

      <div className="savings-card glass-effect">
        <div className="card-header">
          <i className="fas fa-chart-line"></i>
          <h2>Configure your savings rule</h2>
        </div>

        {rule ? (
          <div className="current-rule">
            <div className="rule-badge active">
              <i className="fas fa-check-circle"></i> Active
            </div>
            <div className="rule-detail">
              {rule.type === 'roundup' ? (
                <>Round‑up expenses to the nearest <strong>₦{rule.value}</strong> and save the difference</>
              ) : rule.type === 'percentage' ? (
                <>Save <strong>{rule.value}%</strong> of every income</>
              ) : (
                <>Save <strong>₦{Number(rule.value).toLocaleString()}</strong> from every income</>
              )}
              {rule.targetGoalId && (
                <div className="rule-goal">
                  <i className="fas fa-flag-checkered"></i> Linked to goal #{goals.find(g => g._id === rule.targetGoalId)?.name || 'unknown'}
                </div>
              )}
            </div>
            <button className="btn-danger" onClick={deleteRule} disabled={loading}>
              <i className="fas fa-trash"></i> Disable
            </button>
          </div>
        ) : (
          <div className="rule-form">
            {/* Rule type selector */}
            <div className="form-group">
              <label>Savings method</label>
              <div className="type-buttons">
                <button
                  type="button"
                  className={type === 'fixed' ? 'active' : ''}
                  onClick={() => setType('fixed')}
                >
                  <i className="fas fa-coins"></i> Fixed amount
                </button>
                <button
                  type="button"
                  className={type === 'roundup' ? 'active' : ''}
                  onClick={() => {
                    setType('roundup');
                    setShowInfo(true);
                  }}
                >
                  <i className="fas fa-arrow-up"></i> Round‑up savings
                </button>
              </div>
            </div>

            {type === 'fixed' && (
              <div className="form-group">
                <label>Amount to save from each income (₦)</label>
                <div className="input-with-icon">
                  <i className="fas fa-naira-sign input-icon"></i>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                  />
                </div>
                <small>Example: save ₦1,000 every time income is added to your wallet</small>
              </div>
            )}

            {type === 'roundup' && (
              <div className="form-group">
                <label>Round‑up to nearest (₦)</label>
                <div className="input-with-icon">
                  <i className="fas fa-coins input-icon"></i>
                  <input
                    type="number"
                    min="100"
                    step="100"
                    value={value}
                    onChange={(e) => setValue(Number(e.target.value))}
                  />
                </div>
                <small>Example: expense ₦2,300 → round to ₦2,400, save ₦100</small>
                <button className="info-btn" onClick={() => setShowInfo(true)}>
                  <i className="fas fa-question-circle"></i> How round‑up works
                </button>
              </div>
            )}

            {/* Goal selector */}
            <div className="form-group">
              <label>Link to savings goal (optional)</label>
              <div className="input-with-icon">
                <i className="fas fa-flag-checkered input-icon"></i>
                <select value={selectedGoalId} onChange={(e) => setSelectedGoalId(e.target.value)}>
                  <option value="">None – save to general savings wallet</option>
                  {goals.map(goal => (
                    <option key={goal._id} value={goal._id}>
                      {goal.name} – ₦{goal.current.toLocaleString()} / ₦{goal.target.toLocaleString()}
                    </option>
                  ))}
                </select>
              </div>
              <small>If selected, auto‑saved money will be added to this goal.</small>
            </div>

            {message && <div className={`message ${message.type}`}>{message.text}</div>}

            <button className="btn-primary" onClick={saveRule} disabled={loading}>
              {loading ? 'Saving...' : 'Enable Auto‑Savings'}
            </button>
          </div>
        )}
      </div>

      {/* Info popup for round‑up */}
      {showInfo && (
        <div className="modal-overlay" onClick={() => setShowInfo(false)}>
          <div className="modal-content glass-effect" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3><i className="fas fa-lightbulb"></i> How Round‑Up Savings Work</h3>
              <button className="modal-close" onClick={() => setShowInfo(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Every time you add an <strong>expense</strong>, we automatically round the amount up to the nearest multiple you choose (e.g., ₦100). The difference is moved from your main wallet to your savings.</p>
              <p><strong>Example:</strong> You spend ₦2,350 on groceries. With round‑up set to ₦100, we round up to ₦2,400 and save ₦50.</p>
              <p>These savings are then added to your savings balance (or to the linked goal).</p>
              <div className="modal-tip">
                <i className="fas fa-check-circle"></i> It's a painless way to save small amounts automatically!
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowInfo(false)}>Got it</button>
            </div>
          </div>
        </div>
      )}

      <div className="info-card glass-effect">
        <h3><i className="fas fa-lightbulb"></i> How it works</h3>
        <ul>
          <li><strong>Fixed amount rule</strong>: When you add income, the chosen amount is moved to savings.</li>
          <li><strong>Round‑up rule</strong>: When you add an expense, we round up to the nearest step and save the difference.</li>
          <li>Money is taken from your <strong>main wallet</strong> and added to your <strong>savings balance</strong> (or linked goal).</li>
          <li>You can only have one active rule at a time (fixed amount OR round‑up).</li>
        </ul>
      </div>

      <style jsx="true">{`
        .auto-savings-page { max-width: 700px; margin: 0 auto; padding: 20px; }
        .page-header { text-align: center; margin-bottom: 30px; }
        .savings-card, .info-card { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 18px; margin-bottom: 30px; border: 1px solid var(--glass-border); }
        .type-buttons { display: flex; gap: 15px; margin-top: 10px; }
        .type-buttons button { flex: 1; padding: 12px; border: 1px solid var(--border-color); background: var(--glass-bg); border-radius: var(--radius-md); cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .type-buttons button.active { background: var(--gradient-primary); color: white; border-color: transparent; }
        .input-with-icon { position: relative; }
        .input-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: var(--text-secondary); }
        input, select { width: 100%; padding: 12px 12px 12px 40px; background: var(--glass-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); }
        .info-btn { background: none; border: none; color: var(--accent-primary); cursor: pointer; margin-top: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 0.85rem; }
        .btn-primary, .btn-danger { padding: 12px 24px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: var(--gradient-primary); color: white; width: 100%; }
        .btn-danger { background: rgba(229,62,62,0.1); color: #e53e3e; margin-top: 15px; }
        .message { padding: 10px; border-radius: var(--radius-md); margin-top: 15px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        .current-rule { text-align: center; padding: 20px; background: var(--glass-bg); border-radius: var(--radius-md); }
        .rule-detail { font-size: 1.2rem; margin: 15px 0; }
        .rule-goal { margin-top: 10px; font-size: 0.9rem; color: var(--text-secondary); }
        .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 2000; }
        .modal-content { max-width: 450px; width: 90%; background: var(--card-bg); border-radius: var(--radius-lg); padding: 16px; border: 1px solid var(--glass-border); }
        .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; color: var(--text-secondary); }
        .modal-body { margin-bottom: 20px; line-height: 1.5; }
        .modal-tip { background: rgba(56,161,105,0.1); padding: 10px; border-radius: var(--radius-md); margin-top: 15px; display: flex; align-items: center; gap: 8px; }
        .modal-footer button { padding: 8px 20px; background: var(--gradient-primary); border: none; border-radius: var(--radius-md); color: white; cursor: pointer; }
      `}</style>
    </div>
  );
};

export default AutoSavings;