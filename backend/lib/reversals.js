// Reversal ↔ original-debit pairing (V1 categorisation). A reversal is a credit
// that undoes an earlier charge; on its own we already keep it out of income, but
// the original DEBIT still counts as spend. Pairing the two lets both net out to
// zero — a refunded purchase should affect nothing.
//
// Deliberately conservative so we never wrongly erase a real expense: the debit
// must be the SAME account (bank), the SAME amount (to the naira), and come BEFORE
// the reversal within a short window. Pure + greedy (nearest match first), each
// row used at most once.

const lc = (s) => (s || '').toString().toLowerCase();
const hoursBetween = (a, b) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
const WINDOW_H = 14 * 24; // a reversal usually lands within ~2 weeks of the charge

// reversals: rows with type 'reversal' (amount > 0). debits: rows with type
// 'expense' (amount < 0). Both need { _id, amount, date, bank }.
// Returns [{ reversalId, debitId }].
function pairReversals(reversals, debits) {
  const used = new Set();
  const pairs = [];
  const sorted = [...reversals].sort((a, b) => new Date(a.date) - new Date(b.date));
  for (const r of sorted) {
    const amt = Math.abs(r.amount);
    let best = null;
    let bestGap = Infinity;
    for (const d of debits) {
      const id = String(d._id);
      if (used.has(id)) continue;
      if (Math.abs(Math.abs(d.amount) - amt) > 0.5) continue;   // same amount (to the naira)
      if (lc(d.bank) !== lc(r.bank)) continue;                  // same account
      const gap = hoursBetween(d.date, r.date);                 // debit must precede the reversal
      if (gap < 0 || gap > WINDOW_H) continue;
      if (gap < bestGap) { best = d; bestGap = gap; }
    }
    if (best) { used.add(String(best._id)); pairs.push({ reversalId: String(r._id), debitId: String(best._id) }); }
  }
  return pairs;
}

module.exports = { pairReversals };
