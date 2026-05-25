import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const Profile = () => {
  const { darkMode } = useAuth();
  const [banks, setBanks] = useState([]);
  const [bankDetails, setBankDetails] = useState({
    bankName: '',
    bankCode: '',
    accountNumber: '',
    accountName: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState(null);

  // Fetch bank list from Paystack via our backend
  useEffect(() => {
    const fetchBanks = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get('http://localhost:5000/api/banks', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setBanks(res.data);
      } catch (err) {
        console.error('Failed to load banks:', err);
      }
    };
    fetchBanks();
  }, []);

  // Fetch user's saved bank details
  useEffect(() => {
    const fetchBankDetails = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await axios.get('http://localhost:5000/api/user/bank-details', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.data) {
          setBankDetails(res.data);
        }
      } catch (err) {
        console.error('Error fetching bank details:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBankDetails();
  }, []);

  // Resolve account name when bankCode and accountNumber (10 digits) are present
  useEffect(() => {
    if (bankDetails.bankCode && bankDetails.accountNumber.length === 10) {
      const resolveAccount = async () => {
        setResolving(true);
        try {
          const token = localStorage.getItem('token');
          const res = await axios.get('http://localhost:5000/api/bank/resolve', {
            params: {
              account_number: bankDetails.accountNumber,
              bank_code: bankDetails.bankCode,
            },
            headers: { Authorization: `Bearer ${token}` }
          });
          // Set the resolved name
          setBankDetails(prev => ({
            ...prev,
            accountName: res.data.account_name
          }));
          setMessage({ text: 'Account verified successfully', type: 'success' });
          setTimeout(() => setMessage(null), 3000);
        } catch (err) {
          // Handle specific errors
          const errorMsg = err.response?.data?.message || 'Could not verify account';
          setMessage({ text: errorMsg, type: 'error' });
          // Clear the account name on error
          setBankDetails(prev => ({
            ...prev,
            accountName: ''
          }));
          setTimeout(() => setMessage(null), 4000);
        } finally {
          setResolving(false);
        }
      };
      resolveAccount();
    }
  }, [bankDetails.bankCode, bankDetails.accountNumber]);

  const handleSave = async () => {
    if (!bankDetails.bankName || !bankDetails.accountNumber) {
      setMessage({ text: 'Bank and account number required', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      await axios.post('http://localhost:5000/api/user/bank-details', bankDetails, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMessage({ text: 'Bank details saved!', type: 'success' });
    } catch (err) {
      setMessage({ text: 'Failed to save', type: 'error' });
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  return (
    <div className="profile-page">
      <div className="section-header">
        <h2><i className="fas fa-user-circle"></i> Profile & Bank Details</h2>
        <p>Add your bank account for wallet withdrawals</p>
      </div>

      <div className="profile-card glass-effect">
        <h3>Bank Information</h3>

        <div className="form-group">
          <label>Bank Name</label>
          <select
            value={bankDetails.bankName}
            onChange={(e) => {
              const selectedBank = banks.find(b => b.name === e.target.value);
              setBankDetails({
                ...bankDetails,
                bankName: selectedBank.name,
                bankCode: selectedBank.code,
                accountName: '' // reset when bank changes
              });
            }}
          >
            <option value="">Select Bank</option>
            {banks.map((bank) => (
              <option key={bank.code} value={bank.name}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label>Account Number</label>
          <input
            type="text"
            value={bankDetails.accountNumber}
            onChange={(e) => {
              // Only allow digits
              const digits = e.target.value.replace(/\D/g, '');
              if (digits.length <= 10) {
                setBankDetails({ ...bankDetails, accountNumber: digits, accountName: '' });
              }
            }}
            placeholder="10-digit NUBAN account number"
            maxLength="10"
          />
          {resolving && <small><i className="fas fa-spinner fa-spin"></i> Verifying account...</small>}
        </div>

        <div className="form-group">
          <label>Account Name</label>
          <input
            type="text"
            value={bankDetails.accountName}
            onChange={(e) => setBankDetails({ ...bankDetails, accountName: e.target.value })}
            placeholder="Will be filled automatically"
            // Keep editable but pre-filled
          />
          <small>Auto‑filled from your bank; you can edit if needed.</small>
        </div>

        {message && <div className={`message ${message.type}`}>{message.text}</div>}

        <button className="btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Bank Details'}
        </button>
      </div>

      <style jsx="true">{`
        .profile-page { max-width: 600px; margin: 0 auto; padding: 20px; }
        .profile-card {
          background: var(--card-bg);
          backdrop-filter: blur(20px);
          border-radius: var(--radius-lg);
          padding: 30px;
          border: 1px solid var(--glass-border);
        }
        .form-group { margin-bottom: 20px; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
        select, input {
          width: 100%;
          padding: 12px;
          background: var(--glass-bg);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
          color: var(--text-primary);
        }
        .btn-primary {
          width: 100%;
          padding: 12px;
          background: var(--gradient-primary);
          color: white;
          border: none;
          border-radius: var(--radius-md);
          font-weight: 600;
          cursor: pointer;
        }
        .message {
          padding: 10px;
          border-radius: var(--radius-md);
          margin-top: 15px;
          text-align: center;
        }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        small { font-size: 0.75rem; color: var(--text-secondary); display: block; margin-top: 5px; }
      `}</style>
    </div>
  );
};

export default Profile;