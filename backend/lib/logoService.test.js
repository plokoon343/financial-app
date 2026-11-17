'use strict';
// Run: node backend/lib/logoService.test.js
const assert = require('assert');
const { createLogoService, keyFor } = require('./logoService');
const { overrideFor, OVERRIDES } = require('./logoOverrides');
const { nameMatches } = require('./logoProvider');

let passed = 0;
const eq = (a, b, label) => { assert.deepStrictEqual(a, b, label); passed += 1; };

// In-memory store and a counting fake provider.
const memStore = () => {
  const m = new Map();
  return {
    m,
    get: async (id) => m.get(id) || null,
    getMany: async (ids) => Object.fromEntries(ids.filter((i) => m.has(i)).map((i) => [i, { ...m.get(i), data: undefined }])),
    getImage: async (id) => m.get(id) || null,
    put: async (d) => { m.set(d.id, d); },
  };
};
const fakeProvider = (behave) => {
  const calls = [];
  return { calls, fetchLogo: async (a) => { calls.push(a); return behave(a, calls.length); } };
};
const urlFor = (id) => `/api/logos/${id}`;
const mk = (provider, store = memStore(), clock = { t: 1_000_000 }) =>
  ({ svc: createLogoService({ store, provider, now: () => clock.t, gapMs: 0 }), store, clock });

(async () => {
  // Keys: overrides first, then the catalogue slug, then the merchant words.
  eq(keyFor('MTN Airtime').id, 'mtn', 'override beats everything');
  eq(keyFor('Chicken Republic Lekki').id, 'chicken-republic', 'a brand not in the catalogue is pinned');
  eq(keyFor('GTBank').domain, 'gtbank.com', 'banks are pinned');
  eq(keyFor('NETFLIX.COM LAGOS NG').id, 'netflix', 'spelling variants share one id');
  eq(keyFor('Showmax').id, 'showmax', 'catalogue-only brand');
  eq(keyFor(''), null, 'empty name has no key');
  eq(keyFor('x'.repeat(200)), null, 'absurd name has no key');
  eq(keyFor('Adaeze Okafor').search, null, 'a person is never sent to a provider');
  eq(keyFor('Mama Ngozi').search, null, 'an unknown name is never sent to a provider');
  assert(OVERRIDES.every((o) => o.id && o.domain && o.re), 'every override has id, domain and pattern'); passed += 1;
  for (const n of ['MTN', 'Airtel', 'Glo', 'DStv', 'GOtv', 'Bolt', 'Uber', 'Chowdeck', 'Glovo', 'Jumia', 'Chicken Republic', 'Netflix', 'Spotify', 'GTBank', 'Access Bank', 'Zenith Bank', 'UBA', 'First Bank']) {
    assert(overrideFor(n), `${n} is pinned`); passed += 1;
  }
  eq(overrideFor('Ogloba Stores'), null, 'Glo does not match inside another word');
  eq(overrideFor('Bolton Hospital'), null, 'Bolt does not match inside another word');

  // Provider match guard.
  eq(nameMatches('Chowdeck Lagos', 'Chowdeck'), true, 'extra location words are fine');
  eq(nameMatches('Mama Put', 'Mama Cass'), false, 'different business is refused');
  eq(nameMatches('Bukka', 'Bukka Hut'), true, 'prefix brand ok');

  // Found: resolved once, then served from cache with no second provider call.
  {
    const p = fakeProvider(() => ({ data: Buffer.from('img'), contentType: 'image/webp', etag: 'e1', domain: 'mtn.ng' }));
    const { svc, store } = mk(p);
    eq((await svc.lookup(['MTN'], urlFor)).MTN, null, 'first ask answers at once with no logo yet');
    await svc.idle();
    eq(p.calls.length, 1, 'one provider call');
    eq(p.calls[0].domain, 'mtn.ng', 'override asks by its pinned domain, no name search');
    eq((await svc.lookup(['MTN', 'MTN Data'], urlFor)), { MTN: '/api/logos/mtn', 'MTN Data': '/api/logos/mtn' }, 'now served from our copy');
    await svc.idle();
    eq(p.calls.length, 1, 'never asked again');
    eq((await svc.image('mtn')).contentType, 'image/webp', 'image served from our store');
    eq(store.m.get('mtn').status, 'found', 'stored');
  }

  // Negative results are cached: a popular unknown merchant does not hammer the provider.
  {
    const p = fakeProvider(() => null);
    const { svc, clock } = mk(p);
    await svc.lookup(['Chowdeck'], urlFor); await svc.idle();
    for (let i = 0; i < 20; i++) { await svc.lookup(['Chowdeck'], urlFor); await svc.idle(); }
    eq(p.calls.length, 1, '21 asks, one provider call');
    clock.t += 29 * 24 * 3600 * 1000;
    await svc.lookup(['Chowdeck'], urlFor); await svc.idle();
    eq(p.calls.length, 1, 'still cached at 29 days');
    clock.t += 2 * 24 * 3600 * 1000;
    await svc.lookup(['Chowdeck'], urlFor); await svc.idle();
    eq(p.calls.length, 2, 'retried once after 30 days');
  }

  // Failures back off instead of retrying on every request.
  {
    const p = fakeProvider(() => { throw new Error('rate limited'); });
    const { svc, clock, store } = mk(p);
    await svc.lookup(['Bolt'], urlFor); await svc.idle();
    await svc.lookup(['Bolt'], urlFor); await svc.idle();
    eq(p.calls.length, 1, 'no retry inside the backoff');
    eq(store.m.get('bolt').status, 'error', 'failure recorded');
    clock.t += 61 * 60 * 1000;
    await svc.lookup(['Bolt'], urlFor); await svc.idle();
    eq(p.calls.length, 2, 'retry after an hour');
    clock.t += 3 * 60 * 60 * 1000;
    await svc.lookup(['Bolt'], urlFor); await svc.idle();
    eq(p.calls.length, 3, 'retry after the longer wait');
    eq(store.m.get('bolt').attempts, 3, 'attempts counted');
  }

  // Never blocks: lookup returns before a slow provider answers.
  {
    let release; const gate = new Promise((r) => { release = r; });
    const p = fakeProvider(async () => { await gate; return null; });
    const { svc } = mk(p);
    const t0 = Date.now();
    const out = await svc.lookup(['Uber'], urlFor);
    assert(Date.now() - t0 < 100 && out.Uber === null, 'lookup did not wait'); passed += 1;
    release(); await svc.idle();
  }

  // Duplicates in one burst are one call; people and unknown names make none; no key = no calls.
  {
    const p = fakeProvider(() => null);
    const { svc } = mk(p);
    await Promise.all([svc.lookup(['Jumia', 'jumia', 'JUMIA'], urlFor), svc.lookup(['Jumia'], urlFor)]); await svc.idle();
    eq(p.calls.length, 1, 'concurrent asks for one brand are one call');
    await svc.lookup(['Adaeze Okafor', 'Mama Ngozi'], urlFor); await svc.idle();
    eq(p.calls.length, 1, 'people and unknown names never reach the provider');
    const noProv = mk(null).svc;
    eq(await noProv.lookup(['MTN'], urlFor), { MTN: null }, 'no provider key: answers null, no crash');
  }

  // Daily cap.
  {
    const p = fakeProvider(() => null);
    const svc = createLogoService({ store: memStore(), provider: p, dailyCap: 2, gapMs: 0 });
    await svc.lookup(['MTN', 'Airtel', 'Glo', 'Bolt'], urlFor); await svc.idle();
    eq(p.calls.length, 2, 'stops at the daily cap');
  }

  console.log(`${passed} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
