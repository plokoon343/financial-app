import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

// Mobile-only bottom tab bar with a raised center action (Import / Add).
const BottomNav = () => {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = (p) => (p === '/' ? pathname === '/' : pathname.startsWith(p));

  const Tab = ({ to, icon, label }) => (
    <Link to={to} className={`bn-item ${active(to) ? 'active' : ''}`}>
      <i className={`fas ${icon}`} aria-hidden="true"></i>
      <span className="bn-label">{label}</span>
    </Link>
  );

  return (
    <nav className="bottom-nav">
      <Tab to="/" icon="fa-house" label="Home" />
      <Tab to="/transactions" icon="fa-receipt" label="Money" />

      <button className="bn-fab" onClick={() => navigate('/import-statement')} aria-label="Add or import">
        <i className="fas fa-plus" aria-hidden="true"></i>
      </button>

      <Tab to="/insights" icon="fa-chart-pie" label="Insights" />
      <button className="bn-item" onClick={() => window.dispatchEvent(new Event('finpilot:open-menu'))}>
        <i className="fas fa-bars" aria-hidden="true"></i>
        <span className="bn-label">Menu</span>
      </button>

      <style>{`
        .bottom-nav {
          display: none;
          position: fixed; bottom: 0; left: 0; right: 0; z-index: 1100; height: 64px;
          background: rgba(11,19,38,0.85); backdrop-filter: blur(20px);
          border-top: 1px solid var(--glass-border);
          align-items: center; justify-content: space-around;
          padding-bottom: env(safe-area-inset-bottom);
        }
        @media (max-width: 768px) { .bottom-nav { display: flex; } }
        .bn-item {
          flex: 1; background: none; border: none; cursor: pointer;
          display: flex; flex-direction: column; align-items: center; gap: 2px;
          color: var(--text-secondary); text-decoration: none;
        }
        .bn-item .fas { font-size: 1.4rem; }
        .bn-label { font-size: 0.62rem; font-weight: 600; }
        .bn-item.active { color: var(--accent-primary, #44BC7E); }
        .bn-fab {
          width: 52px; height: 52px; margin-top: -28px; flex-shrink: 0;
          background: var(--gradient-primary); color: #04241a; border: 4px solid #071c1a;
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          cursor: pointer; box-shadow: 0 8px 20px rgba(19, 157, 160,0.45);
        }
        .bn-fab .fas { font-size: 1.7rem; font-weight: 700; }
      `}</style>
    </nav>
  );
};

export default BottomNav;
