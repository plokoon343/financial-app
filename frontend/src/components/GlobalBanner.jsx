import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Site-wide dismissible banner, set by an admin. Shows once per banner until the
// viewer dismisses it (dismissal remembered per-device in localStorage). A new banner
// (new id) shows again even if a previous one was dismissed.
const KEY = 'dismissed_banners';
const readDismissed = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };

const STYLES = {
  info:    { bg: '#0f6e56', fg: '#eafff5' },
  success: { bg: '#276749', fg: '#e6ffef' },
  warning: { bg: '#b45309', fg: '#fff7ed' },
};

export default function GlobalBanner() {
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    axios.get(`${API_URL}/api/global-banner`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        const b = r.data?.banner;
        if (b && !readDismissed().has(b.id)) setBanner(b);
      })
      .catch(() => {});
  }, []);

  if (!banner) return null;
  const s = STYLES[banner.type] || STYLES.info;
  const dismiss = () => {
    try {
      const set = readDismissed(); set.add(banner.id);
      localStorage.setItem(KEY, JSON.stringify([...set].slice(-40)));
    } catch { /* ignore */ }
    setBanner(null);
  };

  return (
    <div className="gb" style={{ background: s.bg, color: s.fg }}>
      <span className="gb-msg">{banner.message}</span>
      {banner.link && (
        <a className="gb-link" href={banner.link} target={/^https?:\/\//.test(banner.link) ? '_blank' : undefined} rel="noreferrer" style={{ color: s.fg }}>
          {banner.linkText || 'Learn more'}
        </a>
      )}
      <button className="gb-x" onClick={dismiss} aria-label="Dismiss" style={{ color: s.fg }}><i className="fas fa-times"></i></button>

      <style jsx="true">{`
        .gb { display: flex; align-items: center; gap: 12px; padding: 10px 16px; font-size: 0.9rem; font-weight: 600; line-height: 1.4; }
        .gb-msg { flex: 1; min-width: 0; }
        .gb-link { font-weight: 800; text-decoration: underline; white-space: nowrap; }
        .gb-x { background: transparent; border: none; cursor: pointer; opacity: 0.85; padding: 4px; }
        .gb-x:hover { opacity: 1; }
      `}</style>
    </div>
  );
}
