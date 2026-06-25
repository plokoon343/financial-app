import React, { useEffect, useState } from 'react';
import './Logo.css';
import markPng from '../assets/logo-mark.png';
import fullDark from '../assets/logo-full-dark.png';   // black wordmark — for light backgrounds
import fullLight from '../assets/logo-full-light.png';  // white wordmark — for dark backgrounds
import loadingVid from '../assets/loading.mp4';
import splashVid from '../assets/splash.mp4';

// The mark on its own (the gradient "A → o"). `animate='pulse'` gives the
// branded loading pulse used in place of the classic spinner.
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

// Branded loading indicator — the looping logo animation, in place of the spinner.
export const Loader = ({ size = 64, label }) => (
  <div className="am-loader" role="status" aria-label={label || 'Loading'}>
    <video className="am-loader-vid" src={loadingVid} autoPlay loop muted playsInline style={{ height: size }} />
    {label && <span className="am-loader-label">{label}</span>}
  </div>
);

// Full-screen launch animation that morphs into the logo, shown once on open.
export const Splash = ({ onDone }) => {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    // Safety net in case `onEnded` never fires (autoplay blocked, etc.).
    const t = setTimeout(() => finish(), 4500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const finish = () => { setHidden(true); onDone && onDone(); };
  if (hidden) return null;
  return (
    <div className="am-splash" onClick={finish}>
      <video className="am-splash-vid" src={splashVid} autoPlay muted playsInline onEnded={finish} />
    </div>
  );
};

export default LogoFull;
