import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import './Login.css';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_URL}/api/forgot-password`, { email });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Something went wrong. Please try again.');
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
            <i className="fas fa-key logo-icon"></i>
            <h1>Reset Password</h1>
          </div>
          <p className="login-subtitle">Enter your email and we'll send you a reset link</p>
        </div>

        {error && <div className="error-message"><span className="error-icon">⚠️</span> {error}</div>}

        {sent ? (
          <div>
            <div className="error-message" style={{ background: 'rgba(56,161,105,0.12)', color: '#38a169', border: '1px solid #38a169' }}>
              <span className="error-icon">✅</span> If an account with that email exists, a reset link has been sent. It expires in 1 hour.
            </div>
            <div className="signup-section" style={{ marginTop: '1.5rem' }}>
              <Link to="/login" className="signup-link">← Back to login</Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            <div className="form-group">
              <label htmlFor="email" className="form-label">Email Address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="Enter your email"
                className="form-input"
                disabled={loading}
              />
            </div>
            <button type="submit" className={`login-button ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <div className="signup-section" style={{ marginTop: '1.5rem' }}>
              <Link to="/login" className="signup-link">← Back to login</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPassword;
