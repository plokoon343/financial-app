// Round 11 Part J: the logo.dev adapter (server side only). Uses the secret key
// (LOGO_DEV_SECRET_KEY) with the documented self-hosting path: find the domain with
// GET /v2/search, ask GET /v2/brands/logo for a download url, download the file and keep
// the FILE (the url expires). It never uses img.logo.dev, because logo.dev's fair-use page
// says not to download from the CDN to build your own copy.
// Written from logo.dev's published docs; the /v2/brands/logo response shape (`url`,
// `etag`) is as the self-hosting page describes and should get one live check with a key.
'use strict';

const BASE = 'https://api.logo.dev/v2';
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

// A search hit is only trusted when its name and the query share the first word and one
// side's words are all inside the other. "Chowdeck Lagos" ~ "Chowdeck"; "Mama Put" !~ "Mama Cass".
function nameMatches(query, candidate) {
  const a = tokens(query); const b = tokens(candidate);
  if (!a.length || !b.length || a[0] !== b[0]) return false;
  const sa = new Set(a); const sb = new Set(b);
  return [...sb].every((t) => sa.has(t)) || [...sa].every((t) => sb.has(t));
}

function createLogoDev({ secretKey, http = require('axios'), timeoutMs = 15000 }) {
  if (!secretKey) return null;
  const headers = { Authorization: `Bearer ${secretKey}` };

  async function domainFor(name) {
    const r = await http.get(`${BASE}/search`, { headers, params: { q: name, limit: 3 }, timeout: timeoutMs, validateStatus: (s) => s < 500 });
    if (r.status === 429) throw new Error('rate limited');
    if (r.status >= 400) return null;
    const hit = ((r.data && r.data.data) || []).find((c) => c && c.domain && nameMatches(name, c.name));
    return hit ? hit.domain : null;
  }

  async function fetchLogo({ name, domain }) {
    const d = domain || (name ? await domainFor(name) : null);
    if (!d) return null;
    const meta = await http.get(`${BASE}/brands/logo`, { headers, params: { domain: d }, timeout: timeoutMs, validateStatus: (s) => s < 500 });
    if (meta.status === 429 || meta.status === 202) throw new Error(meta.status === 202 ? 'still indexing' : 'rate limited');
    if (meta.status >= 400 || !meta.data || !meta.data.url) return null;
    const url = new URL(meta.data.url);
    url.searchParams.set('format', 'webp');
    url.searchParams.set('size', '128');
    const img = await http.get(url.toString(), { responseType: 'arraybuffer', timeout: timeoutMs, maxContentLength: 200 * 1024, validateStatus: (s) => s < 500 });
    if (img.status >= 400 || !img.data || !img.data.byteLength) return null;
    return { data: Buffer.from(img.data), contentType: String(img.headers['content-type'] || 'image/webp').split(';')[0], etag: String(meta.data.etag || ''), domain: d };
  }

  return { fetchLogo };
}

module.exports = { createLogoDev, nameMatches };
