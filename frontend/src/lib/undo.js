// Undo for deletes and dismissals. The change shows straight away in the page, but
// the request waits 5 seconds behind an Undo button. Starting another one, or
// leaving the page, sends the waiting one at once.

const DELAY = 5000;
let pending = null;
const listeners = new Set();
const notify = () => listeners.forEach((l) => l(pending && { id: pending.id, message: pending.message }));
let counter = 0;

async function send(p) {
  try { await p.commit(); }
  catch {
    p.onUndo?.();
    window.dispatchEvent(new CustomEvent('automonie:undo-failed', { detail: p.message }));
  }
}

// message: what happened ("Account deleted"); commit: the request; onUndo: put the
// page back the way it was.
export function undoable(message, commit, onUndo) {
  flushUndo();
  const p = { id: ++counter, message, commit, onUndo };
  p.timer = setTimeout(() => { if (pending === p) { pending = null; notify(); } send(p); }, DELAY);
  pending = p;
  notify();
}

export function undoLast() {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  notify();
  p.onUndo?.();
}

export function flushUndo() {
  if (!pending) return;
  clearTimeout(pending.timer);
  const p = pending;
  pending = null;
  notify();
  send(p);
}

export function subscribeUndo(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushUndo);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUndo(); });
}
