import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import './Login.css'; // reuse same CSS for consistency
//import { API_URL } from '../config';
// Theme configuration
// const theme = {
//   light: {
//     bg: 'linear-gradient(135deg, #f5f7fa 0%, #e4edf5 100%)',
//     cardBg: 'white',
//     text: '#1a365d',
//     textSecondary: '#2d3748',
//     inputBg: '#f8fafc',
//     inputBorder: '#e2e8f0',
//     inputText: '#2d3748',
//     shadow: '0 10px 30px rgba(0, 82, 204, 0.08), 0 1px 3px rgba(0, 0, 0, 0.05)',
//     errorBg: '#fed7d7',
//     errorBorder: '#e53e3e',
//     errorText: '#9b2c2c',
//     successBg: '#c6f6d5',
//     successBorder: '#38a169',
//     successText: '#276749',
//     buttonBg: 'linear-gradient(135deg, #3182ce 0%, #2b6cb0 100%)',
//     buttonHoverBg: 'linear-gradient(135deg, #2b6cb0 0%, #2c5282 100%)',
//     link: '#3182ce',
//     linkHover: '#2c5282',
//   },
//   dark: {
//     bg: 'linear-gradient(135deg, #1a202c 0%, #2d3748 100%)',
//     cardBg: '#2d3748',
//     text: '#f7fafc',
//     textSecondary: '#e2e8f0',
//     inputBg: '#4a5568',
//     inputBorder: '#718096',
//     inputText: '#f7fafc',
//     shadow: '0 10px 30px rgba(0, 0, 0, 0.3), 0 1px 3px rgba(0, 0, 0, 0.2)',
//     errorBg: '#742a2a',
//     errorBorder: '#e53e3e',
//     errorText: '#fed7d7',
//     successBg: '#22543d',
//     successBorder: '#38a169',
//     successText: '#c6f6d5',
//     buttonBg: 'linear-gradient(135deg, #2c5282 0%, #2d3748 100%)',
//     buttonHoverBg: 'linear-gradient(135deg, #2d3748 0%, #1a202c 100%)',
//     link: '#63b3ed',
//     linkHover: '#90cdf4',
//   }
// };

// Textbox states for better visual feedback
// const textboxStates = {
//   normal: {
//     border: '2px solid',
//     borderRadius: '10px',
//     transition: 'all 0.25s ease',
//   },
//   focus: {
//     boxShadow: '0 0 0 3px rgba(66, 153, 225, 0.3)',
//     borderColor: '#4299e1',
//   },
//   error: {
//     borderColor: '#e53e3e',
//     backgroundColor: 'rgba(254, 215, 215, 0.1)',
//   },
//   valid: {
//     borderColor: '#38a169',
//     backgroundColor: 'rgba(198, 246, 213, 0.1)',
//   }
// };

const Register = () => {
  const [formData, setFormData] = useState({
    name: '', email: '', phone: '', password: '', confirmPassword: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const { register } = useAuth();
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
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (formData.phone.replace(/\D/g, '').length < 7) {
      setError('Enter a valid phone number');
      return;
    }
    setLoading(true);
    setError('');
    const result = await register(formData.name, formData.email, formData.password, formData.phone);
    if (result.success) navigate('/');
    else setError(result.message);
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
            <i className="fas fa-chart-simple logo-icon"></i>
            <h1>AUTOMONIE</h1>
          </div>
          <p className="login-subtitle">Create your account</p>
        </div>

        {error && (
          <div className="error-message">
            <i className="fas fa-triangle-exclamation error-icon"></i> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="name" className="form-label">Full Name</label>
            <input
              id="name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              placeholder="Enter your full name"
              className="form-input"
              disabled={loading}
            />
          </div>

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
            <label htmlFor="phone" className="form-label">Phone Number</label>
            <input
              id="phone"
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              placeholder="e.g. 0801 234 5678"
              className="form-input"
              disabled={loading}
            />
          </div>

          <div className="form-group">
            <label htmlFor="password" className="form-label">Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={formData.password}
                onChange={handleChange}
                required
                placeholder="At least 6 characters"
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

          <div className="form-group">
            <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
            <div style={{ position: 'relative' }}>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? "text" : "password"}
                name="confirmPassword"
                value={formData.confirmPassword}
                onChange={handleChange}
                required
                placeholder="Confirm your password"
                className="form-input"
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              >
                {showConfirmPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Creating Account...' : 'Sign Up'}
          </button>
        </form>

        <div className="signup-section" style={{ marginTop: '1.5rem', borderTop: 'none' }}>
          <p>Already have an account?</p>
          <Link to="/login" className="signup-link">Login</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;