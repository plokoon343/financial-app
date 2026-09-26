import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import { LogoFull } from './Logo';
import { HIDDEN_PATHS } from '../config/features';
const Sidebar = () => {
  const { user, logout, darkMode, toggleDarkMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  // Listen for wallet updates from other components
  useEffect(() => {
    const handleWalletUpdate = (e) => {
      setWalletBalance(e.detail.balance);
    };
    window.addEventListener('wallet-updated', handleWalletUpdate);
    return () => window.removeEventListener('wallet-updated', handleWalletUpdate);
  }, []);

  // Open the drawer when the mobile bottom-nav "Menu" button is tapped
  useEffect(() => {
    const openMenu = () => setIsOpen(true);
    window.addEventListener('finpilot:open-menu', openMenu);
    return () => window.removeEventListener('finpilot:open-menu', openMenu);
  }, []);

  // Fetch wallet balance on first mount
  useEffect(() => {
    const fetchWallet = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_URL}/api/wallet`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setWalletBalance(res.data.balance);
      } catch (err) {
        console.error('Failed to load wallet:', err);
      }
    };
    fetchWallet();
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Grouped navigation — the five intents (web parity with the mobile 5-tab nav:
  // Home / Money / Grow / Insights / You). Tools that will later fold into a hub as
  // tabs (Smart Categorise, Track Cash, the Insights analyses, the account/alert
  // pages) are grouped under their destination now so the sidebar already reads that
  // way. Shared Expenses is hidden for now (under review); Quick Log was removed.
  const navGroups = [
    { title: 'Home', items: [
      { path: '/', label: 'Dashboard', icon: 'dashboard' },
      { path: '/assistant', label: 'AI Assistant', icon: 'smart_toy' },
    ]},
    { title: 'Money', items: [
      { path: '/transactions', label: 'Transactions', icon: 'receipt_long' },
      { path: '/people', label: 'People & Family', icon: 'diversity_3' },
      { path: '/subscriptions', label: 'Subscriptions', icon: 'subscriptions' },
      { path: '/cash', label: 'Track Cash', icon: 'payments' },
      { path: '/smart-categorize', label: 'Smart Categorise', icon: 'sell' },
    ]},
    { title: 'Grow', items: [
      { path: '/goals', label: 'Goals', icon: 'track_changes' },
      { path: '/budget', label: 'Budget', icon: 'account_balance_wallet' },
      { path: '/bills', label: 'Bills', icon: 'receipt' },
      { path: '/pay-bills', label: 'Pay Bills', icon: 'bolt' },
      { path: '/auto-savings', label: 'Auto‑Savings', icon: 'savings' },
      { path: '/debt', label: 'Debt', icon: 'credit_card' },
      { path: '/wallet', label: 'Wallet', icon: 'wallet' },
    ]},
    { title: 'Insights', items: [
      { path: '/insights', label: 'Insights', icon: 'pie_chart' },
      { path: '/financial-health', label: 'Financial Health', icon: 'health_and_safety' },
      { path: '/cashflow', label: 'Cashflow', icon: 'monitoring' },
      { path: '/networth', label: 'Net Worth', icon: 'show_chart' },
      { path: '/recap', label: 'Recaps', icon: 'movie' },
      // Money Wrapped is a year-in-review — only surface it in December.
      ...(new Date().getMonth() === 11 ? [{ path: '/wrapped', label: 'Money Wrapped', icon: 'celebration' }] : []),
    ]},
    { title: 'You', items: [
      { path: '/accounts', label: 'Accounts & alerts', icon: 'account_balance' },
      { path: '/settings', label: 'Settings', icon: 'settings' },
      { path: '/support', label: 'Support & FAQ', icon: 'help' },
      ...((user?.role === 'superadmin' || user?.newsletterEditor) ? [{ path: '/newsletter', label: 'Newsletter', icon: 'campaign' }] : []),
      ...(user?.role === 'superadmin' ? [{ path: '/admin', label: 'Admin', icon: 'shield' }] : []),
    ]},
  ]
    // Drop nav entries for features hidden in V1 (still routable, just not shown).
    .map((g) => ({ ...g, items: g.items.filter((it) => !HIDDEN_PATHS.has(it.path)) }))
    .filter((g) => g.items.length > 0);

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <>
      <button className="sidebar-hamburger" onClick={toggleSidebar}>
        <span className="material-symbols-outlined">menu</span>
      </button>

      {isOpen && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo" onClick={toggleSidebar}>
            <LogoFull height={26} variant="light" />
          </Link>
        </div>

        {/* User info */}
        <Link to="/profile" className="sidebar-user-link" onClick={toggleSidebar}>
  <div className="sidebar-user">
    <div className="sidebar-avatar">
      {user?.name?.charAt(0).toUpperCase() || <i className="fas fa-user"></i>}
    </div>
    <div className="sidebar-user-info">
      <span className="sidebar-greeting">Hello,</span>
      <span className="sidebar-name">{user?.name?.split(' ')[0] || 'User'}</span>
    </div>
  </div>
</Link>

        {/* Wallet balance */}
        <div className="sidebar-wallet">
          <span className="material-symbols-outlined">account_balance_wallet</span>
          <span>{fmtNaira(walletBalance)}</span>
          <Link
            to="/wallet?action=deposit"
            className="sidebar-wallet-add"
            title="Deposit to wallet"
            onClick={toggleSidebar}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', color: 'var(--accent-primary)' }}
          >
            <span className="material-symbols-outlined">add_circle</span>
          </Link>
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.title} className="sidebar-group">
              <div className="sidebar-group-title">{group.title}</div>
              {group.items.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`sidebar-link ${location.pathname === item.path ? 'active' : ''} ${item.key ? 'sidebar-key' : ''}`}
                  onClick={toggleSidebar}
                >
                  <span className="material-symbols-outlined">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.key && <span className="sidebar-key-badge">New</span>}
                </Link>
              ))}
            </div>
          ))}
        </nav>

        {/* Footer with theme toggle and logout */}
        <div className="sidebar-footer">
          <button
            className="sidebar-link"
            style={{ width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', marginBottom: '0.5rem' }}
            onClick={() => { window.dispatchEvent(new Event('finpilot:start-tour')); setIsOpen(false); }}
          >
            <span className="material-symbols-outlined">help</span>
            <span>Take a tour</span>
          </button>
          <div className="sidebar-actions">
            <button className="sidebar-dark-toggle" onClick={toggleDarkMode}>
              <span className="material-symbols-outlined">{darkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
            <button className="sidebar-logout" onClick={handleLogout}>
              <span className="material-symbols-outlined">logout</span>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;