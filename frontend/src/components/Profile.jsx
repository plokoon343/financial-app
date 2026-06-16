import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

const GOAL_OPTIONS = ['Build an emergency fund', 'Save for rent', 'Pay off debt', 'Save for a big purchase', 'Track my spending', 'Grow my investments', 'Other'];
const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const Profile = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [profile, setProfile] = useState({ name: '', email: '', phone: '', monthlyIncome: '', primaryGoal: '' });

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3000); };

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get(`${API_URL}/api/me`, authHeader());
        const p = res.data;
        setProfile({ name: p.name || '', email: p.email || '', phone: p.phone || '', monthlyIncome: p.monthlyIncome || '', primaryGoal: p.primaryGoal || '' });
      } catch { /* non-fatal */ }
      finally { setLoading(false); }
    })();
  }, []);

  const save = async () => {
    if (profile.phone.replace(/\D/g, '').length < 7) {
      flash('A valid phone number is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await axios.put(`${API_URL}/api/me`, {
        name: profile.name, phone: profile.phone,
        monthlyIncome: profile.monthlyIncome === '' ? 0 : Number(profile.monthlyIncome),
        primaryGoal: profile.primaryGoal,
      }, authHeader());
      flash('Profile saved!');
    } catch (err) { flash(err.response?.data?.message || 'Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="loading">Loading profile...</div>;

  return (
    <div className="profile-page">
      <div className="section-header">
        <h2><i className="fas fa-user-circle"></i> Profile</h2>
        <p>Your personal details</p>
      </div>

      {message && <div className={`message ${message.type}`}>{message.text}</div>}

      <div className="profile-card glass-effect">
        <div className="avatar-row">
          <div className="avatar">{(profile.name || 'U').charAt(0).toUpperCase()}</div>
          <div>
            <div className="av-name">{profile.name || 'Your name'}</div>
            <div className="av-email">{profile.email}</div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group"><label>Full Name</label>
            <input type="text" value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} /></div>
          <div className="form-group"><label>Phone *</label>
            <input type="tel" value={profile.phone} onChange={e => setProfile({ ...profile, phone: e.target.value })} placeholder="Required" required /></div>
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
        <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save Details'}</button>

        <p className="settings-link">
          Payout method, password, notifications and more are in <Link to="/settings">Settings</Link>.
        </p>
      </div>

      <style jsx="true">{`
        .profile-page { max-width: 600px; margin: 0 auto; padding: 16px; }
        .profile-card { background: var(--card-bg); backdrop-filter: blur(20px); border-radius: var(--radius-lg); padding: 22px; border: 1px solid var(--glass-border); }
        .avatar-row { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
        .avatar { width: 56px; height: 56px; border-radius: 50%; background: var(--gradient-primary); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: 700; }
        .av-name { font-weight: 700; font-size: 1.05rem; }
        .av-email { color: var(--text-secondary); font-size: 0.85rem; }
        .form-group { margin-bottom: 16px; }
        .form-row { display: flex; gap: 14px; }
        .form-row .form-group { flex: 1; }
        .form-group label { display: block; margin-bottom: 8px; font-weight: 600; }
        select, input { width: 100%; padding: 12px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); }
        .btn-primary { width: 100%; padding: 12px; background: var(--gradient-primary); color: white; border: none; border-radius: var(--radius-md); font-weight: 600; cursor: pointer; }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
        .settings-link { margin-top: 18px; text-align: center; font-size: 0.85rem; color: var(--text-secondary); }
        .settings-link a { color: var(--accent-primary, var(--accent-primary)); font-weight: 600; }
        .message { padding: 10px; border-radius: var(--radius-md); margin-bottom: 16px; text-align: center; }
        .message.success { background: rgba(56,161,105,0.1); color: #38a169; }
        .message.error { background: rgba(229,62,62,0.1); color: #e53e3e; }
        .dark-theme select { color-scheme: dark; }
        .dark-theme select option { background: #26263a; color: #f8f9fa; }
      `}</style>
    </div>
  );
};

export default Profile;
