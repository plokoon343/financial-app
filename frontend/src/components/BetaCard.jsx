import React, { useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { API_URL } from '../config';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const KINDS = [
  { id: 'bug', label: 'Bug' },
  { id: 'idea', label: 'Idea' },
  { id: 'praise', label: 'Praise' },
  { id: 'other', label: 'Other' },
];

// Beta program + in-app feedback, shown on the Settings page.
export default function BetaCard() {
  const { user, updateUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [groupUrl, setGroupUrl] = useState('');
  const [kind, setKind] = useState('idea');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState(null); // {type, text}
  const isBeta = !!user?.betaTester;

  const toggleBeta = async () => {
    setBusy(true); setNote(null);
    try {
      const { data } = await axios.patch(`${API_URL}/api/me/beta`, { enabled: !isBeta }, authHeader());
      updateUser?.({ ...user, betaTester: data.betaTester });
      setGroupUrl(data.betaTester ? (data.groupUrl || '') : '');
      setNote({ type: 'ok', text: data.betaTester ? "You're a beta tester now." : 'You have left the beta.' });
    } catch { setNote({ type: 'err', text: 'Could not update. Try again.' }); }
    finally { setBusy(false); }
  };

  const sendFeedback = async () => {
    if (msg.trim().length < 3) { setNote({ type: 'err', text: 'Please write a little more.' }); return; }
    setSending(true); setNote(null);
    try {
      await axios.post(`${API_URL}/api/feedback`, { kind, message: msg.trim(), platform: 'web' }, authHeader());
      setMsg('');
      setNote({ type: 'ok', text: 'Thank you. Your feedback is in.' });
    } catch { setNote({ type: 'err', text: 'Could not send. Try again.' }); }
    finally { setSending(false); }
  };

  return (
    <div className="settings-card">
      <h3><i className="fas fa-flask"></i> Beta program &amp; feedback</h3>

      <div className="row-between">
        <div>
          <strong>Beta tester</strong>
          <span className="hint">Get new features first and help shape the app.</span>
        </div>
        <button className={isBeta ? 'btn-secondary' : 'btn-primary'} onClick={toggleBeta} disabled={busy}>
          {busy ? '…' : isBeta ? 'Leave beta' : "I'm in"}
        </button>
      </div>

      {isBeta && groupUrl && (
        <a href={groupUrl} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ display: 'inline-flex', marginTop: 12, background: '#25D366' }}>
          <i className="fab fa-whatsapp" style={{ marginRight: 8 }}></i> Join the beta WhatsApp community
        </a>
      )}

      <div style={{ marginTop: 18, borderTop: '1px solid var(--glass-border)', paddingTop: 16 }}>
        <strong style={{ display: 'block', marginBottom: 10 }}>Send feedback</strong>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)}
              style={{
                padding: '5px 12px', borderRadius: 999, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${kind === k.id ? 'var(--accent-primary, #008751)' : 'var(--glass-border)'}`,
                background: kind === k.id ? 'var(--accent-primary, #008751)' : 'transparent',
                color: kind === k.id ? '#fff' : 'var(--text-secondary)',
              }}>{k.label}</button>
          ))}
        </div>
        <textarea value={msg} onChange={e => setMsg(e.target.value)} rows={3}
          placeholder="What's working, what's broken, what you'd love to see…"
          style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--glass-border)', background: 'var(--bg-input, transparent)', color: 'var(--text-primary)', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.9rem' }} />
        <div style={{ marginTop: 10 }}>
          <button className="btn-primary" onClick={sendFeedback} disabled={sending}>
            <i className="fas fa-paper-plane" style={{ marginRight: 8 }}></i>{sending ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>

      {note && (
        <p style={{ marginTop: 12, fontSize: '0.85rem', color: note.type === 'ok' ? '#38a169' : '#e53e3e' }}>{note.text}</p>
      )}
    </div>
  );
}
