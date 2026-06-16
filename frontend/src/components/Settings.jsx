import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';
import { tipsEnabled, setTipsEnabled, resetTips } from '../utils/tips';
import { fmtNaira } from '../utils/format';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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

  // payout
  const [method, setMethod] = useState('card');
  const [savingPayout, setSavingPayout] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [card, setCard] = useState({ number: '', expiry: '', holderName: '' });
  const [savedCardLast4, setSavedCardLast4] = useState('');
  const [titan, setTitan] = useState({ accountNumber: '', accountName: '' });
  const [titanBank, setTitanBank] = useState({ code: '100039', name: 'Titan-Paystack' });

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
      } catch { /* non-fatal */ }
    })();
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/banks`, authHeader());
        const banks = res.data || [];
        const m = banks.find(b => /titan/i.test(b.name) && /paystack/i.test(b.name)) || banks.find(b => /titan/i.test(b.name));
        if (m) setTitanBank({ code: m.code, name: m.name });
      } catch {}
    })();
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/user/bank-details`, authHeader());
        const p = res.data || {};
        if (p.method) setMethod(p.method);
        if (p.card) { setSavedCardLast4(p.card.last4 || ''); setCard(c => ({ ...c, expiry: p.card.expiry || '', holderName: p.card.holderName || '' })); }
        if (p.titan) setTitan({ accountNumber: p.titan.accountNumber || '', accountName: p.titan.accountName || '' });
      } catch {}
    })();
  }, []);

  // ── handlers ──
  const changePassword = async () => {
    if (pw.next.length < 6) return flash('New password must be at least 6 characters', 'error');
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
    try { await axios.post(`${API_URL}/api/logout-all`, {}, authHeader()); } catch {}
    logout(); navigate('/login');
  };

  const exportData = async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/me/export`, authHeader());
      const doc = new jsPDF();
      const date = (d) => (d ? new Date(d).toLocaleDateString('en-NG') : '');
      let y = 16;

      // Header
      doc.setFontSize(18); doc.setTextColor('#0b1326');
      doc.text('FinPilot — Data Export', 14, y); y += 7;
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
          ['Monthly income', p.monthlyIncome ? fmtNaira(p.monthlyIncome) : '—'],
          ['Primary goal', p.primaryGoal || '—'],
        ],
        theme: 'striped', headStyles: { fillColor: [8, 135, 81] }, styles: { fontSize: 9 },
      });

      const section = (title, head, rows) => {
        if (!rows || rows.length === 0) return;
        autoTable(doc, {
          startY: doc.lastAutoTable.finalY + 8,
          head: [[`${title} (${rows.length})`, ...Array(head.length - 1).fill('')]],
          theme: 'plain', styles: { fontSize: 11, fontStyle: 'bold', textColor: [8, 135, 81] },
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
      section('Debts', ['Name', 'Balance', 'Min payment'],
        (data.debts || []).map((d) => [d.name, fmtNaira(d.balance), fmtNaira(d.minPayment)]));
      section('Subscriptions', ['Name', 'Cost', 'Frequency', 'Status'],
        (data.subscriptions || []).map((s) => [s.name, fmtNaira(s.cost), s.frequency, s.status]));
      section('Recurring bills', ['Name', 'Amount', 'Due day', 'Frequency'],
        (data.bills || []).map((b) => [b.name, fmtNaira(b.amount), b.dueDate, b.frequency]));

      doc.save(`finpilot-data-${new Date().toISOString().slice(0, 10)}.pdf`);
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
  const toggleTips = () => { const n = !tipsOn; setTipsOn(n); setTipsEnabled(n); if (n) resetTips(); };

  // payout
  const resolveTitan = useCallback(async () => {
    setResolving(true);
    try {
      const res = await axios.get(`${API_URL}/api/bank/resolve`, { params: { account_number: titan.accountNumber, bank_code: titanBank.code }, ...authHeader() });
      setTitan(prev => ({ ...prev, accountName: res.data.account_name }));
    } catch (err) { setTitan(prev => ({ ...prev, accountName: '' })); flash(err.response?.data?.message || 'Could not verify account', 'error'); }
    finally { setResolving(false); }
  }, [titan.accountNumber, titanBank.code]);
  useEffect(() => {
    if (method === 'titan' && titan.accountNumber.length === 10 && titanBank.code) resolveTitan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titan.accountNumber, titanBank.code, method]);

  const fmtCard = (r) => r.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
  const fmtExp = (r) => { const d = r.replace(/\D/g, '').slice(0, 4); return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  const savePayout = async () => {
    setSavingPayout(true);
    try {
      let payload;
      if (method === 'card') {
        const digits = card.number.replace(/\D/g, '');
        if (digits.length < 12) { flash('Enter a valid card number', 'error'); setSavingPayout(false); return; }
        if (!/^\d{2}\/\d{2}$/.test(card.expiry)) { flash('Enter expiry as MM/YY', 'error'); setSavingPayout(false); return; }
        payload = { method: 'card', card: { number: digits, expiry: card.expiry, holderName: card.holderName } };
      } else {
        if (titan.accountNumber.length !== 10) { flash('Enter a valid 10-digit account number', 'error'); setSavingPayout(false); return; }
        payload = { method: 'titan', titan: { accountNumber: titan.accountNumber, accountName: titan.accountName, bankCode: titanBank.code, bankName: titanBank.name } };
      }
      await axios.post(`${API_URL}/api/user/bank-details`, payload, authHeader());
      flash('Payout method saved!');
      if (method === 'card') { setSavedCardLast4(card.number.replace(/\D/g, '').slice(-4)); setCard(c => ({ ...c, number: '' })); }
    } catch (err) { flash(err.response?.data?.message || 'Failed to save', 'error'); }
    finally { setSavingPayout(false); }
  };

  const Toggle = ({ on, onClick, disabled }) => (
    <button className={`switch ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled}><span /></button>
  );

  return (
    <div className="settings-page">
      <div className="section-header">
        <h2><i className="fas fa-gear"></i> Settings</h2>
        <p>Manage your account, security, payout and preferences</p>
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
            <input type="password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} placeholder="At least 6 characters" /></div>
          <div className="form-group"><label>Confirm</label>
            <input type="password" value={pw.confirm} onChange={e => setPw({ ...pw, confirm: e.target.value })} /></div>
        </div>
        <button className="btn-primary" onClick={changePassword} disabled={savingPw || !pw.current || !pw.next}>{savingPw ? 'Updating…' : 'Update Password'}</button>
        <div className="divider" />
        <div className="row-between">
          <div>
            <strong>Active sessions</strong>
            <span className="hint">Last login: {lastLogin ? new Date(lastLogin).toLocaleString() : '—'}</span>
          </div>
          <button className="btn-secondary" onClick={logoutAll}>Log out all devices</button>
        </div>
      </div>

      {/* Payout */}
      <div className="settings-card">
        <h3><i className="fas fa-money-bill-transfer"></i> Payout &amp; Banking</h3>
        <div className="method-toggle">
          <button type="button" className={method === 'card' ? 'active' : ''} onClick={() => setMethod('card')}><i className="fas fa-credit-card"></i> Card</button>
          <button type="button" className={method === 'titan' ? 'active' : ''} onClick={() => setMethod('titan')}><i className="fas fa-building-columns"></i> Paystack-Titan</button>
        </div>
        {method === 'card' ? (
          <>
            {savedCardLast4 && <div className="saved-hint"><i className="fas fa-check-circle"></i> Saved card ending •••• {savedCardLast4}</div>}
            <div className="form-group"><label>Card Number</label>
              <input inputMode="numeric" value={card.number} onChange={e => setCard({ ...card, number: fmtCard(e.target.value) })} placeholder="1234 5678 9012 3456" /></div>
            <div className="form-row">
              <div className="form-group"><label>Expiry (MM/YY)</label>
                <input inputMode="numeric" value={card.expiry} onChange={e => setCard({ ...card, expiry: fmtExp(e.target.value) })} placeholder="08/27" maxLength="5" /></div>
              <div className="form-group"><label>Cardholder</label>
                <input value={card.holderName} onChange={e => setCard({ ...card, holderName: e.target.value })} placeholder="Name on card" /></div>
            </div>
            <small className="hint"><i className="fas fa-lock"></i> Only the last 4 digits are stored — never the full number or CVV.</small>
          </>
        ) : (
          <>
            <div className="form-group"><label>Bank</label><input value={titanBank.name} disabled /></div>
            <div className="form-group"><label>Account Number</label>
              <input inputMode="numeric" value={titan.accountNumber} maxLength="10"
                onChange={e => { const d = e.target.value.replace(/\D/g, ''); if (d.length <= 10) setTitan({ ...titan, accountNumber: d, accountName: '' }); }}
                placeholder="10-digit account number" />
              {resolving && <small className="hint"><i className="fas fa-spinner fa-spin"></i> Verifying…</small>}</div>
            <div className="form-group"><label>Account Name</label>
              <input value={titan.accountName} onChange={e => setTitan({ ...titan, accountName: e.target.value })} placeholder="Auto-filled after verification" /></div>
          </>
        )}
        <button className="btn-primary" onClick={savePayout} disabled={savingPayout}>{savingPayout ? 'Saving…' : 'Save Payout Method'}</button>
      </div>

      {/* Notifications */}
      <div className="settings-card">
        <h3><i className="fas fa-bell"></i> Notifications</h3>
        <div className="row-between"><div><strong>Email alerts</strong><span className="hint">Important updates by email.</span></div><Toggle on={emailAlerts} onClick={() => saveEmailAlerts(!emailAlerts)} /></div>
        <div className="row-between"><div><strong>In-app alerts</strong><span className="hint">Ticket updates &amp; more in the bell. Always on.</span></div><Toggle on disabled /></div>
      </div>

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

      <style jsx="true">{`
        .settings-page { max-width: 720px; margin: 0 auto; padding: 16px; }
        .settings-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 16px; }
        .settings-card.danger { border-color: rgba(229,62,62,0.4); }
        .settings-card h3 { margin: 0 0 16px; font-size: 1rem; display: flex; align-items: center; gap: 8px; }
        .sub { font-weight: 600; font-size: 0.85rem; margin: 0 0 10px; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.03em; }
        .kv { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .kv span { color: var(--text-secondary); font-size: 0.85rem; }
        .divider { height: 1px; background: var(--glass-border); margin: 16px 0; }
        .form-group { margin-bottom: 14px; }
        .form-row { display: flex; gap: 14px; }
        .form-row .form-group { flex: 1; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 0.85rem; }
        .form-group input { width: 100%; padding: 11px 12px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); }
        .form-group input:disabled { opacity: 0.7; }
        .row-between { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 10px 0; border-bottom: 1px solid var(--glass-border); }
        .row-between:last-of-type { border-bottom: none; }
        .row-between strong { display: block; font-size: 0.9rem; }
        .hint { font-size: 0.78rem; color: var(--text-secondary); display: inline-flex; gap: 6px; align-items: center; }
        .method-toggle { display: flex; gap: 12px; margin-bottom: 18px; }
        .method-toggle button { flex: 1; padding: 11px; border: 1px solid var(--border-color, var(--glass-border)); background: var(--glass-bg); border-radius: var(--radius-md); color: var(--text-primary); cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .method-toggle button.active { background: var(--gradient-primary); color: #fff; border-color: transparent; }
        .saved-hint { background: rgba(56,161,105,0.1); color: #38a169; padding: 9px 12px; border-radius: var(--radius-md); margin-bottom: 14px; font-size: 0.84rem; }
        .switch { width: 46px; height: 26px; border-radius: 14px; border: none; background: var(--border-color, #cbd5e0); position: relative; cursor: pointer; flex-shrink: 0; transition: background 0.2s; }
        .switch.on { background: var(--accent-primary, var(--accent-primary)); }
        .switch span { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left 0.2s; }
        .switch.on span { left: 23px; }
        .switch:disabled { opacity: 0.7; cursor: not-allowed; }
        .btn-primary { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 11px 18px; font-weight: 600; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-secondary { background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); color: var(--text-primary); border-radius: var(--radius-md); padding: 10px 16px; font-weight: 600; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; margin-top: 6px; }
        .btn-danger { background: rgba(229,62,62,0.12); color: #e53e3e; border: 1px solid rgba(229,62,62,0.4); border-radius: var(--radius-md); padding: 11px 18px; font-weight: 600; cursor: pointer; }
        .btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }
        .message { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.12); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.12); color: #e53e3e; }
        .dark-theme select { color-scheme: dark; }
      `}</style>
    </div>
  );
};

export default Settings;
