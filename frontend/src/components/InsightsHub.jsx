import React, { Suspense, lazy } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { Loader } from './Logo';
import { FEATURES } from '../config/features';

// "Insights" hub — folds the former standalone analysis pages (Spending insights,
// Financial Health, Cashflow, Net Worth) into one tabbed page. The old routes
// redirect here with the matching ?tab=. Read-only analysis in one place.
const Insights = lazy(() => import('./Insights'));
const FinancialHealth = lazy(() => import('./FinancialHealth'));
const Cashflow = lazy(() => import('./Cashflow'));
const NetWorthCalculator = lazy(() => import('./NetWorthCalculator'));

export default function InsightsHub() {
  const [params, setParams] = useSearchParams();
  // transactions come from the ProtectedLayout Outlet context (App.js).
  const ctx = useOutletContext() || {};
  const transactions = ctx.transactions || [];

  const tabs = [
    { key: 'spending', label: 'Spending', icon: 'fa-chart-pie', render: () => <Insights transactions={transactions} /> },
    { key: 'health', label: 'Financial Health', icon: 'fa-heart-pulse', render: () => <FinancialHealth transactions={transactions} /> },
    { key: 'cashflow', label: 'Cashflow', icon: 'fa-chart-line', render: () => <Cashflow /> },
    ...(FEATURES.netWorth ? [{ key: 'networth', label: 'Net Worth', icon: 'fa-chart-area', render: () => <NetWorthCalculator /> }] : []),
  ];

  const active = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'spending';
  const current = tabs.find((t) => t.key === active) || tabs[0];
  const pick = (key) => { const p = new URLSearchParams(params); p.set('tab', key); setParams(p, { replace: true }); };

  return (
    <div className="ih-page">
      <div className="ih-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active === t.key}
            className={`ih-tab ${active === t.key ? 'on' : ''}`}
            onClick={() => pick(t.key)}
          >
            <i className={`fas ${t.icon}`} aria-hidden="true"></i>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      <div className="ih-body">
        <Suspense fallback={<div className="ih-loading"><Loader size={44} /></div>}>
          {current.render()}
        </Suspense>
      </div>

      <style>{`
        .ih-page { max-width: 1100px; margin: 0 auto; }
        .ih-tabs { display: flex; gap: 6px; border-bottom: 1px solid var(--border-color, var(--glass-border)); margin: 0 0 4px; padding: 0 8px; overflow-x: auto; }
        .ih-tab { display: inline-flex; align-items: center; gap: 8px; background: none; border: none; border-bottom: 2px solid transparent; color: var(--text-secondary); font-weight: 700; font-size: 0.9rem; padding: 12px 8px 13px; cursor: pointer; white-space: nowrap; }
        .ih-tab .fas { font-size: 1.15rem; }
        .ih-tab.on { color: var(--accent-primary, #139DA0); border-bottom-color: var(--accent-primary, #139DA0); }
        .ih-loading { display: flex; justify-content: center; padding: 48px 0; }
      `}</style>
    </div>
  );
}
