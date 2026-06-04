import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { tipsEnabled, setTipsEnabled, resetTips } from '../utils/tips';

const GOAL_OPTIONS = ['Build an emergency fund', 'Save for rent', 'Pay off debt', 'Save for a big purchase', 'Track my spending', 'Grow my investments', 'Other'];
const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const Profile = () => {
  // Profile details
  const [profile, setProfile] = useState({ name: '', phone: '', monthlyIncome: '', primaryGoal: '', emailAlerts: true });
  const [savingProfile, setSavingProfile] = useState(false);
  // Change password
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [savingPw, setSavingPw] = useState(false);
  // Tips toggle
  const [tipsOn, setTipsOn] = useState(tipsEnabled());
  const [method, setMethod] = useState('card'); // 'card' | 'titan'
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState(null);

  // Card fields (CVV is never collected or stored)
  const [card, setCard] = useState({ number: '', expiry: '', holderName: '' });
  const [savedCardLast4, setSavedCardLast4] = useState('');

  // Paystack-Titan account fields
  const [titan, setTitan] = useState({ accountNumber: '', accountName: '' });
  const [titanBank, setTitanBank] = useState({ code: '100039', name: 'Titan-Paystack' }); // sensible fallback

  // Load profile details
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/me`, authHeader());
        const p = res.data;
        setProfile({ name: p.name || '', phone: p.phone || '', monthlyIncome: p.monthlyIncome || '', primaryGoal: p.primaryGoal || '', emailAlerts: p.emailAlerts !== false });
      } catch { /* non-fatal */ }
    })();
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await axios.put(`${API_URL}/api/me`, {
        name: profile.name,
        phone: profile.phone,
        monthlyIncome: profile.monthlyIncome === '' ? 0 : Number(profile.monthlyIncome),
        primaryGoal: profile.primaryGoal,
        emailAlerts: profile.emailAlerts,
      }, authHeader());
      setMessage({ text: 'Profile saved!', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save profile', type: 'error' });
    } finally { setSavingProfile(false); setTimeout(() => setMessage(null), 3000); }
  };

  const changePassword = async () => {
    if (pw.next.length < 6) return setMessage({ text: 'New password must be at least 6 characters', type: 'error' });
    if (pw.next !== pw.confirm) return setMessage({ text: 'New passwords do not match', type: 'error' });
    setSavingPw(true);
    try {
      await axios.post(`${API_URL}/api/change-password`, { currentPassword: pw.current, newPassword: pw.next }, authHeader());
      setPw({ current: '', next: '', confirm: '' });
      setMessage({ text: 'Password changed successfully!', type: 'success' });
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to change password', type: 'error' });
    } finally { setSavingPw(false); setTimeout(() => setMessage(null), 3000); }
  };

  const toggleTips = () => {
    const next = !tipsOn;
    setTipsOn(next);
    setTipsEnabled(next);
    if (next) resetTips(); // re-enable: let first-time tips show again
  };

  // Find the Titan-Paystack bank code from Paystack's bank list
  useEffect(() => {
    const fetchBanks = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_URL}/api/banks`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const banks = res.data || [];
        const match =
          banks.find(b => /titan/i.test(b.name) && /paystack/i.test(b.name)) ||
          banks.find(b => /titan/i.test(b.name));
        if (match) setTitanBank({ code: match.code, name: match.name });
      } catch (err) {
        console.error('Failed to load banks:', err);
      }
    };
    fetchBanks();
  }, []);

  // Load the user's saved payout method
  useEffect(() => {
    const fetchPayout = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get(`${API_URL}/api/user/bank-details`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const p = res.data || {};
        if (p.method) setMethod(p.method);
        if (p.card) {
          setSavedCardLast4(p.card.last4 || '');
          setCard(c => ({ ...c, expiry: p.card.expiry || '', holderName: p.card.holderName || '' }));
        }
        if (p.titan) {
          setTitan({ accountNumber: p.titan.accountNumber || '', accountName: p.titan.accountName || '' });
        }
      } catch (err) {
        console.error('Error fetching payout details:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchPayout();
  }, []);

  // Resolve the Titan account name once a full 10-digit number is entered
  const resolveTitanAccount = useCallback(async () => {
    setResolving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/bank/resolve`, {
        params: { account_number: titan.accountNumber, bank_code: titanBank.code },
        headers: { Authorization: `Bearer ${token}` },
      });
      setTitan(prev => ({ ...prev, accountName: res.data.account_name }));
      setMessage({ text: 'Account verified successfully', type: 'success' });
      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      setTitan(prev => ({ ...prev, accountName: '' }));
      setMessage({ text: err.response?.data?.message || 'Could not verify account', type: 'error' });
      setTimeout(() => setMessage(null), 4000);
    } finally {
      setResolving(false);
    }
  }, [titan.accountNumber, titanBank.code]);

  useEffect(() => {
    if (method === 'titan' && titan.accountNumber.length === 10 && titanBank.code) {
      resolveTitanAccount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titan.accountNumber, titanBank.code, method]);

  // Formatters
  const formatCardNumber = (raw) =>
    raw.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();

  const formatExpiry = (raw) => {
    const d = raw.replace(/\D/g, '').slice(0, 4);
    return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      let payload;
      if (method === 'card') {
        const digits = card.number.replace(/\D/g, '');
        if (digits.length < 12) {
          setMessage({ text: 'Enter a valid card number', type: 'error' });
          setSaving(false);
          return;
        }
        if (!/^\d{2}\/\d{2}$/.test(card.expiry)) {
          setMessage({ text: 'Enter expiry as MM/YY', type: 'error' });
          setSaving(false);
          return;
        }
        payload = { method: 'card', card: { number: digits, expiry: card.expiry, holderName: card.holderName } };
      } else {
        if (titan.accountNumber.length !== 10) {
          setMessage({ text: 'Enter a valid 10-digit account number', type: 'error' });
          setSaving(false);
          return;
        }
        payload = {
          method: 'titan',
          titan: {
            accountNumber: titan.accountNumber,
            accountName: titan.accountName,
            bankCode: titanBank.code,
            bankName: titanBank.name,
          },
        };
      }

      await axios.post(`${API_URL}/api/user/bank-details`, payload, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage({ text: 'Payout method saved!', type: 'success' });
      if (method === 'card') {
        setSavedCardLast4(card.number.replace(/\D/g, '').slice(-4));
        setCard(c => ({ ...c, number: '' }));
      }
    } catch (err) {
      setMessage({ text: err.response?.data?.message || 'Failed to save', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  return (
    <div className="profile-page">
      <div className="section-header">
        <h2><i className="fas fa-user-circle"></i> Profile &amp; Settings</h2>
        <p>Manage your details, security, payout method and preferences</p>
      </div>

      {message && <div className={`message ${message.type}`} style={{ marginBottom: '16px' }}>{message.text}</div>}

      {/* Profile details */}
      <div className="profile-card glass-effect">
        <h3>Your Details</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Full Name</label>
            <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input type="text" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} placeholder="optional" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Monthly Income (₦)</label>
            <input type="number" min="0" value={profile.monthlyIncome} onChange={e => setProfile({ ...profile, monthlyIncome: e.target.value })} placeholder="optional" />
          </div>
          <div className="form-group">
            <label>Primary Goal</label>
            <select value={profile.primaryGoal} onChange={e => setProfile({ ...profile, primaryGoal: e.target.value })}>
              <option value="">Select a goal</option>
              {GOAL_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={profile.emailAlerts} onChange={e => setProfile({ ...profile, emailAlerts: e.target.checked })} />
          Send me email alerts
        </label>
        <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save Details'}
        </button>
      </div>

      {/* Change password */}
      <div className="profile-card glass-effect">
        <h3>Change Password</h3>
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
          {savingPw ? 'Updating...' : 'Update Password'}
        </button>
      </div>

      {/* Preferences */}
      <div className="profile-card glass-effect">
        <h3>Preferences</h3>
        <label className="checkbox-row">
          <input type="checkbox" checked={tipsOn} onChange={toggleTips} />
          Show feature tips &amp; first-time hints
        </label>
        <small>Turn this back on to see the in-app tips again as you use each feature.</small>
      </div>

      <div className="profile-card glass-effect">
        <h3>Payout Method</h3>

        {/* Method toggle */}
        <div className="method-toggle">
          <button
            type="button"
            className={method === 'card' ? 'active' : ''}
            onClick={() => setMethod('card')}
          >
            <i className="fas fa-credit-card"></i> Card details
          </button>
          <button
            type="button"
            className={method === 'titan' ? 'active' : ''}
            onClick={() => setMethod('titan')}
          >
            <i className="fas fa-building-columns"></i> Paystack-Titan account
          </button>
        </div>

        {/* CARD FORM */}
        {method === 'card' && (
          <>
            {savedCardLast4 && (
              <div className="saved-hint">
                <i className="fas fa-check-circle"></i> Saved card ending in •••• {savedCardLast4}. Enter a new card below to replace it.
              </div>
            )}
            <div className="form-group">
              <label>Card Number</label>
              <input
                type="text"
                inputMode="numeric"
                value={card.number}
                onChange={(e) => setCard({ ...card, number: formatCardNumber(e.target.value) })}
                placeholder="1234 5678 9012 3456"
              />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Expiry (MM/YY)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={card.expiry}
                  onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                  placeholder="08/27"
                  maxLength="5"
                />
              </div>
              <div className="form-group">
                <label>Cardholder Name</label>
                <input
                  type="text"
                  value={card.holderName}
                  onChange={(e) => setCard({ ...card, holderName: e.target.value })}
                  placeholder="Name on card"
                />
              </div>
            </div>
            <small className="security-note">
              <i className="fas fa-lock"></i> For your security we never store your CVV or full card number — only the last 4 digits.
            </small>
          </>
        )}

        {/* TITAN FORM */}
        {method === 'titan' && (
          <>
            <div className="form-group">
              <label>Bank</label>
              <input type="text" value={titanBank.name} disabled />
            </div>
            <div className="form-group">
              <label>Account Number</label>
              <input
                type="text"
                inputMode="numeric"
                value={titan.accountNumber}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, '');
                  if (digits.length <= 10) setTitan({ ...titan, accountNumber: digits, accountName: '' });
                }}
                placeholder="10-digit account number"
                maxLength="10"
              />
              {resolving && <small><i className="fas fa-spinner fa-spin"></i> Verifying account...</small>}
            </div>
            <div className="form-group">
              <label>Account Name</label>
              <input
                type="text"
                value={titan.accountName}
                onChange={(e) => setTitan({ ...titan, accountName: e.target.value })}
                placeholder="Auto-filled after verification"
              />
              <small>Auto-filled from Paystack; you can edit if needed.</small>
            </div>
          </>
        )}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Payout Method'}
        </button>
      </div>

      <style jsx="true">{`
        .profile-page { max-width: 600px; margin: 0 auto; padding: 20px; }
        .profile-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 18px;
          border: 1px solid var(--glass-border);
        }
        .method-toggle { display: flex; gap: 12px; margin: 18px 0 24px; }
        .method-toggle button {
          flex: 1;
          padding: 12px;
          border: 1px solid var(--border-color);
          background: var(--glass-bg);
          border-radius: var(--radius-md);
          color: var(--text-primary);
          cursor: pointer;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s;
        }
        .method-toggle button.active { background: var(--gradient-primary); color: white; border-color: transparent; }
        .form-group { margin-bottom: 20px; }
        .form-row { display: flex; gap: 15px; }
        .form-row .form-group { flex: 1; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
        select, input {
          width: 100%;
          padding: 12px;
          background: var(--glass-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-primary);
        }
        input:disabled { opacity: 0.7; cursor: not-allowed; }
        .saved-hint {
          background: rgba(56,161,105,0.1);
          color: #38a169;
          padding: 10px 12px;
          border-radius: var(--radius-md);
          margin-bottom: 18px;
          font-size: 0.85rem;
        }
        .security-note { color: var(--text-secondary); font-size: 0.78rem; display: flex; align-items: center; gap: 6px; }
        .btn-primary {
          width: 100%;
          padding: 12px;
          margin-top: 20px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
        }
        .message { padding: 10px; border-radius: var(--radius-md); margin-top: 15px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        small { font-size: 0.75rem; color: var(--text-secondary); display: block; margin-top: 5px; }
        .profile-card { margin-bottom: 18px; }
        .checkbox-row { display: flex; align-items: center; gap: 10px; font-weight: 500; margin-bottom: 14px; cursor: pointer; }
        .checkbox-row input { width: auto; }
        .dark-theme select option { background: #26263a; color: #f8f9fa; }
        .dark-theme select { color-scheme: dark; }
      `}</style>
    </div>
  );
};

export default Profile;
