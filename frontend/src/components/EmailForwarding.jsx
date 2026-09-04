import React, { useEffect, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Email forwarding setup (spec B1) — web parity with the mobile screen. Shows the
// user's unique inbound address, how to point their bank alerts at it, and a live
// "we're receiving your alerts" status.

const STEPS = [
  { title: 'Copy your address', body: 'Use the Copy button above.' },
  { title: 'Open Gmail on the web', body: 'Settings → Filters and Blocked Addresses → Create a new filter.' },
  { title: 'Match your bank', body: 'In “From”, enter your bank’s alert address (e.g. alerts@gtbank.com). Create filter.' },
  { title: 'Forward to your address', body: 'Tick “Forward it to” and paste your address. Gmail sends a one-time confirmation.' },
  { title: 'Done', body: 'New bank emails now import themselves — nothing to open.' },
];

export default function EmailForwarding() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/inbound-email/address`, headers);
      setData(data);
      return data;
    } catch { setError('Could not load your email address.'); return null; }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll status until the first alert lands, then flip to "receiving ✓".
  useEffect(() => {
    if (!data || data.receiving) return;
    pollRef.current = setInterval(async () => {
      try {
        const { data: s } = await axios.get(`${API_URL}/api/inbound-email/status`, headers);
        if (s.receiving) setData((d) => ({ ...d, ...s }));
      } catch { /* keep polling */ }
    }, 6000);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const copy = async () => {
    if (!data) return;
    try { await navigator.clipboard.writeText(data.address); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="ef-page">
      <div className="ef-head">
        <h2><i className="fas fa-envelope-open-text"></i> Email forwarding</h2>
        <p>Forward your bank’s alert emails to your private address and they import themselves — no scanning, no uploads.</p>
      </div>

      {loading ? <div className="ef-card">Loading…</div> : error ? <div className="ef-card ef-err">{error}</div> : (
        <>
          <div className="ef-addr-card">
            <div>
              <div className="ef-label">YOUR PRIVATE ADDRESS</div>
              <div className="ef-addr">{data.address}</div>
            </div>
            <button className="ef-copy" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </div>

          {data.receiving ? (
            <div className="ef-status ef-ok"><i className="fas fa-circle-check"></i> Receiving your alerts{data.count ? ` — ${data.count} imported so far` : ''}.</div>
          ) : (
            <div className="ef-status ef-wait"><i className="fas fa-clock"></i> Waiting for your first forwarded email…</div>
          )}

          {!data.active && (
            <div className="ef-note"><i className="fas fa-circle-info"></i> Forwarding goes live shortly — your address is reserved and won’t change.</div>
          )}

          <div className="ef-card">
            <h3>How to set it up (once)</h3>
            <ol className="ef-steps">
              {STEPS.map((s) => <li key={s.title}><strong>{s.title}.</strong> {s.body}</li>)}
            </ol>
            <a className="ef-gmail" href="https://mail.google.com/mail/u/0/#settings/filters" target="_blank" rel="noreferrer">
              <i className="fas fa-external-link-alt"></i> Open Gmail filters
            </a>
          </div>

          <p className="ef-privacy">We only accept mail from known banks — anything else is ignored. Your address is private to you.</p>
        </>
      )}

      <style jsx="true">{`
        .ef-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .ef-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .ef-head p { color: var(--text-secondary); margin: 0 0 18px; }
        .ef-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; margin-bottom: 16px; color: var(--text-primary); }
        .ef-err { color: #e53e3e; }
        .ef-addr-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: var(--bg-card); border: 2px solid var(--accent-primary); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; flex-wrap: wrap; }
        .ef-label { font-size: 0.7rem; font-weight: 800; letter-spacing: 0.6px; color: var(--accent-primary); }
        .ef-addr { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); word-break: break-all; margin-top: 3px; }
        .ef-copy { background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-full); padding: 9px 18px; font-weight: 700; cursor: pointer; }
        .ef-status { display: flex; align-items: center; gap: 9px; padding: 12px 14px; border-radius: var(--radius-md); margin-bottom: 14px; font-weight: 600; }
        .ef-ok { background: rgba(56,161,105,0.1); border: 1px solid #38a169; color: var(--text-primary); }
        .ef-wait { background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-secondary); }
        .ef-note { display: flex; align-items: center; gap: 8px; background: var(--glass-bg); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; color: var(--text-secondary); font-size: 0.86rem; margin-bottom: 16px; }
        .ef-steps { margin: 10px 0 0; padding-left: 20px; color: var(--text-primary); line-height: 1.6; }
        .ef-steps li { margin-bottom: 8px; }
        .ef-gmail { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px; color: var(--accent-primary); font-weight: 700; text-decoration: none; }
        .ef-privacy { color: var(--text-secondary); font-size: 0.8rem; text-align: center; }
      `}</style>
    </div>
  );
}
