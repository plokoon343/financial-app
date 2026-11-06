'use strict';
// Acceptance suite for Block 2a: the Observation model, the merge ladder, the field
// winners and the behaviour matrix (round 6, brief 3.1, 3.2, 3.3, 3.7; research
// section 2, tests T1 to T18).
//
// Scope note, stated plainly because it matters when reading a pass: this block does
// NOT do linking (3.4), which is 2b. Several of T1 to T18 end in a LINK between two
// transactions (T4 own move, T5 funding, T6 reversal, T7 fees, T8 cash, T9 refund,
// T16 ajo). For those, this file asserts everything 2a owns and must get right for
// the linker to be able to work at all: that the two sides are kept APART rather than
// merged, that each side gets the correct effect, and that each is flagged with what
// the linker should look for. The assertion that they end up joined belongs to 2b and
// is marked `LINK (2b)` where it would go. Claiming those as passing here would be
// claiming work that has not been done.
//
// GTBank inputs follow the verified Acct / Amt / Desc / Avail Bal layout. Everything
// else is a synthetic field set, as the research doc says, and is to be replaced with
// redacted real alerts from the corpus before release.

const { makeObservation, toKobo, lagosDay, accountRef } = require('./observation');
const { mergeDecision, buildTransactions, expectedTransactionCount } = require('./mergeLadder');
const { resolveFields, resolveCategory } = require('./fieldWinners');
const { classify, totals } = require('./behaviourMatrix');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => {
  if (cond) pass += 1;
  else { fail += 1; console.log(`FAIL  ${label}${extra ? `  ${extra}` : ''}`); }
};

const USER = 'u1';
const NAME = 'Chidumebi Onukogu';
const at = (iso) => new Date(`${iso}+01:00`).getTime();   // Lagos wall clock

// Shorthand for building an Observation.
const obs = (o) => makeObservation({ userId: USER, ...o });

// How many transactions a run of observations produces, and whether that agrees with
// the count check (section 3.2: the answer must equal the largest number any single
// source contributed).
function run(observations) {
  const txns = buildTransactions(observations);
  return { txns, count: txns.length, expected: expectedTransactionCount(observations) };
}

// ── T1: one payment, an SMS and the bank app's push ──────────────────────────
{
  const sms = obs({
    source: 'sms', raw: 'Acct ...6083 Amt NGN2,000.00 DR Desc TRF to ADA OKAFOR Avail Bal NGN127,696.51',
    direction: 'debit', amount: 2000, balanceAfter: 127696.51, counterpartyRaw: 'TRF to ADA OKAFOR',
    bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:02:00'),
  });
  const push = obs({
    source: 'notification', raw: 'GTBank: NGN2,000.00 debit to Ada Okafor',
    direction: 'debit', amount: 2000, counterpartyRaw: 'Ada Okafor',
    bankCode: 'gtb', eventTime: at('2026-10-02T10:03:00'),
  });
  const { txns, count, expected } = run([sms, push]);
  check('T1: one transaction from two sources', count === 1, `got ${count}`);
  check('T1: count check agrees', count === expected);
  check('T1: both sources kept as evidence', txns[0].observations.length === 2);
  const f = resolveFields(txns[0].observations);
  check('T1: amount 2,000', f.amountKobo === toKobo(2000));
  check('T1: a debit', f.direction === 'debit');
  check('T1: named Ada Okafor', f.counterpartyClean === 'ADA OKAFOR', f.counterpartyClean);
  check('T1: sources recorded', f.sources.includes('sms') && f.sources.includes('notification'));
  check('T1: the alert time wins, not the later push', f.eventTime === at('2026-10-02T10:02:00'));
  check('T1: the balance comes from the side that quoted one', f.balanceAfterKobo === toKobo(127696.51));
  const c = classify({ direction: 'debit', description: 'TRF to ADA OKAFOR', counterpartyClean: 'ADA OKAFOR' }, { userName: NAME });
  check('T1: spending', c.effect === 'Spending' && c.row === 1);
}

// ── T2: the same SMS delivered twice ─────────────────────────────────────────
{
  const text = 'Acct ...6083 Amt NGN2,000.00 DR Desc TRF to ADA OKAFOR Avail Bal NGN127,696.51';
  // Both sides carry a real receivedAt: step 1 is about the same bytes arriving twice
  // CLOSE TOGETHER, so leaving it to default to "now" would not be testing the rule.
  const first = obs({ source: 'sms', raw: text, direction: 'debit', amount: 2000, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:02:00'), receivedAt: at('2026-10-02T10:02:00') });
  const again = obs({ source: 'sms', raw: text, direction: 'debit', amount: 2000, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:02:00'), receivedAt: at('2026-10-02T10:05:00') });
  const { txns, count, expected } = run([first, again]);
  check('T2: one transaction', count === 1, `got ${count}`);
  check('T2: count check agrees', count === expected);
  check('T2: the repeat is dropped, not attached', txns[0].observations.length === 1);
  check('T2: and it is recorded as dropped', (txns[0].dropped || []).length === 1);
  check('T2: the decision names re-delivery', mergeDecision(again, txns).reason === 're-delivery');
}

// ── T3: two identical airtime purchases a minute apart ───────────────────────
// The case the same-source rule exists for. Same amount, same bank, one minute apart,
// and genuinely two purchases: only the balance tells them apart.
{
  const a = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN500.00 DR Desc AIRTIME Avail Bal NGN9,500.00', direction: 'debit', amount: 500, balanceAfter: 9500, counterpartyRaw: 'AIRTIME', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:00:00') });
  const b = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN500.00 DR Desc AIRTIME Avail Bal NGN9,000.00', direction: 'debit', amount: 500, balanceAfter: 9000, counterpartyRaw: 'AIRTIME', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:01:00') });
  const { count, expected } = run([a, b]);
  check('T3: two transactions', count === 2, `got ${count}`);
  check('T3: count check agrees', count === expected && expected === 2);
}

// ── T4: a transfer between the user's own two banks ──────────────────────────
{
  const debit = obs({ source: 'sms', raw: `Acct ...6083 Amt NGN50,000.00 DR Desc TRF to ${NAME} Avail Bal NGN10,000.00`, direction: 'debit', amount: 50000, counterpartyRaw: `TRF to ${NAME}`, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T14:00:00') });
  const credit = obs({ source: 'notification', raw: `Kuda: NGN50,000.00 received from ${NAME}`, direction: 'credit', amount: 50000, counterpartyRaw: NAME, bankCode: 'kuda', eventTime: at('2026-10-02T14:01:00') });
  const { count } = run([debit, credit]);
  check('T4: the two sides stay apart, they are not one transaction', count === 2, `got ${count}`);
  const d = classify({ direction: 'debit', description: `TRF to ${NAME}`, counterpartyClean: NAME }, { userName: NAME });
  const c = classify({ direction: 'credit', description: `received from ${NAME}`, counterpartyClean: NAME }, { userName: NAME });
  check('T4: the debit is an own move', d.effect === 'Own move', d.effect);
  check('T4: the credit is an own move too, not income', c.effect === 'Own move', c.effect);
  check('T4: both ask the linker for the other side', d.needsLink === 'ownMove' && c.needsLink === 'ownMove');
  check('T4: neither touches the totals', totals([{ ...d, amountKobo: toKobo(50000) }, { ...c, amountKobo: toKobo(50000) }]).spendingKobo === 0);
  // LINK (2b): the pair becomes one item shown as "Moved to Kuda".
}

// ── T5: a bank funds a wallet, then the wallet pays a merchant ───────────────
{
  const fund = classify({ direction: 'debit', description: 'TRF to OPAY', counterpartyClean: 'OPAY' }, { userName: NAME, trackedWallets: ['opay'] });
  const spend = classify({ direction: 'debit', description: 'MAMA PUT RESTAURANT', counterpartyClean: 'MAMA PUT' }, { userName: NAME, trackedWallets: ['opay'] });
  check('T5: funding the wallet is an own move', fund.effect === 'Own move', fund.effect);
  check('T5: the restaurant is the only spending', spend.effect === 'Spending');
  const t = totals([{ ...fund, amountKobo: toKobo(20000) }, { ...spend, amountKobo: toKobo(4500) }]);
  check('T5: only 4,500 counts as spending', t.spendingKobo === toKobo(4500), String(t.spendingKobo));
  // LINK (2b): the bank debit and the wallet credit become one "Added to OPay".
}

// ── T6: a failed transfer and its reversal ───────────────────────────────────
{
  const debit = obs({ source: 'sms', raw: 'Zenith: NGN15,000.00 DR to TUNDE Ref R1', direction: 'debit', amount: 15000, reference: 'R1', counterpartyRaw: 'TUNDE', bankCode: 'zenith', eventTime: at('2026-10-02T12:00:00') });
  const reversal = obs({ source: 'sms', raw: 'Zenith: NGN15,000.00 CR reversal Ref R1', direction: 'credit', amount: 15000, reference: 'R1', counterpartyRaw: 'TUNDE', bankCode: 'zenith', eventTime: at('2026-10-02T12:40:00') });
  const { count } = run([debit, reversal]);
  check('T6: a reversal is not a duplicate of its debit', count === 2, `got ${count}`);
  const r = classify({ direction: 'credit', description: 'NGN15,000.00 CR reversal', counterpartyClean: 'TUNDE' }, { userName: NAME });
  check('T6: the credit is Cancelled, never income', r.effect === 'Cancelled', r.effect);
  check('T6: and it asks the linker for the debit it cancels', r.needsLink === 'reversal');
  check('T6: cancelled money is in neither total', totals([{ ...r, amountKobo: toKobo(15000) }]).incomeKobo === 0);
  // LINK (2b): both marked Cancelled, one struck-through item, net zero.
}

// ── T7: a transfer and the two fees that follow it ───────────────────────────
{
  const main = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN15,000.00 DR Desc TRF to TUNDE Avail Bal NGN5,000.00', direction: 'debit', amount: 15000, counterpartyRaw: 'TUNDE', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T12:00:10') });
  const fee1 = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN10.00 DR Desc TRANSFER FEE Avail Bal NGN4,990.00', direction: 'debit', amount: 10, counterpartyRaw: 'TRANSFER FEE', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T12:00:40') });
  const fee2 = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN50.00 DR Desc STAMP DUTY Avail Bal NGN4,940.00', direction: 'debit', amount: 50, counterpartyRaw: 'STAMP DUTY', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T12:00:40') });
  const { count } = run([main, fee1, fee2]);
  check('T7: three separate amounts stay separate', count === 3, `got ${count}`);
  const f1 = classify({ direction: 'debit', description: 'TRANSFER FEE', counterpartyClean: 'TRANSFER FEE' }, {});
  const f2 = classify({ direction: 'debit', description: 'STAMP DUTY', counterpartyClean: 'STAMP DUTY' }, {});
  check('T7: a transfer fee is Bank charges', f1.category === 'Bank Charges' && f1.row === 11);
  check('T7: stamp duty is too', f2.category === 'Bank Charges');
  check('T7: both ask the linker for their parent', f1.needsLink === 'fee' && f2.needsLink === 'fee');
  check('T7: fees are still spending', f1.effect === 'Spending' && f2.effect === 'Spending');
  // LINK (2b): both become children, detail reads "NGN15,060 including NGN60 charges".
}

// ── T8: an ATM withdrawal, its fee, and cash spent the next day ──────────────
{
  const w = classify({ direction: 'debit', description: 'ATM WITHDRAWAL LAGOS', counterpartyClean: 'ATM' }, {});
  const fee = classify({ direction: 'debit', description: 'ATM CHARGE', counterpartyClean: 'ATM CHARGE' }, {});
  const food = classify({ direction: 'debit', description: 'Food, paid from Cash', counterpartyClean: 'Mama Put' }, {});
  check('T8: the withdrawal is an own move into Cash, not spending', w.effect === 'Own move' && w.row === 9, w.effect);
  check('T8: it tells the linker it is cash', w.needsLink === 'cash');
  check('T8: the ATM charge is Bank charges', fee.category === 'Bank Charges');
  check('T8: the cash spend is real spending', food.effect === 'Spending');
  const t = totals([{ ...w, amountKobo: toKobo(20000) }, { ...fee, amountKobo: toKobo(100) }, { ...food, amountKobo: toKobo(3000) }]);
  check('T8: 20,000 taken out is not spending', t.spendingKobo === toKobo(3100), String(t.spendingKobo));
  // LINK (2b): 17,000 remains as "cash to log".
}

// ── T9: a refund three weeks after the purchase ──────────────────────────────
{
  const r = classify({ direction: 'credit', description: 'REFUND from JUMIA', counterpartyClean: 'JUMIA' }, {});
  check('T9: a refund is negative spending, never income', r.effect === 'Spending' && r.negative === true, r.effect);
  check('T9: it asks the linker for the purchase', r.needsLink === 'refund' && r.row === 8);
  const t = totals([{ effect: 'Spending', amountKobo: toKobo(8999) }, { ...r, amountKobo: toKobo(8999) }]);
  check('T9: the month nets to zero for that store', t.spendingKobo === 0, String(t.spendingKobo));
  check('T9: and nothing lands in income', t.incomeKobo === 0);
}

// ── T10: a statement row for an alert already held ───────────────────────────
// The alert is at 22:59 Lagos on 2 Oct; the statement calls it 3 Oct. Comparing in
// UTC would put the alert on the 2nd at 21:59 and still match, but a transaction at
// 00:30 Lagos would not, which is why the day is computed in Lagos.
{
  const alert = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN2,000.00 DR Desc TRF to ADA OKAFOR', direction: 'debit', amount: 2000, counterpartyRaw: 'ADA OKAFOR', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T22:59:00') });
  const row = obs({ source: 'statement', raw: '03/10/2026 2,000.00 DR ADA OKAFOR', direction: 'debit', amount: 2000, counterpartyRaw: 'ADA OKAFOR', bankCode: 'gtb', eventTime: at('2026-10-03T00:00:00') });
  const { txns, count } = run([alert, row]);
  check('T10: merged within a day of the value date', count === 1, `got ${count}`);
  check('T10: the statement is added as a source', txns[0].observations.length === 2);
  const f = resolveFields(txns[0].observations);
  check('T10: the alert keeps the time, the statement only knew the day', f.eventTime === at('2026-10-02T22:59:00'));
  check('T10: Lagos day of the alert is the 2nd', lagosDay(at('2026-10-02T22:59:00')) === '2026-10-02');
  check('T10: and 00:30 Lagos is the 3rd, not the 2nd', lagosDay(at('2026-10-03T00:30:00')) === '2026-10-03');
}

// ── T11: an alert in the period with no statement row ────────────────────────
{
  const credit = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN100,000.00 CR Desc INWARD TRF', direction: 'credit', amount: 100000, counterpartyRaw: 'INWARD TRF', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-15T09:00:00') });
  const octoberRows = [
    obs({ source: 'statement', raw: '01/10/2026 5,000.00 DR SHOPRITE', direction: 'debit', amount: 5000, counterpartyRaw: 'SHOPRITE', bankCode: 'gtb', eventTime: at('2026-10-01T00:00:00') }),
  ];
  const { txns } = run([...octoberRows, credit]);
  const unmatched = txns.filter((t) => t.observations.every((o) => o.source !== 'statement'));
  check('T11: the credit has no statement row behind it', unmatched.length === 1, `got ${unmatched.length}`);
  check('T11: and it is the 100,000 one', unmatched[0].observations[0].amountKobo === toKobo(100000));
  // The "Not on your statement" card itself is Block 4; what 2a owes is the fact.
}

// ── T12: a shared screenshot and the push for the same payment ───────────────
{
  const share = obs({ source: 'share', raw: 'NGN7,500.00 debit to BOLT', direction: 'debit', amount: 7500, counterpartyRaw: 'BOLT', bankCode: 'gtb', eventTime: at('2026-10-02T18:20:00') });
  const push = obs({ source: 'notification', raw: 'GTBank: NGN7,500.00 debit BOLT', direction: 'debit', amount: 7500, counterpartyRaw: 'BOLT', bankCode: 'gtb', eventTime: at('2026-10-02T18:20:00') });
  const { count, expected } = run([share, push]);
  check('T12: one transaction', count === 1, `got ${count}`);
  check('T12: count check agrees', count === expected);
  // Still one when the share arrives two days later, which is the alert/share window.
  const late = obs({ source: 'share', raw: 'NGN7,500.00 debit to BOLT', direction: 'debit', amount: 7500, counterpartyRaw: 'BOLT', bankCode: 'gtb', eventTime: at('2026-10-04T18:00:00') });
  check('T12: and still one when the share is two days late', run([push, late]).count === 1);
  // But not five days later.
  const tooLate = obs({ source: 'share', raw: 'NGN7,500.00 debit to BOLT', direction: 'debit', amount: 7500, counterpartyRaw: 'BOLT', bankCode: 'gtb', eventTime: at('2026-10-07T18:00:00') });
  check('T12: five days later is a separate transaction', run([push, tooLate]).count === 2);
}

// ── T13: a manual entry, then the bank's alert ───────────────────────────────
{
  const manual = obs({ source: 'manual', raw: 'Rent share', direction: 'debit', amount: 12000, counterpartyRaw: 'Rent share', bankCode: 'gtb', eventTime: at('2026-10-02T08:00:00') });
  const sms = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN12,000.00 DR Desc TRF to NGOZI Avail Bal NGN3,000.00', direction: 'debit', amount: 12000, balanceAfter: 3000, counterpartyRaw: 'NGOZI', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T08:05:00') });
  const { txns, count } = run([manual, sms]);
  check('T13: one transaction', count === 1, `got ${count}`);
  const f = resolveFields(txns[0].observations);
  check('T13: the alert wins the figures', f.amountKobo === toKobo(12000) && f.balanceAfterKobo === toKobo(3000));
  check('T13: the alert wins the time', f.eventTime === at('2026-10-02T08:05:00'));
  // The user's own words and category survive the merge: that is what resolveCategory
  // is for, and a user choice outranks everything the rules know.
  const cat = resolveCategory({ userChoice: 'Housing', suggestion: 'Transfer' });
  check('T13: the user keeps their category', cat.category === 'Housing' && cat.guessed === false);
}

// ── T14: two manual entries, one alert, so the app must ask ──────────────────
{
  const m1 = obs({ source: 'manual', raw: 'cash out 1', direction: 'debit', amount: 1000, bankCode: 'gtb', eventTime: at('2026-10-02T09:00:00') });
  const m2 = obs({ source: 'manual', raw: 'cash out 2', direction: 'debit', amount: 1000, bankCode: 'gtb', eventTime: at('2026-10-02T09:10:00') });
  const sms = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN1,000.00 DR Desc POS', direction: 'debit', amount: 1000, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T09:15:00') });
  const built = buildTransactions([m1, m2]);
  check('T14: the two manual entries stay apart', built.length === 2);
  const d = mergeDecision(sms, built);
  check('T14: the alert asks instead of guessing', d.action === 'ask', d.action);
  check('T14: and offers both as choices', d.candidates.length === 2, String(d.candidates.length));
  const { count, expected } = run([m1, m2, sms]);
  check('T14: nothing is lost while the question waits', count === 3, `got ${count}`);
  check('T14: count check agrees, two from one source means two', expected === 2);
}

// ── T15: a monthly NYSC credit ───────────────────────────────────────────────
{
  // Deliberately byte-identical text, a month apart. Only the receipt times tell them
  // apart, which is exactly why step 1 is anchored to when a delivery arrived rather
  // than to the words in it: real allowances repeat, and losing one as a "duplicate"
  // would take a month's income off someone's safe-to-spend.
  const sep = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN77,000.00 CR Desc NYSC ALLOWANCE', direction: 'credit', amount: 77000, counterpartyRaw: 'NYSC', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-09-27T10:00:00'), receivedAt: at('2026-09-27T10:00:00') });
  const oct = obs({ source: 'sms', raw: 'Acct ...6083 Amt NGN77,000.00 CR Desc NYSC ALLOWANCE', direction: 'credit', amount: 77000, counterpartyRaw: 'NYSC', bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-27T10:00:00'), receivedAt: at('2026-10-27T10:00:00') });
  const { count } = run([sep, oct]);
  check('T15: a month apart is two credits, not one re-delivered', count === 2, `got ${count}`);
  const c = classify({ direction: 'credit', description: 'NYSC ALLOWANCE', counterpartyClean: 'NYSC' }, {});
  check('T15: it is income', c.effect === 'Income' && c.row === 25);
  check('T15: shown as the NYSC allowance', c.shownAs === 'NYSC allowance', c.shownAs);
  check('T15: and asks once whether this is the monthly income', c.ask && c.ask.type === 'income' && c.ask.once === true);
}

// ── T16: ajo, repeated transfers to one person ───────────────────────────────
{
  const months = [1, 2, 3].map((m) => obs({
    source: 'sms', raw: `Acct ...6083 Amt NGN5,000.00 DR Desc TRF to CHIOMA ${m}`, direction: 'debit', amount: 5000,
    counterpartyRaw: 'CHIOMA', bankCode: 'gtb', accountMask: '6083', eventTime: at(`2026-0${m}-01T10:00:00`),
  }));
  const { count } = run(months);
  check('T16: three monthly transfers are three transactions', count === 3, `got ${count}`);
  const c = classify({ direction: 'debit', description: 'TRF to CHIOMA', counterpartyClean: 'CHIOMA' }, { userName: NAME });
  check('T16: until the user says otherwise each is ordinary spending', c.effect === 'Spending' && c.row === 1);
  // LINK (2b): after the second, ask about ajo; on "Ajo", all become Own move.
}

// ── T17: a declined payment ──────────────────────────────────────────────────
{
  const c = classify({ direction: 'debit', description: 'Card payment DECLINED at SHOPRITE', counterpartyClean: 'SHOPRITE' }, {});
  check('T17: nothing is created', c.drop === true && c.effect === null);
  check('T17: and it is row 31', c.row === 31);
  // A reversal mentions failure too, and that one DID move money, so it must not be
  // caught by the same rule.
  const rev = classify({ direction: 'credit', description: 'Your failed transfer has been reversed', counterpartyClean: 'TUNDE' }, {});
  check('T17: a reversal of a failure is still money moving', rev.drop !== true && rev.effect === 'Cancelled');
}

// ── T18: a transfer to someone with the user's own name, nothing to pair with ─
{
  const only = obs({ source: 'sms', raw: `Acct ...6083 Amt NGN3,000.00 DR Desc TRF to ${NAME}`, direction: 'debit', amount: 3000, counterpartyRaw: NAME, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:00:00') });
  const { count } = run([only]);
  check('T18: one transaction', count === 1);
  // The user's own name IS the evidence here, so this is an own move on its own.
  const c = classify({ direction: 'debit', description: `TRF to ${NAME}`, counterpartyClean: NAME }, { userName: NAME });
  check('T18: their own name makes it an own move', c.effect === 'Own move', c.effect);
  check('T18: and the linker is told to look for the other side', c.needsLink === 'ownMove');
  // A stranger's name is not an own move and is never asked about.
  const other = classify({ direction: 'debit', description: 'TRF to ADA OKAFOR', counterpartyClean: 'ADA OKAFOR' }, { userName: NAME });
  check('T18: a stranger is plain spending', other.effect === 'Spending' && other.ask === null);
  // A wallet the user does not track is a guess, so it asks once rather than deciding.
  const wallet = classify({ direction: 'debit', description: 'TRF to OPAY', counterpartyClean: 'OPAY' }, { userName: NAME, trackedWallets: [] });
  check('T18: an untracked wallet asks instead of guessing', wallet.ask && wallet.ask.type === 'ownMove', JSON.stringify(wallet.ask));
}

// ── The ladder's own rules, beyond the numbered cases ────────────────────────
{
  // Step 2 beats the clock: the same session id, months apart, two different sources.
  const a = obs({ source: 'share', raw: 'receipt', direction: 'debit', amount: 84000, reference: 'SESSION-1', bankCode: 'access', eventTime: at('2026-08-01T10:00:00') });
  const b = obs({ source: 'statement', raw: 'row', direction: 'debit', amount: 84000, reference: 'SESSION-1', bankCode: 'access', eventTime: at('2026-10-25T10:00:00') });
  check('ladder: a shared reference merges whatever the gap', run([a, b]).count === 1);

  // But not when the amounts differ: that is a disagreement, not a match.
  const c = obs({ source: 'statement', raw: 'row', direction: 'debit', amount: 8400, reference: 'SESSION-1', bankCode: 'access', eventTime: at('2026-10-25T10:00:00') });
  check('ladder: the same reference with a different amount does not merge', run([a, c]).count === 2);
  // It is not two unrelated transactions either: the bank says they are one movement
  // of money and the sources disagree about it, which is the "Which is right?" card.
  const conflicted = mergeDecision(c, buildTransactions([a]));
  check('ladder: and it comes back as a conflict, not as new money', conflicted.action === 'conflict', conflicted.action);
  check('ladder: naming the field in dispute', conflicted.conflict.field === 'amount');
  check('ladder: with both figures and both sources', conflicted.conflict.values.length === 2 && conflicted.conflict.sources.length === 2);
  check('ladder: and the transaction it disagrees with', conflicted.target != null);
  check('ladder: the conflict is carried onto the transaction', (run([a, c]).txns[1] || {}).conflict != null);
  // A reference match with opposite directions is the same kind of card.
  const flipped = obs({ source: 'statement', raw: 'row', direction: 'credit', amount: 84000, reference: 'SESSION-1', bankCode: 'access', eventTime: at('2026-10-25T10:00:00') });
  check('ladder: opposite directions on one reference is a conflict too', mergeDecision(flipped, buildTransactions([a])).conflict.field === 'direction');

  // Step 3: the same balance in the same account is the same moment.
  const d1 = obs({ source: 'sms', raw: 'x', direction: 'debit', amount: 1500, balanceAfter: 42000, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:00:00') });
  const d2 = obs({ source: 'statement', raw: 'y', direction: 'debit', amount: 1500, balanceAfter: 42000, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T00:00:00') });
  check('ladder: the same balance after merges', run([d1, d2]).count === 1);

  // Two different accounts at the same bank never merge, even for the same amount.
  const e1 = obs({ source: 'sms', raw: 'x', direction: 'debit', amount: 1500, bankCode: 'gtb', accountMask: '6083', eventTime: at('2026-10-02T10:00:00') });
  const e2 = obs({ source: 'notification', raw: 'y', direction: 'debit', amount: 1500, bankCode: 'gtb', accountMask: '9921', eventTime: at('2026-10-02T10:01:00') });
  check('ladder: two accounts at one bank stay apart', run([e1, e2]).count === 2);

  // Opposite directions are never the same money.
  const f1 = obs({ source: 'sms', raw: 'x', direction: 'debit', amount: 1500, bankCode: 'gtb', eventTime: at('2026-10-02T10:00:00') });
  const f2 = obs({ source: 'notification', raw: 'y', direction: 'credit', amount: 1500, bankCode: 'gtb', eventTime: at('2026-10-02T10:01:00') });
  check('ladder: a debit never merges with a credit', run([f1, f2]).count === 2);

  // Different people, same amount, same minute: not the same payment.
  const g1 = obs({ source: 'sms', raw: 'x', direction: 'debit', amount: 1500, counterpartyRaw: 'ADA OKAFOR', bankCode: 'gtb', eventTime: at('2026-10-02T10:00:00') });
  const g2 = obs({ source: 'notification', raw: 'y', direction: 'debit', amount: 1500, counterpartyRaw: 'TUNDE BELLO', bankCode: 'gtb', eventTime: at('2026-10-02T10:01:00') });
  check('ladder: different names stay apart', run([g1, g2]).count === 2);
}

// ── Field winners, beyond the numbered cases ─────────────────────────────────
{
  // A genuine disagreement is reported, never averaged or silently picked.
  const a = makeObservation({ source: 'sms', direction: 'debit', amount: 5000, raw: 'a' });
  const b = makeObservation({ source: 'notification', direction: 'debit', amount: 5500, raw: 'b' });
  const f = resolveFields([a, b]);
  check('fields: a disagreement on amount is surfaced', f.conflict && f.conflict.field === 'amount', JSON.stringify(f.conflict));
  check('fields: the statement-first order still picks the SMS over the push', f.amountKobo === toKobo(5000));

  // The statement outranks the SMS.
  const s = makeObservation({ source: 'statement', direction: 'debit', amount: 5200, raw: 's' });
  check('fields: the statement wins over an alert', resolveFields([a, s]).amountKobo === toKobo(5200));

  // The longest clean name wins, whichever source carried it.
  const short = makeObservation({ source: 'notification', direction: 'debit', amount: 100, counterpartyRaw: 'ADA', raw: 'n' });
  const long = makeObservation({ source: 'sms', direction: 'debit', amount: 100, counterpartyRaw: 'TRF to ADA OKAFOR CHINWE', raw: 'm' });
  check('fields: the longest readable name wins', resolveFields([short, long]).counterpartyClean === 'ADA OKAFOR CHINWE');

  // A pending hold never speaks for the figures.
  const hold = makeObservation({ source: 'notification', direction: 'debit', amount: 9999, status: 'pending', raw: 'h' });
  const real = makeObservation({ source: 'sms', direction: 'debit', amount: 5000, raw: 'r' });
  check('fields: a hold does not set the amount', resolveFields([hold, real]).amountKobo === toKobo(5000));
  check('fields: and a hold on its own has no conflict to report', resolveFields([hold, real]).conflict === null);

  // Category order.
  check('fields: a rule beats a learned merchant', resolveCategory({ userRule: 'Food', learnedMerchant: 'Shopping' }).category === 'Food');
  check('fields: a suggestion is marked as a guess', resolveCategory({ suggestion: 'Transport' }).guessed === true);
  check('fields: a learned merchant is not a guess', resolveCategory({ learnedMerchant: 'Food' }).guessed === false);
}

// ── The model itself ─────────────────────────────────────────────────────────
{
  check('kobo: 1,234.56 naira is 123456 kobo', toKobo('1,234.56') === 123456);
  check('kobo: arithmetic stays exact', toKobo(0.1) + toKobo(0.2) === toKobo(0.3));
  check('accountRef: bank and tail', accountRef({ bankCode: 'GTB', accountMask: '6083' }) === 'gtb:6083');
  check('accountRef: bank alone when no digits were shown', accountRef({ bankCode: 'GTB' }) === 'gtb');
  const o = makeObservation({ source: 'sms', raw: '  Acct   ...6083   DR  ', amount: 10, direction: 'debit' });
  const o2 = makeObservation({ source: 'sms', raw: 'Acct ...6083 DR', amount: 10, direction: 'debit' });
  check('rawHash: whitespace does not change the hash', o.rawHash === o2.rawHash);
  check('rawHash: empty text has no hash', makeObservation({ source: 'sms', raw: '' }).rawHash === '');
  check('status: anything but pending is final', makeObservation({ source: 'sms', raw: 'x', status: 'whatever' }).status === 'final');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
