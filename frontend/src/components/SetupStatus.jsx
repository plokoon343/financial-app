import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Admin, Overview: which keys and settings this server has (names only, never
// values), so it's clear what still needs setting on Render.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export default function SetupStatus() {
  const [groups, setGroups] = useState(null);
  useEffect(() => {
    axios.get(`${API_URL}/api/admin/setup-status`, auth()).then((r) => setGroups(r.data.groups || [])).catch(() => setGroups([]));
  }, []);
  if (!groups || !groups.length) return null;
  const missing = groups.reduce((n, g) => n + g.keys.filter((k) => !k.set).length, 0);
  return (
    <section className="ss">
      <h3>Setup checklist <span className="ss-sum">{missing ? `${missing} missing` : 'all set'}</span></h3>
      <div className="ss-grid">
        {groups.map((g) => (
          <div key={g.group} className="ss-group">
            <strong>{g.group}</strong>
            {g.keys.map((k) => (
              <div key={k.name} className="ss-row" title={k.use}>
                <code>{k.name}</code>
                <span className={`ss-badge ${k.set ? 'on' : 'off'}`}>{k.set ? 'Set' : 'Missing'}</span>
              </div>
            ))}
            {g.note && <p className="ss-note">{g.note}</p>}
          </div>
        ))}
      </div>
      <style>{`
        .ss { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 2rem; color: var(--text-primary); }
        .ss h3 { margin: 0 0 12px; display: flex; align-items: center; gap: 10px; }
        .ss-sum { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); }
        .ss-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
        .ss-group { border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; display: grid; gap: 6px; align-content: start; }
        .ss-row { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 0.82rem; }
        .ss-row code { overflow-wrap: anywhere; }
        .ss-badge { font-size: 0.72rem; font-weight: 700; border-radius: 999px; padding: 2px 10px; white-space: nowrap; }
        .ss-badge.on { background: rgba(22, 163, 74, 0.14); color: var(--success-color); }
        .ss-badge.off { background: rgba(217, 119, 6, 0.14); color: var(--warning-color); }
        .ss-note { margin: 4px 0 0; font-size: 0.78rem; color: var(--text-secondary); }
      `}</style>
    </section>
  );
}
