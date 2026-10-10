// First-time feature tips. Seen tips are kept on the account (so a tip seen on the
// phone doesn't show again here) and cached in localStorage for an instant answer.
// Ids are shared with the mobile app: 'screen:money', 'screen:insights', ...
import axios from 'axios';
import { API_URL } from '../config';

const SEEN_KEY = 'finpilot_tips_seen';
const ENABLED_KEY = 'finpilot_tips_enabled';
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export const tipsEnabled = () => localStorage.getItem(ENABLED_KEY) !== 'false';
export const setTipsEnabled = (v) => localStorage.setItem(ENABLED_KEY, v ? 'true' : 'false');

const seenList = () => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
export const hasSeenTip = (key) => seenList().includes(key);
export const markTipSeen = (key) => {
  const a = seenList();
  if (!a.includes(key)) { a.push(key); localStorage.setItem(SEEN_KEY, JSON.stringify(a)); }
  axios.post(`${API_URL}/api/me/tips`, { id: key }, auth()).catch(() => {});
};
// Merge the tips this account has already seen (from /api/me).
export const seedTips = (ids) => {
  if (!Array.isArray(ids) || !ids.length) return;
  const a = seenList();
  const merged = [...new Set([...a, ...ids])];
  if (merged.length !== a.length) localStorage.setItem(SEEN_KEY, JSON.stringify(merged));
};
// Fetch the account's seen tips once per page load, before any tip decides to show.
let loading = null;
export const loadSeenTips = () => {
  loading = loading || axios.get(`${API_URL}/api/me`, auth()).then((r) => seedTips(r.data?.seenTips)).catch(() => {});
  return loading;
};
export const resetTips = () => {
  localStorage.removeItem(SEEN_KEY);
  axios.delete(`${API_URL}/api/me/tips`, auth()).catch(() => {});
};
