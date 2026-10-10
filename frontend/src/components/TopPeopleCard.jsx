import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// Insights card: who you send money to most. It also asks, once, whether the people
// who share your surname are family, so their transfers sort themselves.
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export default function TopPeopleCard() {
  const [data, setData] = useState(null);
  const [answered, setAnswered] = useState({}); // contactId -> 'family' | 'no'

  const load = () => axios.get(`${API_URL}/api/contacts`, auth()).then((r) => setData(r.data)).catch(() => setData(null));
  useEffect(() => { load(); }, []);
  if (!data) return null;

  const top = (data.contacts || []).filter((c) => c.sentTotal > 0 && c.relationship !== 'self')
    .sort((a, b) => b.sentTotal - a.sentTotal).slice(0, 4);
  const suggested = data.familyPromptDone ? [] : (data.contacts || []).filter((c) => c.familySuggested && c.relationship === 'unknown');
  if (!top.length && !suggested.length) return null;

  const answer = async (c, isFamily) => {
    setAnswered((a) => ({ ...a, [c.id]: isFamily ? 'family' : 'no' }));
    if (isFamily) await axios.patch(`${API_URL}/api/contacts/${c.id}`, { relationship: 'family', applyToPast: true }, auth()).catch(() => {});
  };
  const finishPrompt = async () => {
    await axios.post(`${API_URL}/api/contacts/family-prompt/done`, {}, auth()).catch(() => {});
    load();
  };

  return (
    <div className="tpc">
      {suggested.length > 0 && (
        <div className="tpc-prompt">
          <strong>Are these family?</strong>
          <p>They share your surname. Say yes and their transfers go to Family &amp; Friends. We’ll only ask once.</p>
          {suggested.map((c) => (
            <div key={c.id} className="tpc-row">
              <span className="tpc-name">{c.name}</span>
              {answered[c.id]
                ? <span className="tpc-meta">{answered[c.id] === 'family' ? 'Family' : 'Not family'}</span>
                : (
                  <span className="tpc-actions">
                    <button type="button" className="btn-secondary" onClick={() => answer(c, false)}>No</button>
                    <button type="button" className="btn-primary" onClick={() => answer(c, true)}>Family</button>
                  </span>
                )}
            </div>
          ))}
          <button type="button" className="btn-secondary tpc-done" onClick={finishPrompt}>Done</button>
        </div>
      )}
      {top.length > 0 && (
        <>
          <div className="tpc-head">
            <strong>Who you send money to most</strong>
            <Link to="/people">See everyone</Link>
          </div>
          {top.map((c) => (
            <div key={c.id} className="tpc-row">
              <span className="tpc-name">{c.name}{c.relationship !== 'unknown' && <span className="tpc-meta"> · {cap(c.relationship)}</span>}</span>
              <span className="tpc-amount">{fmtNaira(c.sentTotal)}<span className="tpc-meta"> · {c.sentCount} transfer{c.sentCount === 1 ? '' : 's'}</span></span>
            </div>
          ))}
        </>
      )}
      <style>{`
        .tpc { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 16px; padding: 14px 18px; display: grid; gap: 10px; }
        .tpc-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .tpc-head strong, .tpc-prompt strong { color: var(--text-primary); }
        .tpc-head a { color: var(--accent-primary); font-weight: 700; font-size: 0.85rem; text-decoration: none; }
        .tpc-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 40px; border-top: 1px solid var(--border-color); padding-top: 8px; }
        .tpc-name { color: var(--text-primary); font-weight: 600; overflow-wrap: anywhere; }
        .tpc-amount { color: var(--text-primary); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .tpc-meta { color: var(--text-secondary); font-weight: 500; font-size: 0.82rem; }
        .tpc-prompt { display: grid; gap: 8px; padding-bottom: 6px; }
        .tpc-prompt p { margin: 0; color: var(--text-secondary); font-size: 0.88rem; }
        .tpc-actions { display: flex; gap: 8px; }
        .tpc-actions button, .tpc-done { padding: 8px 14px; min-height: 40px; }
        .tpc-done { justify-self: end; }
      `}</style>
    </div>
  );
}
