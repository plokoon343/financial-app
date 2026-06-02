import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

const Profile = () => {
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
        <h2><i className="fas fa-user-circle"></i> Profile & Payout</h2>
        <p>Choose how you want to withdraw money from your wallet</p>
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

        {message && <div className={`message ${message.type}`}>{message.text}</div>}

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
      `}</style>
    </div>
  );
};

export default Profile;
