import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_URL } from '../config';
import { allCategoriesFor } from '../utils/categoryStore';
import { parseQuickLog } from '../lib/quickLog';

// Quick log (web parity with the mobile /quick-log screen). Type a natural line —
// "2k bike to school", "spent 5000 on data", "got 20k salary" — and it becomes a
// transaction. Live-parses into editable fields. Optional voice via the Web Speech
// API where the browser supports it (Chrome/Edge); everything works by typing.

const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export default function QuickLog() {
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('expense');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const recogRef = useRef(null);

  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const cats = useMemo(() => allCategoriesFor(type), [type]);

  // Live-parse the typed/spoken line into fields (which stay editable).
  useEffect(() => {
    const p = parseQuickLog(text);
    if (p) {
      setAmountText(String(p.amount));
      setDescription(p.description);
      setCategory(p.category);
      setType(p.type);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => () => { try { recogRef.current && recogRef.current.stop(); } catch { /* noop */ } }, []);

  const toggleMic = () => {
    if (listening) { try { recogRef.current && recogRef.current.stop(); } catch { /* noop */ } setListening(false); return; }
    setError('');
    try {
      const r = new SpeechRecognition();
      r.lang = 'en-NG';
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        const said = Array.from(e.results).map((x) => x[0].transcript).join(' ');
        setText(said);
      };
      r.onerror = () => { setListening(false); setError('Could not hear that — try again, or just type it.'); };
      r.onend = () => setListening(false);
      recogRef.current = r;
      r.start();
      setText('');
      setListening(true);
    } catch {
      setError('Voice input is not available in this browser — type it instead.');
    }
  };

  const parsedAmount = parseFloat((amountText || '').replace(/[^0-9.]/g, ''));
  const ready = parsedAmount > 0 && !!category;

  const save = async () => {
    if (!(parsedAmount > 0)) { setError('Type an amount, e.g. "2k bike to school".'); return; }
    if (!category) { setError('Pick a category for this one.'); return; }
    setSaving(true); setError('');
    try {
      await axios.post(`${API_URL}/api/transactions`, {
        type, amount: parsedAmount,
        description: description.trim() || (type === 'income' ? 'Cash in' : 'Cash spend'),
        category, date: new Date().toISOString(),
      }, headers);
      navigate('/transactions');
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  };

  const switchType = (t) => { setType(t); setCategory(''); };

  return (
    <div className="ql-page">
      <div className="ql-head">
        <h2><i className="fas fa-bolt"></i> Quick log</h2>
        <p>Type it like you&apos;d say it — &ldquo;2k bike to school&rdquo;, &ldquo;spent 5000 on data&rdquo;, &ldquo;got 20k salary&rdquo; — and we&apos;ll sort out the rest.</p>
      </div>

      <div className="ql-say">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'e.g. "2k bike to school"  ·  "spent 5000 on data"  ·  "got 20k salary"'}
          rows={2}
          autoFocus
          disabled={saving}
        />
        {SpeechRecognition && (
          <button className={`ql-mic ${listening ? 'on' : ''}`} onClick={toggleMic} disabled={saving} title="Speak">
            <i className={`fas ${listening ? 'fa-stop' : 'fa-microphone'}`}></i>
            {listening ? 'Listening…' : 'Speak'}
          </button>
        )}
      </div>

      {error && <div className="ql-err">{error}</div>}

      {/* Editable preview */}
      <div className="ql-card">
        <div className="ql-amount">
          <span className="ql-sign" style={{ color: type === 'income' ? '#22c55e' : '#ef4444' }}>{type === 'income' ? '+' : '−'}₦</span>
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" disabled={saving} />
        </div>

        <div className="ql-toggle">
          {['expense', 'income'].map((t) => (
            <button key={t} className={`ql-tg ${type === t ? 'on ' + t : ''}`} onClick={() => switchType(t)} disabled={saving}>
              {t === 'expense' ? 'Expense' : 'Income'}
            </button>
          ))}
        </div>

        <input className="ql-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What was it?" disabled={saving} />

        <select className="ql-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={saving}>
          <option value="">Category…</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <button className="ql-save" onClick={save} disabled={saving || !ready}>
        {saving ? 'Saving…' : 'Save'}
      </button>

      <style jsx="true">{`
        .ql-page { max-width: 560px; margin: 0 auto; padding: 20px; }
        .ql-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .ql-head p { color: var(--text-secondary); margin: 0 0 18px; line-height: 1.5; }
        .ql-say { position: relative; }
        .ql-say textarea { width: 100%; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 14px; color: var(--text-primary); font-size: 1.05rem; font-family: inherit; resize: vertical; box-sizing: border-box; }
        .ql-say textarea:focus { outline: none; border-color: var(--accent-primary); }
        .ql-mic { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 6px; background: var(--glass-bg); color: var(--accent-primary); border: 1px solid var(--accent-primary); border-radius: var(--radius-full); padding: 6px 12px; font-weight: 700; font-size: 0.8rem; cursor: pointer; }
        .ql-mic.on { background: #ef4444; color: #fff; border-color: #ef4444; }
        .ql-err { background: rgba(239,68,68,0.12); color: #ef4444; padding: 10px 14px; border-radius: var(--radius-md); margin: 12px 0 0; }
        .ql-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin: 16px 0; display: flex; flex-direction: column; gap: 14px; }
        .ql-amount { display: flex; align-items: center; gap: 8px; }
        .ql-sign { font-size: 1.5rem; font-weight: 800; }
        .ql-amount input { flex: 1; background: transparent; border: none; color: var(--text-primary); font-size: 1.8rem; font-weight: 800; outline: none; }
        .ql-toggle { display: flex; gap: 8px; background: var(--bg-primary, var(--glass-bg)); border-radius: var(--radius-md); padding: 4px; }
        .ql-tg { flex: 1; padding: 9px; border: none; background: transparent; color: var(--text-secondary); font-weight: 700; border-radius: var(--radius-sm, 8px); cursor: pointer; }
        .ql-tg.on.expense { background: #ef4444; color: #fff; }
        .ql-tg.on.income { background: #22c55e; color: #fff; }
        .ql-desc, .ql-cat { background: var(--bg-primary, var(--glass-bg)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 11px 13px; color: var(--text-primary); font-size: 0.95rem; }
        .ql-save { width: 100%; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 14px; font-weight: 800; font-size: 1rem; cursor: pointer; }
        .ql-save:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
}
