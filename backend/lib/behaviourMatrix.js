'use strict';
// The behaviour matrix (round 6, Block 2, section 3.7; research section 2).
//
// Every Transaction gets exactly ONE effect, and the effect is what the totals obey:
//
//   Income     money that is yours to spend
//   Spending   money gone
//   Own move   your money in a different pocket, left out of both totals
//   Cancelled  it did not happen in the end, nets to zero
//   Debt       borrowed or repaid, in neither income nor spending
//
// Getting this wrong is worse than getting a category wrong. A category mistake is
// cosmetic; an effect mistake changes what the app tells someone they can spend. That
// is why a loan received is not income, a withdrawal is not spending, and moving your
// own money between your own accounts is neither.
//
// This module decides the effect of ONE transaction from its own evidence. Rows that
// need the other side of a pair (own move, reversal, refund, fee, ajo) are detected
// here and marked `needsLink`, so the linker (section 3.4) knows what to look for,
// but they are NOT paired here. Where a one-sided answer would be a guess, the row
// says what to ask instead, which is how the matrix's "ask the user when" column is
// honoured without inventing certainty.
//
// Pure and dependency-free.

const lc = (s) => String(s || '').toLowerCase();

const EFFECTS = ['Income', 'Spending', 'Own move', 'Cancelled', 'Debt'];

// ── Wording, kept here rather than scattered through the detectors ──
const RE = {
  failed: /\b(declined|failed|unsuccessful|not successful|cancelled|timed out|insufficient fund)\b/,
  reversalMoved: /\b(reversal|reversed|refund(?:ed)?|rvsl|charge ?back|returned)\b/,
  atm: /\b(atm|cash wdl|cash withdrawal|cardless|cash-?out|pos cash|cash advance)\b/,
  cardPurchase: /\b(web ?pur|pos ?pur|card ?pur|purchase|vpos)\b/,
  // "stamp dut" with a trailing \b never matched "stamp duty": there is no word
  // boundary between "dut" and "y". ATM and card charges are listed here so they are
  // read as the bank's fee before the cash rule below reads them as a withdrawal.
  fee: /\b(stamp\s?duty|stamp\s?duties|vat|transfer fee|nip fee|maintenance fee|account maintenance|amf|sms (?:alert )?charge|commission|cot|levy|card fee|bank charge|service charge|atm charge|atm fee|withdrawal fee|agent fee)\b/,
  ussdFee: /\b(ussd|session fee)\b/,
  airtime: /\b(airtime|recharge|data ?bundle|data ?plan|top ?up)\b/,
  bills: /\b(electricity|nepa|phcn|ikedc|ibedc|ekedc|aedc|eedc|prepaid|dstv|gotv|startimes|water board)\b/,
  betting: /\b(bet9ja|nairabet|sportybet|1xbet|betking|merrybet|betway|msport)\b/,
  interest: /\b(interest|owealth)\b/,
  lender: /\b(okash|fairmoney|palmcredit|carbon|renmoney|quickcheck|aella|branch|migo|sokoloan|kwikcash|creditville|specta|credit ?direct|lendigo)\b/,
  loanIn: /\b(loan|disburse(?:ment|d)?|credit facility|pay ?later|overdraft|advance)\b/,
  loanRepay: /\b(loan repayment|repayment|repaid|loan deduction|loan due|instal?ment|instal?lment)\b/,
  salary: /\b(salary|wage|payroll|stipend|allowance|nysc)\b/,
  savingsApp: /\b(piggyvest|cowrywise|risevest|target savings|vault|owealth|safelock)\b/,
  wallet: /\b(opay|palmpay|moniepoint|kuda|paga|vfd|vbank|paycom|alat)\b/,
  exchange: /\b(binance|luno|quidax|busha|yellowcard|roqqu|bybit|coinbase)\b/,
  dollarCard: /\b(dollar card|usd card|virtual card|chipper|geegpay|grey\b|payday)\b/,
};

// A transfer whose counterparty reads as the user themself. Two or more parts of
// their own name have to appear, so "Samuel" alone never triggers it.
function namesUser(text, userName) {
  const parts = lc(userName).replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  if (parts.length < 2) return false;
  const t = lc(text);
  return parts.filter((w) => t.includes(w)).length >= 2;
}

/**
 * Decide the effect of one Transaction.
 *
 * txn: { direction, amountKobo, description, counterpartyClean, category, channelHints, status }
 * context: { userName, trackedWallets, knownLenders, isSelfTransferRoute }
 *
 * Returns { row, effect, shownAs, needsLink, ask, category }.
 *   row       the matrix row this matched, so a surprising answer can be traced
 *   needsLink what the linker should look for: 'ownMove' | 'reversal' | 'refund'
 *             | 'fee' | 'cash' | null
 *   ask       the question to put in the Action Center, or null to stay silent
 */
function classify(txn = {}, context = {}) {
  const { userName = '', trackedWallets = [] } = context;
  const credit = txn.direction === 'credit';
  const text = `${lc(txn.description)} ${lc(txn.counterpartyClean)} ${(txn.channelHints || []).map(lc).join(' ')}`;
  const name = txn.counterpartyClean || txn.description || '';

  // Row 31: a decline never moved money. Checked first, because a declined payment
  // mentions everything a real one does.
  if (RE.failed.test(text) && !RE.reversalMoved.test(text)) {
    return { row: 31, effect: null, shownAs: null, needsLink: null, ask: null, drop: true };
  }

  // A hold is not money moving. It waits for the final charge and is replaced by it,
  // or dropped after 7 days (13.7).
  if (txn.status === 'pending') {
    return { row: 'hold', effect: null, shownAs: name, needsLink: null, ask: null, hold: true };
  }

  // Rows 7 and 8: a credit that gives money back. Which of the two it is depends on
  // the debit it belongs to, so both ask the linker rather than deciding here.
  if (credit && RE.reversalMoved.test(text)) {
    const refund = /\brefund(?:ed)?\b/.test(text);
    return {
      row: refund ? 8 : 7,
      effect: refund ? 'Spending' : 'Cancelled',   // a refund is negative spending, never income
      shownAs: refund ? `Refund from ${name}` : name,
      needsLink: refund ? 'refund' : 'reversal',
      ask: null,
      negative: refund,
    };
  }

  // Rows 11, 12, 13: the bank's own charges. Small, frequent, and never the user's
  // decision, so they are never a question.
  if (!credit && (RE.fee.test(text) || RE.ussdFee.test(text))) {
    return { row: RE.ussdFee.test(text) ? 12 : 11, effect: 'Spending', shownAs: 'Bank charges', needsLink: 'fee', ask: null, category: 'Bank Charges' };
  }

  // Row 9: cash out. The money is not spent yet, it changed form, so it is an own
  // move into a Cash account and what it was spent on is asked for later, in the
  // digest, not at the till.
  if (!credit && RE.atm.test(text) && !RE.cardPurchase.test(text)) {
    return { row: 9, effect: 'Own move', shownAs: 'Cash withdrawal', needsLink: 'cash', ask: null };
  }

  // Rows 23 and 24: borrowed money is not income, and paying it back is not spending.
  if (credit && (RE.lender.test(text) || RE.loanIn.test(text))) {
    const known = RE.lender.test(text);
    return {
      row: 23, effect: 'Debt', shownAs: `Loan from ${name}`, needsLink: null,
      ask: known ? null : { type: 'loan', question: `Is this ${'₦'}[X] a loan?` },
    };
  }
  if (!credit && (RE.loanRepay.test(text) || (RE.lender.test(text) && /\b(loan|repay|deduction|due)\b/.test(text)))) {
    return { row: 24, effect: 'Debt', shownAs: 'Loan repayment', needsLink: null, ask: null };
  }

  // Rows 20, 21, 26, 27: money parked somewhere else of the user's. Still theirs, so
  // none of it is spending.
  if (!credit && RE.savingsApp.test(text)) {
    return { row: RE.savingsApp.test(text) && /owealth|safelock/.test(text) ? 20 : 21, effect: 'Own move', shownAs: `Saved to ${name}`, needsLink: 'ownMove', ask: null };
  }
  if (!credit && RE.exchange.test(text)) {
    return { row: 27, effect: 'Own move', shownAs: `Moved to ${name}`, needsLink: 'ownMove', ask: null };
  }
  if (!credit && RE.dollarCard.test(text)) {
    return { row: 26, effect: 'Own move', shownAs: `Added to ${name}`, needsLink: 'ownMove', ask: null };
  }

  // Rows 3 and 5: the user's own name on a transfer, or a wallet they track. One side
  // alone cannot prove an own move, so it is flagged for the linker and, if nothing
  // pairs with it, asked once (row 3's "ask the user when").
  const selfNamed = namesUser(text, userName);
  const walletNamed = RE.wallet.test(text);
  const tracked = trackedWallets.some((w) => text.includes(lc(w)));
  if (!credit && (selfNamed || walletNamed)) {
    const certain = selfNamed || tracked;
    return {
      row: tracked || walletNamed ? 5 : 3,
      effect: certain ? 'Own move' : 'Spending',
      shownAs: `Moved to ${name}`,
      needsLink: 'ownMove',
      ask: certain ? null : { type: 'ownMove', question: 'Did this go to another account of yours?' },
    };
  }

  // Row 22: interest. Real income, but grouped so daily kobo credits do not fill the
  // list.
  if (credit && RE.interest.test(text)) {
    return { row: 22, effect: 'Income', shownAs: 'Interest', needsLink: null, ask: null, group: 'monthly' };
  }

  // Row 25: a salary or allowance. Asked once, because income drives safe-to-spend
  // and a wrong guess there is the most expensive wrong guess the app can make.
  if (credit && RE.salary.test(text)) {
    return { row: 25, effect: 'Income', shownAs: RE.salary.test(text) && /nysc|allowance/.test(text) ? 'NYSC allowance' : 'Salary', needsLink: null, ask: { type: 'income', question: 'Is this your monthly income?', once: true } };
  }

  // Rows 16 to 19: everyday spending that is never worth a question.
  if (!credit && RE.airtime.test(text)) return { row: 16, effect: 'Spending', shownAs: name, needsLink: null, ask: null, category: 'Airtime & Data' };
  if (!credit && RE.bills.test(text)) return { row: 17, effect: 'Spending', shownAs: name, needsLink: null, ask: null, category: 'Utilities' };
  if (!credit && RE.betting.test(text)) return { row: 18, effect: 'Spending', shownAs: name, needsLink: null, ask: null, category: 'Entertainment' };
  if (credit && RE.betting.test(text)) return { row: 19, effect: 'Spending', shownAs: `${name} (money back)`, needsLink: null, ask: null, negative: true };

  // Rows 1, 2, 6, 14, 15: ordinary money out and in.
  if (credit) {
    // Row 2, with row 3 checked first above: a credit naming the user is their own
    // money arriving, not income.
    if (selfNamed) {
      return { row: 3, effect: 'Own move', shownAs: `Moved from ${name}`, needsLink: 'ownMove', ask: null };
    }
    return { row: 2, effect: 'Income', shownAs: name, needsLink: null, ask: null };
  }
  return { row: 1, effect: 'Spending', shownAs: name, needsLink: null, ask: null };
}

/**
 * What a set of classified transactions contributes to the month's totals. Own moves,
 * cancellations, debt and holds contribute nothing, which is the point of giving them
 * their own effect rather than a category.
 */
function totals(classified = []) {
  let income = 0, spending = 0;
  for (const c of classified) {
    if (!c || !c.effect) continue;
    const amount = Number(c.amountKobo) || 0;
    if (c.effect === 'Income') income += amount;
    else if (c.effect === 'Spending') spending += c.negative ? -amount : amount;
  }
  return { incomeKobo: income, spendingKobo: spending };
}

module.exports = { classify, totals, namesUser, EFFECTS };
