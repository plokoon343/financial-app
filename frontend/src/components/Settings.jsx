import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import { tipsEnabled, setTipsEnabled, resetTips } from '../utils/tips';
import BetaCard from './BetaCard';
import { fmtNaira } from '../utils/format';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const Settings = () => {
  const { user, updateUser, darkMode, toggleDarkMode, logout } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState(null);
  const flash = (text, type = 'success') => { setMessage({ text, type }); window.scrollTo({ top: 0, behavior: 'smooth' }); setTimeout(() => setMessage(null), 3500); };

  // account
  const [email, setEmail] = useState(user?.email || '');
  const [lastLogin, setLastLogin] = useState(null);
  const [emailForm, setEmailForm] = useState({ password: '', newEmail: '' });
  const [savingEmail, setSavingEmail] = useState(false);

  // security
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);

  // notifications + prefs
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [tipsOn, setTipsOn] = useState(tipsEnabled());
  const [trainingOptOut, setTrainingOptOut] = useState(false);

  // delete
  const [delPw, setDelPw] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/me`, authHeader());
        setEmail(res.data.email || '');
        setEmailAlerts(res.data.emailAlerts !== false);
        setLastLogin(res.data.lastLogin || null);
        setTrainingOptOut(!!res.data.trainingOptOut);
      } catch { /* non-fatal */ }
    })();
  }, []);

  // ── handlers ──
  const changePassword = async () => {
    if (pw.next.length < 8) return flash('New password must be at least 8 characters', 'error');
    if (pw.next !== pw.confirm) return flash('New passwords do not match', 'error');
    setSavingPw(true);
    try {
      await axios.post(`${API_URL}/api/change-password`, { currentPassword: pw.current, newPassword: pw.next }, authHeader());
      setPw({ current: '', next: '', confirm: '' });
      flash('Password changed. Other devices have been signed out.');
    } catch (err) { flash(err.response?.data?.message || 'Failed to change password', 'error'); }
    finally { setSavingPw(false); }
  };

  const changeEmail = async () => {
    setSavingEmail(true);
    try {
      const res = await axios.post(`${API_URL}/api/change-email`, { password: emailForm.password, newEmail: emailForm.newEmail }, authHeader());
      setEmail(res.data.email);
      updateUser({ email: res.data.email });
      setEmailForm({ password: '', newEmail: '' });
      flash('Email updated.');
    } catch (err) { flash(err.response?.data?.message || 'Failed to change email', 'error'); }
    finally { setSavingEmail(false); }
  };

  const logoutAll = async () => {
    if (!window.confirm('Log out of all devices? You will need to sign in again.')) return;
    try { await axios.post(`${API_URL}/api/logout-all`, {}, authHeader()); } catch { /* best effort */ }
    logout(); navigate('/login');
  };

  const exportData = async () => {
    try {
      const [{ data }, { jsPDF }, { default: autoTable }] = await Promise.all([
        axios.get(`${API_URL}/api/me/export`, authHeader()),
        import('jspdf'),
        import('jspdf-autotable'),
      ]);
      const doc = new jsPDF();
      const date = (d) => (d ? new Date(d).toLocaleDateString('en-NG') : '');
      let y = 16;

      // Header
      doc.setFontSize(18); doc.setTextColor('#0B0E11');
      doc.text('Automonie - Data Export', 14, y); y += 7;
      doc.setFontSize(10); doc.setTextColor('#64748b');
      doc.text(`Generated ${new Date().toLocaleString('en-NG')}`, 14, y); y += 8;

      // Profile
      const p = data.profile || {};
      autoTable(doc, {
        startY: y,
        head: [['Profile', '']],
        body: [
          ['Name', p.name || ''],
          ['Email', p.email || ''],
          ['Phone', p.phone || ''],
          ['Monthly income', p.monthlyIncome ? fmtNaira(p.monthlyIncome) : '-'],
          ['Primary goal', p.primaryGoal || '-'],
        ],
        theme: 'striped', headStyles: { fillColor: [19, 157, 160] }, styles: { fontSize: 9 },
      });

      const section = (title, head, rows) => {
        if (!rows || rows.length === 0) return;
        autoTable(doc, {
          startY: doc.lastAutoTable.finalY + 8,
          head: [[`${title} (${rows.length})`, ...Array(head.length - 1).fill('')]],
          theme: 'plain', styles: { fontSize: 11, fontStyle: 'bold', textColor: [19, 157, 160] },
        });
        autoTable(doc, {
          startY: doc.lastAutoTable.finalY + 1,
          head: [head],
          body: rows,
          theme: 'striped', headStyles: { fillColor: [30, 41, 59] }, styles: { fontSize: 8, cellPadding: 2 },
        });
      };

      section('Transactions', ['Date', 'Description', 'Category', 'Type', 'Amount'],
        (data.transactions || []).map((t) => [date(t.date), (t.description || '').slice(0, 40), t.category || '', t.type || '', fmtNaira(t.amount)]));
      section('Budgets', ['Category', 'Month', 'Amount'],
        (data.budgets || []).map((b) => [b.category, b.month, fmtNaira(b.amount)]));
      section('Goals', ['Name', 'Saved', 'Target', 'Deadline'],
        (data.goals || []).map((g) => [g.name, fmtNaira(g.current), fmtNaira(g.target), date(g.deadline)]));
      section('Subscriptions', ['Name', 'Cost', 'Frequency', 'Status'],
        (data.subscriptions || []).map((s) => [s.name, fmtNaira(s.cost), s.frequency, s.status]));
      section('Recurring bills', ['Name', 'Amount', 'Due day', 'Frequency'],
        (data.bills || []).map((b) => [b.name, fmtNaira(b.amount), b.dueDate, b.frequency]));

      doc.save(`automonie-data-${new Date().toISOString().slice(0, 10)}.pdf`);
      flash('Your data has been downloaded as a PDF.');
    } catch (e) {
      flash('Could not export data', 'error');
    }
  };

  const deleteAccount = async () => {
    if (!delPw) return flash('Enter your password to confirm', 'error');
    if (!window.confirm('This permanently deletes your account and ALL your data. This cannot be undone. Continue?')) return;
    setDeleting(true);
    try {
      await axios.delete(`${API_URL}/api/me`, { ...authHeader(), data: { password: delPw } });
      logout(); navigate('/login');
    } catch (err) { flash(err.response?.data?.message || 'Failed to delete account', 'error'); setDeleting(false); }
  };

  const saveEmailAlerts = async (val) => {
    setEmailAlerts(val);
    try { await axios.put(`${API_URL}/api/me`, { emailAlerts: val }, authHeader()); } catch { flash('Could not save preference', 'error'); }
  };
  const saveTrainingOptOut = async (val) => {
    setTrainingOptOut(val);
    try { await axios.post(`${API_URL}/api/me/training-optout`, { optOut: val }, authHeader()); } catch { setTrainingOptOut(!val); flash('Could not save preference', 'error'); }
  };
  const toggleTips = () => { const n = !tipsOn; setTipsOn(n); setTipsEnabled(n); if (n) resetTips(); };

  const Toggle = ({ on, onClick, disabled }) => (
    <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled}><span /></button>
  );

  return (
    <div className="settings-page">
      <div className="section-header">
        <h2><i className="fas fa-gear"></i> Settings</h2>
        <p>Manage your account, security and preferences</p>
      </div>
      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {/* Account */}
      <div className="settings-card">
        <h3><i className="fas fa-user"></i> Account</h3>
        <div className="kv"><span>Signed in as</span><strong>{email}</strong></div>
        <div className="divider" />
        <p className="sub">Change email</p>
        <div className="form-row">
          <div className="form-group"><label>New email</label>
            <input type="email" value={emailForm.newEmail} onChange={e => setEmailForm({ ...emailForm, newEmail: e.target.value })} placeholder="new@email.com" /></div>
          <div className="form-group"><label>Current password</label>
            <input type="password" value={emailForm.password} onChange={e => setEmailForm({ ...emailForm, password: e.target.value })} /></div>
        </div>
        <button className="btn-primary" onClick={changeEmail} disabled={savingEmail || !emailForm.newEmail || !emailForm.password}>{savingEmail ? 'Saving…' : 'Update Email'}</button>
      </div>

      {/* Security */}
      <div className="settings-card">
        <h3><i className="fas fa-shield-halved"></i> Security</h3>
        <p className="sub">Change password</p>
        <div className="form-group"><label>Current Password</label>
          <input type="password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} /></div>
        <div className="form-row">
          <div className="form-group"><label>New Password</label>
            <input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></div>
          <div className="form-group"><label>Confirm</label>
            <input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></div>
        </div>
        <button className="btn-primary" onClick={changePassword} disabled={savingPw || !pw.current || !pw.next}>{savingPw ? 'Updating…' : 'Update Password'}</button>
        <div className="divider" />
        <div className="row-between">
          <div>
            <strong>Active sessions</strong>
            <span className="hint">Last login: {lastLogin ? new Date(lastLogin).toLocaleString() : '-'}</span>
          </div>
          <button className="btn-secondary" onClick={logoutAll}>Log out all devices</button>
        </div>
      </div>

      {/* Notifications */}
      <div className="settings-card">
        <h3><i className="fas fa-bell"></i> Notifications</h3>
        <div className="row-between"><div><strong>Email alerts</strong><span className="hint">Important updates by email.</span></div><Toggle on={emailAlerts} onClick={() => saveEmailAlerts(!emailAlerts)} /></div>
        <div className="row-between"><div><strong>In-app alerts</strong><span className="hint">Ticket updates &amp; more in the bell. Always on.</span></div><Toggle on disabled /></div>
      </div>

      {/* Beta program + feedback */}
      <BetaCard />

      {/* Appearance + prefs */}
      <div className="settings-card">
        <h3><i className="fas fa-palette"></i> Appearance &amp; Help</h3>
        <div className="row-between"><div><strong>Dark mode</strong><span className="hint">Use the darker theme.</span></div><Toggle on={darkMode} onClick={toggleDarkMode} /></div>
        <div className="row-between"><div><strong>Feature tips</strong><span className="hint">First-time hints as you explore.</span></div><Toggle on={tipsOn} onClick={toggleTips} /></div>
        <button className="btn-secondary" onClick={() => window.dispatchEvent(new Event('finpilot:start-tour'))}><i className="fas fa-route"></i> Replay the app tour</button>
      </div>

      {/* Data & privacy */}
      <div className="settings-card">
        <h3><i className="fas fa-database"></i> Data &amp; Privacy</h3>
        <div className="row-between"><div><strong>Help improve Automonie</strong><span className="hint">Use my corrections (categories, amounts) to make import more accurate. Never shared outside Automonie.</span></div><Toggle on={!trainingOptOut} onClick={() => saveTrainingOptOut(!trainingOptOut)} /></div>
        <div className="divider" />
        <div className="row-between"><div><strong>Export my data</strong><span className="hint">Download everything as a PDF report.</span></div><button className="btn-secondary" onClick={exportData}><i className="fas fa-download"></i> Export</button></div>
        <div className="divider" />
        <button className="btn-secondary" onClick={() => { logout(); navigate('/login'); }}><i className="fas fa-right-from-bracket"></i> Log out</button>
      </div>

      {/* Danger zone */}
      <div className="settings-card danger">
        <h3><i className="fas fa-triangle-exclamation"></i> Danger Zone</h3>
        <p className="hint">Permanently delete your account and all data. This cannot be undone.</p>
        <div className="form-group"><label>Confirm with your password</label>
          <input type="password" value={delPw} onChange={e => setDelPw(e.target.value)} placeholder="Your password" /></div>
        <button className="btn-danger" onClick={deleteAccount} disabled={deleting || !delPw}>{deleting ? 'Deleting…' : 'Delete my account'}</button>
      </div>

      <style>{`
        .settings-page { max-width: 720px; margin: 0 auto; padding: 16px; }
        .settings-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; }
        .settings-card.danger { border-color: rgba(229,62,62,0.4); }
        .settings-card h3 { margin: 0 0 16px; font-size: 1rem; display: flex; align-items: center; gap: 8px; }
        .sub { font-weight: 600; font-size: 0.85rem; margin: 0 0 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
        .kv { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .kv span { color: var(--text-secondary); font-size: 0.85rem; }

.row-between { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--glass-border); }
        .row-between:last-of-type { border-bottom: none; }
        .row-between strong { display: block; font-size: 0.9rem; }
        .hint { font-size: 0.78rem; color: var(--text-secondary); display: inline-flex; gap: 6px; align-items: center; }
        .switch { width: 46px; height: 26px; border-radius: 14px; border: none; background: var(--border-color, #cbd5e0); position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.2s; }
        .switch.on { background: var(--accent-primary, var(--accent-primary)); }
        .switch span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.2s; }
        .switch.on span { left: 23px; }
        .switch:disabled { opacity: 0.7; cursor: not-allowed; }

.dark-theme select { color-scheme: dark; }
      `}</style>
    </div>
  );
};

export default Settings;
