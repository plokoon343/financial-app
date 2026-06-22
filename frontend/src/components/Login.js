import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css';

const Login = () => {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 2-step verification state
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  
  const { login, verifyLoginOtp, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const timedOut = new URLSearchParams(window.location.search).get('timeout') === '1';
  const googleClientId = process.env.REACT_APP_GOOGLE_CLIENT_ID;

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.setAttribute('data-theme', 'light');
  }, [darkMode]);

  // Render the Google Identity Services button when a client ID is configured.
  useEffect(() => {
    if (!googleClientId || otpStep) return;
    let iv;
    const tryInit = () => {
      if (!window.google?.accounts?.id) return false;
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (resp) => {
          const result = await loginWithGoogle(resp.credential);
          if (result.success) navigate('/');
          else setError(result.message || 'Google sign-in failed');
        },
      });
      const el = document.getElementById('googleBtn');
      if (el) {
        el.innerHTML = '';
        window.google.accounts.id.renderButton(el, { theme: 'filled_black', size: 'large', width: 300, text: 'continue_with', shape: 'pill' });
      }
      return true;
    };
    if (!tryInit()) {
      iv = setInterval(() => { if (tryInit()) clearInterval(iv); }, 300);
      setTimeout(() => iv && clearInterval(iv), 6000);
    }
    return () => iv && clearInterval(iv);
  }, [googleClientId, otpStep, loginWithGoogle, navigate]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    if (error) setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await login(formData.email, formData.password);
    if (result.success && result.otpRequired) {
      setOtpEmail(result.email);
      setOtpStep(true);
    } else if (result.success) {
      navigate('/');
    } else {
      setError(result.message || 'Login failed');
    }
    setLoading(false);
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (!otp.trim()) { setError('Enter the 6-digit code.'); return; }
    setLoading(true);
    setError('');
    const result = await verifyLoginOtp(otpEmail, otp.trim());
    if (result.success) navigate('/');
    else setError(result.message || 'Verification failed');
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
            <h1>AUTOMONIE</h1>
          </div>
          <p className="login-subtitle">{otpStep ? 'Enter the code we emailed you' : 'Sign in to manage your finances'}</p>
        </div>

        {timedOut && !error && (
          <div className="error-message" style={{ background: 'rgba(59,130,246,0.12)', borderColor: '#3b82f6' }}>
            <i className="fas fa-lock error-icon"></i> You were signed out after a period of inactivity. Please sign in again.
          </div>
        )}

        {error && (
          <div className="error-message">
            <i className="fas fa-triangle-exclamation error-icon"></i> {error}
          </div>
        )}

        {otpStep ? (
          <form onSubmit={handleVerifyOtp} className="login-form">
            <div className="form-group">
              <label htmlFor="otp" className="form-label">Verification code</label>
              <input
                id="otp"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(e) => { setOtp(e.target.value); if (error) setError(''); }}
                required
                placeholder="6-digit code"
                className="form-input"
                disabled={loading}
                autoFocus
              />
              <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #94a3b8)', marginTop: '8px' }}>
                Sent to {otpEmail}. The code expires in 10 minutes.
              </p>
            </div>
            <button type="submit" className={`login-button ${loading ? 'loading' : ''}`} disabled={loading}>
              {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
            <button type="button" className="demo-button" style={{ marginTop: '12px' }} onClick={() => { setOtpStep(false); setOtp(''); setError(''); }}>
              ← Back to login
            </button>
          </form>
        ) : (
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

          {googleClientId && (
            <>
              <div className="login-divider"><span>or</span></div>
              <div id="googleBtn" style={{ display: 'flex', justifyContent: 'center' }}></div>
            </>
          )}
        </form>
        )}

        {!otpStep && (
        <div className="signup-section">
          <p>Don't have an account?</p>
          <Link to="/register" className="signup-link">Create an account</Link>
        </div>
        )}

        <div className="login-footer">
          <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
        </div>
      </div>
    </div>
  );
};

export default Login;
