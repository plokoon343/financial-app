// Help Centre content: categories, loading, search and a simple "is this a how-to
// question" check used by the Ask assistant (round9 brief, B2).
//
// Source of truth is backend/data/help.json (edited directly, ships without a
// release - same convention as before). If SANITY_PROJECT_ID / SANITY_DATASET /
// SANITY_HELP_READ_TOKEN are set, articles are instead read live from Sanity (the
// same project automonie-web already uses for its content), so the app, the admin
// and automonie.com/help can eventually share one editable source; until an owner
// sets those keys and writes articles in Sanity Studio, this falls back to the
// JSON file with no behaviour change. See docs/briefs/round9-forwarding-support-tutorials.md.
'use strict';

const LOCAL = require('../data/help.json');

const CATEGORIES = [
  { id: 'getting-started', name: 'Getting started' },
  { id: 'automatic-tracking', name: 'Automatic tracking' },
  { id: 'statements', name: 'Statements' },
  { id: 'budgets-goals', name: 'Budgets and goals' },
  { id: 'plus-billing', name: 'Plus and billing' },
  { id: 'privacy-security', name: 'Privacy and security' },
  { id: 'troubleshooting', name: 'Troubleshooting' },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

const localArticles = () => (LOCAL.sections || []).map((s, i) => ({
  slug: s.id,
  title: s.title,
  category: CATEGORY_IDS.has(s.category) ? s.category : 'getting-started',
  summary: s.summary || '',
  videoUrl: s.videoUrl || '',
  steps: Array.isArray(s.steps) ? s.steps : [],
  order: i,
  source: 'local',
}));

// Plain-HTTP read against Sanity's query API - no @sanity/client dependency needed
// in the backend for a handful of cached reads. Published documents only (no
// drafts). Returns null (never throws) so callers always have the local fallback.
let sanityCache = { at: 0, articles: null };
const SANITY_TTL_MS = 5 * 60 * 1000;
async function fetchSanityArticles() {
  const projectId = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET;
  const token = process.env.SANITY_HELP_READ_TOKEN;
  if (!projectId || !dataset || !token) return null;
  if (sanityCache.articles && Date.now() - sanityCache.at < SANITY_TTL_MS) return sanityCache.articles;
  try {
    const apiVersion = process.env.SANITY_API_VERSION || '2024-12-01';
    const query = encodeURIComponent(
      `*[_type == "helpArticle" && !(_id in path("drafts.**"))] | order(category asc, order asc){ "slug": slug.current, title, category, summary, videoUrl, steps, order }`,
    );
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://${projectId}.api.sanity.io/v${apiVersion}/data/query/${dataset}?query=${query}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: ctrl.signal,
    }).finally(() => clearTimeout(timer));
    if (!r.ok) throw new Error(`Sanity HTTP ${r.status}`);
    const body = await r.json();
    const result = Array.isArray(body.result) ? body.result : [];
    if (!result.length) return null; // nothing published yet - stay on local content
    const articles = result
      .filter((a) => a && a.slug && CATEGORY_IDS.has(a.category))
      .map((a) => ({ ...a, steps: Array.isArray(a.steps) ? a.steps : [], source: 'sanity' }));
    sanityCache = { at: Date.now(), articles };
    return articles;
  } catch (e) {
    console.error('[helpContent] Sanity fetch failed, using local help.json:', e.message);
    return null;
  }
}

async function getArticles() {
  const sanity = await fetchSanityArticles();
  return sanity && sanity.length ? sanity : localArticles();
}

async function getArticleBySlug(slug) {
  const articles = await getArticles();
  return articles.find((a) => a.slug === slug) || null;
}

// A small set of Nigerian-phrasing substitutions, applied before tokenising so a
// search for "alert no show" or "money no dey enter" matches the same articles as
// "email not arriving" / "transaction missing".
const PHRASE_SYNONYMS = [
  [/\bno dey\b/g, 'not'],
  [/\bno show\b/g, 'not showing'],
  [/\bdey enter\b/g, 'is arriving'],
  [/\be don\b/g, 'it has'],
  [/\bnaso\b/g, 'is correct'],
  [/\babeg\b/g, 'please'],
  [/\bmy money\b/g, 'my transaction'],
  [/\balert\b/g, 'alert email notification'],
];

const normalize = (q) => {
  let s = String(q || '').toLowerCase();
  for (const [re, repl] of PHRASE_SYNONYMS) s = s.replace(re, repl);
  return s;
};
// Naive plural stemming (alerts -> alert) so "forward my alerts" matches an
// article titled "...bank alert..." without a real stemming library.
const stem = (t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t);
const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2).map(stem);

function scoreArticle(article, queryTokens) {
  const haystack = tokenize([article.title, article.summary, (article.steps || []).map((s) => s.text).join(' ')].join(' '));
  const titleTokens = tokenize(article.title);
  let score = 0;
  for (const t of queryTokens) {
    if (titleTokens.includes(t)) score += 3;
    else if (haystack.includes(t)) score += 1;
  }
  return score;
}

// Ranked matches for a search query. Returns [] when nothing scores above zero,
// which callers treat as a "no result" (logs help_search_no_result).
async function searchArticles(query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  const articles = await getArticles();
  return articles
    .map((a) => ({ article: a, score: scoreArticle(a, queryTokens) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.article);
}

// Best single match for the Ask assistant's help-first answer. A minimum score
// keeps a weak, coincidental overlap from producing a confident-sounding wrong
// answer; below it we'd rather fall through to the general assistant.
const MIN_CONFIDENT_SCORE = 3;
async function bestMatch(query) {
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return null;
  const articles = await getArticles();
  let best = null, bestScore = 0;
  for (const a of articles) {
    const s = scoreArticle(a, queryTokens);
    if (s > bestScore) { best = a; bestScore = s; }
  }
  return bestScore >= MIN_CONFIDENT_SCORE ? best : null;
}

// Does this read like "how do I..." rather than a financial question about the
// user's own data? Used to decide whether Ask should even try a help-first answer.
const HOWTO_RE = /\b(how (do|can|does|did) i|how to|what is|what does|explain|meaning of|forward(ing)?|set ?up|configure|cancel|turn (on|off)|enable|allow|connect my bank|import a statement|upload a statement)\b/i;
const isHowToQuestion = (message) => HOWTO_RE.test(String(message || ''));

// 3-5 line summary for Ask's reply: lead with the article summary, then the first
// few steps, trimmed. Full detail stays in the article itself (the "Learn more" link).
function condensed(article, maxSteps = 4) {
  const lines = [article.summary].filter(Boolean);
  for (const step of (article.steps || []).slice(0, maxSteps)) lines.push(`- ${step.text}`);
  return lines.join('\n');
}

module.exports = {
  CATEGORIES, CATEGORY_IDS,
  getArticles, getArticleBySlug, searchArticles, bestMatch,
  isHowToQuestion, condensed, normalize,
};
