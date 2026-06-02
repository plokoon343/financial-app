import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';
const Sidebar = () => {
  const { user, logout, darkMode, toggleDarkMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);

  // Listen for wallet updates from other components
  useEffect(() => {
    const handleWalletUpdate = (e) => {
      setWalletBalance(e.detail.balance);
    };
    window.addEventListener('wallet-updated', handleWalletUpdate);
    return () => window.removeEventListener('wallet-updated', handleWalletUpdate);
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

  // Main navigation items (always visible)
  const mainNavItems = [
    { path: '/', label: 'Dashboard', icon: 'fa-chart-line' },
    { path: '/budget', label: 'Budget', icon: 'fa-chart-pie' },
    { path: '/financial-health', label: 'Financial Health', icon: 'fa-heart-pulse' },
    { path: '/wallet', label: 'Wallet', icon: 'fa-wallet' },
  ];

  // Items that go inside the "More" dropdown
  const moreItems = [
    { path: '/auto-savings', label: 'Auto‑Savings', icon: 'fa-robot' },
  ];

  // Add Admin link only for superadmin
  if (user?.role === 'superadmin') {
    moreItems.push({ path: '/admin', label: 'Admin', icon: 'fa-shield-halved' });
  }

  const toggleSidebar = () => setIsOpen(!isOpen);

  return (
    <>
      <button className="sidebar-hamburger" onClick={toggleSidebar}>
        <i className="fas fa-bars"></i>
      </button>

      {isOpen && <div className="sidebar-overlay" onClick={toggleSidebar}></div>}

      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <Link to="/" className="sidebar-logo" onClick={toggleSidebar}>
            <i className="fas fa-chart-simple"></i>
            <span>FINPILOT</span>
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
          <i className="fas fa-wallet"></i>
          <span>₦{walletBalance.toLocaleString()}</span>
        </div>

        <nav className="sidebar-nav">
          {/* Main navigation items */}
          {mainNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`sidebar-link ${location.pathname === item.path ? 'active' : ''}`}
              onClick={toggleSidebar}
            >
              <i className={`fas ${item.icon}`}></i>
              <span>{item.label}</span>
            </Link>
          ))}

          {/* Dropdown "More" section */}
          <div className="sidebar-dropdown">
            <button
              className="sidebar-dropdown-btn"
              onClick={() => setIsMoreOpen(!isMoreOpen)}
            >
              <i className="fas fa-ellipsis-h"></i>
              <span>More</span>
              <i className={`fas fa-chevron-${isMoreOpen ? 'up' : 'down'} dropdown-arrow`}></i>
            </button>
            <div className={`sidebar-dropdown-content ${isMoreOpen ? 'open' : ''}`}>
              {moreItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`sidebar-link ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => {
                    setIsMoreOpen(false);
                    toggleSidebar();
                  }}
                >
                  <i className={`fas ${item.icon}`}></i>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </nav>

        {/* Footer with theme toggle and logout */}
        <div className="sidebar-footer">
          <div className="sidebar-actions">
            <button className="sidebar-dark-toggle" onClick={toggleDarkMode}>
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>
            <button className="sidebar-logout" onClick={handleLogout}>
              <i className="fas fa-sign-out-alt"></i>
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;