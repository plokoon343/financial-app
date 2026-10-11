'use strict';

// The AI provider layer. Two groups, chosen by what the data is:
//
//   PERSONAL  anything that can identify someone or carries their money: reading an
//             unknown alert or statement, transcribing a shared receipt image,
//             transfer purposes, and "ask about my money". Paid Gemini ONLY
//             (GEMINI_PAID_API_KEY), never a free tier. Without that key these
//             features are simply off; the deterministic layer keeps working.
//
//   STRIPPED  merchant names with every name, number, phone, email and amount
//             removed first (lib/aiStrip): merchant categorisation and a receipt's
//             shop and category. Free tiers, tried in order, falling through on any
//             failure: Groq → Gemini free → Cloudflare Workers AI → OpenRouter free.
//
// All providers speak the OpenAI chat-completions format, so one call function
// serves every one of them. Models are env-overridable: free models get retired.

const { isStripped } = require('./aiStrip');

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/openai';

// Tests only (never in production): AI_TEST_BASE points both groups at a stand-in.
const testBase = (env) => (env.NODE_ENV !== 'production' && env.AI_TEST_BASE) || '';

function personalConfig(env = process.env) {
  if (testBase(env)) return { name: 'test-personal', baseURL: testBase(env), apiKey: 'test', model: 'test', json: true };
  if ((env.AI_PERSONAL_PROVIDER || '').toLowerCase() === 'none' || !env.GEMINI_PAID_API_KEY) return null;
  return { name: 'gemini-paid', baseURL: GEMINI_BASE, apiKey: env.GEMINI_PAID_API_KEY, model: env.GEMINI_PAID_MODEL || 'gemini-3.6-flash', json: true };
}

function strippedChain(env = process.env) {
  if (testBase(env)) return [{ name: 'test-stripped', baseURL: testBase(env), apiKey: 'test', model: 'test', json: true }];
  const all = {
    groq: env.GROQ_API_KEY && { name: 'groq', baseURL: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY, model: env.GROQ_MODEL || 'llama-3.1-8b-instant', json: true },
    gemini: env.GEMINI_API_KEY && { name: 'gemini-free', baseURL: GEMINI_BASE, apiKey: env.GEMINI_API_KEY, model: env.GEMINI_FREE_MODEL || 'gemini-3.6-flash', json: true },
    cloudflare: env.CF_ACCOUNT_ID && env.CF_AI_TOKEN && { name: 'cloudflare', baseURL: `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1`, apiKey: env.CF_AI_TOKEN, model: env.CF_AI_MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct', json: false },
    openrouter: env.OPENROUTER_API_KEY && { name: 'openrouter', baseURL: 'https://openrouter.ai/api/v1', apiKey: env.OPENROUTER_API_KEY, model: env.OPENROUTER_MODEL || 'openrouter/free', json: false },
  };
  const order = (env.AI_STRIPPED_ORDER || 'groq,gemini,cloudflare,openrouter').split(',').map((s) => s.trim().toLowerCase());
  return order.map((k) => all[k]).filter(Boolean);
}

// One chat call. `content` may be a string or OpenAI content parts (for an image).
// Returns the reply text; throws on HTTP error or timeout.
async function chat(cfg, { system, content, maxTokens = 400, json = true, timeoutMs = 20000 }, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model, temperature: 0, max_tokens: maxTokens,
        ...(json && cfg.json ? { response_format: { type: 'json_object' } } : {}),
        messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }],
      }),
    });
    if (!res.ok) { const e = new Error(`${cfg.name} ${res.status}`); e.status = res.status; throw e; }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || '');
  } finally { clearTimeout(timer); }
}

// Tolerant JSON: models sometimes wrap it in a fence or a sentence.
function parseJSON(txt) {
  const t = String(txt || '').replace(/^\s*```(?:json)?|```\s*$/g, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// PERSONAL: paid Gemini or nothing. Returns { text, provider } or null when off.
async function runPersonal(req, { env = process.env, fetchImpl = fetch } = {}) {
  const cfg = personalConfig(env);
  if (!cfg) return null;
  return { text: await chat(cfg, req, fetchImpl), provider: cfg.name };
}

// STRIPPED: the free chain, first success wins. Refuses outright if the text still
// carries a digit or @, so an amount, account, phone or email can't reach a free tier.
// Returns { text, provider } or null when no provider is set or all of them failed.
async function runStripped(req, { env = process.env, fetchImpl = fetch, onError } = {}) {
  const text = typeof req.content === 'string' ? req.content : '';
  if (!text || !isStripped(text)) throw new Error('refused: text is not stripped');
  for (const cfg of strippedChain(env)) {
    try { return { text: await chat(cfg, req, fetchImpl), provider: cfg.name }; }
    catch (e) { if (onError) onError(cfg.name, e); }
  }
  return null;
}

const status = (env = process.env) => ({
  personal: personalConfig(env) ? { provider: 'gemini-paid', model: personalConfig(env).model } : null,
  stripped: strippedChain(env).map((c) => ({ provider: c.name, model: c.model })),
});

module.exports = { personalConfig, strippedChain, chat, parseJSON, runPersonal, runStripped, status };
