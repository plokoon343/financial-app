import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import './EmailSetup.css';

// Round 10 Part F1: "finish on your computer". Opened from the phone's QR code or the
// emailed link: /setup/email?t=<one-time token>. The token is redeemed once, then this
// page keeps going on a short page session that is held in sessionStorage so a refresh
// works. Everything shown belongs to the one user the link was made for.

const SESSION_KEY = 'automonie.emailSetup.session';
// React strict mode runs effects twice in development. A one-time token must not be
// spent twice, so the redeem request is shared per token.
const redeeming = new Map();
const redeemOnce = (t) => {
  if (!redeeming.has(t)) redeeming.set(t, axios.post(`${API_URL}/api/email-handoff/redeem`, { t }).then((r) => r.data));
  return redeeming.get(t);
};

const readSession = () => { try { return sessionStorage.getItem(SESSION_KEY) || ''; } catch { return ''; } };
const writeSession = (v) => { try { if (v) sessionStorage.setItem(SESSION_KEY, v); else sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ } };

const Tick = ({ done, label }) => (
  <li className={`es-tick ${done ? 'es-tick-done' : ''}`}>
    <span className="es-tick-dot" aria-hidden="true">{done ? '✓' : ''}</span>
    <span>{label}<span className="es-sr">{done ? ', done' : ', waiting'}</span></span>
  </li>
);

export default function EmailSetup() {
  const [params] = useSearchParams();
  const [state, setState] = useState('loading'); // loading | ready | gone
  const [view, setView] = useState(null);
  const [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const key = useRef('');
  const startedFor = useRef('');

  const headers = () => ({ 'x-handoff-session': key.current });

  const refresh = useCallback(async () => {
    if (!key.current) return;
    try {
      const { data } = await axios.get(`${API_URL}/api/email-handoff/view`, { headers: headers() });
      setView(data);
    } catch (e) {
      if (e.response && e.response.status === 401) { writeSession(''); key.current = ''; setState('gone'); }
    }
  }, []);

  useEffect(() => {
    const t = params.get('t') || '';
    if (startedFor.current === (t || 'none')) return;
    startedFor.current = t || 'none';
    // Take the token out of the address bar and history straight away.
    if (t) window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      if (t) {
        try {
          const r = await redeemOnce(t);
          key.current = r.sessionKey; writeSession(r.sessionKey);
          setView(r.view); setState('ready');
        } catch { setState('gone'); }
        return;
      }
      key.current = readSession();
      if (!key.current) { setState('gone'); return; }
      try {
        const { data } = await axios.get(`${API_URL}/api/email-handoff/view`, { headers: headers() });
        setView(data); setState('ready');
      } catch { writeSession(''); setState('gone'); }
    })();
  }, [params]);

  // Live ticks and the confirmation code: poll while the page is open.
  useEffect(() => {
    if (state !== 'ready') return undefined;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [state, refresh]);

  const copy = async (text, what) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 2000); }
    catch { setNote('Copy did not work here. Select the text and copy it by hand.'); }
  };

  const download = async () => {
    setBusy(true); setNote('');
    try {
      const { data } = await axios.get(`${API_URL}/api/email-handoff/filter.xml`, { headers: headers(), responseType: 'blob' });
      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url; a.download = 'automonie-filter.xml'; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      let msg = 'Could not prepare the filter file.';
      try { if (e.response && e.response.data) msg = JSON.parse(await e.response.data.text()).message || msg; } catch { /* keep default */ }
      setNote(msg);
    } finally { setBusy(false); }
  };

  const confirmed = async () => {
    try { await axios.post(`${API_URL}/api/email-handoff/confirmed`, {}, { headers: headers() }); await refresh(); }
    catch { setNote('Could not save that. Try again.'); }
  };

  if (state === 'loading') return <main className="es-page"><p className="es-muted" role="status">Opening your setup...</p></main>;
  if (state === 'gone') {
    return (
      <main className="es-page">
        <div className="es-card">
          <h1 className="es-h1">This link has expired or was already used</h1>
          <p className="es-muted">Open the Automonie app on your phone, go to Email forwarding, and choose Finish on your computer to get a new link. Each link works once and lasts 24 hours.</p>
        </div>
      </main>
    );
  }

  const t = view.ticks;
  const code = view.gmailVerification && view.gmailVerification.code;
  const link = view.gmailVerification && view.gmailVerification.link;
  const f = view.filter;

  return (
    <main className="es-page">
      <div className="es-card">
        <h1 className="es-h1">Finish your email setup</h1>
        <p className="es-muted">Three short steps in Gmail. Your phone shows the same progress.</p>

        <ul className="es-ticks" aria-label="Progress">
          <Tick done={t.linkOpened} label="Link opened" />
          <Tick done={t.gmailConfirmed} label="Gmail confirmed" />
          <Tick done={t.firstBankEmail} label="First bank email" />
        </ul>

        <section className="es-step">
          <h2 className="es-h2"><span className="es-num">1</span> Add your forwarding address in Gmail</h2>
          <p className="es-muted">In Gmail, open Settings, then See all settings, then Forwarding and POP/IMAP, then Add a forwarding address. Paste this address.</p>
          <div className="es-copy">
            <code className="es-code" data-testid="address">{view.address}</code>
            <button type="button" className="es-btn" onClick={() => copy(view.address, 'address')}>{copied === 'address' ? 'Copied' : 'Copy'}</button>
          </div>
          <a className="es-link" href="https://mail.google.com/mail/u/0/#settings/fwdandpop" target="_blank" rel="noopener noreferrer">Open Gmail forwarding settings</a>
          {!view.active && <p className="es-muted">Forwarding goes live shortly. Your address is reserved and will not change.</p>}
        </section>

        <section className="es-step">
          <h2 className="es-h2"><span className="es-num">2</span> Enter the confirmation code</h2>
          {code || link ? (
            <>
              <p className="es-muted">Gmail sent a code to your address. It arrived here, so you do not need to look for it.</p>
              {code && (
                <div className="es-copy">
                  <code className="es-code es-code-big" data-testid="code">{code}</code>
                  <button type="button" className="es-btn" onClick={() => copy(code, 'code')}>{copied === 'code' ? 'Copied' : 'Copy'}</button>
                </div>
              )}
              {link && <a className="es-link" href={link} target="_blank" rel="noopener noreferrer">Confirm in Gmail instead</a>}
              <button type="button" className="es-btn es-btn-main" onClick={confirmed}>I entered it</button>
            </>
          ) : t.gmailConfirmed ? (
            <p className="es-ok">Gmail is confirmed.</p>
          ) : (
            <p className="es-muted" role="status">Waiting for Gmail to send the code. This page will show it as soon as it arrives.</p>
          )}
        </section>

        <section className="es-step">
          <h2 className="es-h2"><span className="es-num">3</span> Import the filter</h2>
          {f.count ? (
            <>
              <p className="es-muted">The filter forwards only your banks&apos; alerts ({f.count} sender{f.count === 1 ? '' : 's'}), not your other mail. Download it, then in Gmail open Settings, Filters and Blocked Addresses, Import filters, choose the file and tick the filter.</p>
              <button type="button" className="es-btn es-btn-main" onClick={download} disabled={busy}>{busy ? 'Preparing...' : 'Download filter file'}</button>
            </>
          ) : (
            <p className="es-muted">We are still learning your bank&apos;s alert address. Forward one bank alert to the address above once, and the filter file appears here.</p>
          )}
          {!!f.missingBanks.length && <p className="es-muted">Still learning: {f.missingBanks.map((b) => b.name).join(', ')}.</p>}
          <p className="es-muted">Do not turn on Gmail&apos;s &quot;Forward a copy of incoming mail&quot;. That sends all your mail, not just bank alerts.</p>
        </section>

        {!!note && <p className="es-err" role="alert">{note}</p>}
        <p className="es-fine">This page belongs to your account only. We never ask for your email password.</p>
      </div>
    </main>
  );
}
