import React, { useEffect, useState } from 'react';
import './Logo.css';
import markPng from '../assets/logo-mark.png';
import fullDark from '../assets/logo-full-dark.png';   // black wordmark — for light backgrounds
import fullLight from '../assets/logo-full-light.png';  // white wordmark — for dark backgrounds

// The mark on its own (the gradient "A → o"). `animate='pulse'` gives the
// branded loading animation used in place of the classic spinner.
export const LogoMark = ({ size = 40, animate, className = '', style }) => (
  <img
    src={markPng}
    alt="Automonie"
    className={`am-mark ${animate === 'pulse' ? 'am-pulse' : ''} ${className}`}
    style={{ height: size, width: 'auto', ...style }}
    draggable="false"
  />
);

const isLight = (c) => typeof c === 'string' && ['#fff', '#ffffff', 'white'].includes(c.toLowerCase());

// Mark + "automonie" wordmark. `variant`:
//   'auto'  (default) — black wordmark, switches to white under .dark-theme
//   'light' — always white wordmark (for dark surfaces like the sidebar)
//   'dark'  — always black wordmark
// `color` is kept for backwards-compat: color="#fff" maps to variant="light".
export const LogoFull = ({ height = 34, variant = 'auto', color, className = '' }) => {
  const v = variant !== 'auto' ? variant : (color ? (isLight(color) ? 'light' : 'dark') : 'auto');
  if (v === 'light' || v === 'dark') {
    return <img src={v === 'light' ? fullLight : fullDark} alt="automonie" className={`am-full ${className}`} style={{ height }} draggable="false" />;
  }
  return (
    <span className={`am-full am-auto ${className}`} style={{ height }}>
      <img className="am-fd" src={fullDark} alt="automonie" style={{ height }} draggable="false" />
      <img className="am-fl" src={fullLight} alt="" style={{ height }} draggable="false" />
    </span>
  );
};

// Branded loading indicator — the pulsing logo icon, in place of the spinner.
export const Loader = ({ size = 56, label }) => (
  <div className="am-loader" role="status" aria-label={label || 'Loading'}>
    <LogoMark size={size} animate="pulse" />
    {label && <span className="am-loader-label">{label}</span>}
  </div>
);

// Brief branded splash that reveals the logo on open, then fades and unmounts.
export const Splash = ({ onDone }) => {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { setHidden(true); onDone && onDone(); }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (hidden) return null;
  return (
    <div className="am-splash">
      <div className="am-splash-inner"><LogoFull height={48} variant="light" /></div>
    </div>
  );
};

export default LogoFull;
