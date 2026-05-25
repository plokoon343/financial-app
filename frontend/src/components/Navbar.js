import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
//import { API_URL } from '../config';
const Navbar = () => {
  const { user, logout, darkMode, toggleDarkMode } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  let navItems = [
    { path: '/', label: 'Dashboard', icon: 'fa-chart-line' },
    { path: '/budget', label: 'Budget', icon: 'fa-chart-pie' },
    { path: '/financial-health', label: 'Financial Health', icon: 'fa-heart-pulse' },
    { path: '/currency-converter', label: 'Currency Converter', icon: 'fa-money-bill-transfer' }
  ];

  if (user?.role === 'superadmin') {
    navItems.push({ path: '/admin', label: 'Admin', icon: 'fa-shield-halved' });
  }

  return (
    <>
      <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
        <div className="navbar-content">
          <Link to="/" className="navbar-brand">
            <div className="brand-logo">
              <i className="fas fa-chart-simple logo-icon"></i>   {/* Changed from fa-chart-pie to fa-chart-simple */}
              <span className="logo-text">FINPILOT</span>
            </div>
          </Link>

          <ul className={`navbar-nav ${isMenuOpen ? 'active' : ''}`}>
            {navItems.map((item) => (
              <li key={item.path}>
                <Link
                  to={item.path}
                  className={`nav-link ${location.pathname === item.path ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  <i className={`fas ${item.icon} nav-icon`}></i>
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>

          <div className="navbar-controls">
            <div className="user-menu">
              <div className="user-avatar">
                {user?.name?.charAt(0).toUpperCase() || <i className="fas fa-user"></i>}
              </div>
              <div className="user-info">
                <span className="user-greeting">Hello,</span>
                <span className="user-name">{user?.name?.split(' ')[0] || 'User'}</span>
              </div>
            </div>

            <button onClick={handleLogout} className="logout-btn">
              <i className="fas fa-sign-out-alt logout-icon"></i>
              <span>Logout</span>
            </button>

            <button
              className="theme-toggle"
              onClick={toggleDarkMode}
              aria-label="Toggle dark mode"
            >
              <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
            </button>

            <button
              className="mobile-menu-toggle"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              aria-label="Toggle menu"
            >
              <i className={`fas ${isMenuOpen ? 'fa-times' : 'fa-bars'}`}></i>
            </button>
          </div>
        </div>
      </nav>

      {isMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setIsMenuOpen(false)}></div>
      )}
    </>
  );
};

export default Navbar;