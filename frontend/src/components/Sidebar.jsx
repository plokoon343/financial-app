import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';
import { LogoFull } from './Logo';
import { useServerFeatures } from '../lib/useServerFeatures';
const Sidebar = () => {
  const { user, logout, darkMode, toggleDarkMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const live = useServerFeatures();
  const [actionCount, setActionCount] = useState(0);

  // Action Center badge: refreshed on navigation and whenever an action resolves.
  useEffect(() => {
    const refresh = () => axios.get(`${API_URL}/api/action-center?summary=1`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => setActionCount(r.data.total || 0)).catch(() => {});
    refresh();
    window.addEventListener('automonie:actions-changed', refresh);
    return () => window.removeEventListener('automonie:actions-changed', refresh);
  }, [location.pathname]);

  // Open the drawer when the mobile bottom-nav "Menu" button is tapped
  useEffect(() => {
    const openMenu = () => setIsOpen(true);
    window.addEventListener('finpilot:open-menu', openMenu);
    return () => window.removeEventListener('finpilot:open-menu', openMenu);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Grouped navigation: the five intents (web parity with the mobile 5-tab nav:
  // Home / Money / Grow / Insights / You). Tools that will later fold into a hub as
  // tabs (Smart Categorise, Track Cash, the Insights analyses, the account/alert
  // pages) are grouped under their destination now so the sidebar already reads that
  // way. Shared Expenses is hidden for now (under review); Quick Log was removed.
  const navGroups = [
    { title: 'Home', items: [
      { path: '/', label: 'Dashboard', icon: 'fa-house' },
      { path: '/actions', label: 'Action Center', icon: 'fa-list-check', count: actionCount },
      ...(live.assistant ? [{ path: '/assistant', label: 'Ask Automonie', icon: 'fa-comments' }] : []),
    ]},
    { title: 'Money', items: [
      { path: '/transactions', label: 'Transactions', icon: 'fa-receipt' },
      { path: '/subscriptions', label: 'Subscriptions', icon: 'fa-repeat' },
    ]},
    { title: 'Grow', items: [
      { path: '/goals', label: 'Goals', icon: 'fa-bullseye' },
      { path: '/budget', label: 'Budget', icon: 'fa-wallet' },
      { path: '/bills', label: 'Bills', icon: 'fa-file-invoice' },
    ]},
    { title: 'Insights', items: [
      { path: '/insights', label: 'Insights', icon: 'fa-chart-pie' },
      { path: '/recap', label: 'Recaps', icon: 'fa-film' },
      // Money Wrapped is a year-in-review: only surface it in December.
      ...(new Date().getMonth() === 11 ? [{ path: '/wrapped', label: 'Money Wrapped', icon: 'fa-champagne-glasses' }] : []),
    ]},
    { title: 'You', items: [
      { path: '/accounts', label: 'Accounts & alerts', icon: 'fa-building-columns' },
      { path: '/settings', label: 'Settings', icon: 'fa-gear' },
      { path: '/support', label: 'Support & FAQ', icon: 'fa-circle-question' },
      ...((user?.role === 'superadmin' || user?.newsletterEditor) ? [{ path: '/newsletter', label: 'Newsletter', icon: 'fa-bullhorn' }] : []),
      ...(user?.role === 'superadmin' ? [{ path: '/admin', label: 'Admin', icon: 'fa-shield-halved' }] : []),
    ]},
  ];

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <>
      <button className="sidebar-hamburger" onClick={toggleSidebar}>
        <i className="fas fa-bars" aria-hidden="true"></i>
      </button>

      {isOpen && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo" onClick={toggleSidebar}>
            <LogoFull height={26} />
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
                  <i className={`fas ${item.icon}`} aria-hidden="true"></i>
                  <span>{item.label}</span>
                  {item.key && <span className="sidebar-key-badge">New</span>}
                  {item.count > 0 && <span className="sidebar-key-badge" aria-label={`${item.count} to review`}>{item.count}</span>}
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
            <i className="fas fa-circle-question" aria-hidden="true"></i>
            <span>Take a tour</span>
          </button>
          <div className="sidebar-actions">
            <button className="sidebar-dark-toggle" onClick={toggleDarkMode}>
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`} aria-hidden="true"></i>
            </button>
            <button className="sidebar-logout" onClick={handleLogout}>
              <i className="fas fa-right-from-bracket" aria-hidden="true"></i>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;