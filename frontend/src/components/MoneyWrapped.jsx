import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { prettyMerchant, computeArchetype } from '../lib/insights';

// Money Wrapped (web parity with the mobile /wrapped screen). A year-in-review story
// computed entirely client-side from the user's own transactions — never shows a
// naira figure on the shareable slides, so it's safe for the group chat. Rendered as
// a full-bleed gradient carousel (arrows / dots / keyboard / swipe).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function MoneyWrapped() {
  const [all, setAll] = useState(null);
  const [idx, setIdx] = useState(0);
  const [toast, setToast] = useState('');
  const touchX = useRef(null);
  const year = new Date().getFullYear();
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2000); };

  useEffect(() => {
    axios.get(`${API_URL}/api/transactions`, headers)
      .then((r) => setAll(r.data || []))
      .catch(() => setAll([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slides = useMemo(() => {
    if (!all) return [];
    const yr = all.filter((t) => (t.date || '').slice(0, 4) === String(year));
    const expenses = yr.filter((t) => t.type === 'expense');
    if (expenses.length < 5) return [];

    const byMonth = Array(12).fill(0);
    expenses.forEach((t) => { byMonth[+t.date.slice(5, 7) - 1] += 1; });
    const busiest = byMonth.indexOf(Math.max(...byMonth));
    const monthsActive = byMonth.filter((n) => n > 0).length;

    const byM = new Map();
    expenses.forEach((t) => { const k = prettyMerchant(t.description); byM.set(k, (byM.get(k) || 0) + 1); });
    const topM = [...byM.entries()].sort((a, b) => b[1] - a[1])[0];

    const monthly = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, '0')}`;
      const r = computeArchetype(yr, 0, key);
      if (r) monthly.push(r.archetype);
    }
    const freq = new Map();
    monthly.forEach((a) => { const e = freq.get(a.key) || { a, n: 0 }; e.n += 1; freq.set(a.key, e); });
    const dominant = [...freq.values()].sort((x, y) => y.n - x.n)[0]?.a;
    const distinct = [];
    monthly.forEach((a) => { if (!distinct.length || distinct[distinct.length - 1].key !== a.key) distinct.push(a); });

    const spentDays = new Set(expenses.map((t) => t.date));
    const elapsed = Math.round((Date.now() - new Date(year, 0, 1).getTime()) / 86400000) + 1;
    const noSpend = Math.max(0, elapsed - spentDays.size);

    const out = [];
    out.push({ key: 'intro', colors: ['#0e9f6e', '#075f4d'], fa: 'fa-wand-magic-sparkles', eyebrow: 'AUTOMONIE', big: `Your ${year},\nwrapped.`, sub: 'A year of your money, as a story — swipe →' });
    out.push({ key: 'vol', colors: ['#6d28d9', '#4c1d95'], fa: 'fa-receipt', eyebrow: 'THE NUMBERS', big: `${expenses.length}\ntransactions`, sub: `across ${monthsActive} month${monthsActive === 1 ? '' : 's'} · ${MONTHS[busiest]} was your busiest` });
    if (topM) out.push({ key: 'merch', colors: ['#0ea5e9', '#0369a1'], fa: 'fa-heart', eyebrow: 'RIDE OR DIE', big: topM[0], sub: `${topM[1]} visits this year. Loyalty like this is rare.` });
    if (distinct.length > 1) out.push({ key: 'journey', colors: ['#f59e0b', '#b45309'], fa: 'fa-arrow-trend-up', eyebrow: 'THE GLOW-UP', big: distinct.map((a) => a.name.replace('The ', '')).join('  →  '), sub: 'You shape-shifted through the year. Character development.' });
    if (dominant) out.push({ key: 'era', colors: [dominant.color, dominant.color], sym: dominant.icon, eyebrow: `YOUR ${year} ERA`, big: dominant.name, sub: dominant.tagline });
    if (noSpend >= 5) out.push({ key: 'discipline', colors: ['#14b8a6', '#0f766e'], fa: 'fa-shield-halved', eyebrow: 'IRON WILL', big: `${noSpend} days`, sub: 'you spent absolutely nothing. Monk behaviour, respect.' });
    out.push({ key: 'share', colors: ['#ec4899', '#9d174d'], fa: 'fa-share-nodes', eyebrow: 'THAT’S A WRAP', big: 'Share your\nmoney era', sub: 'Personality only — never your figures. Safe for the group chat.', share: true });
    return out;
  }, [all, year]);

  const go = useCallback((d) => setIdx((i) => Math.max(0, Math.min(slides.length - 1, i + d))), [slides.length]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const shareWrapped = async () => {
    const era = slides.find((s) => s.key === 'era');
    const text = era
      ? `My ${year} money era: ${era.big}.\n"${era.sub}"\n\nGet your own Money Wrapped on Automonie → automonie.com`
      : `My ${year} Money Wrapped on Automonie → automonie.com`;
    try {
      if (navigator.share) await navigator.share({ text });
      else { await navigator.clipboard.writeText(text); flash('Copied — paste it anywhere'); }
    } catch { /* cancelled */ }
  };

  const loading = all === null;
  const isDecember = new Date().getMonth() === 11; // Money Wrapped only unlocks in December
  const s = slides[idx];

  return (
    <div className="wr-page">
      {toast && <div className="wr-toast">{toast}</div>}
      {loading ? (
        <div className="wr-stage" style={{ background: 'linear-gradient(135deg,#0e9f6e,#075f4d)' }}><div className="wr-eyebrow">Loading your year…</div></div>
      ) : !isDecember ? (
        <div className="wr-stage wr-empty">
          <i className="fas fa-calendar-day" style={{ fontSize: '2.4rem', opacity: 0.75 }}></i>
          <div className="wr-empty-title">Money Wrapped drops in December</div>
          <div className="wr-empty-sub">Your full year-in-review unlocks at the end of the year. Check back in December to see your {year} money era. In the meantime, your weekly and monthly recaps are on the Recaps page.</div>
        </div>
      ) : slides.length === 0 ? (
        <div className="wr-stage wr-empty">
          <i className="fas fa-film" style={{ fontSize: '2.4rem', opacity: 0.7 }}></i>
          <div className="wr-empty-title">Not enough for a Wrapped yet</div>
          <div className="wr-empty-sub">Add or import a few months of transactions and your year-in-review will come alive.</div>
        </div>
      ) : (
        <div
          className="wr-stage"
          style={{ background: `linear-gradient(135deg, ${s.colors[0]}, ${s.colors[1]})` }}
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { if (touchX.current == null) return; const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); touchX.current = null; }}
        >
          <div className="wr-icon">
            {s.sym ? <span className="material-symbols-outlined" style={{ fontSize: 32 }}>{s.sym}</span> : <i className={`fas ${s.fa}`}></i>}
          </div>
          <div className="wr-eyebrow">{s.eyebrow}</div>
          <div className="wr-big">{s.big}</div>
          <div className="wr-sub">{s.sub}</div>
          {s.share && <button className="wr-share" onClick={shareWrapped}><i className="fas fa-share-nodes"></i> Share my Wrapped</button>}

          {idx > 0 && <button className="wr-nav wr-prev" onClick={() => go(-1)} aria-label="Previous"><i className="fas fa-chevron-left"></i></button>}
          {idx < slides.length - 1 && <button className="wr-nav wr-next" onClick={() => go(1)} aria-label="Next"><i className="fas fa-chevron-right"></i></button>}

          <div className="wr-dots">
            {slides.map((sl, i) => <span key={sl.key} className={`wr-dot ${i === idx ? 'on' : ''}`} onClick={() => setIdx(i)} />)}
          </div>
        </div>
      )}

      <style jsx="true">{`
        .wr-page { max-width: 720px; margin: 0 auto; padding: 16px; }
        .wr-stage { position: relative; border-radius: 24px; min-height: 70vh; padding: 40px 34px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 16px; overflow: hidden; color: #fff; box-shadow: 0 20px 50px rgba(0,0,0,0.25); }
        .wr-icon { width: 62px; height: 62px; border-radius: 18px; background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center; font-size: 1.6rem; }
        .wr-eyebrow { font-size: 0.8rem; font-weight: 900; letter-spacing: 2px; color: rgba(255,255,255,0.85); }
        .wr-big { font-size: 2.5rem; font-weight: 900; line-height: 1.1; white-space: pre-line; }
        .wr-sub { font-size: 1.1rem; font-weight: 600; line-height: 1.5; color: rgba(255,255,255,0.92); max-width: 90%; }
        .wr-share { display: inline-flex; align-items: center; gap: 10px; background: #fff; color: #0b1326; border: none; padding: 13px 22px; border-radius: 14px; font-weight: 800; font-size: 0.95rem; cursor: pointer; margin-top: 6px; }
        .wr-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 50%; border: none; background: rgba(0,0,0,0.28); color: #fff; cursor: pointer; font-size: 1rem; }
        .wr-prev { left: 14px; } .wr-next { right: 14px; }
        .wr-dots { position: absolute; bottom: 22px; left: 0; right: 0; display: flex; gap: 7px; justify-content: center; }
        .wr-dot { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,0.4); cursor: pointer; }
        .wr-dot.on { background: #fff; width: 22px; border-radius: 4px; }
        .wr-empty { background: linear-gradient(135deg,#1f2937,#0b1120); align-items: center; justify-content: center; text-align: center; }
        .wr-empty-title { font-size: 1.3rem; font-weight: 800; }
        .wr-empty-sub { font-size: 0.95rem; color: rgba(255,255,255,0.8); max-width: 340px; line-height: 1.5; }
        .wr-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: 999px; text-align: center; font-weight: 600; margin-bottom: 10px; z-index: 5; }
      `}</style>
    </div>
  );
}
