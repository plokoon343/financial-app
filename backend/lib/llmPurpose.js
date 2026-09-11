// Tier-2 LLM caller for purpose inference (spec 6.1 hybrid). Handles the OpenAI-
// compatible providers (Groq, Google Gemini) over plain fetch — no SDK needed, and
// both speak the same /chat/completions + JSON-mode shape. The Anthropic path stays
// in server.js on the existing SDK client. Only the ambiguous tail that Tier-1
// couldn't classify is ever sent here, and it's already redacted (spec 6.1 privacy).

'use strict';

const { PURPOSE_IDS } = require('./purposeInference');

// Resolve the configured Tier-2 provider from env, or null for deterministic-only.
// AI_PURPOSE_PROVIDER = none (default) | groq | gemini | anthropic.
function purposeProviderConfig(env = process.env) {
  switch ((env.AI_PURPOSE_PROVIDER || 'none').toLowerCase()) {
    case 'groq':
      return { kind: 'openai', baseURL: 'https://api.groq.com/openai/v1', apiKey: env.GROQ_API_KEY || '', model: env.AI_PURPOSE_MODEL || 'llama-3.3-70b-versatile', name: 'groq' };
    case 'gemini':
      return { kind: 'openai', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '', model: env.AI_PURPOSE_MODEL || 'gemini-2.0-flash', name: 'gemini' };
    case 'anthropic':
      return { kind: 'anthropic', apiKey: env.ANTHROPIC_API_KEY || '', model: env.AI_PURPOSE_MODEL || 'claude-haiku-4-5', name: 'anthropic' };
    default:
      return null;
  }
}

// True when a Tier-2 provider is configured AND has its key — i.e. the LLM booster is
// actually usable. (Tier-1 deterministic always runs regardless.)
function purposeLLMActive(env = process.env) {
  const c = purposeProviderConfig(env);
  return !!(c && c.apiKey);
}

const SYSTEM = 'You label the purpose of a user\'s uncategorised bank transfers. Choose ONLY from the allowed purpose ids. Be conservative: use "other" whenever you are not clearly sure — a wrong guess is worse than "other". Reply with JSON only.';

// Call an OpenAI-compatible endpoint (Groq/Gemini) in JSON mode and return the raw
// proposals array ([{ref, purpose, confidence, reason}]). Throws on transport/HTTP
// error so the caller can fall back to Tier-1-only.
async function inferOpenAICompat(promptText, cfg, fetchImpl = fetch) {
  const instruction = `${promptText}\n\nAllowed purpose ids: ${PURPOSE_IDS.join(', ')}.\nReturn JSON exactly like: {"proposals":[{"ref":0,"purpose":"rent","confidence":"high","reason":"short reason"}]}. One entry per ref; omit refs you are unsure about or set purpose to "other".`;
  const res = await fetchImpl(`${cfg.baseURL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: instruction },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${cfg.name} ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  const txt = data?.choices?.[0]?.message?.content || '{}';
  return parseProposals(txt);
}

// Tolerant JSON extraction: models sometimes wrap JSON in prose or fences.
function parseProposals(txt) {
  let obj;
  try { obj = JSON.parse(txt); }
  catch {
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { obj = JSON.parse(m[0]); } catch { return []; }
  }
  return Array.isArray(obj?.proposals) ? obj.proposals : [];
}

module.exports = { purposeProviderConfig, purposeLLMActive, inferOpenAICompat, parseProposals, SYSTEM };
