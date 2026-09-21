import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Admin: global notification controls — (1) broadcast a one-off message to every
// user's notification bell, and (2) set/clear a site-wide dismissible banner.
export default function GlobalNotify() {
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const [msg, setMsg] = useState(null);
  const flash = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  // Broadcast
  const [bTitle, setBTitle] = useState('');
  const [bMessage, setBMessage] = useState('');
  const [bType, setBType] = useState('info');
  const [bLink, setBLink] = useState('');
  const [busy, setBusy] = useState('');

  // Banner
  const [nMessage, setNMessage] = useState('');
  const [nType, setNType] = useState('info');
  const [nLink, setNLink] = useState('');
  const [nLinkText, setNLinkText] = useState('');
  const [current, setCurrent] = useState(null);

  const loadBanner = () => axios.get(`${API_URL}/api/global-banner`, headers).then((r) => setCurrent(r.data?.banner || null)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadBanner(); }, []);

  const broadcast = async () => {
    if (!bTitle.trim()) { flash('Add a title.', 'error'); return; }
    if (!window.confirm(`Send "${bTitle}" to every user's notification bell?`)) return;
    setBusy('cast');
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/notify-all`, { title: bTitle, message: bMessage, type: bType, link: bLink }, headers);
      flash(`Sent to ${data.sent} user${data.sent === 1 ? '' : 's'}.`);
      setBTitle(''); setBMessage(''); setBLink('');
    } catch (e) { flash(e.response?.data?.message || 'Broadcast failed.', 'error'); }
    finally { setBusy(''); }
  };

  const saveBanner = async () => {
    if (!nMessage.trim()) { flash('Add a banner message.', 'error'); return; }
    setBusy('banner');
    try {
      await axios.post(`${API_URL}/api/admin/global-banner`, { message: nMessage, type: nType, link: nLink, linkText: nLinkText, active: true }, headers);
      flash('Banner is now live for everyone.');
      setNMessage(''); setNLink(''); setNLinkText(''); loadBanner();
    } catch (e) { flash(e.response?.data?.message || 'Could not set the banner.', 'error'); }
    finally { setBusy(''); }
  };

  const clearBanner = async () => {
    setBusy('clear');
    try {
      await axios.post(`${API_URL}/api/admin/global-banner`, { active: false }, headers);
      flash('Banner cleared.'); loadBanner();
    } catch { flash('Could not clear the banner.', 'error'); }
    finally { setBusy(''); }
  };

  const inp = { width: '100%', boxSizing: 'border-box', padding: '0.6rem 0.8rem', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-primary)', marginBottom: 10 };

  return (
    <div>
      {msg && <div className={`gn-msg ${msg.type}`} style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 14, background: msg.type === 'error' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)', color: msg.type === 'error' ? '#ef4444' : '#22c55e' }}>{msg.text}</div>}

      <h3 style={{ margin: '0 0 4px' }}>Broadcast a notification</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>Drops a one-off message into every user&apos;s in-app notification bell (web + mobile). Good for announcements and feature drops.</p>
      <input style={inp} placeholder="Title (e.g. New: Money Wrapped is live 🎉)" value={bTitle} onChange={(e) => setBTitle(e.target.value)} />
      <textarea style={{ ...inp, minHeight: 70, fontFamily: 'inherit' }} placeholder="Message (optional)" value={bMessage} onChange={(e) => setBMessage(e.target.value)} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <select style={{ ...inp, width: 'auto', marginBottom: 0 }} value={bType} onChange={(e) => setBType(e.target.value)}>
          <option value="info">Info</option><option value="success">Success</option><option value="warning">Warning</option>
        </select>
        <input style={{ ...inp, flex: 1, marginBottom: 0 }} placeholder="Link (optional, e.g. /wrapped)" value={bLink} onChange={(e) => setBLink(e.target.value)} />
      </div>
      <button onClick={broadcast} disabled={!!busy} style={{ padding: '0.6rem 1.4rem', border: 'none', borderRadius: 8, background: 'var(--gradient-primary, var(--accent-primary))', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy === 'cast' ? 'Sending…' : 'Send to everyone'}
      </button>

      <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '26px 0' }} />

      <h3 style={{ margin: '0 0 4px' }}>Site-wide banner</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: 0 }}>A strip at the top of the app everyone sees until they dismiss it. Use for urgent/important notices. Setting a new one re-shows it even to people who dismissed the last.</p>
      {current && (
        <div style={{ background: 'var(--glass-bg)', border: '1px solid var(--border-color)', borderRadius: 8, padding: '10px 12px', marginBottom: 12, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
          <strong>Live now:</strong> {current.message} <button onClick={clearBanner} disabled={!!busy} style={{ marginLeft: 8, padding: '0.3rem 0.7rem', border: 'none', borderRadius: 6, background: '#e53e3e', color: '#fff', cursor: 'pointer', fontSize: '0.78rem' }}>{busy === 'clear' ? '…' : 'Clear'}</button>
        </div>
      )}
      <input style={inp} placeholder="Banner message" value={nMessage} onChange={(e) => setNMessage(e.target.value)} />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <select style={{ ...inp, width: 'auto', marginBottom: 0 }} value={nType} onChange={(e) => setNType(e.target.value)}>
          <option value="info">Info (teal)</option><option value="success">Success (green)</option><option value="warning">Warning (amber)</option>
        </select>
        <input style={{ ...inp, flex: 1, marginBottom: 0 }} placeholder="Link (optional)" value={nLink} onChange={(e) => setNLink(e.target.value)} />
        <input style={{ ...inp, width: 160, marginBottom: 0 }} placeholder="Link text" value={nLinkText} onChange={(e) => setNLinkText(e.target.value)} />
      </div>
      <button onClick={saveBanner} disabled={!!busy} style={{ padding: '0.6rem 1.4rem', border: 'none', borderRadius: 8, background: 'var(--gradient-primary, var(--accent-primary))', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1 }}>
        {busy === 'banner' ? 'Publishing…' : 'Publish banner'}
      </button>
    </div>
  );
}
