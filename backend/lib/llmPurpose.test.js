'use strict';
// Run: node backend/lib/llmPurpose.test.js
const { purposeProviderConfig, purposeLLMActive, parseProposals, inferOpenAICompat } = require('./llmPurpose');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// --- provider config resolution ---
check('default none', purposeProviderConfig({}) === null);
check('groq config', (() => { const c = purposeProviderConfig({ AI_PURPOSE_PROVIDER: 'groq', GROQ_API_KEY: 'k' }); return c.kind === 'openai' && c.baseURL.includes('groq') && c.apiKey === 'k' && c.model.includes('llama'); })());
check('gemini config', (() => { const c = purposeProviderConfig({ AI_PURPOSE_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }); return c.kind === 'openai' && c.baseURL.includes('googleapis') && c.model.includes('gemini'); })());
check('anthropic config', (() => { const c = purposeProviderConfig({ AI_PURPOSE_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k' }); return c.kind === 'anthropic'; })());
check('model override', purposeProviderConfig({ AI_PURPOSE_PROVIDER: 'groq', GROQ_API_KEY: 'k', AI_PURPOSE_MODEL: 'custom-model' }).model === 'custom-model');
check('active needs a key', purposeLLMActive({ AI_PURPOSE_PROVIDER: 'groq' }) === false);
check('active with key', purposeLLMActive({ AI_PURPOSE_PROVIDER: 'groq', GROQ_API_KEY: 'k' }) === true);
check('none never active', purposeLLMActive({}) === false);

// --- tolerant JSON parsing ---
check('plain json', parseProposals('{"proposals":[{"ref":0,"purpose":"rent"}]}').length === 1);
check('fenced json', parseProposals('```json\n{"proposals":[{"ref":1,"purpose":"salary"}]}\n```')[0].purpose === 'salary');
check('prose-wrapped json', parseProposals('Here you go: {"proposals":[{"ref":2,"purpose":"gift"}]} thanks').length === 1);
check('garbage -> []', parseProposals('not json at all').length === 0);
check('missing proposals -> []', parseProposals('{"foo":1}').length === 0);

// --- inferOpenAICompat drives the right request + parses the reply (mock fetch) ---
(async () => {
  let seen = null;
  const mockFetch = async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body), auth: opts.headers.Authorization };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"proposals":[{"ref":0,"purpose":"rent","confidence":"high"}]}' } }] }) };
  };
  const cfg = purposeProviderConfig({ AI_PURPOSE_PROVIDER: 'groq', GROQ_API_KEY: 'secret' });
  const out = await inferOpenAICompat('CANDIDATES HERE', cfg, mockFetch);
  check('calls chat/completions', seen && seen.url.endsWith('/chat/completions'));
  check('sends bearer key', seen && seen.auth === 'Bearer secret');
  check('requests json mode', seen && seen.body.response_format.type === 'json_object');
  check('temperature 0', seen && seen.body.temperature === 0);
  check('parses proposals', out.length === 1 && out[0].purpose === 'rent');

  const errFetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  let threw = false;
  try { await inferOpenAICompat('x', cfg, errFetch); } catch { threw = true; }
  check('throws on HTTP error', threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
