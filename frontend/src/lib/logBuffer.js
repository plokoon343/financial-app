// A tiny ring buffer of the last 20 console.error/warn lines from this session,
// used only to attach to a support ticket when the user ticks consent (round9
// B3). Never holds transaction data or chat content - just whatever the app
// itself logged to the console.
const MAX = 20;
const buffer = [];

const wrap = (orig) => (...args) => {
  try {
    buffer.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 300));
    if (buffer.length > MAX) buffer.shift();
  } catch { /* ignore */ }
  orig(...args);
};

if (typeof window !== 'undefined' && !window.__automonieLogBufferInstalled) {
  window.__automonieLogBufferInstalled = true;
  console.error = wrap(console.error.bind(console));
  console.warn = wrap(console.warn.bind(console));
}

export const getRecentLogs = () => [...buffer];
