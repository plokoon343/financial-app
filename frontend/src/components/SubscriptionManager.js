import React, { useState, useEffect } from 'react';
import axios from 'axios';
//import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
const SubscriptionManager = () => {
  //const { darkMode } = useAuth();
  const [subscriptions, setSubscriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newSubscription, setNewSubscription] = useState({
    name: '',
    cost: '',
    frequency: 'monthly',
    category: 'Entertainment',
  });
  // Auto-detected candidates from bank statements
  const [detected, setDetected] = useState([]);
  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState('');

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

  const detectSubscriptions = async () => {
    setDetecting(true); setDetectMsg('');
    try {
      const res = await axios.get(`${API_URL}/api/subscriptions/detect`, authHeaders());
      setDetected(res.data || []);
      setDetectMsg(res.data.length ? '' : 'No recurring charges found in your transactions yet.');
    } catch (err) {
      setDetectMsg('Could not scan transactions. Try again.');
    } finally {
      setDetecting(false);
    }
  };

  const addDetected = async (cand) => {
    try {
      await axios.post(`${API_URL}/api/subscriptions`, {
        name: cand.name, cost: cand.cost, frequency: cand.frequency, category: cand.category,
      }, authHeaders());
      setDetected((prev) => prev.filter((c) => c.name !== cand.name));
      fetchSubscriptions();
    } catch (err) {
      setDetectMsg('Could not add that subscription.');
    }
  };

  // Fetch subscriptions from backend
  const fetchSubscriptions = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/subscriptions`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSubscriptions(res.data);
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSubscriptions();
  }, []);

  // Add new subscription
  const addSubscription = async () => {
    if (!newSubscription.name || !newSubscription.cost) return;
    try {
      const token = localStorage.getItem('token');
      const payload = {
        name: newSubscription.name,
        cost: parseFloat(newSubscription.cost),
        frequency: newSubscription.frequency,
        category: newSubscription.category,
      };
      await axios.post(`${API_URL}/api/subscriptions`, payload, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSubscriptions();
      setNewSubscription({
        name: '',
        cost: '',
        frequency: 'monthly',
        category: 'Entertainment',
      });
    } catch (err) {
      console.error('Failed to add subscription:', err);
      alert('Error adding subscription. Please try again.');
    }
  };

  // Toggle subscription status (active/cancelled)
  const toggleSubscription = async (id, currentStatus) => {
    const newStatus = currentStatus === 'active' ? 'cancelled' : 'active';
    try {
      const token = localStorage.getItem('token');
      await axios.put(`${API_URL}/api/subscriptions/${id}`, { status: newStatus }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSubscriptions();
    } catch (err) {
      console.error('Failed to toggle subscription:', err);
    }
  };

  // Delete subscription
  const removeSubscription = async (id) => {
    if (!window.confirm('Remove this subscription?')) return;
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/subscriptions/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchSubscriptions();
    } catch (err) {
      console.error('Failed to delete subscription:', err);
    }
  };

  // Calculations for overview cards
  const activeSubscriptions = subscriptions.filter(sub => sub.status === 'active');
  const monthlyCost = activeSubscriptions.reduce((total, sub) => {
    return total + (sub.frequency === 'yearly' ? sub.cost / 12 : sub.cost);
  }, 0);
  const yearlyCost = activeSubscriptions.reduce((total, sub) => {
    return total + (sub.frequency === 'monthly' ? sub.cost * 12 : sub.cost);
  }, 0);

  const getCategoryColor = (category) => {
    const colors = {
      Entertainment: '#FF6B8B',
      Health: '#4ECDC4',
      Work: '#45B7D1',
      Shopping: '#FFA07A',
      Utilities: '#98D8C8',
      Other: '#C9C9C9'
    };
    return colors[category] || colors.Other;
  };

  const getSubscriptionsByCategory = () => {
    return activeSubscriptions.reduce((acc, sub) => {
      acc[sub.category] = (acc[sub.category] || 0) + 
        (sub.frequency === 'monthly' ? sub.cost : sub.cost / 12);
      return acc;
    }, {});
  };
  const categoryBreakdown = getSubscriptionsByCategory();

  if (loading) {
    return <div className="loading">Loading subscriptions...</div>;
  }

  return (
    <div className="subscriptions-page">
      <div className="section-header">
        <h2><i className="fas fa-calendar-alt"></i> Subscription Manager</h2>
        <p className="section-subtitle">Track and manage your recurring payments</p>
      </div>

      {/* Overview Cards */}
      <div className="overview-grid">
        <div className="overview-card glass-effect">
          <div className="overview-icon monthly-cost"><i className="fas fa-calendar-day"></i></div>
          <div className="overview-content"><h3>Monthly Cost</h3><div className="overview-amount">{fmtNaira(monthlyCost)}</div></div>
        </div>
        <div className="overview-card glass-effect">
          <div className="overview-icon yearly-cost"><i className="fas fa-calendar-year"></i></div>
          <div className="overview-content"><h3>Yearly Cost</h3><div className="overview-amount">{fmtNaira(yearlyCost)}</div></div>
        </div>
        <div className="overview-card glass-effect">
          <div className="overview-icon active-subs"><i className="fas fa-bell"></i></div>
          <div className="overview-content"><h3>Active Subscriptions</h3><div className="overview-amount">{activeSubscriptions.length}</div></div>
        </div>
      </div>

      {/* Category Breakdown */}
      {activeSubscriptions.length > 0 && (
        <div className="category-breakdown glass-effect">
          <div className="breakdown-header"><h3><i className="fas fa-chart-pie"></i> Monthly Cost by Category</h3><p>See where your subscription money goes</p></div>
          <div className="breakdown-list">
            {Object.entries(categoryBreakdown).map(([category, amount]) => (
              <div key={category} className="breakdown-item" style={{ '--category-color': getCategoryColor(category) }}>
                <div className="category-label">
                  <div className="color-dot" style={{ backgroundColor: getCategoryColor(category) }}></div>
                  <span className="category-name">{category}</span>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${((amount / monthlyCost) * 100)}%`, backgroundColor: getCategoryColor(category) }}></div>
                  </div>
                </div>
                <div className="category-info">
                  <div className="category-amount">{fmtNaira(amount)}</div>
                  <div className="category-percentage">{((amount / monthlyCost) * 100).toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subscriptions List */}
      <div className="subscriptions-list-container glass-effect">
        <div className="list-header">
          <h3><i className="fas fa-list"></i> Your Subscriptions</h3>
          <span className="subscription-count">{subscriptions.length} subscription{subscriptions.length !== 1 ? 's' : ''}</span>
        </div>
        {subscriptions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><i className="fas fa-calendar-times"></i></div>
            <h4>No Subscriptions Yet</h4>
            <p>Add your first subscription to start tracking recurring payments.</p>
            <button className="btn-primary" onClick={() => document.querySelector('.add-subscription-form')?.scrollIntoView({ behavior: 'smooth' })}>
              <i className="fas fa-plus"></i> Add First Subscription
            </button>
          </div>
        ) : (
          <div className="subscriptions-list">
            {subscriptions.map((sub) => (
              <div key={sub._id} className={`subscription-item ${sub.status}`}>
                <div className="sub-info">
                  <div className="sub-name">
                    <i className="fas fa-receipt"></i>
                    <span>{sub.name}</span>
                    <span className="status-badge" style={{ backgroundColor: sub.status === 'active' ? '#27ae60' : '#e74c3c', color: 'white' }}>{sub.status}</span>
                  </div>
                  <div className="sub-details">
                    <span className="sub-cost"><i className="fas fa-money-bill"></i>{fmtNaira(sub.cost)}/{sub.frequency === 'monthly' ? 'mo' : 'yr'}</span>
                    <span className="sub-category" style={{ backgroundColor: `${getCategoryColor(sub.category)}20`, color: getCategoryColor(sub.category), border: `1px solid ${getCategoryColor(sub.category)}` }}>
                      <i className="fas fa-tag"></i>{sub.category}
                    </span>
                    {sub.status === 'active' && (
                      <span className="sub-next-payment"><i className="fas fa-calendar-check"></i>Next: {new Date(sub.nextPayment).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
                <div className="sub-actions">
                  <button className={`status-btn ${sub.status}`} onClick={() => toggleSubscription(sub._id, sub.status)} title={sub.status === 'active' ? 'Cancel Subscription' : 'Reactivate Subscription'}>
                    <i className={`fas ${sub.status === 'active' ? 'fa-times' : 'fa-redo'}`}></i>
                    {sub.status === 'active' ? 'Cancel' : 'Reactivate'}
                  </button>
                  <button className="remove-btn" onClick={() => removeSubscription(sub._id)} title="Remove Subscription">
                    <i className="fas fa-trash"></i>Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Auto-detect from statements */}
      <div className="detect-card glass-effect">
        <div className="detect-head">
          <div>
            <h3><i className="fas fa-magnifying-glass-chart"></i> Detect from statements</h3>
            <p>Scan your transactions for recurring charges and add them as subscriptions.</p>
          </div>
          <button className="btn-primary" onClick={detectSubscriptions} disabled={detecting}>
            <i className="fas fa-wand-magic-sparkles"></i> {detecting ? 'Scanning…' : 'Scan transactions'}
          </button>
        </div>
        {detectMsg && <p className="detect-msg">{detectMsg}</p>}
        {detected.length > 0 && (
          <div className="detect-list">
            {detected.map((c, i) => (
              <div key={i} className="detect-row">
                <div className="detect-info">
                  <span className="detect-name">{c.name}</span>
                  <span className="detect-meta">{fmtNaira(c.cost)}/mo · seen in {c.occurrences} months · {c.category}</span>
                </div>
                <button className="detect-add" onClick={() => addDetected(c)}><i className="fas fa-plus"></i> Add</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Subscription Form */}
      <div className="add-subscription-form glass-effect">
        <div className="form-header">
          <h3><i className="fas fa-plus-circle"></i> Add New Subscription</h3>
          <p>Track your recurring payments and services</p>
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label htmlFor="sub-name"><i className="fas fa-receipt"></i> Subscription Name</label>
            <div className="input-with-icon">
              <i className="fas fa-receipt input-icon"></i>
              <input id="sub-name" type="text" value={newSubscription.name} onChange={(e) => setNewSubscription({...newSubscription, name: e.target.value})} className="form-control" placeholder="e.g., Netflix, Spotify Premium" />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="sub-cost"><i className="fas fa-money-bill"></i> Cost</label>
            <div className="input-with-icon">
              <i className="fas fa-money-bill input-icon"></i>
              <input id="sub-cost" type="number" value={newSubscription.cost} onChange={(e) => setNewSubscription({...newSubscription, cost: e.target.value})} className="form-control" step="0.01" min="0" placeholder="0.00" />
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="sub-frequency"><i className="fas fa-clock"></i> Billing Frequency</label>
            <div className="input-with-icon">
              <i className="fas fa-clock input-icon"></i>
              <select id="sub-frequency" value={newSubscription.frequency} onChange={(e) => setNewSubscription({...newSubscription, frequency: e.target.value})} className="form-control">
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="sub-category"><i className="fas fa-tag"></i> Category</label>
            <div className="input-with-icon">
              <i className="fas fa-tag input-icon"></i>
              <select id="sub-category" value={newSubscription.category} onChange={(e) => setNewSubscription({...newSubscription, category: e.target.value})} className="form-control">
                <option value="Entertainment">Entertainment</option>
                <option value="Health">Health</option>
                <option value="Work">Work</option>
                <option value="Shopping">Shopping</option>
                <option value="Utilities">Utilities</option>
                <option value="Other">Other</option>
              </select>
            </div>
          </div>
        </div>
        {/* Scheduled payment option in add form */}
        <div className="form-buttons">
          <button className="btn-submit" onClick={addSubscription}><i className="fas fa-plus"></i> Add Subscription</button>
        </div>
      </div>

      {/* Tips Section */}
      <div className="subscription-tips glass-effect">
        <div className="tips-header">
          <h3><i className="fas fa-lightbulb"></i> Subscription Management Tips</h3>
          <p>Smart ways to manage your recurring payments</p>
        </div>
        <div className="tips-list">
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-search"></i></div><div className="tip-content"><h4>Review regularly</h4><p>Audit your subscriptions every 3-6 months to ensure you're still using them.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-chart-line"></i></div><div className="tip-content"><h4>Assess value</h4><p>Are you getting enough value for what you're paying? Cancel underused services.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-percentage"></i></div><div className="tip-content"><h4>Look for discounts</h4><p>Many services offer student, family, or annual discounts.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-users"></i></div><div className="tip-content"><h4>Share accounts</h4><p>Consider family plans where appropriate to split costs.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-bell"></i></div><div className="tip-content"><h4>Set reminders</h4><p>Mark cancellation deadlines in your calendar before free trials end.</p></div></div>
        </div>
      </div>

      <style jsx="true">{`
        /* Subscription Manager Styles */
        .subscriptions-page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
        }
        
        .section-header {
          text-align: center;
          margin-bottom: 24px;
          padding: 18px 14px;
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
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 15px;
        }
        
        .section-subtitle {
          color: var(--text-secondary);
          font-size: 1.1rem;
          max-width: 600px;
          margin: 0 auto;
        }
        
        /* Overview Grid */
        .overview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }
        
        .overview-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 20px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          transition: all var(--transition-base);
        }
        
        .overview-card:hover {
          transform: translateY(-5px);
          box-shadow: var(--shadow-lg);
        }
        
        .overview-icon {
          width: 70px;
          height: 70px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          color: white;
        }
        
        .overview-icon.monthly-cost {
          background: var(--gradient-primary);
        }
        
        .overview-icon.yearly-cost {
          background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%);
        }
        
        .overview-icon.active-subs {
          background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);
        }
        
        .overview-content h3 {
          font-size: 1rem;
          color: var(--text-secondary);
          margin-bottom: 5px;
          font-weight: 500;
        }
        
        .overview-amount {
          font-size: 1.8rem;
          font-weight: 700;
          font-family: var(--font-accent);
          color: var(--text-primary);
        }
        
        /* Category Breakdown */
        .category-breakdown {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          margin-bottom: 24px;
        }
        
        .breakdown-header {
          margin-bottom: 25px;
        }
        
        .breakdown-header h3 {
          font-family: var(--font-heading);
          font-size: 1.6rem;
          color: var(--text-primary);
          margin-bottom: 8px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .breakdown-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .breakdown-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .breakdown-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 18px 20px;
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          transition: all var(--transition-base);
        }
        
        .breakdown-item:hover {
          transform: translateX(10px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        .category-label {
          display: flex;
          align-items: center;
          gap: 15px;
          flex: 1;
        }
        
        .color-dot {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        
        .category-name {
          font-weight: 600;
          color: var(--text-primary);
          min-width: 120px;
        }
        
        .progress-container {
          flex: 1;
          height: 10px;
          background: var(--glass-bg);
          border-radius: var(--radius-full);
          overflow: hidden;
        }
        
        .progress-bar {
          height: 100%;
          border-radius: var(--radius-full);
          transition: width 0.5s ease;
        }
        
        .category-info {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        
        .category-amount {
          font-family: var(--font-accent);
          font-weight: 700;
          font-size: 1.2rem;
          color: var(--text-primary);
          min-width: 100px;
          text-align: right;
        }
        
        .category-percentage {
          font-weight: 600;
          color: var(--text-secondary);
          min-width: 60px;
          text-align: center;
          background: var(--glass-bg);
          padding: 6px 12px;
          border-radius: var(--radius-full);
        }
        
        /* Subscriptions List */
        .subscriptions-list-container {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          margin-bottom: 24px;
        }
        
        .list-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 25px;
          padding-bottom: 20px;
          border-bottom: 2px solid var(--glass-border);
        }
        
        .list-header h3 {
          font-family: var(--font-heading);
          font-size: 1.6rem;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .subscription-count {
          font-size: 0.9rem;
          background: var(--glass-bg);
          padding: 6px 15px;
          border-radius: var(--radius-full);
          color: var(--text-secondary);
          font-weight: 600;
        }
        
        .empty-state {
          text-align: center;
          padding: 60px 40px;
        }
        
        .empty-state-icon {
          font-size: 80px;
          margin-bottom: 20px;
          opacity: 0.5;
          color: var(--text-secondary);
        }
        
        .empty-state h4 {
          font-family: var(--font-heading);
          font-size: 1.6rem;
          margin-bottom: 10px;
          color: var(--text-primary);
        }
        
        .empty-state p {
          color: var(--text-secondary);
          max-width: 400px;
          margin: 0 auto 25px;
          font-size: 1.1rem;
          line-height: 1.6;
        }
        
        .subscriptions-list {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        
        .subscription-item {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 20px;
          transition: all var(--transition-base);
          border-left: 4px solid;
        }
        
        .subscription-item.active {
          border-left-color: #27ae60;
        }
        
        .subscription-item.cancelled {
          border-left-color: #e74c3c;
          opacity: 0.7;
        }
        
        .subscription-item:hover {
          transform: translateX(5px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        .sub-info {
          margin-bottom: 15px;
        }
        
        .sub-name {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 1.3rem;
          font-weight: 600;
          color: var(--text-primary);
          margin-bottom: 10px;
        }
        
        .status-badge {
          font-size: 0.75rem;
          padding: 4px 12px;
          border-radius: var(--radius-full);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        
        .sub-details {
          display: flex;
          flex-wrap: wrap;
          gap: 20px;
          align-items: center;
        }
        
        .sub-details span {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.95rem;
          padding: 8px 15px;
          background: var(--glass-bg);
          border-radius: var(--radius-full);
          color: var(--text-secondary);
        }
        
        .sub-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
        }
        
        .status-btn, .remove-btn {
          padding: 10px 20px;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9rem;
        }
        
        .status-btn.active {
          background: rgba(231, 76, 60, 0.1);
          color: #e74c3c;
          border: 1px solid #e74c3c;
        }
        
        .status-btn.cancelled {
          background: rgba(39, 174, 96, 0.1);
          color: #27ae60;
          border: 1px solid #27ae60;
        }
        
        .status-btn:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
        }
        
        .remove-btn {
          background: rgba(52, 152, 219, 0.1);
          color: #3498db;
          border: 1px solid #3498db;
        }
        
        .remove-btn:hover {
          background: rgba(231, 76, 60, 0.1);
          color: #e74c3c;
          border-color: #e74c3c;
          transform: translateY(-2px);
          box-shadow: var(--shadow-sm);
        }
        
        /* Detect from statements */
        .detect-card { background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); margin-bottom: 24px; }
        .detect-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .detect-head h3 { font-family: var(--font-heading); font-size: 1.4rem; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .detect-head p { color: var(--text-secondary); font-size: 0.9rem; margin-top: 4px; }
        .detect-msg { color: var(--text-secondary); font-size: 0.9rem; margin-top: 12px; }
        .detect-list { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
        .detect-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; background: var(--glass-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); }
        .detect-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .detect-name { color: var(--text-primary); font-weight: 600; }
        .detect-meta { color: var(--text-secondary); font-size: 0.8rem; }
        .detect-add { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-full); padding: 8px 18px; font-weight: 600; cursor: pointer; white-space: nowrap; }

        /* Add Subscription Form */
        .add-subscription-form {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
          margin-bottom: 24px;
        }
        
        .form-header {
          text-align: center;
          margin-bottom: 30px;
        }
        
        .form-header h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 8px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .form-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 25px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: var(--text-primary);
          font-size: 0.95rem;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .input-with-icon {
          position: relative;
        }
        
        .input-icon {
          position: absolute;
          left: 15px;
          top: 50%;
          transform: translateY(-50%);
          color: var(--text-secondary);
          font-size: 1rem;
          z-index: 1;
        }
        
        .form-control {
          width: 100%;
          padding: 15px 15px 15px 45px;
          background: var(--glass-bg);
          border: 2px solid var(--glass-border);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          font-size: 1rem;
          transition: all var(--transition-base);
          font-family: var(--font-body);
        }
        
        .form-control:focus {
          outline: none;
          border-color: var(--income-color);
          box-shadow: 0 0 0 3px rgba(0, 212, 170, 0.15);
          background: var(--card-bg);
        }
        
        select.form-control {
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23636e72' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 15px center;
          background-size: 16px;
          padding-right: 45px;
        }
        
        .form-buttons {
          display: flex;
          justify-content: center;
          margin-top: 20px;
        }
        
        .btn-submit {
          padding: 16px 40px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-full);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 1.1rem;
          box-shadow: var(--shadow-md);
        }
        
        .btn-submit:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-lg);
        }
        
        /* Tips Section */
        .subscription-tips {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          box-shadow: var(--shadow-md);
          border: 1px solid var(--glass-border);
        }
        
        .tips-header {
          margin-bottom: 30px;
        }
        
        .tips-header h3 {
          font-family: var(--font-heading);
          font-size: 1.8rem;
          margin-bottom: 8px;
          color: var(--text-primary);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .tips-header p {
          color: var(--text-secondary);
          font-size: 0.95rem;
        }
        
        .tips-list {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
        }
        
        .tip-item {
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          padding: 20px;
          display: flex;
          gap: 20px;
          transition: all var(--transition-base);
        }
        
        .tip-item:hover {
          transform: translateY(-5px);
          background: rgba(255, 255, 255, 0.05);
        }
        
        .tip-icon {
          width: 60px;
          height: 60px;
          border-radius: 50%;
          background: var(--gradient-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: white;
          flex-shrink: 0;
        }
        
        .tip-content h4 {
          font-size: 1.1rem;
          color: var(--text-primary);
          margin-bottom: 8px;
          font-weight: 600;
        }
        
        .tip-content p {
          color: var(--text-secondary);
          font-size: 0.9rem;
          line-height: 1.5;
        }
        
        /* Primary Button */
        .btn-primary {
          padding: 14px 32px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-full);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-base);
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 1rem;
          box-shadow: var(--shadow-md);
        }
        
        .btn-primary:hover {
          transform: translateY(-3px);
          box-shadow: var(--shadow-lg);
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
          .subscriptions-page {
            padding: 15px;
          }
          
          .section-header h2 {
            font-size: 2rem;
          }
          
          .overview-grid {
            grid-template-columns: 1fr;
          }
          
          .category-info {
            flex-direction: column;
            gap: 10px;
            align-items: flex-end;
          }
          
          .category-amount {
            text-align: right;
            min-width: auto;
          }
          
          .category-percentage {
            min-width: auto;
          }
          
          .sub-details {
            flex-direction: column;
            align-items: flex-start;
            gap: 10px;
          }
          
          .sub-details span {
            width: 100%;
            justify-content: flex-start;
          }
          
          .form-grid {
            grid-template-columns: 1fr;
          }
          
          .tips-list {
            grid-template-columns: 1fr;
          }
        }
        
        @media (max-width: 480px) {
          .section-header h2 {
            font-size: 1.8rem;
          }
          
          .subscription-item {
            flex-direction: column;
            gap: 15px;
          }
          
          .sub-actions {
            width: 100%;
            justify-content: stretch;
          }
          
          .status-btn, .remove-btn {
            flex: 1;
            justify-content: center;
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
          margin-top: 8px;
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

export default SubscriptionManager;