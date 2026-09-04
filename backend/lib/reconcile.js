// Balance reconciliation (spec A5) — the correctness oracle for statement imports.
//
// A statement gives an opening balance, a closing balance, and every transaction
// between. Therefore:
//
//     opening + Σ(credits) − Σ(debits)  ==  closing
//
// If that equation doesn't hold, the import is untrustworthy — a row was dropped,
// duplicated, or misparsed — and we know it WITHOUT a human checking. This is the
// single most valuable accuracy tool for statements, and it works even for a bank
// whose format we've never seen: the balance math validates the import regardless.
//
// Pure and dependency-free so it can be unit-tested; the caller (server.js) feeds
// it the parsed ledger plus the opening/closing balances read from the statement.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const isNum = (n) => typeof n === 'number' && !isNaN(n);

// reconcile({ transactions, openingBalance, closingBalance })
//   transactions: [{ type:'income'|'expense', amount, balance? }]  (amount is unsigned magnitude)
//   openingBalance / closingBalance: numbers read independently from the statement, or null.
// Returns a plain object describing whether the import balances and, when possible,
// which row is the first to diverge.
function reconcile({ transactions = [], openingBalance = null, closingBalance = null } = {}) {
  const credits = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const debits = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const net = round2(credits - debits);

  const result = {
    checked: false,            // did we have enough independent info to verify?
    ok: null,                  // true | false once checked
    openingBalance: isNum(openingBalance) ? round2(openingBalance) : null,
    closingBalance: isNum(closingBalance) ? round2(closingBalance) : null,
    credits: round2(credits),
    debits: round2(debits),
    net,
    count: transactions.length,
    computedClosing: null,     // opening + net
    difference: null,          // computedClosing − closingBalance (0 when balanced)
    firstDivergenceIndex: null, // first row whose running balance breaks (localises the error)
    reason: 'not enough balance information on the statement to verify',
  };

  // The equation check — the strong, independent test. Needs BOTH an opening and a
  // closing balance that were read from the statement (not from the rows we parsed).
  if (isNum(openingBalance) && isNum(closingBalance)) {
    const computed = round2(openingBalance + net);
    const diff = round2(computed - closingBalance);
    result.computedClosing = computed;
    result.difference = diff;
    result.checked = true;
    result.ok = Math.abs(diff) < 0.01;
    result.reason = result.ok
      ? 'balanced: opening + credits − debits = closing'
      : `off by ${diff.toFixed(2)} — a transaction is likely missing, duplicated, or misread`;
  }

  // Error localisation — walk the running balance row by row against each row's own
  // stated balance; the first mismatch points at (or just before) the bad row. Only
  // meaningful when we have an opening balance and every row carries a balance.
  if (isNum(openingBalance)) {
    const withBal = transactions.filter((t) => isNum(t.balance));
    if (withBal.length === transactions.length && transactions.length) {
      let running = round2(openingBalance);
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        running = round2(running + (t.type === 'income' ? Math.abs(t.amount) : -Math.abs(t.amount)));
        if (Math.abs(running - round2(t.balance)) > 0.01) {
          result.firstDivergenceIndex = i;
          if (!result.checked) {
            result.checked = true;
            result.ok = false;
            result.reason = `running balance diverges at row ${i + 1}`;
          }
          break;
        }
      }
    }
  }

  return result;
}

// Pull an opening/closing balance out of raw statement text. Looks for the labelled
// summary figures ("Opening Balance … 12,345.67", "Closing Balance … 9,000.00").
// Returns { openingBalance, closingBalance } with nulls when not found. Kept here so
// both the parser and the tests share one definition of the labels we recognise.
const MONEY_AFTER = /(?:ngn|₦)?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d{2})|-?\d+\.\d{2})/i;
const OPENING_LABELS = ['opening balance', 'balance brought forward', 'balance b/f', 'opening bal', 'b/fwd'];
const CLOSING_LABELS = ['closing balance', 'balance carried forward', 'balance c/f', 'closing bal', 'c/fwd'];

function findLabeledBalance(text, labels, { last = false } = {}) {
  const hay = (text || '').replace(/\s+/g, ' ');
  const low = hay.toLowerCase();
  let found = null;
  for (const label of labels) {
    let from = 0;
    for (;;) {
      const i = low.indexOf(label, from);
      if (i === -1) break;
      const after = hay.slice(i + label.length, i + label.length + 40);
      const m = after.match(MONEY_AFTER);
      if (m) {
        found = parseFloat(m[1].replace(/,/g, ''));
        if (!last) return found; // first hit wins for opening
      }
      from = i + label.length;
    }
  }
  return found; // for closing we keep scanning so the LAST labelled figure wins
}

function extractBalances(text) {
  return {
    openingBalance: findLabeledBalance(text, OPENING_LABELS, { last: false }),
    closingBalance: findLabeledBalance(text, CLOSING_LABELS, { last: true }),
  };
}

module.exports = { reconcile, extractBalances, findLabeledBalance };
