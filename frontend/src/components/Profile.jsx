import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

const GOAL_OPTIONS = ['Build an emergency fund', 'Save for rent', 'Pay off debt', 'Save for a big purchase', 'Track my spending', 'Grow my investments', 'Other'];
const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const Profile = () => {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  // Profile details
  const [profile, setProfile] = useState({ name: '', phone: '', monthlyIncome: '', primaryGoal: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  // Payout method
  const [method, setMethod] = useState('card'); // 'card' | 'titan'
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [card, setCard] = useState({ number: '', expiry: '', holderName: '' });
  const [savedCardLast4, setSavedCardLast4] = useState('');
  const [titan, setTitan] = useState({ accountNumber: '', accountName: '' });
  const [titanBank, setTitanBank] = useState({ code: '100039', name: 'Titan-Paystack' });

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3000); };

  // Load profile details
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/me`, authHeader());
        const p = res.data;
        setProfile({ name: p.name || '', phone: p.phone || '', monthlyIncome: p.monthlyIncome || '', primaryGoal: p.primaryGoal || '' });
      } catch { /* non-fatal */ }
    })();
  }, []);

  // Load Paystack bank list (for Titan code) and saved payout
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/banks`, authHeader());
        const banks = res.data || [];
        const match = banks.find(b => /titan/i.test(b.name) && /paystack/i.test(b.name)) || banks.find(b => /titan/i.test(b.name));
        if (match) setTitanBank({ code: match.code, name: match.name });
      } catch { /* fallback code is fine */ }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/user/bank-details`, authHeader());
        const p = res.data || {};
        if (p.method) setMethod(p.method);
        if (p.card) { setSavedCardLast4(p.card.last4 || ''); setCard(c => ({ ...c, expiry: p.card.expiry || '', holderName: p.card.holderName || '' })); }
        if (p.titan) setTitan({ accountNumber: p.titan.accountNumber || '', accountName: p.titan.accountName || '' });
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    })();
  }, []);

  // Resolve Titan account name
  const resolveTitanAccount = useCallback(async () => {
    setResolving(true);
    try {
      const res = await axios.get(`${API_URL}/api/bank/resolve`, {
        params: { account_number: titan.accountNumber, bank_code: titanBank.code }, ...authHeader(),
      });
      setTitan(prev => ({ ...prev, accountName: res.data.account_name }));
      flash('Account verified successfully');
    } catch (err) {
      setTitan(prev => ({ ...prev, accountName: '' }));
      flash(err.response?.data?.message || 'Could not verify account', 'error');
    } finally { setResolving(false); }
  }, [titan.accountNumber, titanBank.code]);

  useEffect(() => {
    if (method === 'titan' && titan.accountNumber.length === 10 && titanBank.code) resolveTitanAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titan.accountNumber, titanBank.code, method]);

  const formatCardNumber = (raw) => raw.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim();
  const formatExpiry = (raw) => { const d = raw.replace(/\D/g, '').slice(0, 4); return d.length >= 3 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await axios.put(`${API_URL}/api/me`, {
        name: profile.name, phone: profile.phone,
        monthlyIncome: profile.monthlyIncome === '' ? 0 : Number(profile.monthlyIncome),
        primaryGoal: profile.primaryGoal,
      }, authHeader());
      flash('Profile saved!');
    } catch (err) { flash(err.response?.data?.message || 'Failed to save profile', 'error'); }
    finally { setSavingProfile(false); }
  };

  const savePayout = async () => {
    setSaving(true);
    try {
      let payload;
      if (method === 'card') {
        const digits = card.number.replace(/\D/g, '');
        if (digits.length < 12) { flash('Enter a valid card number', 'error'); setSaving(false); return; }
        if (!/^\d{2}\/\d{2}$/.test(card.expiry)) { flash('Enter expiry as MM/YY', 'error'); setSaving(false); return; }
        payload = { method: 'card', card: { number: digits, expiry: card.expiry, holderName: card.holderName } };
      } else {
        if (titan.accountNumber.length !== 10) { flash('Enter a valid 10-digit account number', 'error'); setSaving(false); return; }
        payload = { method: 'titan', titan: { accountNumber: titan.accountNumber, accountName: titan.accountName, bankCode: titanBank.code, bankName: titanBank.name } };
      }
      await axios.post(`${API_URL}/api/user/bank-details`, payload, authHeader());
      flash('Payout method saved!');
      if (method === 'card') { setSavedCardLast4(card.number.replace(/\D/g, '').slice(-4)); setCard(c => ({ ...c, number: '' })); }
    } catch (err) { flash(err.response?.data?.message || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  return (
    <div className="profile-page">
      <div className="section-header">
        <h2><i className="fas fa-user-circle"></i> Profile</h2>
        <p>Your details and how you withdraw from your wallet</p>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      {/* Profile details */}
      <div className="profile-card glass-effect">
        <h3>Your Details</h3>
        <div className="form-row">
          <div className="form-group"><label>Full Name</label>
            <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></div>
          <div className="form-group"><label>Phone</label>
            <input type="text" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} placeholder="optional" /></div>
        </div>
        <div className="form-row">
          <div className="form-group"><label>Monthly Income (₦)</label>
            <input type="number" min="0" value={profile.monthlyIncome} onChange={e => setProfile({ ...profile, monthlyIncome: e.target.value })} placeholder="optional" /></div>
          <div className="form-group"><label>Primary Goal</label>
            <select value={profile.primaryGoal} onChange={e => setProfile({ ...profile, primaryGoal: e.target.value })}>
              <option value="">Select a goal</option>
              {GOAL_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
            </select></div>
        </div>
        <button className="btn-primary" onClick={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Details'}</button>
      </div>

      {/* Payout method */}
      <div className="profile-card glass-effect">
        <h3>Payout Method</h3>
        <div className="method-toggle">
          <button type="button" className={method === 'card' ? 'active' : ''} onClick={() => setMethod('card')}>
            <i className="fas fa-credit-card"></i> Card details
          </button>
          <button type="button" className={method === 'titan' ? 'active' : ''} onClick={() => setMethod('titan')}>
            <i className="fas fa-building-columns"></i> Paystack-Titan account
          </button>
        </div>

        {method === 'card' && (
          <>
            {savedCardLast4 && <div className="saved-hint"><i className="fas fa-check-circle"></i> Saved card ending in •••• {savedCardLast4}. Enter a new card to replace it.</div>}
            <div className="form-group"><label>Card Number</label>
              <input type="text" inputMode="numeric" value={card.number} onChange={e => setCard({ ...card, number: formatCardNumber(e.target.value) })} placeholder="1234 5678 9012 3456" /></div>
            <div className="form-row">
              <div className="form-group"><label>Expiry (MM/YY)</label>
                <input type="text" inputMode="numeric" value={card.expiry} onChange={e => setCard({ ...card, expiry: formatExpiry(e.target.value) })} placeholder="08/27" maxLength="5" /></div>
              <div className="form-group"><label>Cardholder Name</label>
                <input type="text" value={card.holderName} onChange={e => setCard({ ...card, holderName: e.target.value })} placeholder="Name on card" /></div>
            </div>
            <small className="security-note"><i className="fas fa-lock"></i> We never store your CVV or full card number — only the last 4 digits.</small>
          </>
        )}

        {method === 'titan' && (
          <>
            <div className="form-group"><label>Bank</label><input type="text" value={titanBank.name} disabled /></div>
            <div className="form-group"><label>Account Number</label>
              <input type="text" inputMode="numeric" value={titan.accountNumber}
                onChange={e => { const d = e.target.value.replace(/\D/g, ''); if (d.length <= 10) setTitan({ ...titan, accountNumber: d, accountName: '' }); }}
                placeholder="10-digit account number" maxLength="10" />
              {resolving && <small><i className="fas fa-spinner fa-spin"></i> Verifying account...</small>}</div>
            <div className="form-group"><label>Account Name</label>
              <input type="text" value={titan.accountName} onChange={e => setTitan({ ...titan, accountName: e.target.value })} placeholder="Auto-filled after verification" /></div>
          </>
        )}

        <button className="btn-primary" onClick={savePayout} disabled={saving}>{saving ? 'Saving...' : 'Save Payout Method'}</button>
      </div>

      <style jsx="true">{`
        .profile-page { max-width: 600px; margin: 0 auto; padding: 16px; }
        .profile-card { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 20px; border: 1px solid var(--glass-border); margin-bottom: 16px; }
        .profile-card h3 { margin: 0 0 16px; }
        .method-toggle { display: flex; gap: 12px; margin: 4px 0 20px; }
        .method-toggle button { flex: 1; padding: 12px; border: 1px solid var(--border-color, var(--glass-border)); background: var(--glass-bg); border-radius: var(--radius-md); color: var(--text-primary); cursor: pointer; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
        .method-toggle button.active { background: var(--gradient-primary); color: white; border-color: transparent; }
        .form-group { margin-bottom: 16px; }
        .form-row { display: flex; gap: 14px; }
        .form-row .form-group { flex: 1; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
        select, input { width: 100%; padding: 12px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); }
        input:disabled { opacity: 0.7; }
        .saved-hint { background: rgba(56,161,105,0.1); color: #38a169; padding: 10px 12px; border-radius: var(--radius-md); margin-bottom: 18px; font-size: 0.85rem; }
        .security-note { color: var(--text-secondary); font-size: 0.78rem; display: flex; align-items: center; gap: 6px; }
        .btn-primary { width: 100%; padding: 12px; background: var(--gradient-primary); color: white; border: none; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .message { padding: 10px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        small { font-size: 0.75rem; color: var(--text-secondary); display: block; margin-top: 5px; }
        .dark-theme select { color-scheme: dark; }
        .dark-theme select option { background: #26263a; color: #f8f9fa; }
      `}</style>
    </div>
  );
};

export default Profile;
