import { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Key-gated features the server has switched on ({ assistant, bankLink }). Fetched
// once per page load and shared; everything is treated as off until it answers.
let cached = null;
let pending = null;

export function useServerFeatures() {
  const [features, setFeatures] = useState(cached || {});
  useEffect(() => {
    if (cached) return undefined;
    let alive = true;
    pending = pending || axios
      .get(`${API_URL}/api/features`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((res) => { cached = res.data || {}; return cached; })
      .catch(() => { pending = null; return {}; });
    pending.then((f) => { if (alive) setFeatures(f); });
    return () => { alive = false; };
  }, []);
  return features;
}
