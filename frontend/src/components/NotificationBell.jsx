import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const timeAgo = (d) => {
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const NotificationBell = () => {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/notifications`, auth());
      setItems(res.data.items || []);
      setUnread(res.data.unread || 0);
    } catch { /* offline / cold start — ignore */ }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60000); // poll every minute
    return () => clearInterval(id);
  }, [load]);

  // Close on outside click
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const openItem = async (n) => {
    if (!n.read) {
      try { await axios.patch(`${API_URL}/api/notifications/${n._id}/read`, {}, auth()); } catch {}
      setItems(prev => prev.map(x => x._id === n._id ? { ...x, read: true } : x));
      setUnread(u => Math.max(0, u - 1));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const markAllRead = async () => {
    try { await axios.post(`${API_URL}/api/notifications/read-all`, {}, auth()); } catch {}
    setItems(prev => prev.map(x => ({ ...x, read: true })));
    setUnread(0);
  };

  const iconFor = (t) => t === 'ticket' ? 'fa-headset' : t === 'success' ? 'fa-circle-check' : 'fa-circle-info';

  return (
    <div className="nb-wrap" ref={ref}>
      <button className="nb-btn" onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <i className="fas fa-bell"></i>
        {unread > 0 && <span className="nb-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="nb-panel">
          <div className="nb-head">
            <strong>Notifications</strong>
            {unread > 0 && <button onClick={markAllRead} className="nb-mark">Mark all read</button>}
          </div>
          <div className="nb-list">
            {items.length === 0 && <div className="nb-empty"><i className="fas fa-circle-check" style={{ marginRight: 6, color: '#22c55e' }}></i> You're all caught up</div>}
            {items.map(n => (
              <button key={n._id} className={`nb-item ${n.read ? '' : 'unread'}`} onClick={() => openItem(n)}>
                <i className={`fas ${iconFor(n.type)} nb-ic`}></i>
                <div className="nb-text">
                  <span className="nb-title">{n.title}</span>
                  {n.message && <span className="nb-msg">{n.message}</span>}
                  <span className="nb-time">{timeAgo(n.createdAt)}</span>
                </div>
                {!n.read && <span className="nb-dot" />}
              </button>
            ))}
          </div>
        </div>
      )}

      <style jsx="true">{`
        .nb-wrap { position: fixed; top: 1rem; right: 1rem; z-index: 1100; }
        .nb-btn { position: relative; width: 44px; height: 44px; border-radius: 12px; background: var(--card-bg);
          border: 1px solid var(--glass-border); color: var(--text-primary); font-size: 1.2rem; cursor: pointer;
          backdrop-filter: blur(10px); }
        .nb-badge { position: absolute; top: -4px; right: -4px; background: #e53e3e; color: #fff; font-size: 0.68rem;
          font-weight: 700; min-width: 18px; height: 18px; border-radius: 9px; display: flex; align-items: center; justify-content: center; padding: 0 4px; }
        .nb-panel { position: absolute; top: 52px; right: 0; width: 340px; max-width: calc(100vw - 2rem);
          background: var(--bg-elevated, #ffffff); border: 1px solid var(--border-color, var(--glass-border)); border-radius: 14px;
          box-shadow: var(--shadow-lg); overflow: hidden; }
        .nb-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); }
        .nb-mark { background: none; border: none; color: var(--accent-primary, var(--accent-primary)); cursor: pointer; font-size: 0.8rem; font-weight: 600; }
        .nb-list { max-height: 60vh; overflow-y: auto; }
        .nb-empty { padding: 28px 14px; text-align: center; color: var(--text-secondary); font-size: 0.88rem; }
        .nb-item { display: flex; gap: 10px; align-items: flex-start; width: 100%; text-align: left; background: none;
          border: none; border-bottom: 1px solid var(--border-color, var(--glass-border)); padding: 12px 14px; cursor: pointer; color: var(--text-primary); }
        .nb-item.unread { background: rgba(0,135,81,0.08); }
        .nb-item:hover { background: var(--bg-input, var(--glass-bg)); }
        .nb-ic { color: var(--accent-primary, var(--accent-primary)); margin-top: 2px; }
        .nb-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
        .nb-title { font-weight: 600; font-size: 0.86rem; }
        .nb-msg { font-size: 0.8rem; color: var(--text-secondary); }
        .nb-time { font-size: 0.72rem; color: var(--text-secondary); }
        .nb-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent-primary, var(--accent-primary)); margin-top: 6px; }
      `}</style>
    </div>
  );
};

export default NotificationBell;
