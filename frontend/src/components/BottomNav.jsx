import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const TABS = [
  { path: '/', label: 'Home', icon: 'fa-house' },
  { path: '/transactions', label: 'Transactions', icon: 'fa-receipt' },
  { path: '/budget', label: 'Budget', icon: 'fa-chart-pie' },
  { path: '/wallet', label: 'Wallet', icon: 'fa-wallet' },
];

// Mobile-only bottom tab bar. The "Menu" button opens the full sidebar drawer.
const BottomNav = () => {
  const { pathname } = useLocation();
  const isActive = (p) => (p === '/' ? pathname === '/' : pathname.startsWith(p));

  return (
    <nav className="bottom-nav">
      {TABS.map((t) => (
        <Link key={t.path} to={t.path} className={`bn-item ${isActive(t.path) ? 'active' : ''}`}>
          <i className={`fas ${t.icon}`}></i>
          <span>{t.label}</span>
        </Link>
      ))}
      <button className="bn-item" onClick={() => window.dispatchEvent(new Event('finpilot:open-menu'))}>
        <i className="fas fa-bars"></i>
        <span>Menu</span>
      </button>

      <style jsx="true">{`
        .bottom-nav {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 1100;
          background: var(--card-bg); backdrop-filter: blur(20px);
          border-top: 1px solid var(--glass-border);
          padding: 6px 4px calc(6px + env(safe-area-inset-bottom));
          justify-content: space-around; align-items: stretch;
        }
        .bn-item {
          flex: 1; background: none; border: none; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          color: var(--text-secondary); text-decoration: none; font-size: 0.66rem; font-weight: 600;
          padding: 4px 0; border-radius: 10px;
        }
        .bn-item i { font-size: 1.15rem; }
        .bn-item.active { color: var(--accent-primary, #6366f1); }
        @media (max-width: 768px) {
          .bottom-nav { display: flex; }
        }
      `}</style>
    </nav>
  );
};

export default BottomNav;
