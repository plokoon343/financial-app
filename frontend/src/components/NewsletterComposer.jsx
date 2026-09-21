import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import RichTextEditor from './RichTextEditor';

// Newsletter composer — usable standalone (route /newsletter, for a scoped
// newsletter-editor) or embedded in the Admin dashboard. Visual editor, live audience
// count, test-to-self, confirmed send-to-all, and recent-sends history.
export default function NewsletterComposer({ embedded = false }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [review, setReview] = useState(false);

  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const flash = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  const loadAudience = useCallback(async () => {
    try { const { data } = await axios.get(`${API_URL}/api/admin/newsletter/audience`, headers); setAudience(data); }
    catch { flash('Could not load your audience.', 'error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadAudience(); }, [loadAudience]);

  const plainLen = body.replace(/<[^>]+>/g, '').trim().length;
  const ready = subject.trim() && plainLen > 0;

  const sendTest = async () => {
    if (!ready) { flash('Add a subject and some content first.', 'error'); return; }
    setBusy('test');
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/newsletter/test`, { subject, html: body }, headers);
      flash(`Test sent to ${data.to} — check your inbox.`);
    } catch (e) { flash(e.response?.data?.message || 'Test send failed.', 'error'); }
    finally { setBusy(''); }
  };

  // Upload a graphic and return its public URL for the editor to insert.
  const uploadImage = async (file) => {
    const fd = new FormData(); fd.append('image', file);
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/newsletter/image`, fd, { headers: { Authorization: headers.headers.Authorization } });
      return data.url;
    } catch (e) { flash(e.response?.data?.message || 'Image upload failed.', 'error'); throw e; }
  };

  // Review gate: 'Send' opens a preview of the exact email; the actual send happens
  // only after the reviewer confirms.
  const openReview = () => {
    if (!ready) { flash('Add a subject and some content first.', 'error'); return; }
    if (!(audience?.active > 0)) { flash('No subscribers to send to yet.', 'error'); return; }
    setReview(true);
  };

  const send = async () => {
    setReview(false); setBusy('send');
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/newsletter/send`, { subject, html: body }, headers);
      flash(`Sent to ${data.sent}${data.failed ? `, ${data.failed} failed` : ''}.`);
      setSubject(''); setBody(''); loadAudience();
    } catch (e) { flash(e.response?.data?.message || 'Send failed.', 'error'); }
    finally { setBusy(''); }
  };

  return (
    <div className={`nl-wrap ${embedded ? 'nl-embedded' : ''}`}>
      {!embedded && (
        <div className="nl-head">
          <h2><i className="fas fa-paper-plane"></i> Newsletter</h2>
          <p>Write an update and send it to everyone on the Automonie waitlist. Format it like a document — no code needed. Always send yourself a test first.</p>
        </div>
      )}

      <div className="nl-audience">
        <i className="fas fa-users"></i>
        {audience ? <span><strong>{audience.active}</strong> subscriber{audience.active === 1 ? '' : 's'} · {audience.unsubscribed} unsubscribed</span> : <span>Loading audience…</span>}
        <button className="nl-refresh" onClick={loadAudience} title="Refresh"><i className="fas fa-sync-alt"></i></button>
      </div>

      {msg && <div className={`nl-msg ${msg.type}`}>{msg.text}</div>}

      <label className="nl-label">Subject</label>
      <input className="nl-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Automonie is almost here 🎉" disabled={!!busy} />

      <label className="nl-label">Message</label>
      <RichTextEditor value={body} onChange={setBody} disabled={!!busy} uploadImage={uploadImage} />
      <div className="nl-hint">Tip: use the image button to add graphics. Some fonts (like Poppins) fall back to a standard font in Gmail/Outlook — that&apos;s normal for email. Every email includes an unsubscribe link automatically.</div>

      <div className="nl-actions">
        <button className="nl-test" onClick={sendTest} disabled={!!busy || !ready}>
          {busy === 'test' ? 'Sending…' : 'Send test to me'}
        </button>
        <button className="nl-send" onClick={openReview} disabled={!!busy || !ready || !(audience?.active > 0)}>
          Review &amp; send to {audience?.active ?? 0} subscriber{(audience?.active ?? 0) === 1 ? '' : 's'}
        </button>
      </div>

      {audience?.history?.length > 0 && (
        <div className="nl-history">
          <h3>Recent sends</h3>
          {audience.history.map((h) => (
            <div key={h._id} className="nl-hrow">
              <div className="nl-hmain">
                <div className="nl-hsubject">{h.subject}</div>
                <div className="nl-hmeta">{new Date(h.createdAt).toLocaleString()} · by {h.sentBy}</div>
              </div>
              <div className="nl-hcount">{h.sent} sent{h.failed ? ` · ${h.failed} failed` : ''}</div>
            </div>
          ))}
        </div>
      )}

      {review && (
        <div className="nl-overlay" onClick={() => setReview(false)}>
          <div className="nl-modal" onClick={(e) => e.stopPropagation()}>
            <div className="nl-modal-head">
              <strong>Review before sending</strong>
              <button className="nl-x" onClick={() => setReview(false)}><i className="fas fa-times"></i></button>
            </div>
            <div className="nl-modal-sub">Going to <b>{audience?.active}</b> subscriber{audience?.active === 1 ? '' : 's'} · Subject: <b>{subject}</b></div>
            <div className="nl-preview">
              <div className="nl-pv-brand">automonie</div>
              <div className="nl-pv-card" dangerouslySetInnerHTML={{ __html: body }} />
              <div className="nl-pv-foot">You&apos;re getting this because you joined the Automonie waitlist. <u>Unsubscribe</u>.</div>
            </div>
            <div className="nl-modal-actions">
              <button className="nl-test" onClick={() => setReview(false)}>Back to edit</button>
              <button className="nl-send" onClick={send} disabled={busy === 'send'}>{busy === 'send' ? 'Sending…' : `Confirm & send to ${audience?.active}`}</button>
            </div>
          </div>
        </div>
      )}

      <style jsx="true">{`
        .nl-wrap { max-width: 760px; margin: 0 auto; padding: 20px; }
        .nl-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .nl-modal { background: var(--bg-card, #fff); border: 1px solid var(--border-color); border-radius: 14px; width: 100%; max-width: 620px; max-height: 88vh; overflow-y: auto; padding: 18px; }
        .nl-modal-head { display: flex; justify-content: space-between; align-items: center; color: var(--text-primary); font-size: 1.05rem; }
        .nl-x { background: transparent; border: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
        .nl-modal-sub { color: var(--text-secondary); font-size: 0.85rem; margin: 6px 0 12px; }
        .nl-preview { background: #f6f8fa; border-radius: 12px; padding: 16px; }
        .nl-pv-brand { font-weight: 800; font-size: 20px; color: #0f6e56; margin-bottom: 10px; }
        .nl-pv-card { background: #fff; border: 1px solid #e7ebf1; border-radius: 12px; padding: 18px; color: #0b1326; line-height: 1.6; }
        .nl-pv-card img { max-width: 100%; height: auto; }
        .nl-pv-foot { color: #8a97a8; font-size: 12px; padding: 12px 4px 0; }
        .nl-modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 14px; }
        .nl-embedded { padding: 0; max-width: none; }
        .nl-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .nl-head p { color: var(--text-secondary); margin: 0 0 18px; line-height: 1.5; }
        .nl-audience { display: flex; align-items: center; gap: 10px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 14px; color: var(--text-primary); font-size: 0.9rem; margin-bottom: 14px; }
        .nl-audience i.fa-users { color: var(--accent-primary); }
        .nl-refresh { margin-left: auto; background: transparent; border: none; color: var(--text-secondary); cursor: pointer; }
        .nl-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; }
        .nl-msg.success { background: rgba(34,197,94,0.12); color: #22c55e; }
        .nl-msg.error { background: rgba(239,68,68,0.12); color: #ef4444; }
        .nl-label { display: block; color: var(--text-secondary); font-size: 0.8rem; font-weight: 700; margin: 4px 0 6px; }
        .nl-subject { width: 100%; box-sizing: border-box; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 11px 13px; color: var(--text-primary); font-size: 1rem; margin-bottom: 14px; }
        .nl-hint { color: var(--text-secondary); font-size: 0.8rem; margin: 8px 0 0; line-height: 1.5; }
        .nl-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
        .nl-test { background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-md); padding: 11px 20px; font-weight: 700; cursor: pointer; }
        .nl-send { background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 11px 22px; font-weight: 800; cursor: pointer; }
        .nl-test:disabled, .nl-send:disabled { opacity: 0.5; cursor: default; }
        .nl-history { margin-top: 26px; }
        .nl-history h3 { color: var(--text-primary); margin: 0 0 10px; }
        .nl-hrow { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color); }
        .nl-hmain { min-width: 0; }
        .nl-hsubject { color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .nl-hmeta { color: var(--text-secondary); font-size: 0.78rem; }
        .nl-hcount { color: var(--text-secondary); font-size: 0.82rem; white-space: nowrap; }
      `}</style>
    </div>
  );
}
