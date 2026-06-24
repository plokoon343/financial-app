import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import PayBill from './PayBill';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const TYPE_ICON = { airtime: 'fa-mobile-screen-button', data: 'fa-wifi', tv: 'fa-tv', electricity: 'fa-bolt' };

// Dedicated bill-payments page (Airtime, Data, TV, Electricity) — separate from
// the Bills & Obligations page. Hosts the PayBill panel plus recent history.
const PayBills = () => {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/api/bills/history`, auth());
      setHistory(r.data || []);
    } catch {
      /* history is best-effort */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  return (
    <div className="paybills-page">
      <div className="section-header">
        <h2><i className="fas fa-bolt"></i> Pay Bills</h2>
        <p>Top up airtime &amp; data, renew TV, or buy electricity — instantly from your wallet.</p>
      </div>

      <PayBill onPaid={loadHistory} />

      <div className="history-card">
        <div className="history-head">
          <h3><i className="fas fa-clock-rotate-left"></i> Recent payments</h3>
          {history.length > 0 && <span className="count">{history.length}</span>}
        </div>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No bill payments yet. Your purchases will appear here.</p>
        ) : (
          <div className="history-list">
            {history.map((h) => (
              <div key={h._id} className="history-row">
                <div className={`h-ic ${h.billType}`}><i className={`fas ${TYPE_ICON[h.billType] || 'fa-receipt'}`}></i></div>
                <div className="h-main">
                  <span className="h-name">{h.provider || h.serviceID}</span>
                  <span className="h-meta">
                    {h.phone || h.billersCode}{h.token ? ` · token ${h.token}` : ''} · {new Date(h.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="h-right">
                  <span className="h-amt">{fmtNaira(h.amount)}</span>
                  <span className={`h-status ${h.status}`}>{h.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style jsx="true">{`
        .paybills-page { padding: 20px; max-width: 760px; margin: 0 auto; }
        .section-header { text-align: center; margin-bottom: 20px; }
        .section-header h2 { display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--text-primary); font-size: 1.8rem; }
        .section-header p { color: var(--text-secondary); margin-top: 6px; }
        .history-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; margin-top: 22px; }
        .history-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .history-head h3 { display: flex; align-items: center; gap: 9px; color: var(--text-primary); font-size: 1.1rem; }
        .history-head .count { font-size: 0.75rem; background: var(--glass-bg); color: var(--text-secondary); padding: 3px 10px; border-radius: var(--radius-full); font-weight: 600; }
        .muted { color: var(--text-secondary); font-size: 0.9rem; }
        .history-list { display: flex; flex-direction: column; gap: 8px; }
        .history-row { display: flex; align-items: center; gap: 12px; background: var(--glass-bg); border-radius: var(--radius-md); padding: 11px 13px; }
        .h-ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: rgba(0,168,98,0.12); color: var(--accent-primary); flex-shrink: 0; }
        .h-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .h-name { color: var(--text-primary); font-weight: 600; }
        .h-meta { color: var(--text-secondary); font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .h-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
        .h-amt { color: var(--text-primary); font-weight: 700; white-space: nowrap; }
        .h-status { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.4px; font-weight: 700; padding: 2px 8px; border-radius: var(--radius-full); }
        .h-status.completed { background: rgba(34,197,94,0.14); color: #22c55e; }
        .h-status.pending { background: rgba(245,158,11,0.14); color: #f59e0b; }
        .h-status.failed { background: rgba(239,68,68,0.14); color: #ef4444; }
      `}</style>
    </div>
  );
};

export default PayBills;
