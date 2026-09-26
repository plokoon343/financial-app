import React, { Suspense, lazy } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader } from './Logo';

// "Accounts & alerts" hub — folds the three former Banking pages (My Accounts,
// Email Forwarding, Connect Bank) into one tabbed page, so setting up where your
// transactions come from lives in a single place. The old /connect-bank and
// /email-forwarding routes redirect here with the matching ?tab=. Email is given
// prominence: it's the ingestion path that works for iPhone (see the beta survey).
const Accounts = lazy(() => import('./Accounts'));
const EmailForwarding = lazy(() => import('./EmailForwarding'));
const ConnectBank = lazy(() => import('./ConnectBank'));

const TABS = [
  { key: 'accounts', label: 'My accounts', icon: 'credit_card', render: () => <Accounts /> },
  { key: 'email', label: 'Email alerts', icon: 'forward_to_inbox', render: () => <EmailForwarding /> },
  { key: 'bank', label: 'Connect bank', icon: 'account_balance', render: () => <ConnectBank /> },
];

export default function AccountsHub() {
  const [params, setParams] = useSearchParams();
  const active = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'accounts';
  const current = TABS.find((t) => t.key === active) || TABS[0];

  const pick = (key) => { const p = new URLSearchParams(params); p.set('tab', key); setParams(p, { replace: true }); };

  return (
    <div className="ah-page">
      <div className="ah-head">
        <h2><i className="fas fa-building-columns"></i> Accounts &amp; alerts</h2>
        <p>Name the accounts we detect, and set up where your transactions come from.</p>
      </div>

      <div className="ah-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`ah-tab ${active === t.key ? 'on' : ''}`}
            onClick={() => pick(t.key)}
          >
            <span className="material-symbols-outlined">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="ah-body">
        <Suspense fallback={<div className="ah-loading"><Loader size={44} /></div>}>
          {current.render()}
        </Suspense>
      </div>

      <style jsx="true">{`
        .ah-page { max-width: 760px; margin: 0 auto; padding: 20px 20px 8px; }
        .ah-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .ah-head p { color: var(--text-secondary); margin: 0 0 16px; }
        .ah-tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--border-color, var(--glass-border)); margin-bottom: 4px; overflow-x: auto; }
        .ah-tab { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); font-weight: 700; font-size: 0.9rem; padding: 10px 6px 12px; cursor: pointer; white-space: nowrap; }
        .ah-tab .material-symbols-outlined { font-size: 1.15rem; }
        .ah-tab.on { color: var(--accent-primary, #008751); border-bottom-color: var(--accent-primary, #008751); }
        .ah-loading { display: flex; justify-content: center; padding: 48px 0; }
      `}</style>
    </div>
  );
}
