import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Subscriptions is a live, read-only tracker. It scans the user's transactions
// for recurring charges and shows them — there are no add/edit/delete actions.
const SubscriptionManager = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await axios.get(`${API_URL}/api/subscriptions/detect`, authHeaders());
      setItems(res.data || []);
    } catch (err) {
      setError('Could not scan your transactions. The server may be waking up — try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const monthlyOf = (s) => (s.frequency === 'yearly' ? s.cost / 12 : s.cost);
  const monthlyCost = items.reduce((t, s) => t + monthlyOf(s), 0);
  const yearlyCost = monthlyCost * 12;

  const getCategoryColor = (category) => ({
    Entertainment: '#FF6B8B', Health: '#4ECDC4', Work: '#45B7D1',
    Shopping: '#FFA07A', Utilities: '#98D8C8', Other: '#C9C9C9',
  }[category] || '#C9C9C9');

  const categoryBreakdown = items.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] || 0) + monthlyOf(s);
    return acc;
  }, {});

  return (
    <div className="subscriptions-page">
      <div className="section-header">
        <h2><i className="fas fa-calendar-alt"></i> Subscriptions</h2>
        <p className="section-subtitle">Recurring charges detected from your statements — updated live.</p>
        <button className="btn-ghost" onClick={load} disabled={loading}>
          <i className="fas fa-sync-alt"></i> {loading ? 'Scanning…' : 'Rescan'}
        </button>
      </div>

      {error && <div className="subs-error">{error}</div>}

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
          <div className="overview-content"><h3>Subscriptions</h3><div className="overview-amount">{items.length}</div></div>
        </div>
      </div>

      {/* Category breakdown */}
      {items.length > 0 && (
        <div className="category-breakdown">
          <div className="breakdown-header"><h3><i className="fas fa-chart-pie"></i> Monthly cost by category</h3></div>
          <div className="breakdown-list">
            {Object.entries(categoryBreakdown).map(([category, amount]) => (
              <div key={category} className="breakdown-item">
                <div className="category-label">
                  <div className="color-dot" style={{ backgroundColor: getCategoryColor(category) }}></div>
                  <span className="category-name">{category}</span>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${monthlyCost ? (amount / monthlyCost) * 100 : 0}%`, backgroundColor: getCategoryColor(category) }}></div>
                  </div>
                </div>
                <div className="category-info">
                  <div className="category-amount">{fmtNaira(amount)}</div>
                  <div className="category-percentage">{monthlyCost ? ((amount / monthlyCost) * 100).toFixed(0) : 0}%</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* List (read-only) */}
      <div className="subscriptions-list-container">
        <div className="list-header">
          <h3><i className="fas fa-list"></i> Your subscriptions</h3>
          <span className="subscription-count">{items.length} found</span>
        </div>
        {loading ? (
          <div className="subs-loading">Scanning your transactions…</div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><i className="fas fa-calendar-times"></i></div>
            <h4>No recurring charges yet</h4>
            <p>Import more bank statements and rescan — Automonie spots subscriptions automatically.</p>
          </div>
        ) : (
          <div className="subscriptions-list">
            {items.map((s, i) => (
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

      {/* Tips */}
      <div className="subscription-tips">
        <div className="tips-header"><h3><i className="fas fa-lightbulb"></i> Subscription tips</h3></div>
        <div className="tips-list">
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-search"></i></div><div className="tip-content"><h4>Review regularly</h4><p>Audit your subscriptions every 3–6 months to ensure you still use them.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-percentage"></i></div><div className="tip-content"><h4>Look for discounts</h4><p>Many services offer student, family, or annual discounts.</p></div></div>
          <div className="tip-item"><div className="tip-icon"><i className="fas fa-users"></i></div><div className="tip-content"><h4>Share plans</h4><p>Family plans can split costs across people you trust.</p></div></div>
        </div>
      </div>

      <style jsx="true">{`
        .subscriptions-page { padding: 20px; max-width: 1100px; margin: 0 auto; }
        .section-header { text-align: center; margin-bottom: 24px; padding: 18px 14px; background: var(--bg-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); border: 1px solid var(--border-color); }
        .section-header h2 { font-family: var(--font-heading); font-size: 2rem; font-weight: 700; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 12px; color: var(--text-primary); }
        .section-subtitle { color: var(--text-secondary); font-size: 1rem; max-width: 600px; margin: 0 auto 12px; }
        .btn-ghost { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 8px 18px; cursor: pointer; font-weight: 600; }
        .btn-ghost:disabled { opacity: 0.6; cursor: default; }
        .subs-error { background: rgba(239,68,68,0.12); color: #ef4444; padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; }
        .subs-loading { text-align: center; padding: 40px; color: var(--text-secondary); }
        .overview-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .overview-card { background: var(--bg-card); border-radius: var(--radius-lg); padding: 16px; display: flex; align-items: center; gap: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--border-color); }
        .overview-icon { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 24px; color: white; flex-shrink: 0; }
        .overview-icon.monthly-cost { background: var(--gradient-primary); }
        .overview-icon.yearly-cost { background: linear-gradient(135deg, #ff6b8b 0%, #ffa62e 100%); }
        .overview-icon.active-subs { background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); }
        .overview-content h3 { font-size: 0.95rem; color: var(--text-secondary); margin-bottom: 4px; font-weight: 500; }
        .overview-amount { font-size: 1.6rem; font-weight: 700; font-family: var(--font-accent); color: var(--text-primary); }
        .category-breakdown, .subscriptions-list-container, .subscription-tips { background: var(--bg-card); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow-md); border: 1px solid var(--border-color); margin-bottom: 24px; }
        .breakdown-header h3, .list-header h3, .tips-header h3 { font-family: var(--font-heading); font-size: 1.3rem; color: var(--text-primary); display: flex; align-items: center; gap: 10px; }
        .breakdown-list { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
        .breakdown-item { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; background: var(--glass-bg); border-radius: var(--radius-md); }
        .category-label { display: flex; align-items: center; gap: 14px; flex: 1; }
        .color-dot { width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; }
        .category-name { font-weight: 600; color: var(--text-primary); min-width: 110px; }
        .progress-container { flex: 1; height: 8px; background: var(--glass-bg); border-radius: var(--radius-full); overflow: hidden; }
        .progress-bar { height: 100%; border-radius: var(--radius-full); transition: width 0.5s ease; }
        .category-info { display: flex; align-items: center; gap: 14px; }
        .category-amount { font-family: var(--font-accent); font-weight: 700; color: var(--text-primary); text-align: right; }
        .category-percentage { font-weight: 600; color: var(--text-secondary); background: var(--glass-bg); padding: 5px 10px; border-radius: var(--radius-full); }
        .list-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color); }
        .subscription-count { font-size: 0.85rem; background: var(--glass-bg); padding: 6px 14px; border-radius: var(--radius-full); color: var(--text-secondary); font-weight: 600; }
        .empty-state { text-align: center; padding: 50px 30px; }
        .empty-state-icon { font-size: 64px; margin-bottom: 16px; opacity: 0.5; color: var(--text-secondary); }
        .empty-state h4 { font-family: var(--font-heading); font-size: 1.4rem; margin-bottom: 8px; color: var(--text-primary); }
        .empty-state p { color: var(--text-secondary); max-width: 420px; margin: 0 auto; line-height: 1.6; }
        .subscriptions-list { display: flex; flex-direction: column; gap: 12px; }
        .subscription-item { background: var(--glass-bg); border-radius: var(--radius-md); padding: 18px; border-left: 4px solid var(--accent-primary); }
        .sub-name { display: flex; align-items: center; gap: 12px; font-size: 1.15rem; font-weight: 600; color: var(--text-primary); margin-bottom: 10px; }
        .seen-badge { font-size: 0.72rem; padding: 3px 10px; border-radius: var(--radius-full); background: var(--glass-bg); color: var(--text-secondary); font-weight: 600; }
        .sub-details { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
        .sub-details span { display: flex; align-items: center; gap: 8px; font-size: 0.9rem; padding: 7px 14px; background: var(--glass-bg); border-radius: var(--radius-full); color: var(--text-secondary); }
        .tips-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 16px; }
        .tip-item { background: var(--glass-bg); border-radius: var(--radius-md); padding: 18px; display: flex; gap: 16px; }
        .tip-icon { width: 50px; height: 50px; border-radius: 50%; background: var(--gradient-primary); display: flex; align-items: center; justify-content: center; font-size: 20px; color: white; flex-shrink: 0; }
        .tip-content h4 { font-size: 1.05rem; color: var(--text-primary); margin-bottom: 6px; font-weight: 600; }
        .tip-content p { color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; }
        @media (max-width: 768px) { .overview-grid { grid-template-columns: 1fr; } .sub-details { gap: 8px; } }
      `}</style>
    </div>
  );
};

export default SubscriptionManager;
