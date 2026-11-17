import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Round 11 Part J (web): merchant name -> our cached logo url. Asks OUR backend, never a
// logo provider. Names asked for within a short window go in one call; answers are kept for
// the session and a miss is not asked again for five minutes.
const MISS_MS = 5 * 60 * 1000;
const hits = new Map();
const misses = new Map();
const waiting = new Set();
const listeners = new Set();
let timer = null;
let inflight = false;

async function flush() {
  timer = null;
  if (inflight || !waiting.size) return;
  const names = [...waiting].slice(0, 60);
  names.forEach((n) => waiting.delete(n));
  inflight = true;
  try {
    const token = localStorage.getItem('token');
    const { data } = await axios.post(`${API_URL}/api/logos/lookup`, { names }, { headers: { Authorization: `Bearer ${token}` } });
    const logos = (data && data.logos) || {};
    const now = Date.now();
    names.forEach((n) => { if (logos[n]) hits.set(n, logos[n]); else misses.set(n, now); });
    listeners.forEach((f) => f());
  } catch {
    const now = Date.now();
    names.forEach((n) => misses.set(n, now));
  } finally {
    inflight = false;
    if (waiting.size) timer = setTimeout(flush, 50);
  }
}

function want(name) {
  if (!name || hits.has(name) || waiting.has(name)) return;
  const m = misses.get(name);
  if (m && Date.now() - m < MISS_MS) return;
  waiting.add(name);
  if (!timer) timer = setTimeout(flush, 50);
}

export function useLogoUrl(name) {
  const [url, setUrl] = useState(() => hits.get(name) || null);
  useEffect(() => {
    const check = () => setUrl(hits.get(name) || null);
    check();
    want(name);
    listeners.add(check);
    return () => { listeners.delete(check); };
  }, [name]);
  return url;
}
