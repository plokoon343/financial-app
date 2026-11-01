import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import { trackEvent } from '../lib/analytics';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

// Help Centre: articles grouped by category (round9 B2), with search and
// "Did this help?" voting. Content comes from the server (Sanity when an owner
// has set it up, else backend/data/help.json), so it changes without a release.
// A hash (#email-outlook) opens that article directly.
export default function Help() {
  const { hash } = useLocation();
  const [categories, setCategories] = useState([]);
  const [articles, setArticles] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(hash.slice(1) || null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [voted, setVoted] = useState({});

  useEffect(() => {
    trackEvent('help_opened', { source: hash ? hash.slice(1) : 'help_page' });
    axios.get(`${API_URL}/api/help`, auth())
      .then((r) => { setCategories(r.data.categories || []); setArticles(r.data.articles || []); })
      .catch(() => setError('Could not load help. The server may be waking up; try again.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!hash || !articles) return;
    setOpen(hash.slice(1));
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [hash, articles]);

  const grouped = useMemo(() => {
    const byCat = new Map(categories.map((c) => [c.id, { ...c, items: [] }]));
    for (const a of (articles || [])) byCat.get(a.category)?.items.push(a);
    return [...byCat.values()].filter((c) => c.items.length);
  }, [categories, articles]);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults(null); return; }
    const t = setTimeout(() => {
      axios.get(`${API_URL}/api/help/search`, { ...auth(), params: { q } })
        .then((r) => setResults(r.data.results || []))
        .catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const openArticle = (a) => {
    const isOpen = open === a.slug;
    setOpen(isOpen ? null : a.slug);
    if (!isOpen) trackEvent('help_article_viewed', { slug: a.slug });
  };

  const vote = (slug, helpful) => {
    if (voted[slug]) return;
    setVoted((v) => ({ ...v, [slug]: helpful ? 'yes' : 'no' }));
    axios.post(`${API_URL}/api/help/${slug}/vote`, { helpful }, auth()).catch(() => {});
  };

  const renderArticle = (a) => {
    const isOpen = open === a.slug;
    return (
      <section key={a.slug} id={a.slug} className="help-section">
        <button type="button" className="help-head" aria-expanded={isOpen} onClick={() => openArticle(a)}>
          <span>
            <span className="help-title">{a.title}</span>
            <span className="help-muted">{a.summary}</span>
          </span>
          <i className={`fas fa-chevron-${isOpen ? 'up' : 'down'}`} aria-hidden="true"></i>
        </button>
        {isOpen && (
          <div className="help-body">
            <ol>
              {a.steps.map((st, i) => (
                <li key={i}>
                  {st.text}
                  {st.image && <img src={st.image} alt={`Step ${i + 1}`} loading="lazy" />}
                </li>
              ))}
            </ol>
            {a.videoUrl && <a href={a.videoUrl} target="_blank" rel="noopener noreferrer" className="help-video"><i className="fas fa-circle-play" aria-hidden="true"></i> Watch how</a>}
            <div className="help-vote">
              {voted[a.slug]
                ? <span className="help-muted">Thanks for letting us know.</span>
                : (
                  <>
                    <span className="help-muted">Did this help?</span>
                    <button type="button" onClick={() => vote(a.slug, true)}>Yes</button>
                    <button type="button" onClick={() => vote(a.slug, false)}>No</button>
                  </>
                )}
            </div>
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="help-page">
      <h2><i className="fas fa-circle-question" aria-hidden="true"></i> Help</h2>
      <p className="help-muted">How each part of Automonie works, step by step.</p>
      <input
        type="search"
        className="help-search"
        placeholder="Search Help (e.g. &quot;email not arriving&quot;, &quot;alert no show&quot;)"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error && <div className="message error">{error}</div>}
      {!articles && !error && <div className="loading-container"><div className="loading-spinner"></div></div>}

      {results !== null ? (
        <div className="help-results">
          {results.length === 0
            ? <p className="help-muted">No matches. Try different words, or <a href="/support">contact support</a>.</p>
            : results.map(renderArticle)}
        </div>
      ) : (
        grouped.map((cat) => (
          <div key={cat.id} className="help-category">
            <h3>{cat.name}</h3>
            {cat.items.map(renderArticle)}
          </div>
        ))
      )}

      <style>{`
        .help-page { max-width: 760px; margin: 0 auto; padding: 20px; display: grid; gap: 12px; }
        .help-page h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0; }
        .help-page h2 i { color: var(--accent-primary); }
        .help-muted { display: block; color: var(--text-secondary); font-size: 0.88rem; line-height: 1.5; }
        .help-search { width: 100%; padding: 12px 14px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); font: inherit; }
        .help-category { display: grid; gap: 10px; margin-top: 6px; }
        .help-category h3 { margin: 10px 0 0; color: var(--text-primary); font-size: 1rem; }
        .help-section { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); scroll-margin-top: 16px; }
        .help-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 14px 16px; background: none; border: none; text-align: left; color: var(--text-secondary); cursor: pointer; font: inherit; }
        .help-title { display: block; color: var(--text-primary); font-weight: 700; margin-bottom: 2px; }
        .help-body { padding: 0 16px 16px; }
        .help-body ol { margin: 0; padding-left: 22px; color: var(--text-primary); line-height: 1.6; display: grid; gap: 8px; }
        .help-body img { display: block; max-width: 100%; margin-top: 8px; border-radius: var(--radius-md); border: 1px solid var(--border-color); }
        .help-video { display: inline-flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--accent-primary); font-weight: 700; text-decoration: none; min-height: 44px; }
        .help-vote { display: flex; align-items: center; gap: 10px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color); }
        .help-vote button { border: 1px solid var(--border-color); background: var(--bg-card); color: var(--text-primary); border-radius: 20px; padding: 4px 14px; cursor: pointer; font-weight: 600; font-size: 0.85rem; }
        .help-results { display: grid; gap: 10px; }
      `}</style>
    </div>
  );
}
