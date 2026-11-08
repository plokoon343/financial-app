'use strict';
// Run: node backend/lib/txnLinks.test.js
//
// The linking half of the Round 6 Block 2 acceptance suite: T4 to T11 from
// section 2 of the ingestion research doc, plus the undo rules from brief 3.6.
// T1, T2, T3, T12, T13 and T14 are merge-ladder cases and live in Block 2a's own
// suite (lib/observationLedger.test.js); they are not repeated here.
//
// Every input below except the GTBank SMS shapes is a synthetic field set, as the
// brief says: replace them with redacted real alerts from the corpus before release.

const {
  detectLinks, detectFeeLinks, detectReversalLinks, detectOwnMoveLinks, detectRefundLinks,
  detectCashLinks, feeSummary, cashRemaining, effectOfLink, inFeeTable, buildFeeTable,
  feeTableFromEnv, looksLikeCashOut, moveLabel, LINK_COPY,
} = require('./txnLinks');
const { undoOptions, planUnlink, planSplit, provenanceLines } = require('./linkUndo');
const { balanceGate, matchRows, missingFromStatement, reconcileStatement, fieldConflictCard } = require('./statementRecon');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const USER = 'Chidumebi Onukogu';
// A row as this codebase stores one: amount signed to the real direction.
const row = (o) => Object.assign({
  _id: o.id, type: o.dir === 'credit' ? 'income' : 'expense',
  amount: o.dir === 'credit' ? Math.abs(o.amount) : -Math.abs(o.amount),
  date: new Date(o.at), description: o.desc || '', bank: o.bank || '',
  bankCode: o.bankCode || '', accountMask: o.mask || '', category: o.cat || 'Other',
  reference: o.ref || '',
}, o.extra || {});
const linksOfKind = (r, kind) => r.links.filter((l) => l.kind === kind);
const has = (r, kind, fromId, toId) => r.links.some((l) => l.kind === kind && l.fromId === fromId && l.toId === toId);

// ── The fee table [config] ────────────────────────────────────────────────────
check('fee table holds the seeded fees', [6.98, 10, 25, 50].every((n) => inFeeTable(n)));
check('fee table holds the VAT lines', inFeeTable(0.75) && inFeeTable(3.75));
check('fee table holds the VAT-inclusive totals', inFeeTable(10.75) && inFeeTable(53.75));
check('fee table rejects an ordinary amount', !inFeeTable(2000) && !inFeeTable(99));
check('fee table is configurable', buildFeeTable([100]).includes(100) && !buildFeeTable([100]).includes(6.98));
check('fee table reads from config', feeTableFromEnv({ FEE_TABLE: '100, 200' }).includes(100));
check('fee table falls back to the seed', feeTableFromEnv({}).includes(6.98));

// ── T4: a move between the user's own two accounts ────────────────────────────
// GTBank debit to the user's own name, then a Kuda credit from the same name a
// minute later. One linked pair, Own move, out of the totals, nothing asked.
{
  const t4 = [
    row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to CHIDUMEBI ONUKOGU', bank: 'GTBank', bankCode: 'gtbank', mask: '6083' }),
    row({ id: 'c', dir: 'credit', amount: 50000, at: '2026-10-02T14:01:00Z', desc: 'Transfer from CHIDUMEBI ONUKOGU', bank: 'Kuda', bankCode: 'kuda', mask: '1122' }),
  ];
  const r = detectLinks(t4, { userName: USER });
  check('T4 one own-move link', linksOfKind(r, 'ownMove').length === 1);
  check('T4 links the debit to the credit', has(r, 'ownMove', 'd', 'c'));
  check('T4 nothing to ask', r.ask.length === 0);
  const l = linksOfKind(r, 'ownMove')[0];
  check('T4 auto-linked on the own-name rule', l.rule === 'own_move_own_name');
  check('T4 records who made it', l.createdBy === 'rule');
  check('T4 says Moved to Kuda', l.label === 'Moved to Kuda');
  check('T4 excluded from the totals', effectOfLink('ownMove', 'from').countedIn === 'none');
  check('T4 both sides become internal_transfer', effectOfLink('ownMove', 'to').type === 'internal_transfer');
}

// A pair the rules cannot vouch for is asked about once, not guessed.
{
  const vague = [
    row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to ACCESS BANK', bank: 'GTBank', bankCode: 'gtbank' }),
    row({ id: 'c', dir: 'credit', amount: 50000, at: '2026-10-02T14:02:00Z', desc: 'Inward transfer', bank: 'Access', bankCode: 'access' }),
  ];
  const r = detectOwnMoveLinks(vague, { userName: USER });
  check('an unvouched pair is asked, not linked', r.links.length === 0 && r.ask.length === 1);
  check('the asked pair carries its route key', !!r.ask[0].routeKey);
  const saved = detectOwnMoveLinks(vague, { userName: USER, routeKeys: new Set([r.ask[0].routeKey]) });
  check('a saved route auto-links next time', saved.links.length === 1 && saved.links[0].rule === 'own_move_saved_route');
}

// Two accounts, same amount, but hours apart: not a move.
{
  const late = [
    row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to CHIDUMEBI ONUKOGU', bank: 'GTBank' }),
    row({ id: 'c', dir: 'credit', amount: 50000, at: '2026-10-02T18:00:00Z', desc: 'From CHIDUMEBI ONUKOGU', bank: 'Kuda' }),
  ];
  check('outside the 10-minute window it is not a move', detectOwnMoveLinks(late, { userName: USER }).links.length === 0);
}

// The credit may be smaller by a known fee.
{
  const withFee = [
    row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to CHIDUMEBI ONUKOGU', bank: 'GTBank' }),
    row({ id: 'c', dir: 'credit', amount: 49990, at: '2026-10-02T14:01:00Z', desc: 'From CHIDUMEBI ONUKOGU', bank: 'Kuda' }),
  ];
  const r = detectOwnMoveLinks(withFee, { userName: USER });
  check('a credit short by a table fee still links', r.links.length === 1 && r.links[0].fee === 10);
  const odd = [
    row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to CHIDUMEBI ONUKOGU', bank: 'GTBank' }),
    row({ id: 'c', dir: 'credit', amount: 45000, at: '2026-10-02T14:01:00Z', desc: 'From CHIDUMEBI ONUKOGU', bank: 'Kuda' }),
  ];
  check('a credit short by an unknown amount does not link', detectOwnMoveLinks(odd, { userName: USER }).links.length === 0);
}

// ── T5: a bank funds a wallet, then the wallet pays a merchant ────────────────
// The funding is an Own move; only the restaurant debit counts as Spending.
{
  const t5 = [
    row({ id: 'fund-d', dir: 'debit', amount: 20000, at: '2026-10-03T09:00:00Z', desc: 'TRF to OPAY DIGITAL SERVICES', bank: 'Access', bankCode: 'access' }),
    row({ id: 'fund-c', dir: 'credit', amount: 20000, at: '2026-10-03T09:00:30Z', desc: 'Wallet funding', bank: 'OPay', bankCode: 'opay' }),
    row({ id: 'food', dir: 'debit', amount: 4500, at: '2026-10-03T13:00:00Z', desc: 'POS KILIMANJARO RESTAURANT', bank: 'OPay', bankCode: 'opay', cat: 'Food' }),
  ];
  const r = detectLinks(t5, { userName: USER });
  check('T5 the funding is one own move', linksOfKind(r, 'ownMove').length === 1 && has(r, 'ownMove', 'fund-d', 'fund-c'));
  check('T5 linked on the wallet-provider rule', linksOfKind(r, 'ownMove')[0].rule === 'own_move_wallet_provider');
  check('T5 the restaurant debit is left alone', !r.links.some((l) => l.fromId === 'food' || l.toId === 'food'));
  const spending = t5.filter((t) => !r.links.some((l) => l.kind === 'ownMove' && (l.fromId === String(t._id) || l.toId === String(t._id))))
    .filter((t) => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  check('T5 only the 4,500 counts as spending', spending === 4500);
}

// Card-to-wallet funding gets the longer 60-minute window.
{
  const slowFunding = [
    row({ id: 'd', dir: 'debit', amount: 20000, at: '2026-10-03T09:00:00Z', desc: 'WEB PUR OPAY', bank: 'Access', bankCode: 'access' }),
    row({ id: 'c', dir: 'credit', amount: 20000, at: '2026-10-03T09:45:00Z', desc: 'Card funding', bank: 'OPay', bankCode: 'opay' }),
  ];
  check('wallet funding gets 60 minutes', detectOwnMoveLinks(slowFunding, { userName: USER }).links.length === 1);
}

// ── T6: a failed transfer and its reversal ────────────────────────────────────
// Same account, same amount, same reference, 40 minutes later. Both Cancelled.
{
  const t6 = [
    row({ id: 'd', dir: 'debit', amount: 15000, at: '2026-10-04T10:00:00Z', desc: 'TRF to TUNDE BALOGUN', bank: 'Zenith', bankCode: 'zenith', mask: '4120', ref: 'R1' }),
    row({ id: 'c', dir: 'credit', amount: 15000, at: '2026-10-04T10:40:00Z', desc: 'REVERSAL: failed transfer', bank: 'Zenith', bankCode: 'zenith', mask: '4120', ref: 'R1' }),
  ];
  const r = detectLinks(t6, { userName: USER });
  check('T6 one reversal link', linksOfKind(r, 'reversal').length === 1 && has(r, 'reversal', 'c', 'd'));
  check('T6 matched on the stated reference', linksOfKind(r, 'reversal')[0].rule === 'reversal_same_reference');
  check('T6 both sides are cancelled', linksOfKind(r, 'reversal')[0].cancels === true);
  check('T6 neither side counts', effectOfLink('reversal', 'from').countedIn === 'none' && effectOfLink('reversal', 'to').countedIn === 'none');
  check('T6 it is not also read as an own move', linksOfKind(r, 'ownMove').length === 0);
  // The net effect of the pair is zero.
  const net = t6.reduce((s, t) => s + t.amount, 0);
  check('T6 nets to zero', net === 0);
}

// Reversal wording alone is enough when there is no reference.
{
  const worded = [
    row({ id: 'd', dir: 'debit', amount: 15000, at: '2026-10-04T10:00:00Z', desc: 'TRF to TUNDE', bank: 'Zenith', mask: '4120' }),
    row({ id: 'c', dir: 'credit', amount: 15000, at: '2026-10-04T12:00:00Z', desc: 'RVSL of failed transaction', bank: 'Zenith', mask: '4120' }),
  ];
  check('reversal wording links without a reference', detectReversalLinks(worded, {}).length === 1);
  const plain = [
    row({ id: 'd', dir: 'debit', amount: 15000, at: '2026-10-04T10:00:00Z', desc: 'TRF to TUNDE', bank: 'Zenith', mask: '4120' }),
    row({ id: 'c', dir: 'credit', amount: 15000, at: '2026-10-04T12:00:00Z', desc: 'Transfer from ADA', bank: 'Zenith', mask: '4120' }),
  ];
  check('an ordinary credit is not a reversal', detectReversalLinks(plain, {}).length === 0);
  const stale = [
    row({ id: 'd', dir: 'debit', amount: 15000, at: '2026-10-01T10:00:00Z', desc: 'TRF to TUNDE', bank: 'Zenith', mask: '4120' }),
    row({ id: 'c', dir: 'credit', amount: 15000, at: '2026-10-05T10:00:00Z', desc: 'REVERSAL', bank: 'Zenith', mask: '4120' }),
  ];
  check('beyond 72 hours it is not a reversal', detectReversalLinks(stale, {}).length === 0);
}

// ── T7: the charges on a transfer ─────────────────────────────────────────────
// A 15,000 transfer, then a 10 and a 50 debit 30 seconds later at the same account.
{
  const parent = row({ id: 'p', dir: 'debit', amount: 15000, at: '2026-10-05T12:00:10Z', desc: 'TRF to TUNDE BALOGUN', bank: 'GTBank', bankCode: 'gtbank', mask: '6083' });
  const f1 = row({ id: 'f1', dir: 'debit', amount: 10, at: '2026-10-05T12:00:40Z', desc: 'TRF CHARGE', bank: 'GTBank', bankCode: 'gtbank', mask: '6083', cat: 'Bank Charges' });
  const f2 = row({ id: 'f2', dir: 'debit', amount: 50, at: '2026-10-05T12:00:40Z', desc: 'STAMP DUTY', bank: 'GTBank', bankCode: 'gtbank', mask: '6083', cat: 'Bank Charges' });
  const r = detectLinks([parent, f1, f2], { userName: USER });
  check('T7 both charges become children', linksOfKind(r, 'fee').length === 2);
  check('T7 the 10 points at the transfer', has(r, 'fee', 'f1', 'p'));
  check('T7 the 50 points at the transfer', has(r, 'fee', 'f2', 'p'));
  check('T7 detail reads 15,060 including 60 charges', feeSummary(parent, [f1, f2]) === '₦15,060 including ₦60 charges');
  check('T7 a charge is still spending', effectOfLink('fee', 'from').countedIn === 'spending');
  check('T7 a charge is filed as Bank Charges', effectOfLink('fee', 'from').category === 'Bank Charges');
  // Beyond the 2-minute window it is not a charge on that transfer.
  const lateFee = row({ id: 'f3', dir: 'debit', amount: 50, at: '2026-10-05T12:05:00Z', desc: 'STAMP DUTY', bank: 'GTBank', bankCode: 'gtbank', mask: '6083' });
  check('T7 a charge 5 minutes later is not a child', detectFeeLinks([parent, lateFee], {}).length === 0);
  // Two possible parents is ambiguous: leave it rather than guess.
  const p2 = row({ id: 'p2', dir: 'debit', amount: 9000, at: '2026-10-05T12:00:20Z', desc: 'TRF to ADA', bank: 'GTBank', bankCode: 'gtbank', mask: '6083' });
  check('T7 two candidate parents leaves it unlinked', detectFeeLinks([parent, p2, f2], {}).length === 0);
  // A charge at a different account is not this transfer's charge.
  const elsewhere = row({ id: 'f4', dir: 'debit', amount: 50, at: '2026-10-05T12:00:40Z', desc: 'STAMP DUTY', bank: 'Zenith', bankCode: 'zenith', mask: '4120' });
  check('T7 a charge at another account is not a child', detectFeeLinks([parent, elsewhere], {}).length === 0);
}

// ── T8: a cash withdrawal, its fee, and the cash later logged ─────────────────
{
  const wd = row({ id: 'w', dir: 'debit', amount: 20000, at: '2026-10-06T10:00:00Z', desc: 'ATM WITHDRAWAL UBA LAGOS', bank: 'UBA', bankCode: 'uba', mask: '7781', extra: { type: 'cash_withdrawal' } });
  const fee = row({ id: 'wf', dir: 'debit', amount: 100, at: '2026-10-06T10:00:30Z', desc: 'ATM WITHDRAWAL FEE', bank: 'UBA', bankCode: 'uba', mask: '7781', cat: 'Bank Charges' });
  const food = row({ id: 'cf', dir: 'debit', amount: 3000, at: '2026-10-07T13:00:00Z', desc: 'Cash · Food', bank: 'UBA', cat: 'Food', extra: { cashParentId: 'w' } });
  const r = detectLinks([wd, fee, food], { userName: USER });
  check('T8 the withdrawal is read as cash out', looksLikeCashOut(wd));
  check('T8 the 100 is a charge on the withdrawal', has(r, 'fee', 'wf', 'w'));
  check('T8 the cash spend links to the withdrawal', has(r, 'cash', 'cf', 'w'));
  check('T8 the withdrawal itself never counts', effectOfLink('cash', 'to').countedIn === 'none');
  check('T8 17,000 cash still to log', cashRemaining(wd, [food]) === 17000);
  check('T8 the food is ordinary spending', !r.links.some((l) => l.kind === 'ownMove' && (l.fromId === 'cf' || l.toId === 'cf')));
  check('T8 nothing left to log once it is all allocated', cashRemaining(wd, [food, row({ id: 'x', dir: 'debit', amount: 17000, at: '2026-10-07T14:00:00Z' })]) === 0);
}

// ── T9: a refund weeks later ──────────────────────────────────────────────────
{
  const debit = row({ id: 'buy', dir: 'debit', amount: 8999, at: '2026-10-01T11:00:00Z', desc: 'WEB PUR JUMIA NG', bank: 'GTBank', bankCode: 'gtbank', mask: '6083', cat: 'Shopping' });
  const credit = row({ id: 'back', dir: 'credit', amount: 8999, at: '2026-10-24T09:00:00Z', desc: 'REFUND JUMIA NG', bank: 'GTBank', bankCode: 'gtbank', mask: '6083' });
  const r = detectLinks([debit, credit], { userName: USER });
  check('T9 one refund link', linksOfKind(r, 'refund').length === 1 && has(r, 'refund', 'back', 'buy'));
  check('T9 the refund carries the charge’s category', linksOfKind(r, 'refund')[0].category === 'Shopping');
  check('T9 a refund is never income', effectOfLink('refund', 'from').type !== 'income');
  check('T9 a refund does not count as income', effectOfLink('refund', 'from').countedIn === 'none');
  // That category's October spending nets to zero.
  const net = Math.abs(debit.amount) - Math.abs(credit.amount);
  check('T9 the category nets to zero', net === 0);
  // Past 90 days it stands alone.
  const old = row({ id: 'buy2', dir: 'debit', amount: 8999, at: '2026-05-01T11:00:00Z', desc: 'WEB PUR JUMIA NG', bank: 'GTBank', mask: '6083' });
  check('T9 beyond 90 days there is no refund link', detectRefundLinks([old, credit], {}).links.length === 0);
  // Two possible earlier debits: ask, do not pick.
  const twin = row({ id: 'buy3', dir: 'debit', amount: 8999, at: '2026-10-10T11:00:00Z', desc: 'WEB PUR JUMIA NG', bank: 'GTBank', mask: '6083' });
  const amb = detectRefundLinks([debit, twin, credit], {});
  check('T9 two candidates are asked about', amb.links.length === 0 && amb.ask.length === 1 && amb.ask[0].choices.length === 2);
  // A partial refund is allowed; a credit larger than the charge is not a refund.
  const part = row({ id: 'part', dir: 'credit', amount: 4000, at: '2026-10-20T09:00:00Z', desc: 'REFUND JUMIA NG', bank: 'GTBank', mask: '6083' });
  check('T9 a partial refund still links', detectRefundLinks([debit, part], {}).links.length === 1);
  const bigger = row({ id: 'big', dir: 'credit', amount: 20000, at: '2026-10-20T09:00:00Z', desc: 'JUMIA NG', bank: 'GTBank', mask: '6083' });
  check('T9 a credit bigger than the charge is not a refund', detectRefundLinks([debit, bigger], {}).links.length === 0);
}

// Phone check P4/P5, 8 Nov 2026: "dozens of Owealth Withdrawal(Payment) cards",
// some with two indistinguishable candidates. OWealth churn is savings-pocket
// movement, never a refund question, however many identical rows there are.
{
  const owCredit = row({ id: 'ow-credit', dir: 'credit', amount: 5000, at: '2026-08-18T09:00:00Z', desc: 'OWealth Withdrawal(Payment)', bank: 'OPay', mask: '1234' });
  const owDebit1 = row({ id: 'ow-debit1', dir: 'debit', amount: 5000, at: '2026-08-17T09:00:00Z', desc: 'OWealth Withdrawal(Payment)', bank: 'OPay', mask: '1234' });
  const owDebit2 = row({ id: 'ow-debit2', dir: 'debit', amount: 5000, at: '2026-08-18T08:00:00Z', desc: 'OWealth Withdrawal(Payment)', bank: 'OPay', mask: '1234' });
  const owResult = detectRefundLinks([owDebit1, owDebit2, owCredit], {});
  check('P4/P5: OWealth churn never becomes a refund link', owResult.links.length === 0);
  check('P4/P5: OWealth churn is dropped, not asked about even with two candidates', owResult.ask.length === 0);
  // A real purchase and refund for the same amount, on the same day OWealth also
  // moved money, must still link normally - the exclusion is about OWealth
  // specifically, not about every row sharing its day.
  const realDebit = row({ id: 'real-buy', dir: 'debit', amount: 5000, at: '2026-08-17T11:00:00Z', desc: 'WEB PUR JUMIA NG', bank: 'GTBank', mask: '6083' });
  const realCredit = row({ id: 'real-refund', dir: 'credit', amount: 5000, at: '2026-08-18T09:00:00Z', desc: 'REFUND JUMIA NG', bank: 'GTBank', mask: '6083' });
  const mixed = detectRefundLinks([owDebit1, owDebit2, realDebit, realCredit], {});
  check('P4/P5: a real refund alongside OWealth churn still links', mixed.links.length === 1 && has(mixed, 'refund', 'real-refund', 'real-buy'));
}

// ── T10: a statement row for a transaction we already hold ────────────────────
// The statement says 3 Oct; the SMS said 2 Oct 22:59 Lagos time. Inside the
// ladder's plus-or-minus-one-day window for a statement row, so it merges and the
// statement becomes another source rather than a second transaction.
{
  const existing = [{
    _id: 'tx1', type: 'expense', amount: -2000, date: new Date('2026-10-02T21:59:00Z'),
    description: 'TRF to ADA OKAFOR', bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083',
    source: 'sms', channel: 'sms',
  }];
  const rows = [{ type: 'expense', amount: 2000, date: new Date('2026-10-03T00:00:00Z'), description: 'TRF to ADA OKAFOR', balance: 127696.51 }];
  const r = matchRows({ rows, existing, bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083' });
  check('T10 the statement row matches the SMS transaction', r.matched.length === 1 && r.matched[0].transactionId === 'tx1');
  check('T10 nothing is added as a second transaction', r.added.length === 0);
  check('T10 the match records its ladder rule', !!r.matched[0].rule && r.matched[0].step != null);
  check('T10 the statement is recorded as the source that joined', r.matched[0].source === 'statement');
  // A row three days out is a different transaction, not this one.
  const farRows = [{ type: 'expense', amount: 2000, date: new Date('2026-10-06T00:00:00Z'), description: 'TRF to ADA OKAFOR' }];
  const far = matchRows({ rows: farRows, existing, bank: 'GTBank', bankCode: 'gtbank' });
  check('T10 a row days out is added, not merged', far.matched.length === 0 && far.added.length === 1);
}

// ── T11: an alert with no row on the statement ────────────────────────────────
{
  const existing = [
    { _id: 'real', type: 'expense', amount: -2000, date: new Date('2026-10-03T10:00:00Z'), description: 'TRF to ADA OKAFOR', bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083', source: 'sms', channel: 'sms' },
    { _id: 'ghost', type: 'income', amount: 100000, date: new Date('2026-10-15T10:00:00Z'), description: 'Credit alert from UNKNOWN', bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083', source: 'sms', channel: 'sms' },
  ];
  const parsed = {
    openingBalance: 100000, closingBalance: 98000,
    transactions: [{ type: 'expense', amount: 2000, date: new Date('2026-10-03T10:00:00Z'), description: 'TRF to ADA OKAFOR', balance: 98000 }],
  };
  const r = reconcileStatement({ parsed, existing, bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083', periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-31T23:59:59Z') });
  check('T11 the statement balances, so it is not rejected', r.rejected === false && r.gate.verified === true);
  check('T11 the real transaction matched its row', r.matched.length === 1 && r.matched[0].transactionId === 'real');
  check('T11 the unbacked credit is flagged', r.missing.length === 1 && r.missing[0].transactionId === 'ghost');
  check('T11 the flag says it is not on the statement', r.missing[0].reason === 'This alert is not on your statement');
  check('T11 an unbacked credit is urgent', r.missing[0].urgent === true);
  check('T11 the summary names it', /not on your statement/.test(r.summary));
  // A statement we could not verify never accuses an alert of being fake.
  const unverified = reconcileStatement({
    parsed: { transactions: parsed.transactions }, existing,
    bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083',
    periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-31T23:59:59Z'),
  });
  check('T11 an unverified statement flags nothing', unverified.missing.length === 0 && unverified.gate.verified === false);
  // An account the statement does not cover is left out of the check.
  const other = missingFromStatement({
    existing: [{ _id: 'elsewhere', type: 'income', amount: 5000, date: new Date('2026-10-15T10:00:00Z'), bank: 'Kuda', bankCode: 'kuda', accountMask: '1122', source: 'sms' }],
    matched: [], periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-31T23:59:59Z'),
    bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083',
  });
  check('T11 another account is not flagged', other.length === 0);
  // A manual entry is not an alert, so it is never called a fake alert.
  const manual = missingFromStatement({
    existing: [{ _id: 'typed', type: 'income', amount: 5000, date: new Date('2026-10-15T10:00:00Z'), bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083', source: 'manual' }],
    matched: [], periodStart: new Date('2026-10-01T00:00:00Z'), periodEnd: new Date('2026-10-31T23:59:59Z'),
    bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083',
  });
  check('T11 a manual entry is not flagged', manual.length === 0);
}

// ── 3.5, step 1: the balance gate rejects a file that does not add up ─────────
{
  const bad = balanceGate({
    openingBalance: 100000, closingBalance: 98000,
    transactions: [{ type: 'expense', amount: 500, balance: 99500 }],
  });
  check('a statement that does not add up is rejected', bad.ok === false);
  check('the rejection names the gap', /out by/.test(bad.detail));
  check('the rejection offers another file', bad.action === 'Try another file');
  const good = balanceGate({
    openingBalance: 100000, closingBalance: 98000,
    transactions: [{ type: 'expense', amount: 2000, balance: 98000 }],
  });
  check('a statement that adds up passes', good.ok === true && good.verified === true);
  const silent = balanceGate({ transactions: [{ type: 'expense', amount: 2000 }] });
  check('a statement with no balances still imports', silent.ok === true && silent.verified === false);
  check('and says plainly that it was not checked', /could not double-check/.test(silent.detail));
  const rejected = reconcileStatement({
    parsed: { openingBalance: 100000, closingBalance: 98000, transactions: [{ type: 'expense', amount: 500, date: new Date('2026-10-03T10:00:00Z'), balance: 99500 }] },
    existing: [],
  });
  check('a rejected statement imports nothing', rejected.rejected === true && rejected.added.length === 0);
}

// ── 3.3 and 3.5: sources that disagree raise a card, never a merge ────────────
// The ladder catches a disagreement before merging; the field winners catch one
// after. Both are the same question, so both come out looking the same.
{
  const existing = [{
    _id: 'tx1', type: 'expense', amount: -2000, date: new Date('2026-10-03T10:00:00Z'),
    description: 'TRF to ADA OKAFOR', bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083',
    source: 'sms', channel: 'sms', reference: 'SID-99',
  }];
  // The same session id, a different amount: certainly the same payment, so it is
  // never two transactions and never a silent merge either.
  const rows = [{ type: 'expense', amount: 2500, date: new Date('2026-10-03T10:00:00Z'), description: 'TRF to ADA OKAFOR', reference: 'SID-99' }];
  const r = matchRows({ rows, existing, bank: 'GTBank', bankCode: 'gtbank', accountMask: '6083' });
  check('a disagreeing reference is not merged', r.matched.length === 0);
  check('a disagreeing reference raises Which is right', r.ask.length === 1 && r.ask[0].kind === 'which_is_right');
  check('the card names the one transaction it disagrees with', r.ask[0].transactionId === 'tx1');
  check('the card names the field that disagrees', r.ask[0].field === 'amount');
  check('the card quotes both amounts, ours first', /2,000\.00/.test(r.ask[0].reason) && /2,500\.00/.test(r.ask[0].reason));
  check('the row is still kept, flagged for a look', r.added.length === 1 && r.added[0]._needsReview === true);
  // The field-winner path produces the same card.
  const card = fieldConflictCard('tx1', { conflict: { field: 'amount', values: [200000, 250000], sources: ['sms', 'statement'] } });
  check('a field-winner conflict makes the same card', card.kind === 'which_is_right' && card.field === 'amount');
  check('and says where it was caught', card.from === 'field_winners');
  check('a direction conflict reads in plain words', /money out/.test(fieldConflictCard('tx1', { conflict: { field: 'direction', values: ['debit', 'credit'] } }).reason));
  check('no conflict makes no card', fieldConflictCard('tx1', { conflict: null }) === null);
}

// ── 3.6: every merge and every link is reversible ─────────────────────────────
{
  const debit = row({ id: 'd', dir: 'debit', amount: 50000, at: '2026-10-02T14:00:00Z', desc: 'TRF to CHIDUMEBI ONUKOGU', bank: 'GTBank', bankCode: 'gtbank' });
  const credit = row({ id: 'c', dir: 'credit', amount: 50000, at: '2026-10-02T14:01:00Z', desc: 'From CHIDUMEBI ONUKOGU', bank: 'Kuda', bankCode: 'kuda' });
  const l = detectOwnMoveLinks([debit, credit], { userName: USER }).links[0];

  const opts = undoOptions({ txn: debit, links: [l], sources: [] });
  check('3.6 an own move offers an undo', opts.length === 1 && opts[0].action === 'unlink');
  check('3.6 the undo copy is the brief’s', opts[0].label === 'Not a move between my accounts');
  check('3.6 the undo names the other side', opts[0].otherId === 'c');
  check('3.6 the undo says who linked it', opts[0].createdBy === 'rule' && opts[0].rule === 'own_move_own_name');

  const plan = planUnlink({ txn: debit, other: credit, link: l });
  check('3.6 unlinking restores both rows', plan.updates.length === 2);
  check('3.6 the debit goes back to spending', plan.updates.find((u) => u.id === 'd').set.type === 'expense');
  check('3.6 the credit goes back to income', plan.updates.find((u) => u.id === 'c').set.type === 'income');
  check('3.6 unlinking writes a correction', !!plan.correction && plan.correction.kind === 'own_move');
  check('3.6 the correction records it was the user', plan.correction.madeBy === 'user');
  check('3.6 the correction records what it undid', plan.correction.undoOf === 'rule' && plan.correction.to === 'not_ownMove');
  check('3.6 unlinking confirms it in words', /totals/.test(plan.toast));

  // A charge goes back to being a charge, not to nothing.
  const feeLink = { kind: 'fee', fromId: 'f1', toId: 'p', createdBy: 'rule', rule: 'fee_after_parent' };
  const feePlan = planUnlink({ txn: row({ id: 'f1', dir: 'debit', amount: 50, at: '2026-10-05T12:00:40Z', desc: 'STAMP DUTY', cat: 'Bank Charges' }), other: row({ id: 'p', dir: 'debit', amount: 15000, at: '2026-10-05T12:00:10Z' }), link: feeLink });
  check('3.6 unlinking a charge clears feeFor', feePlan.updates.some((u) => u.id === 'f1' && u.unset && 'feeFor' in u.unset));
  check('3.6 unlinking a charge writes a fee correction', feePlan.correction.kind === 'fee');

  // Cash goes back to being cash to log.
  const cashLink = { kind: 'cash', fromId: 'cf', toId: 'w', createdBy: 'user', rule: 'cash_spend_of_withdrawal' };
  const cashPlan = planUnlink({ txn: row({ id: 'cf', dir: 'debit', amount: 3000, at: '2026-10-07T13:00:00Z', extra: { cashParentId: 'w' } }), other: row({ id: 'w', dir: 'debit', amount: 20000, at: '2026-10-06T10:00:00Z', extra: { type: 'cash_withdrawal' } }), link: cashLink });
  check('3.6 unlinking cash clears the parent', cashPlan.updates.some((u) => u.id === 'cf' && u.unset && 'cashParentId' in u.unset));
  check('3.6 unlinking cash reopens the withdrawal', cashPlan.updates.some((u) => u.id === 'w' && u.set && u.set.cashAllocated === false));
  check('3.6 the correction records the user undid our rule', cashPlan.correction.undoOf === 'user');

  // Splitting a merge gives every source back its own transaction.
  const sources = [
    { id: 's1', source: 'sms', direction: 'debit', amountKobo: 200000, eventTime: new Date('2026-10-02T21:59:00Z'), counterpartyRaw: 'TRF to ADA OKAFOR', createdBy: 'rule', rule: 'window' },
    { id: 's2', source: 'notification', direction: 'debit', amountKobo: 200000, eventTime: new Date('2026-10-02T22:00:00Z'), counterpartyRaw: 'Ada Okafor', createdBy: 'rule', rule: 'window' },
  ];
  const merged = { _id: 'tx1', description: 'Ada Okafor', category: 'Sent to people', bank: 'GTBank', date: new Date('2026-10-02T21:59:00Z') };
  const mergeOpts = undoOptions({ txn: merged, links: [], sources });
  check('3.6 a merge offers Not the same', mergeOpts.length === 1 && mergeOpts[0].label === 'Not the same');
  check('3.6 the merge undo lists its sources', mergeOpts[0].sources.length === 2);
  const split = planSplit({ txn: merged, sources });
  check('3.6 splitting keeps one and recreates the rest', split.newRows.length === 1 && split.keepSource.id === 's1');
  check('3.6 the split row keeps its own amount and direction', split.newRows[0].amount === -2000 && split.newRows[0].type === 'expense');
  check('3.6 the split row keeps the source it came from', split.newRows[0].source === 'notification');
  check('3.6 splitting writes a merge correction', split.correction.kind === 'merge' && split.correction.to === 'split');
  check('3.6 splitting one source alone is a no-op', planSplit({ txn: merged, sources: [sources[0]] }).noop === true);

  // Provenance: detail can say where this came from and why, in plain words.
  const lines = provenanceLines({ sources, links: [l] });
  check('3.6 detail says where it came from', lines[0].kind === 'sources' && /bank text/.test(lines[0].text));
  check('3.6 detail explains the merge', lines.some((x) => x.kind === 'merge' && /minutes apart/.test(x.text)));
  check('3.6 detail explains the link', lines.some((x) => x.kind === 'link' && /Move between your accounts/.test(x.text)));
  check('3.6 detail says a rule did it, not the user', lines.find((x) => x.kind === 'link').byText === 'Linked automatically (the other side is your own name)');
  const byUser = provenanceLines({ sources: [], links: [Object.assign({}, l, { createdBy: 'user' })] });
  check('3.6 detail says when the user did it', /You linked these/.test(byUser[0].byText));

  // Every link kind has copy for its title and its undo button.
  check('3.6 every link kind has undo copy', ['ownMove', 'reversal', 'refund', 'fee', 'cash', 'merge']
    .every((k) => LINK_COPY[k] && LINK_COPY[k].title && LINK_COPY[k].undo));
  check('3.6 no em dash in any link copy', !Object.values(LINK_COPY).some((c) => /—/.test(c.title + c.undo)));
  check('3.6 Moved to names the bank', moveLabel({ bank: 'Kuda' }, { description: '' }) === 'Moved to Kuda');
  check('3.6 Moved to has an honest fallback', moveLabel({ bank: '' }, { description: '' }) === 'Moved to another account of yours');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
