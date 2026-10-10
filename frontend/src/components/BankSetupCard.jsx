import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

// The banks the user said they use at onboarding, with the easiest way to connect
// each from the web, until something arrives from it ("2 more banks to connect").
// Renders nothing when every bank is connected or none were picked.
const ROUTE = {
  email: '/accounts?tab=email',
  statement: '/import-statement',
  share: '/help#share',
  mono: '/accounts?tab=bank',
};
const ICON = { email: 'fa-envelope', statement: 'fa-file-lines', share: 'fa-share-nodes', mono: 'fa-link' };
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export default function BankSetupCard() {
  const [banks, setBanks] = useState(null);
  useEffect(() => {
    axios.get(`${API_URL}/api/me/banks?platform=web`, auth()).then((r) => setBanks(r.data.banks || [])).catch(() => setBanks([]));
  }, []);
  const todo = (banks || []).filter((b) => !b.connected);
  if (!todo.length) return null;
  return (
    <div className="bsc">
      <strong>{todo.length} bank{todo.length === 1 ? '' : 's'} to connect</strong>
      {todo.map((b) => {
        const m = b.methods.find((x) => x.method === b.best) || b.methods[0];
        return (
          <Link key={b.code} to={ROUTE[m.method] || '/import-statement'} className="bsc-row">
            <span className="bsc-icon"><i className={`fas ${ICON[m.method] || 'fa-plug'}`} aria-hidden="true"></i></span>
            <span className="bsc-text"><span className="bsc-name">{b.name}</span><span className="bsc-sub">{m.label}: {m.detail}</span></span>
            <i className="fas fa-chevron-right bsc-chev" aria-hidden="true"></i>
          </Link>
        );
      })}
      <style>{`
        .bsc { display: grid; gap: 4px; background: var(--bg-card); border: 1px solid var(--accent-primary); border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 18px; }
        .bsc strong { color: var(--text-primary); margin-bottom: 4px; }
        .bsc-row { display: flex; align-items: center; gap: 12px; min-height: 52px; padding: 6px 0; border-top: 1px solid var(--border-color); text-decoration: none; color: inherit; }
        .bsc-icon { width: 36px; height: 36px; flex-shrink: 0; border-radius: 10px; background: var(--glass-bg); color: var(--accent-primary); display: flex; align-items: center; justify-content: center; }
        .bsc-text { flex: 1; min-width: 0; display: grid; }
        .bsc-name { color: var(--text-primary); font-weight: 700; }
        .bsc-sub { color: var(--text-secondary); font-size: 0.85rem; }
        .bsc-chev { color: var(--text-faint); }
      `}</style>
    </div>
  );
}
