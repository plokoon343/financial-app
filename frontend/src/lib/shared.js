// Shared / household expenses — track who owes whom, WITHOUT moving any money.
// Purely local (your personal ledger of split costs), stored in localStorage.
// Ported 1:1 from the mobile model (finpilot-mobile/src/lib/shared.ts).

const KEY = 'shared_expenses';

export function loadShared() {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch { /* ignore */ }
  return { people: [], entries: [] };
}
export function saveShared(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

// Raw net per person from MY perspective: >0 they owe me, <0 I owe them.
function rawBalances(state) {
  const bal = {};
  state.people.forEach((p) => { bal[p] = 0; });
  for (const e of state.entries) {
    const parts = e.participants.length ? e.participants : ['me'];
    const share = e.amount / parts.length;
    if (e.paidBy === 'me') {
      parts.forEach((p) => { if (p !== 'me' && bal[p] != null) bal[p] += share; });
    } else if (bal[e.paidBy] != null && parts.includes('me')) {
      bal[e.paidBy] -= share; // I owe the payer my share
    }
  }
  return bal;
}

export function balances(state) {
  const bal = rawBalances(state);
  const settled = state.settlements || {};
  Object.keys(bal).forEach((p) => { bal[p] -= settled[p] || 0; });
  return bal;
}

// Settle marks the current balance as squared (future entries still count).
export function settleWith(state, person) {
  const raw = rawBalances(state);
  return { ...state, settlements: { ...(state.settlements || {}), [person]: raw[person] || 0 } };
}
