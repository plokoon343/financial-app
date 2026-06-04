// Lightweight, local persistence for first-time feature tips.
const SEEN_KEY = 'finpilot_tips_seen';
const ENABLED_KEY = 'finpilot_tips_enabled';

export const tipsEnabled = () => localStorage.getItem(ENABLED_KEY) !== 'false';
export const setTipsEnabled = (v) => localStorage.setItem(ENABLED_KEY, v ? 'true' : 'false');

const seenList = () => {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'); } catch { return []; }
};
export const hasSeenTip = (key) => seenList().includes(key);
export const markTipSeen = (key) => {
  const a = seenList();
  if (!a.includes(key)) { a.push(key); localStorage.setItem(SEEN_KEY, JSON.stringify(a)); }
};
export const resetTips = () => localStorage.removeItem(SEEN_KEY);
