import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Pings the backend health endpoint on load. If the (free-tier) server is asleep,
// the first request is slow/failing, so we show a friendly "waking up" overlay and
// keep retrying until it responds — instead of the app looking broken.
const ServerWaker = () => {
  const [status, setStatus] = useState('checking'); // 'checking' | 'waking' | 'ready'

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const ping = async () => {
      try {
        await axios.get(`${API_URL}/api/health`, { timeout: 8000 });
        if (!cancelled) setStatus('ready');
      } catch {
        attempts += 1;
        if (!cancelled) {
          setStatus('waking');
          if (attempts < 25) setTimeout(ping, 3000); // retry ~75s max
          else setStatus('ready'); // give up quietly; per-page errors will show
        }
      }
    };

    // Only reveal the overlay if the first check is slow (avoid a flash on warm servers).
    const slowTimer = setTimeout(() => { if (!cancelled) setStatus(s => (s === 'checking' ? 'waking' : s)); }, 1800);
    ping();
    return () => { cancelled = true; clearTimeout(slowTimer); };
  }, []);

  if (status !== 'waking') return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000,
      background: 'rgba(15,12,41,0.72)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }}>
      <div style={{
        background: 'rgba(38,38,54,0.96)', color: '#f8f9fa', borderRadius: '16px',
        padding: '28px 30px', maxWidth: '380px', textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
      }}>
        <div style={{
          width: '46px', height: '46px', margin: '0 auto 16px',
          border: '4px solid rgba(255,255,255,0.18)', borderTopColor: 'var(--accent-primary)',
          borderRadius: '50%', animation: 'sw-spin 1s linear infinite',
        }} />
        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem' }}>Waking up the server…</h3>
        <p style={{ margin: 0, fontSize: '0.85rem', opacity: 0.8, lineHeight: 1.5 }}>
          The free server sleeps after inactivity. The first load can take up to a minute — hang tight, this happens automatically.
        </p>
      </div>
      <style>{`@keyframes sw-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};

export default ServerWaker;
