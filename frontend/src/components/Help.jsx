import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';

// Help: a short how-to for each feature. Text, screenshots and video links come from
// the server (backend/data/help.json), so they change without a release. A hash
// (#email-outlook) opens that section.
export default function Help() {
  const { hash } = useLocation();
  const [sections, setSections] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(hash.slice(1) || null);

  useEffect(() => {
    axios.get(`${API_URL}/api/help`).then((r) => setSections(r.data.sections || [])).catch(() => setError('Could not load help. The server may be waking up; try again.'));
  }, []);
  useEffect(() => {
    if (!hash || !sections) return;
    setOpen(hash.slice(1));
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, sections]);

  return (
    <div className="help-page">
      <h2><i className="fas fa-circle-question" aria-hidden="true"></i> Help</h2>
      <p className="help-muted">How each part of Automonie works, step by step.</p>
      {error && <div className="message error">{error}</div>}
      {!sections && !error && <div className="loading-container"><div className="loading-spinner"></div></div>}
      {sections?.map((s) => {
        const isOpen = open === s.id;
        return (
          <section key={s.id} id={s.id} className="help-section">
            <button type="button" className="help-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
              <span>
                <span className="help-title">{s.title}</span>
                <span className="help-muted">{s.summary}</span>
              </span>
              <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'}`} aria-hidden="true"></i>
            </button>
            {isOpen && (
              <div className="help-body">
                <ol>
                  {s.steps.map((st, i) => (
                    <li key={i}>
                      {st.text}
                      {st.image && <img src={st.image} alt={`Step ${i + 1}`} loading="lazy" />}
                    </li>
                  ))}
                </ol>
                {s.videoUrl && <a href={s.videoUrl} target="_blank" rel="noopener noreferrer" className="help-video"><i className="fas fa-circle-play" aria-hidden="true"></i> Watch how</a>}
              </div>
            )}
          </section>
        );
      })}
      <style>{`
        .help-page { max-width: 760px; margin: 0 auto; padding: 20px; display: grid; gap: 12px; }
        .help-page h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0; }
        .help-page h2 i { color: var(--accent-primary); }
        .help-muted { display: block; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; }
        .help-section { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); scroll-margin-top: 16px; }
        .help-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 14px 16px; background: none; border: none; text-align: left; color: var(--text-secondary); cursor: pointer; font: inherit; }
        .help-title { display: block; color: var(--text-primary); font-weight: 700; margin-bottom: 2px; }
        .help-body { padding: 0 16px 16px; }
        .help-body ol { margin: 0; padding-left: 22px; color: var(--text-primary); line-height: 1.6; display: grid; gap: 8px; }
        .help-body img { display: block; max-width: 100%; margin-top: 8px; border-radius: var(--radius-md); border: 1px solid var(--border-color); }
        .help-video { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--accent-primary); font-weight: 700; text-decoration: none; min-height: 44px; }
      `}</style>
    </div>
  );
}
