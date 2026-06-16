import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

const Login = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.setAttribute('data-theme', 'light');
  }, [darkMode]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await login(formData.email, formData.password);
    if (result.success) navigate('/');
    else setError(result.message || 'Login failed');
    setLoading(false);
  };

  const toggleDarkMode = () => setDarkMode(!darkMode);

  return (
    <div className={`login-container ${darkMode ? 'dark' : 'light'}`}>
      {/* Theme Toggle with FontAwesome icons */}
      <button className="theme-toggle" onClick={toggleDarkMode}>
        <i className={`fas ${darkMode ? 'fa-sun' : 'fa-moon'}`}></i>
      </button>

      <div className="login-card">
        <div className="login-header">
          <div className="logo">
            <i className="fas fa-chart-simple logo-icon"></i>  {/* Favicon-style icon */}
            <h1>FINPILOT</h1>
          </div>
          <p className="login-subtitle">Sign in to manage your finances</p>
        </div>

        {error && (
          <div className="error-message">
            <span className="error-icon">⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="email" className="form-label">Email Address</label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              required
              placeholder="Enter your email"
              className="form-input"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <div className="password-label-container">
              <label htmlFor="password" className="form-label">Password</label>
              <Link to="/forgot-password" className="forgot-password">Forgot password?</Link>
            </div>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="Enter your password"
                className="form-input"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className={`login-button ${loading ? 'loading' : ''}`} disabled={loading}>
            {loading ? <>Signing In...</> : 'Sign In'}
          </button>
        </form>

        <div className="signup-section">
          <p>Don't have an account?</p>
          <Link to="/register" className="signup-link">Create an account</Link>
        </div>

        <div className="login-footer">
          <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
