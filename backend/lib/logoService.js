// Round 11 Part J: the merchant logo service. Pure of Mongo and of the network: the
// store and the provider are injected (server.js passes the real ones, tests pass fakes).
//
// Rules this file keeps:
//  - The phone and web never reach a provider. They ask us (`lookup`) and load the image
//    from our own `/api/logos/:id` route.
//  - `lookup` never waits on the provider. It answers from what is cached right now and
//    queues the rest in the background, so a screen is never held up by a logo.
//  - Every outcome is cached: found, "no logo" (30 days) and a failed attempt (backs off
//    1h, 2h, 4h ... up to 24h). A name already resolved or known to have no logo never
//    reaches the provider again until its retry time.
//  - Only names that look like a business are ever sent to a provider (a catalogue brand,
//    an override, or cleanName calling it a business). People and unknown names are not,
//    so a stranger's name never leaves us and a person never gets a random company logo.
'use strict';

const fs = require('fs');
const path = require('path');
const { catalogueMatch } = require('./merchantCatalogue');
const { cleanName } = require('./cleanName');
const { deriveCategoryKey } = require('./merchantKey');
const { overrideFor } = require('./logoOverrides');

const DAY = 24 * 60 * 60 * 1000;
const NONE_RETRY_MS = 30 * DAY;
const ERROR_BASE_MS = 60 * 60 * 1000;
const ERROR_MAX_MS = DAY;
const FILE_DIR = path.join(__dirname, '..', 'data', 'logos');
const FILE_TYPES = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

const idOf = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// One stable cache id per merchant, in this order: our pinned override list, then the
// catalogue brand (the same slug subscriptions use), then the merchant words
// (deriveCategoryKey, the key category learning already uses). `search` is what a provider
// may be asked, or null when the name is not safe to send out.
function keyFor(name) {
  const text = String(name || '').trim();
  if (!text || text.length > 80) return null;
  const o = overrideFor(text);
  if (o) return { id: o.id, domain: o.domain, search: null, source: 'override' };
  const hit = catalogueMatch(text);
  if (hit) return { id: idOf(hit.slug), domain: null, search: hit.service, source: 'catalogue' };
  const k = deriveCategoryKey(text);
  if (!k) return null;
  const biz = cleanName({ raw: text }).counterpartyType === 'business';
  return { id: idOf(k), domain: null, search: biz ? text : null, source: 'name' };
}

function fileFor(id) {
  for (const ext of Object.keys(FILE_TYPES)) {
    const p = path.join(FILE_DIR, `${id}.${ext}`);
    try { if (fs.existsSync(p)) return { p, contentType: FILE_TYPES[ext] }; } catch { /* none */ }
  }
  return null;
}

function createLogoService({ store, provider = null, now = () => Date.now(), dailyCap = 300, queueMax = 200, gapMs = 150 }) {
  const queued = new Set();
  const queue = [];
  let running = false;
  let idleWaiters = [];
  let spent = { day: '', n: 0 };

  const spend = () => {
    const day = new Date(now()).toISOString().slice(0, 10);
    if (spent.day !== day) spent = { day, n: 0 };
    if (spent.n >= dailyCap) return false;
    spent.n += 1;
    return true;
  };

  async function resolveOne(k) {
    const prev = await store.get(k.id);
    try {
      const out = await provider.fetchLogo({ name: k.search, domain: k.domain });
      if (out && out.data) {
        await store.put({ id: k.id, status: 'found', contentType: out.contentType || 'image/webp', data: out.data, etag: out.etag || '', domain: out.domain || k.domain || '', source: k.source, resolvedAt: new Date(now()), retryAt: null, attempts: 0 });
      } else {
        await store.put({ id: k.id, status: 'none', source: k.source, resolvedAt: new Date(now()), retryAt: new Date(now() + NONE_RETRY_MS), attempts: 0 });
      }
    } catch (e) {
      const attempts = ((prev && prev.attempts) || 0) + 1;
      const wait = Math.min(ERROR_MAX_MS, ERROR_BASE_MS * 2 ** (attempts - 1));
      await store.put({ id: k.id, status: 'error', source: k.source, resolvedAt: new Date(now()), retryAt: new Date(now() + wait), attempts, error: String(e && e.message || e).slice(0, 120) }).catch(() => null);
    }
  }

  async function pump() {
    if (running) return;
    running = true;
    while (queue.length) {
      const k = queue.shift();
      try {
        if (spend()) await resolveOne(k);
      } catch (e) { console.error('[logos]', e.message); }
      queued.delete(k.id);
      if (queue.length && gapMs) await new Promise((r) => setTimeout(r, gapMs));
    }
    running = false;
    const w = idleWaiters; idleWaiters = [];
    w.forEach((f) => f());
  }

  function schedule(k) {
    if (!provider || queued.has(k.id) || queue.length >= queueMax) return;
    queued.add(k.id);
    queue.push(k);
    setImmediate(pump);
  }

  const idle = () => (running || queue.length ? new Promise((r) => idleWaiters.push(r)) : Promise.resolve());

  // names -> { [name]: url|null }. Fast: one store read, no provider wait.
  async function lookup(names, urlFor) {
    const out = {};
    const keys = new Map();
    for (const n of names) {
      const k = keyFor(n);
      out[n] = null;
      if (k) keys.set(n, k);
    }
    const metas = await store.getMany([...new Set([...keys.values()].map((k) => k.id))]);
    for (const [n, k] of keys) {
      const m = metas[k.id];
      if (m && m.status === 'found') { out[n] = urlFor(k.id, m.etag); continue; }
      const f = fileFor(k.id);
      if (f) { out[n] = urlFor(k.id, 'file'); continue; }
      const due = !m || !m.retryAt || new Date(m.retryAt).getTime() <= now();
      if (due && (k.domain || k.search)) schedule(k);
    }
    return out;
  }

  // The image bytes for one id (our own copy), or null.
  async function image(id) {
    const m = await store.getImage(id);
    if (m && m.status === 'found' && m.data) return { contentType: m.contentType, data: m.data, etag: m.etag || id };
    const f = fileFor(id);
    if (f) { try { return { contentType: f.contentType, data: fs.readFileSync(f.p), etag: `file-${id}` }; } catch { /* none */ } }
    return null;
  }

  return { keyFor, lookup, image, idle, _queueSize: () => queue.length };
}

module.exports = { createLogoService, keyFor, idOf, NONE_RETRY_MS };
