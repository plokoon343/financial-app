'use strict';
// Run: node backend/lib/aiProviders.test.js
const ai = require('./aiProviders');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };

const ALL = { GEMINI_API_KEY: 'free', GROQ_API_KEY: 'g', CF_ACCOUNT_ID: 'acc', CF_AI_TOKEN: 'cf', OPENROUTER_API_KEY: 'or', NVIDIA_API_KEY: 'nv' };

check('personal: off without a paid key, even with a free Gemini key', ai.personalConfig({ GEMINI_API_KEY: 'free' }) === null);
check('personal: the paid key turns it on', ai.personalConfig({ GEMINI_PAID_API_KEY: 'paid' })?.name === 'gemini-paid');
check('personal: never uses the free key', ai.personalConfig({ GEMINI_API_KEY: 'free', GEMINI_PAID_API_KEY: 'paid' }).apiKey === 'paid');
check('personal: AI_PERSONAL_PROVIDER=none switches it off', ai.personalConfig({ GEMINI_PAID_API_KEY: 'p', AI_PERSONAL_PROVIDER: 'none' }) === null);
check('stripped: Gemini free, Cloudflare, OpenRouter, NVIDIA NIM in that order', ai.strippedChain(ALL).map((c) => c.name).join() === 'gemini-free,cloudflare,openrouter,nvidia');
check('stripped: Groq is never used, even with a key or in the order', !ai.strippedChain({ GROQ_API_KEY: 'g', AI_STRIPPED_ORDER: 'groq' }).length && !ai.strippedChain(ALL).some((c) => c.name === 'groq'));
check('stripped: Grok comes second when its key is set', ai.strippedChain({ ...ALL, XAI_API_KEY: 'x' }).map((c) => c.name).join() === 'gemini-free,grok,cloudflare,openrouter,nvidia');
check('stripped: Grok uses the xAI endpoint and an overridable model', ai.strippedChain({ XAI_API_KEY: 'x', XAI_MODEL: 'grok-x' })[0]?.baseURL === 'https://api.x.ai/v1' && ai.strippedChain({ XAI_API_KEY: 'x', XAI_MODEL: 'grok-x' })[0].model === 'grok-x');
check('stripped: NVIDIA NIM uses its OpenAI-style endpoint', ai.strippedChain({ NVIDIA_API_KEY: 'nv' })[0]?.baseURL === 'https://integrate.api.nvidia.com/v1');
check('stripped: only providers with keys', ai.strippedChain({ OPENROUTER_API_KEY: 'x' }).map((c) => c.name).join() === 'openrouter');
check('stripped: Cloudflare needs both account and token', !ai.strippedChain({ CF_ACCOUNT_ID: 'a' }).length);
check('stripped: Cloudflare URL is account-scoped', ai.strippedChain(ALL)[1].baseURL.includes('/accounts/acc/ai/v1'));
check('stripped: order is configurable', ai.strippedChain({ ...ALL, AI_STRIPPED_ORDER: 'openrouter,gemini' }).map((c) => c.name).join() === 'openrouter,gemini-free');
check('stripped: the paid key is never in the free chain', !ai.strippedChain({ GEMINI_PAID_API_KEY: 'paid' }).length);
check('the test stand-in is ignored in production', ai.personalConfig({ NODE_ENV: 'production', AI_TEST_BASE: 'http://x' }) === null && !ai.strippedChain({ NODE_ENV: 'production', AI_TEST_BASE: 'http://x' }).length);
check('status lists both groups', ai.status({ ...ALL, GEMINI_PAID_API_KEY: 'p' }).personal.provider === 'gemini-paid' && ai.status(ALL).stripped.length === 4);

check('parseJSON: fenced', ai.parseJSON('```json\n{"a":1}\n```').a === 1);
check('parseJSON: prose around it', ai.parseJSON('Sure! {"a":2} hope that helps').a === 2);
check('parseJSON: arrays', Array.isArray(ai.parseJSON('[{"a":1}]')));
check('parseJSON: junk is null', ai.parseJSON('nope') === null);

(async () => {
  const calls = [];
  const fake = (behaviour) => async (url, opts) => {
    const name = url.includes('nvidia') ? 'nvidia' : url.includes('cloudflare') ? 'cloudflare' : url.includes('openrouter') ? 'openrouter' : 'gemini';
    calls.push({ name, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    const b = behaviour[name];
    if (b === 'fail') return { ok: false, status: 429, json: async () => ({}) };
    if (b === 'throw') throw new Error('network');
    return { ok: true, json: async () => ({ choices: [{ message: { content: `{"from":"${name}"}` } }] }) };
  };

  calls.length = 0;
  const r1 = await ai.runStripped({ system: 'Name the category.', content: 'SHOPRITE LEKKI' }, { env: ALL, fetchImpl: fake({}) });
  check('stripped: the first provider answers', r1.provider === 'gemini-free' && calls.length === 1, r1);
  check('stripped: JSON mode only where supported', calls[0].body.response_format?.type === 'json_object');

  calls.length = 0;
  const r2 = await ai.runStripped({ content: 'SHOPRITE' }, { env: ALL, fetchImpl: fake({ gemini: 'fail', cloudflare: 'throw', openrouter: 'fail' }) });
  check('stripped: falls through failures to the next provider', r2.provider === 'nvidia' && calls.map((c) => c.name).join() === 'gemini,cloudflare,openrouter,nvidia', calls.map((c) => c.name).join());
  check('stripped: no JSON-mode flag sent to Cloudflare', calls[1].body.response_format === undefined);

  const r3 = await ai.runStripped({ content: 'SHOPRITE' }, { env: ALL, fetchImpl: fake({ gemini: 'fail', cloudflare: 'fail', openrouter: 'fail', nvidia: 'fail' }) });
  check('stripped: all failing gives null', r3 === null);
  check('stripped: nothing configured gives null', (await ai.runStripped({ content: 'SHOPRITE' }, { env: {}, fetchImpl: fake({}) })) === null);

  for (const bad of ['SHOPRITE 4500', 'pay ada@x.com', '₦ SHOPRITE']) {
    let refused = false;
    calls.length = 0;
    try { await ai.runStripped({ content: bad }, { env: ALL, fetchImpl: fake({}) }); } catch { refused = true; }
    check(`stripped: refuses un-stripped text (${bad})`, refused && calls.length === 0);
  }

  calls.length = 0;
  check('personal: off means no call at all', (await ai.runPersonal({ content: 'x' }, { env: { GEMINI_API_KEY: 'free' }, fetchImpl: fake({}) })) === null && calls.length === 0);
  const p = await ai.runPersonal({ content: 'alert 4,500 to Ada' }, { env: { ...ALL, GEMINI_PAID_API_KEY: 'paid' }, fetchImpl: fake({}) });
  check('personal: goes to paid Gemini with the paid key', p.provider === 'gemini-paid' && calls[0].auth === 'Bearer paid' && calls[0].name === 'gemini');

  let timedOut = false;
  const slow = (url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  try { await ai.chat({ name: 'nvidia', baseURL: 'https://integrate.api.nvidia.com/v1', apiKey: 'k', model: 'm' }, { content: 'x', timeoutMs: 50 }, slow); } catch { timedOut = true; }
  check('calls time out instead of hanging', timedOut);

  console.log(`aiProviders: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
