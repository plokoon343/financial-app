import React, { useEffect, useState } from 'react';

// A2HS (Add to Home Screen) prompt. iOS Safari never fires an install event, so
// PWA users there never discover they can install — this shows the manual
// "Share → Add to Home Screen" steps on iOS, and a one-tap Install button on
// Android/desktop Chrome (which does fire beforeinstallprompt).
const DISMISS_KEY = 'a2hs_dismissed_v1';

const ua = () => navigator.userAgent || '';
const isIos = () => /iphone|ipad|ipod/i.test(ua()) || (/Mac/.test(ua()) && 'ontouchend' in document);
const isSafari = () => /safari/i.test(ua()) && !/crios|fxios|edgios|android/i.test(ua());
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: '-3px', display: 'inline' }}
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 15V4M8 8l4-4 4 4" /><path d="M6 12v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7" />
  </svg>
);

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1');

  useEffect(() => {
    if (dismissed || isStandalone()) return undefined;
    const onBip = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener('beforeinstallprompt', onBip);
    if (isIos() && isSafari()) setShowIos(true);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, [dismissed]);

  if (dismissed || isStandalone() || (!deferred && !showIos)) return null;

  const dismiss = () => { setDismissed(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ } };
  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch { /* ignore */ }
    setDeferred(null); dismiss();
  };

  const bar = {
    position: 'fixed', left: '50%', transform: 'translateX(-50%)',
    bottom: 'calc(16px + env(safe-area-inset-bottom))', zIndex: 9999,
    width: 'calc(100% - 24px)', maxWidth: 460,
    background: '#0b1326', color: '#eaf2ff', borderRadius: 14,
    boxShadow: '0 12px 34px rgba(0,0,0,.35)', border: '1px solid rgba(255,255,255,.08)',
    padding: '13px 14px', display: 'flex', alignItems: 'center', gap: 12,
    fontSize: 14, lineHeight: 1.45,
  };
  const btn = {
    background: 'linear-gradient(135deg,#00a862,#008751)', color: '#fff', border: 'none',
    borderRadius: 10, padding: '9px 16px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const x = {
    background: 'transparent', color: 'rgba(234,242,255,.6)', border: 'none',
    fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flex: '0 0 auto',
  };

  return (
    <div style={bar} role="dialog" aria-label="Install Automonie">
      {deferred ? (
        <>
          <span style={{ flex: 1 }}>📲 Install <b>Automonie</b> for a faster, full-screen experience.</span>
          <button style={btn} onClick={install}>Install</button>
        </>
      ) : (
        <span style={{ flex: 1 }}>
          📲 Install <b>Automonie</b> on your iPhone: tap <b>Share</b> <ShareIcon /> then <b>“Add to Home Screen.”</b>
        </span>
      )}
      <button style={x} onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
