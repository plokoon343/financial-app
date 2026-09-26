import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import { buildVoiceLines } from '../lib/insights';
import { avatarFor } from '../utils/merchantAvatar';
import { fmtNaira } from '../utils/format';

// First-insight ceremony (web parity with the mobile first-insight screen). After the
// very first import we celebrate once: confetti, one big spend number, the top-3
// categories, and Automonie's first read. Shown once (localStorage first_insight_seen),
// set on mount so backing out never re-triggers it.
const SEEN_KEY = 'first_insight_seen';
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const monthKey = (iso) => (iso || '').slice(0, 7);
const monthLabel = (m) => {
  if (!m) return 'this month';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
};

// The month with the most spending (imports are usually recent, but robust to older
// statements too), its spend total, top-3 categories, and a Voice line.
function buildInsight(txns) {
  const byMonth = new Map();
  for (const t of txns) {
    if (t.type !== 'expense') continue;
    byMonth.set(monthKey(t.date), (byMonth.get(monthKey(t.date)) || 0) + Math.abs(t.amount));
  }
  if (byMonth.size === 0) return null;
  const month = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const monthTx = txns.filter((t) => monthKey(t.date) === month);
  const spend = monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const income = monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const catMap = new Map();
  for (const t of monthTx) {
    if (t.type !== 'expense') continue;
    const c = t.category || 'Other';
    catMap.set(c, (catMap.get(c) || 0) + Math.abs(t.amount));
  }
  const cats = [...catMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, total]) => ({ name, total, pct: spend > 0 ? total / spend : 0 }));
  const voice = buildVoiceLines(txns, income, month, fmtNaira)[0]?.text
    || 'Here’s the honest picture, no judgement, just the numbers.';
  return { month, spend, cats, voice };
}

// Small dependency-free confetti burst on a canvas, auto-stops after ~2.6s.
function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width = canvas.offsetWidth;
  const H = canvas.height = canvas.offsetHeight;
  const colors = ['#008751', '#1DD3A8', '#f59e0b', '#ec4899', '#0ea5e9', '#8b5cf6'];
  const parts = Array.from({ length: 120 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.4,
    r: 4 + Math.random() * 5, c: colors[(Math.random() * colors.length) | 0],
    vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3, rot: Math.random() * 6.28, vr: -0.2 + Math.random() * 0.4,
  }));
  const t0 = Date.now();
  let raf;
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6); ctx.restore();
    }
    if (Date.now() - t0 < 2600) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  };
  tick();
  return () => cancelAnimationFrame(raf);
}

export default function FirstInsight() {
  const navigate = useNavigate();
  const [insight, setInsight] = useState(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef(null);

  useEffect(() => {
    let alive = true;
    try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
    (async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/transactions`, auth());
        if (!alive) return;
        const ins = buildInsight(Array.isArray(data) ? data : (data?.transactions || []));
        setInsight(ins);
      } catch { /* fall through to the friendly empty state */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (loading || !insight || !canvasRef.current) return undefined;
    const stop = confetti(canvasRef.current);
    return stop;
  }, [loading, insight]);

  const done = () => navigate('/');

  return (
    <div className="fi-overlay">
      <canvas ref={canvasRef} className="fi-confetti" aria-hidden="true" />
      <div className="fi-body">
        {loading ? (
          <p className="fi-loading">Doing the maths you’ve been avoiding…</p>
        ) : insight ? (
          <>
            <div className="fi-eyebrow">YOUR FIRST LOOK</div>
            <h1 className="fi-heading">Here’s where your money went in {monthLabel(insight.month)}</h1>

            <div className="fi-card">
              <div className="fi-spend-label">You spent</div>
              <div className="fi-spend-big">{fmtNaira(insight.spend)}</div>
              <div className="fi-cats">
                {insight.cats.map((c) => {
                  const a = avatarFor(c.name, c.name);
                  return (
                    <div key={c.name}>
                      <div className="fi-cat-row">
                        <span className="fi-cat-left">
                          <span className="fi-cat-icon" style={{ background: `color-mix(in srgb, ${a.color} 16%, transparent)`, color: a.color }}>
                            <i className={a.kind === 'initial' ? 'fas fa-tag' : a.icon}></i>
                          </span>
                          <span className="fi-cat-name">{c.name}</span>
                        </span>
                        <span className="fi-cat-amt">{fmtNaira(c.total)}</span>
                      </div>
                      <div className="fi-bar"><span className="fi-bar-fill" style={{ width: `${Math.max(6, Math.round(c.pct * 100))}%`, background: a.color }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="fi-voice">
              <div className="fi-voice-label">THE AUTOMONIE READ</div>
              <p className="fi-voice-text">{insight.voice}</p>
            </div>
          </>
        ) : (
          <>
            <div className="fi-eyebrow">YOU’RE IN</div>
            <h1 className="fi-heading">Your transactions are in.</h1>
            <p className="fi-empty">We’ll start showing you where your money goes as more comes in.</p>
          </>
        )}

        <button className="fi-btn" onClick={done}>Show me more</button>
      </div>

      <style jsx="true">{`
        .fi-overlay { position: fixed; inset: 0; z-index: 4000; background: var(--bg-primary, #0b1326); overflow: hidden; display: flex; align-items: center; justify-content: center; }
        .fi-overlay::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 40%; background: linear-gradient(180deg, color-mix(in srgb, var(--accent-primary, #008751) 18%, transparent), transparent); pointer-events: none; }
        .fi-confetti { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
        .fi-body { position: relative; width: 100%; max-width: 460px; padding: 28px 24px; display: flex; flex-direction: column; min-height: 60vh; }
        .fi-loading { color: var(--text-secondary); font-size: 0.9rem; text-align: center; margin: auto; }
        .fi-eyebrow { color: var(--accent-primary, #008751); font-size: 0.7rem; font-weight: 800; letter-spacing: 1.4px; }
        .fi-heading { color: var(--text-primary); font-size: 1.7rem; font-weight: 800; letter-spacing: -0.6px; line-height: 1.22; margin: 10px 0 0; }
        .fi-empty { color: var(--text-secondary); font-size: 0.98rem; line-height: 1.5; margin-top: 14px; }
        .fi-card { background: var(--card-bg); border: 1px solid var(--glass-border); border-radius: 18px; padding: 18px; margin-top: 24px; }
        .fi-spend-label { color: var(--text-secondary); font-size: 0.78rem; }
        .fi-spend-big { color: var(--text-primary); font-size: 2.4rem; font-weight: 800; letter-spacing: -1px; margin-top: 4px; }
        .fi-cats { margin-top: 16px; display: flex; flex-direction: column; gap: 12px; }
        .fi-cat-row { display: flex; align-items: center; justify-content: space-between; }
        .fi-cat-left { display: flex; align-items: center; gap: 8px; flex: 1; padding-right: 10px; min-width: 0; }
        .fi-cat-icon { width: 24px; height: 24px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.72rem; flex-shrink: 0; }
        .fi-cat-name { color: var(--text-secondary); font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .fi-cat-amt { color: var(--text-primary); font-size: 0.85rem; font-weight: 700; }
        .fi-bar { height: 6px; border-radius: 3px; background: var(--glass-bg); margin-top: 6px; overflow: hidden; }
        .fi-bar-fill { display: block; height: 100%; border-radius: 3px; }
        .fi-voice { background: var(--card-bg); border: 1px solid var(--glass-border); border-left: 3px solid var(--accent-primary, #008751); border-radius: 14px; padding: 15px; margin-top: 14px; }
        .fi-voice-label { color: var(--accent-primary, #008751); font-size: 0.62rem; font-weight: 800; letter-spacing: 1.2px; }
        .fi-voice-text { color: var(--text-primary); font-size: 0.92rem; line-height: 1.5; margin: 6px 0 0; }
        .fi-btn { margin-top: auto; margin-bottom: 8px; width: 100%; padding: 15px; border: none; border-radius: 14px; color: #fff; font-weight: 800; font-size: 1rem; cursor: pointer; background: var(--gradient-primary, var(--accent-primary, #008751)); }
      `}</style>
    </div>
  );
}
