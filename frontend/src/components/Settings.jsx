import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import { tipsEnabled, setTipsEnabled, resetTips } from '../utils/tips';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const Settings = () => {
  const { darkMode, toggleDarkMode, logout } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState(null);

  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [tipsOn, setTipsOn] = useState(tipsEnabled());

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/me`, authHeader());
        setEmailAlerts(res.data.emailAlerts !== false);
      } catch { /* non-fatal */ }
    })();
  }, []);

  const changePassword = async () => {
    if (pw.next.length < 6) return flash('New password must be at least 6 characters', 'error');
    if (pw.next !== pw.confirm) return flash('New passwords do not match', 'error');
    setSavingPw(true);
    try {
      await axios.post(`${API_URL}/api/change-password`, { currentPassword: pw.current, newPassword: pw.next }, authHeader());
      setPw({ current: '', next: '', confirm: '' });
      flash('Password changed successfully!');
    } catch (err) {
      flash(err.response?.data?.message || 'Failed to change password', 'error');
    } finally { setSavingPw(false); }
  };

  const saveEmailAlerts = async (val) => {
    setEmailAlerts(val);
    try { await axios.put(`${API_URL}/api/me`, { emailAlerts: val }, authHeader()); }
    catch { flash('Could not save preference', 'error'); }
  };

  const toggleTips = () => {
    const next = !tipsOn;
    setTipsOn(next); setTipsEnabled(next);
    if (next) resetTips();
  };

  const doLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="settings-page">
      <div className="section-header">
        <h2><i className="fas fa-gear"></i> Settings</h2>
        <p>Manage your account, appearance and notifications</p>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {/* Account / security */}
      <div className="settings-card">
        <h3><i className="fas fa-lock"></i> Account &amp; Security</h3>
        <div className="form-group">
          <label>Current Password</label>
          <input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder="At least 6 characters" />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} />
          </div>
        </div>
        <button className="btn-primary" onClick={changePassword} disabled={savingPw || !pw.current || !pw.next}>
          {savingPw ? 'Updating…' : 'Update Password'}
        </button>
      </div>

      {/* Appearance */}
      <div className="settings-card">
        <h3><i className="fas fa-palette"></i> Appearance</h3>
        <div className="toggle-row">
          <div>
            <strong>Dark mode</strong>
            <span className="hint">Use a darker theme across the app.</span>
          </div>
          <button className={`switch ${darkMode ? 'on' : ''}`} onClick={toggleDarkMode} aria-label="Toggle dark mode"><span /></button>
        </div>
      </div>

      {/* Notifications */}
      <div className="settings-card">
        <h3><i className="fas fa-bell"></i> Notifications</h3>
        <div className="toggle-row">
          <div>
            <strong>Email alerts</strong>
            <span className="hint">Receive important updates by email.</span>
          </div>
          <button className={`switch ${emailAlerts ? 'on' : ''}`} onClick={() => saveEmailAlerts(!emailAlerts)} aria-label="Toggle email alerts"><span /></button>
        </div>
        <div className="toggle-row">
          <div>
            <strong>In-app alerts</strong>
            <span className="hint">Ticket updates &amp; more appear in the bell. Always on.</span>
          </div>
          <button className="switch on" disabled aria-label="In-app alerts always on"><span /></button>
        </div>
      </div>

      {/* Help / tips */}
      <div className="settings-card">
        <h3><i className="fas fa-circle-question"></i> Help</h3>
        <div className="toggle-row">
          <div>
            <strong>Show feature tips</strong>
            <span className="hint">First-time hints as you use each feature.</span>
          </div>
          <button className={`switch ${tipsOn ? 'on' : ''}`} onClick={toggleTips} aria-label="Toggle tips"><span /></button>
        </div>
        <button className="btn-secondary" onClick={() => window.dispatchEvent(new Event('finpilot:start-tour'))}>
          <i className="fas fa-route"></i> Replay the app tour
        </button>
      </div>

      {/* Session */}
      <div className="settings-card">
        <h3><i className="fas fa-right-from-bracket"></i> Session</h3>
        <button className="btn-danger" onClick={doLogout}>Log out</button>
      </div>

      <style jsx="true">{`
        .settings-page { max-width: 700px; margin: 0 auto; padding: 16px; }
        .settings-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; }
        .settings-card h3 { margin: 0 0 16px; font-size: 1rem; display: flex; align-items: center; gap: 8px; }
        .form-group { margin-bottom: 14px; }
        .form-row { display: flex; gap: 14px; }
        .form-row .form-group { flex: 1; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 0.88rem; }
        .form-group input { width: 100%; padding: 11px 12px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); }
        .toggle-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--glass-border); }
        .toggle-row:last-of-type { border-bottom: none; }
        .toggle-row strong { display: block; font-size: 0.9rem; }
        .toggle-row .hint { font-size: 0.78rem; color: var(--text-secondary); }
        .switch { width: 46px; height: 26px; border-radius: 14px; border: none; background: var(--border-color, #cbd5e0); position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.2s; }
        .switch.on { background: var(--accent-primary, #6366f1); }
        .switch span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.2s; }
        .switch.on span { left: 23px; }
        .switch:disabled { opacity: 0.7; cursor: not-allowed; }
        .btn-primary { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 11px 18px; font-weight: 600; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-secondary { margin-top: 14px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); border-radius: var(--radius-md); padding: 10px 16px; font-weight: 600; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
        .btn-danger { background: rgba(229,62,62,0.12); color: #e53e3e; border: 1px solid rgba(229,62,62,0.3); border-radius: var(--radius-md); padding: 11px 18px; font-weight: 600; cursor: pointer; }
        .message { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.12); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.12); color: #e53e3e; }
      `}</style>
    </div>
  );
};

export default Settings;
