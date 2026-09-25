import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const DISMISS_KEY = 'beta_prompt_dismissed';

// A dismissible card that invites non-beta users to join the beta program. Shows on
// the Dashboard; one click opts them in and reveals the community link. Hidden once
// they join or dismiss it.
export default function BetaPrompt() {
  const { user, updateUser } = useAuth();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState(false);
  const [groupUrl, setGroupUrl] = useState('');

  // Already a beta tester, dismissed, or not signed in → show nothing.
  if (!user || user.betaTester || (dismissed && !joined)) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  const join = async () => {
    setBusy(true);
    try {
      const { data } = await axios.patch(`${API_URL}/api/me/beta`, { enabled: true }, authHeader());
      updateUser?.({ ...user, betaTester: true });
      setGroupUrl(data.groupUrl || '');
      setJoined(true);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  return (
    <div style={{
      position: 'relative', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      background: 'linear-gradient(135deg, rgba(99,102,241,0.12), rgba(0,135,81,0.10))',
      border: '1px solid rgba(99,102,241,0.28)', borderRadius: 16, padding: '1rem 1.25rem', marginBottom: '1.5rem',
    }}>
      <div style={{ fontSize: '1.6rem' }} aria-hidden>🧪</div>
      <div style={{ flex: 1, minWidth: 220 }}>
        {joined ? (
          <>
            <strong style={{ color: 'var(--text-primary, #1a365d)', display: 'block', marginBottom: 2 }}>You're a beta tester now. Thank you!</strong>
            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #5b6b82)' }}>
              {groupUrl ? 'Join the community to get early builds and share feedback.' : 'Send feedback any time from Settings.'}
            </span>
          </>
        ) : (
          <>
            <strong style={{ color: 'var(--text-primary, #1a365d)', display: 'block', marginBottom: 2 }}>Help shape Automonie</strong>
            <span style={{ fontSize: '0.88rem', color: 'var(--text-secondary, #5b6b82)' }}>
              Join the beta: get new features first and tell us what to build next.
            </span>
          </>
        )}
      </div>

      {joined ? (
        groupUrl ? (
          <a href={groupUrl} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ background: '#25D366', whiteSpace: 'nowrap' }}>
            <i className="fab fa-whatsapp" style={{ marginRight: 8 }}></i> Join community
          </a>
        ) : (
          <Link to="/settings" className="btn-secondary" style={{ whiteSpace: 'nowrap' }}>Open Settings</Link>
        )
      ) : (
        <>
          <button className="btn-primary" onClick={join} disabled={busy} style={{ whiteSpace: 'nowrap' }}>
            {busy ? 'Joining…' : "I'm in"}
          </button>
          <button onClick={dismiss} aria-label="Dismiss" style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary, #718096)',
            fontSize: '1.1rem', lineHeight: 1, padding: 4,
          }}>
            <i className="fas fa-times"></i>
          </button>
        </>
      )}
    </div>
  );
}
