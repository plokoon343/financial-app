import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const KIND_COLOR = {
  bug: '#e53e3e', idea: '#6366f1', praise: '#38a169', other: '#718096',
};
const fmtDate = (d) => new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });

// Admin feedback inbox: read and clear in-app / beta feedback.
export default function FeedbackInbox() {
  const [items, setItems] = useState([]);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('open'); // open | all
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/admin/feedback`, authHeader());
      setItems(data.items || []);
      setOpenCount(data.open || 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setHandled = async (id, handled) => {
    setBusy(id);
    try {
      await axios.patch(`${API_URL}/api/admin/feedback/${id}`, { handled }, authHeader());
      setItems(prev => prev.map(f => f._id === id ? { ...f, handled } : f));
      setOpenCount(prev => prev + (handled ? -1 : 1));
    } catch { /* ignore */ }
    finally { setBusy(''); }
  };

  const shown = items.filter(f => filter === 'all' ? true : !f.handled);

  if (loading) return <p style={{ color: 'var(--text-secondary, #718096)' }}>Loading feedback…</p>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Feedback</h3>
        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #718096)' }}>{openCount} open · {items.length} total</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['open', 'Open'], ['all', 'All']].map(([id, lbl]) => (
            <button key={id} onClick={() => setFilter(id)} style={{
              padding: '5px 14px', borderRadius: 999, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
              border: `1px solid ${filter === id ? 'var(--accent-primary, #008751)' : 'var(--glass-border, #e2e8f0)'}`,
              background: filter === id ? 'var(--accent-primary, #008751)' : 'transparent',
              color: filter === id ? '#fff' : 'var(--text-secondary, #718096)',
            }}>{lbl}</button>
          ))}
          <button onClick={load} style={{ padding: '5px 12px', borderRadius: 999, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', border: '1px solid var(--glass-border, #e2e8f0)', background: 'transparent', color: 'var(--text-secondary, #718096)' }}>Refresh</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <p style={{ color: 'var(--text-secondary, #718096)' }}>{filter === 'open' ? 'No open feedback. All clear.' : 'No feedback yet.'}</p>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {shown.map(f => (
            <div key={f._id} style={{
              background: 'var(--card-bg, #fff)', border: '1px solid var(--glass-border, #e2e8f0)', borderRadius: 12,
              padding: '12px 14px', opacity: f.handled ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                <span style={{ fontSize: '0.68rem', fontWeight: 800, textTransform: 'uppercase', color: '#fff', background: KIND_COLOR[f.kind] || '#718096', padding: '2px 8px', borderRadius: 6 }}>{f.kind}</span>
                {f.betaTester && <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#6366f1', background: 'rgba(99,102,241,0.12)', padding: '2px 8px', borderRadius: 6 }}>BETA</span>}
                {f.platform && <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #718096)' }}>{f.platform}</span>}
                <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #718096)', marginLeft: 'auto' }}>{fmtDate(f.createdAt)}</span>
              </div>
              <div style={{ fontSize: '0.92rem', color: 'var(--text-primary, #1a365d)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{f.message}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                <span style={{ fontSize: '0.76rem', color: 'var(--text-secondary, #718096)' }}>{f.name || 'User'} · {f.email}</span>
                <button onClick={() => setHandled(f._id, !f.handled)} disabled={busy === f._id} style={{
                  marginLeft: 'auto', padding: '5px 12px', borderRadius: 8, fontSize: '0.8rem', fontWeight: 700, cursor: 'pointer',
                  border: `1px solid ${f.handled ? 'var(--glass-border, #e2e8f0)' : '#38a169'}`,
                  background: f.handled ? 'transparent' : '#38a169', color: f.handled ? 'var(--text-secondary, #718096)' : '#fff',
                }}>{busy === f._id ? '…' : f.handled ? 'Reopen' : 'Mark done'}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
