// Gemini Flash is the only LLM provider. It is reached over Google's chat-completions
// endpoint with plain fetch (no SDK). One config serves every LLM use: statement and
// alert parsing fallbacks, purpose inference, and the in-app assistant. Only data
// the deterministic layer couldn't handle is ever sent, and it is redacted first.

'use strict';

const { PURPOSE_IDS } = require('./purposeInference');

// The Gemini config from env, or null when no key is set (deterministic-only mode).
// AI_PURPOSE_PROVIDER=none switches the LLM off even when a key is present.
function llmConfig(env = process.env) {
  if ((env.AI_PURPOSE_PROVIDER || '').toLowerCase() === 'none') return null;
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '';
  if (!apiKey) return null;
  return {
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey,
    model: env.AI_PURPOSE_MODEL || 'gemini-3.6-flash',
    name: 'gemini',
  };
}

// True when the LLM tier is usable. Tier-1 deterministic logic always runs regardless.
const llmActive = (env = process.env) => !!llmConfig(env);

const SYSTEM = 'You label the purpose of a user\'s uncategorised bank transfers. Choose ONLY from the allowed purpose ids. Be conservative: use "other" whenever you are not clearly sure, because a wrong guess is worse than "other". Reply with JSON only.';

// Ask the model for purpose proposals in JSON mode and return the raw array
// ([{ref, purpose, confidence, reason}]). Throws on transport/HTTP error so the
// caller can fall back to Tier-1 only.
async function inferPurposesLLM(promptText, cfg, fetchImpl = fetch) {
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

module.exports = { llmConfig, llmActive, inferPurposesLLM, parseProposals, SYSTEM };
