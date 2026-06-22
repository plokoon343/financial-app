import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import './Login.css';

const ResetPassword = () => {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) return setError('Password must be at least 6 characters');
    if (password !== confirm) return setError('Passwords do not match');
    setLoading(true);
    try {
      await axios.post(`${API_URL}/api/reset-password`, { token, password });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not reset password. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`login-container ${darkMode ? 'dark' : 'light'}`}>
      <button className="theme-toggle" onClick={() => setDarkMode(!darkMode)}>
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="login-card">
        <div className="login-header">
          <div className="logo">
            <i className="fas fa-lock logo-icon"></i>
            <h1>New Password</h1>
          </div>
          <p className="login-subtitle">Choose a new password for your account</p>
        </div>

        {error && <div className="error-message"><i className="fas fa-triangle-exclamation error-icon"></i> {error}</div>}

        {!token ? (
          <div className="error-message"><i className="fas fa-triangle-exclamation error-icon"></i> Missing reset token. Please use the link from your email.</div>
        ) : done ? (
          <div className="error-message" style={{ background: 'rgba(56,161,105,0.12)', color: '#38a169', border: '1px solid #38a169' }}>
            <i className="fas fa-circle-check error-icon"></i> Password updated! Redirecting to login…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="password" className="form-label">New Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="At least 6 characters"
                className="form-input"
                disabled={loading}
              />
            </div>
            <div className="form-group">
              <label htmlFor="confirm" className="form-label">Confirm Password</label>
              <input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                placeholder="Re-enter your password"
                className="form-input"
                disabled={loading}
              />
            </div>
            <button type="submit" className={`login-button ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        )}

        <div className="signup-section" style={{ marginTop: '1.5rem' }}>
          <Link to="/login" className="signup-link">← Back to login</Link>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
