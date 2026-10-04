import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Auto-capture: transactions arrive without opening Automonie. On iPhone a Shortcuts
// automation forwards each bank SMS; on Android the app reads bank-app notifications.
// Both authenticate with the user's capture key, shown here once when created.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const ENDPOINT = `${API_URL}/api/ingest/capture`;

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select manually */ }
  };
  return (
    <div className="cap-copy">
      <span className="cap-copy-label">{label}</span>
      <code className="cap-copy-value">{value}</code>
      <button type="button" className="btn-secondary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

export default function AutoCapture() {
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { const { data } = await axios.get(`${API_URL}/api/capture/status`, auth()); setStatus(data); }
    catch { setError('Could not load your capture status.'); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const createKey = async () => {
    if (status?.connected && !window.confirm('A new key disconnects every phone and Shortcut using the old one. Continue?')) return;
    setBusy(true); setError('');
    try { const { data } = await axios.post(`${API_URL}/api/capture/key`, {}, auth()); setKey(data.key); load(); }
    catch { setError('Could not create a key. Try again.'); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm('Stop all auto-capture? Phones and Shortcuts will stop sending transactions.')) return;
    try { await axios.delete(`${API_URL}/api/capture/key`, auth()); setKey(''); load(); }
    catch { setError('Could not disconnect. Try again.'); }
  };

  const keyShown = key || '<your capture key>';

  return (
    <div className="cap-page">
      <section className="cap-card">
        <div className="cap-head">
          <div>
            <h3><i className="fas fa-bolt" aria-hidden="true"></i> Auto-capture</h3>
            <p className="cap-sub">Log transactions the moment your bank alerts you, without opening Automonie.</p>
          </div>
          <span className={`cap-pill ${status?.connected ? 'on' : ''}`}>{status?.connected ? 'Connected' : 'Not set up'}</span>
        </div>
        {status?.connected && (
          <p className="cap-meta">
            {status.count ? `${status.count} transaction${status.count === 1 ? '' : 's'} captured` : 'Nothing captured yet'}
            {status.lastAt ? ` · last on ${new Date(status.lastAt).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
          </p>
        )}
        {error && <div className="message error">{error}</div>}
        {key ? (
          <div className="cap-key">
            <CopyRow label="Your capture key" value={key} />
            <p className="cap-warn"><i className="fas fa-lock" aria-hidden="true"></i> Copy it now. For your safety we only show it once. Keep it private: anyone with it can add transactions to your account.</p>
          </div>
        ) : (
          <div className="cap-actions">
            <button type="button" className="btn-primary" onClick={createKey} disabled={busy}>
              {status?.connected ? 'Create a new key' : 'Create my capture key'}
            </button>
            {status?.connected && <button type="button" className="btn-danger" onClick={disconnect}>Disconnect</button>}
          </div>
        )}
      </section>

      <section className="cap-card">
        <h3><i className="fab fa-apple" aria-hidden="true"></i> iPhone: forward bank texts automatically</h3>
        <p className="cap-sub">Needs iOS 17 or later. Set it up once for each bank that texts you. iPhone shows a small notice each time it runs; that is Apple's rule.</p>
        <ol className="cap-steps">
          <li>Create your capture key above and copy it.</li>
          <li>Open the <strong>Shortcuts</strong> app, go to <strong>Automation</strong>, tap <strong>+</strong>, then choose <strong>Message</strong>.</li>
          <li>Under <strong>Sender</strong>, pick your bank (for example GTBank). Choose <strong>Run Immediately</strong>, then <strong>Next</strong> and <strong>New Blank Automation</strong>.</li>
          <li>Add the action <strong>Get Contents of URL</strong> and paste this address:
            <CopyRow label="URL" value={ENDPOINT} />
          </li>
          <li>Tap the arrow to show more. Set <strong>Method</strong> to <strong>POST</strong>. Under <strong>Headers</strong>, add:
            <CopyRow label="Key" value="x-capture-key" />
            <CopyRow label="Text" value={keyShown} />
          </li>
          <li>Set <strong>Request Body</strong> to <strong>JSON</strong> and add three text fields:
            <ul>
              <li><code>source</code> with the value <code>sms</code></li>
              <li><code>text</code>: tap the value, pick <strong>Shortcut Input</strong>, then <strong>Content</strong></li>
              <li><code>sender</code>: pick <strong>Shortcut Input</strong>, then <strong>Sender</strong></li>
            </ul>
          </li>
          <li>Tap <strong>Done</strong>. Your next alert from that bank appears in Automonie within seconds.</li>
        </ol>
      </section>

      <section className="cap-card">
        <h3><i className="fab fa-android" aria-hidden="true"></i> Android: read bank app notifications</h3>
        <p className="cap-sub">For OPay, Moniepoint, PalmPay, Kuda and other banks that alert you through their app. Turn it on in the Automonie Android app under Accounts. It reads only the bank apps you approve.</p>
      </section>

      <style>{`
        .cap-page { display: grid; gap: 16px; }
        .cap-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; display: grid; gap: 12px; }
        .cap-card h3 { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; color: var(--text-primary); }
        .cap-card h3 i { color: var(--accent-primary); }
        .cap-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
        .cap-sub, .cap-meta { color: var(--text-secondary); font-size: 0.9rem; }
        .cap-pill { font-size: 0.78rem; font-weight: 600; padding: 4px 10px; border-radius: var(--radius-full); background: var(--glass-bg); color: var(--text-secondary); white-space: nowrap; }
        .cap-pill.on { background: rgba(22, 163, 74, 0.12); color: var(--success-color); }
        .cap-actions { display: flex; gap: 10px; flex-wrap: wrap; }
        .cap-key { display: grid; gap: 8px; }
        .cap-warn { font-size: 0.85rem; color: var(--warning-color); display: flex; gap: 8px; align-items: flex-start; }
        .cap-copy { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 6px; }
        .cap-copy-label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); min-width: 44px; }
        .cap-copy-value { flex: 1; min-width: 0; overflow-wrap: anywhere; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 6px 10px; font-size: 0.85rem; color: var(--text-primary); }
        .cap-steps { padding-left: 1.2rem; display: grid; gap: 10px; color: var(--text-primary); font-size: 0.93rem; }
        .cap-steps ul { margin-top: 6px; padding-left: 1.1rem; display: grid; gap: 4px; }
        .cap-steps code, .cap-sub code { background: var(--bg-input); padding: 1px 6px; border-radius: 6px; font-size: 0.85rem; }
      `}</style>
    </div>
  );
}
