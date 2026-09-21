import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { prettyMerchant, computeArchetype } from '../lib/insights';

// Recaps (web parity with the mobile /recap screen). Spotify-style period "stories"
// — daily / weekly / monthly / yearly — computed client-side from the user's own
// transactions, gated by the server release config (/api/recaps/config). A hub lists
// the recaps that are live right now; opening one plays the same gradient carousel as
// Money Wrapped. Never shows a naira figure on the shareable slides.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DEFAULT_CONFIG = { day: 'auto', week: 'auto', month: 'auto', year: 'auto' };

// Which recaps are live now, mirroring lib/recaps.ts on mobile.
function availableRecaps(config, now = new Date()) {
  const metas = [];
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  metas.push({ id: `day-${isoDate(yest)}`, window: 'day', title: 'Daily recap', label: yest.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }), from: isoDate(yest), to: isoDate(yest) });

  const dow = (now.getDay() + 6) % 7;
  const thisMon = new Date(now); thisMon.setDate(now.getDate() - dow); thisMon.setHours(0, 0, 0, 0);
  const lastMon = new Date(thisMon); lastMon.setDate(thisMon.getDate() - 7);
  const lastSun = new Date(thisMon); lastSun.setDate(thisMon.getDate() - 1);
  metas.push({ id: `week-${isoDate(lastMon)}`, window: 'week', title: 'Weekly recap', label: `${lastMon.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${lastSun.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`, from: isoDate(lastMon), to: isoDate(lastSun) });

  const mFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mLast = new Date(now.getFullYear(), now.getMonth(), 0);
  metas.push({ id: `month-${mFirst.getFullYear()}-${String(mFirst.getMonth() + 1).padStart(2, '0')}`, window: 'month', title: 'Monthly recap', label: mFirst.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }), from: isoDate(mFirst), to: isoDate(mLast) });

  const yFirst = new Date(now.getFullYear(), 0, 1);
  metas.push({ id: `year-${now.getFullYear()}`, window: 'year', title: `${now.getFullYear()} Wrapped`, label: `${now.getFullYear()} in review`, from: isoDate(yFirst), to: isoDate(now) });

  const autoOk = (w) => {
    if (w === 'day') return true;
    if (w === 'week') return true;
    if (w === 'month') return now.getDate() <= 10;
    return now.getMonth() === 11;
  };
  return metas.filter((m) => {
    if (m.window === 'year' && now.getMonth() !== 11) return false; // Wrapped only in December
    const rule = config[m.window] || 'auto';
    return rule === 'on' ? true : rule === 'off' ? false : autoOk(m.window);
  });
}

const WINDOW_ICON = { day: 'fa-sun', week: 'fa-calendar-week', month: 'fa-calendar-days', year: 'fa-star' };

function buildSlides(all, meta) {
  const { window: win, from, to, label } = meta;
  const heading = win === 'day' ? 'Daily recap' : win === 'week' ? 'Weekly recap' : win === 'year' ? `${(from || '').slice(0, 4)} Wrapped` : 'Monthly recap';
  const inRange = all.filter((t) => (t.date || '') >= from && (t.date || '') <= to);
  const expenses = inRange.filter((t) => t.type === 'expense');
  const totalExpense = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const minTx = win === 'day' ? 1 : win === 'week' ? 3 : 4;
  if (expenses.length < minTx || totalExpense <= 0) return { heading, slides: [] };

  const byM = new Map();
  expenses.forEach((t) => { const k = prettyMerchant(t.description); byM.set(k, (byM.get(k) || 0) + 1); });
  const topM = [...byM.entries()].sort((a, b) => b[1] - a[1])[0];
  const byC = new Map();
  expenses.forEach((t) => { const c = t.category || 'Other'; byC.set(c, (byC.get(c) || 0) + Math.abs(t.amount)); });
  const topC = [...byC.entries()].sort((a, b) => b[1] - a[1])[0];
  const topCPct = topC ? Math.round((topC[1] / totalExpense) * 100) : 0;
  const income = inRange.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const savingsRate = income > 0 ? Math.round(((income - totalExpense) / income) * 100) : 0;
  const spentDays = new Set(expenses.map((t) => t.date));

  const out = [];
  out.push({ key: 'intro', colors: ['#0e9f6e', '#075f4d'], fa: 'fa-wand-magic-sparkles', eyebrow: 'AUTOMONIE', big: heading, sub: `${label || `${from} – ${to}`}  ·  swipe →` });

  if (win === 'year') {
    const byMonthCount = Array(12).fill(0);
    expenses.forEach((t) => { byMonthCount[+t.date.slice(5, 7) - 1] += 1; });
    const busiest = byMonthCount.indexOf(Math.max(...byMonthCount));
    const monthsActive = byMonthCount.filter((n) => n > 0).length;
    out.push({ key: 'vol', colors: ['#6d28d9', '#4c1d95'], fa: 'fa-receipt', eyebrow: 'THE NUMBERS', big: `${expenses.length}\ntransactions`, sub: `across ${monthsActive} month${monthsActive === 1 ? '' : 's'} · ${MONTHS[busiest]} was your busiest` });
    const yr = +(from || '').slice(0, 4);
    const monthly = [];
    for (let m = 1; m <= 12; m++) { const r = computeArchetype(inRange, 0, `${yr}-${String(m).padStart(2, '0')}`); if (r) monthly.push(r.archetype); }
    const freq = new Map();
    monthly.forEach((a) => { const e = freq.get(a.key) || { a, n: 0 }; e.n += 1; freq.set(a.key, e); });
    const dominant = [...freq.values()].sort((x, y) => y.n - x.n)[0]?.a;
    const distinct = [];
    monthly.forEach((a) => { if (!distinct.length || distinct[distinct.length - 1].key !== a.key) distinct.push(a); });
    if (topM) out.push({ key: 'merch', colors: ['#0ea5e9', '#0369a1'], fa: 'fa-heart', eyebrow: 'RIDE OR DIE', big: topM[0], sub: `${topM[1]} visits this year. Loyalty like this is rare.` });
    if (distinct.length > 1) out.push({ key: 'journey', colors: ['#f59e0b', '#b45309'], fa: 'fa-arrow-trend-up', eyebrow: 'THE GLOW-UP', big: distinct.map((a) => a.name.replace('The ', '')).join('  →  '), sub: 'You shape-shifted through the year. Character development.' });
    if (dominant) out.push({ key: 'era', colors: [dominant.color, dominant.color], sym: dominant.icon, eyebrow: `YOUR ${yr} ERA`, big: dominant.name, sub: dominant.tagline });
  } else {
    if (win === 'month') {
      const r = computeArchetype(inRange, income, (from || '').slice(0, 7));
      if (r) out.push({ key: 'arche', colors: [r.archetype.color, r.archetype.color], sym: r.archetype.icon, eyebrow: 'THIS MONTH YOU WERE', big: r.archetype.name, sub: r.archetype.tagline });
    }
    if (topM) out.push({ key: 'merch', colors: ['#0ea5e9', '#0369a1'], fa: 'fa-heart', eyebrow: win === 'day' ? 'TODAY’S MVP' : 'MOST-VISITED', big: topM[0], sub: topM[1] > 1 ? `${topM[1]} visits. The relationship is strong.` : 'Your standout spot this time.' });
    if (topC) out.push({ key: 'cat', colors: ['#8b5cf6', '#5b21b6'], fa: 'fa-chart-pie', eyebrow: 'WHERE IT WENT', big: topC[0], sub: `${topCPct}% of your spend went here.` });
    if (savingsRate >= 15) out.push({ key: 'save', colors: ['#14b8a6', '#0f766e'], fa: 'fa-shield-halved', eyebrow: 'DISCIPLINE', big: `${savingsRate}% kept`, sub: 'You held money back. Future you says thank you.' });
    else if (spentDays.size >= 5 && win !== 'day') out.push({ key: 'active', colors: ['#f97316', '#c2410c'], fa: 'fa-bolt', eyebrow: 'BUSY BEE', big: `${spentDays.size} spending days`, sub: 'Your card saw the streets this period.' });
  }

  out.push({ key: 'share', colors: ['#ec4899', '#9d174d'], fa: 'fa-share-nodes', eyebrow: 'THAT’S A WRAP', big: 'Share this\nrecap', sub: 'Personality only — never your figures. Safe for the group chat.', share: true });
  return { heading, slides: out };
}

function RecapPlayer({ all, meta, onClose }) {
  const [idx, setIdx] = useState(0);
  const [toast, setToast] = useState('');
  const touchX = useRef(null);
  const { heading, slides } = useMemo(() => buildSlides(all, meta), [all, meta]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2000); };

  const go = useCallback((d) => setIdx((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const share = async () => {
    const era = slides.find((s) => s.key === 'era' || s.key === 'arche');
    const text = era
      ? `My ${heading.toLowerCase()}: ${era.big}.\n"${era.sub}"\n\nGet yours on Automonie → automonie.com`
      : `My ${heading} on Automonie → automonie.com`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); flash('Copied — paste it anywhere'); }
    } catch { /* cancelled */ }
  };

  const s = slides[idx];
  return (
    <div className="rc-overlay" onClick={onClose}>
      <div className="rc-stage-wrap" onClick={(e) => e.stopPropagation()}>
        {toast && <div className="rc-toast">{toast}</div>}
        <button className="rc-close" onClick={onClose} aria-label="Close"><i className="fas fa-times"></i></button>
        {slides.length === 0 ? (
          <div className="rc-stage rc-empty" style={{ background: 'linear-gradient(135deg,#1f2937,#0b1120)' }}>
            <i className="fas fa-film" style={{ fontSize: '2.4rem', opacity: 0.7 }}></i>
            <div className="rc-empty-title">Nothing to recap here yet</div>
            <div className="rc-empty-sub">Add or import a few transactions for this period and the recap comes alive.</div>
          </div>
        ) : (
          <div
            className="rc-stage"
            style={{ background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})` }}
            onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
            onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touchX.current = null; }}
          >
            <div className="rc-icon">{s.sym ? <span className="material-symbols-outlined" style={{ fontSize: 30 }}>{s.sym}</span> : <i className={`fas ${s.fa}`}></i>}</div>
            <div className="rc-eyebrow">{s.eyebrow}</div>
            <div className="rc-big">{s.big}</div>
            <div className="rc-sub">{s.sub}</div>
            {s.share && <button className="rc-share" onClick={share}><i className="fas fa-share-nodes"></i> Share my recap</button>}
            {idx > 0 && <button className="rc-nav rc-prev" onClick={() => go(-1)} aria-label="Previous"><i className="fas fa-chevron-left"></i></button>}
            {idx < slides.length - 1 && <button className="rc-nav rc-next" onClick={() => go(1)} aria-label="Next"><i className="fas fa-chevron-right"></i></button>}
            <div className="rc-dots">{slides.map((sl, i) => <span key={sl.key} className={`rc-dot ${i === idx ? 'on' : ''}`} onClick={() => setIdx(i)} />)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Recap() {
  const [all, setAll] = useState(null);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [active, setActive] = useState(null);
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };

  useEffect(() => {
    axios.get(`${API_URL}/api/transactions`, headers).then((r) => setAll(r.data || [])).catch(() => setAll([]));
    axios.get(`${API_URL}/api/recaps/config`, headers).then((r) => setConfig({ ...DEFAULT_CONFIG, ...(r.data || {}) })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const available = useMemo(() => availableRecaps(config), [config]);
  const loading = all === null;

  return (
    <div className="rc-page">
      <div className="rc-head">
        <h2><i className="fas fa-clapperboard"></i> Your recaps</h2>
        <p>Spotify-style stories of your money — your standout merchant, where it went, your spending personality. Personality only, never your figures.</p>
      </div>

      {loading ? (
        <div className="rc-card">Loading your recaps…</div>
      ) : available.length === 0 ? (
        <div className="rc-card rc-none">
          <i className="fas fa-film" style={{ fontSize: '2rem', opacity: 0.6 }}></i>
          <p>No recaps live right now.</p>
          <p className="rc-none-sub">Daily and weekly recaps drop as periods complete; Money Wrapped arrives in December.</p>
        </div>
      ) : (
        <div className="rc-grid">
          {available.map((m) => (
            <button key={m.id} className="rc-tile" onClick={() => setActive(m)}>
              <div className="rc-tile-icon"><i className={`fas ${WINDOW_ICON[m.window]}`}></i></div>
              <div className="rc-tile-main">
                <div className="rc-tile-title">{m.title}</div>
                <div className="rc-tile-label">{m.label}</div>
              </div>
              <i className="fas fa-play rc-tile-play"></i>
            </button>
          ))}
        </div>
      )}

      {active && all && <RecapPlayer all={all} meta={active} onClose={() => setActive(null)} />}

      <style jsx="true">{`
        .rc-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .rc-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .rc-head p { color: var(--text-secondary); margin: 0 0 18px; line-height: 1.5; }
        .rc-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 20px; color: var(--text-primary); }
        .rc-none { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .rc-none-sub { color: var(--text-secondary); font-size: 0.88rem; max-width: 360px; }
        .rc-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
        .rc-tile { display: flex; align-items: center; gap: 14px; text-align: left; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; cursor: pointer; transition: border-color .15s, transform .1s; }
        .rc-tile:hover { border-color: var(--accent-primary); }
        .rc-tile:active { transform: scale(.99); }
        .rc-tile-icon { width: 46px; height: 46px; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: var(--gradient-primary, var(--accent-primary)); color: #fff; font-size: 1.1rem; flex-shrink: 0; }
        .rc-tile-main { flex: 1; min-width: 0; }
        .rc-tile-title { font-weight: 800; color: var(--text-primary); }
        .rc-tile-label { color: var(--text-secondary); font-size: 0.85rem; margin-top: 2px; }
        .rc-tile-play { color: var(--accent-primary); }

        .rc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .rc-stage-wrap { position: relative; width: 100%; max-width: 480px; }
        .rc-toast { position: absolute; top: -44px; left: 0; right: 0; background: #111827; color: #fff; padding: 9px 14px; border-radius: 999px; text-align: center; font-weight: 600; z-index: 5; }
        .rc-close { position: absolute; top: 12px; right: 12px; z-index: 6; width: 38px; height: 38px; border-radius: 50%; border: none; background: rgba(0,0,0,0.3); color: #fff; cursor: pointer; }
        .rc-stage { position: relative; border-radius: 24px; min-height: 74vh; padding: 40px 32px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 16px; overflow: hidden; color: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.35); }
        .rc-icon { width: 60px; height: 60px; border-radius: 18px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 1.5rem; }
        .rc-eyebrow { font-size: 0.8rem; font-weight: 900; letter-spacing: 2px; color: rgba(255,255,255,0.85); }
        .rc-big { font-size: 2.3rem; font-weight: 900; line-height: 1.12; white-space: pre-line; }
        .rc-sub { font-size: 1.05rem; font-weight: 600; line-height: 1.5; color: rgba(255,255,255,0.92); max-width: 92%; }
        .rc-share { display: inline-flex; align-items: center; gap: 10px; background: #fff; color: #0b1326; border: none; padding: 13px 22px; border-radius: 14px; font-weight: 800; cursor: pointer; margin-top: 6px; }
        .rc-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 42px; height: 42px; border-radius: 50%; border: none; background: rgba(0,0,0,0.28); color: #fff; cursor: pointer; }
        .rc-prev { left: 12px; } .rc-next { right: 12px; }
        .rc-dots { position: absolute; bottom: 20px; left: 0; right: 0; display: flex; gap: 7px; justify-content: center; }
        .rc-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.4); cursor: pointer; }
        .rc-dot.on { background: #fff; width: 22px; border-radius: 4px; }
        .rc-empty { align-items: center; justify-content: center; text-align: center; }
        .rc-empty-title { font-size: 1.3rem; font-weight: 800; }
        .rc-empty-sub { font-size: 0.95rem; color: rgba(255,255,255,0.8); max-width: 340px; line-height: 1.5; }
      `}</style>
    </div>
  );
}
