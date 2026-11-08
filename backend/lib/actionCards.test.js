// Tests for the Action Center card queue (round 6, Block 4; brief 4.8 A1 to A8).
//
// A1, A4 and A6 are decided entirely by this module and are tested here in full.
// A2 (a rule after the same answer twice) is a server tally, so what is tested here is
// the card's half of it: the rule offer and its default. A3 (undo), A5 (offline) and
// A8 (screen reader) are client behaviour and are tested on the clients.

const assert = require('assert');
const cards = require('./actionCards');
const { build, countsOf, homeLine, interruptions, fillTemplate, initialsOf } = cards;

let pass = 0;
const check = (name, cond) => { assert.ok(cond, name); pass += 1; };
const eq = (name, got, want) => { assert.deepStrictEqual(got, want, `${name}: got ${JSON.stringify(got)}`); pass += 1; };

const now = new Date(2026, 10, 6, 12, 0, 0);     // 6 Nov 2026
const daysAgo = (n) => new Date(now.getTime() - n * 86400000);

// ── Shape and copy ───────────────────────────────────────────────────────────────

const ownMoveItem = {
  id: 't1', txnId: 't1', title: 'Moved to OPay', name: 'OPay', amount: 84000,
  meta: 'Sat 25 Oct · 11:01 · Shared receipt', pair: { from: 'Access', to: 'OPay' },
  raw: 'Transaction Amount ₦84,000 ...',
};

{
  const { cards: q } = build({ own_move: [ownMoveItem] });
  eq('one item makes one card', q.length, 1);
  const c = q[0];
  eq('own move is priority 2', c.priority, 2);
  eq('own move question is the final copy', c.question, 'Did this go to another account of yours?');
  eq('two answers, likely one first', c.answers.map((a) => a.label), ["Yes, it's mine", 'No, I sent it to someone']);
  check('the first answer is the primary one', c.answers[0].primary === true);
  check('the second answer is not primary', !c.answers[1].primary);
  check('the raw alert travels with the card but is not the title', c.raw && c.item.title === 'Moved to OPay');
  eq('the pair reads A to B', c.item.pair, { from: 'Access', to: 'OPay' });
  eq('the card names what it acts on', c.targets.txnIds, ['t1']);
}

// Every card type: one question, 2 to 4 answers, a real priority, and no amount baked
// into the question string (so a user with amounts hidden cannot see one leak).
{
  const sample = {
    not_on_statement: [{ id: 'n1', name: 'Tunde', amount: 100000, bank: 'GTBank', meta: 'Mon 3 Nov' }],
    sources_disagree: [{ id: 's1', name: 'Shoprite', a: 5000, b: 5500, aId: 'o1', bId: 'o2', meta: 'Tue' }],
    own_move: [ownMoveItem],
    same_as: [{ id: 'd1', firstId: 'a', secondId: 'b', title: 'MTN', name: 'MTN', amount: 1000, time: '9:10', meta: 'Wed' }],
    income: [{ id: 'i1', name: 'NYSC', amount: 77000, months: 3, meta: 'Fri' }],
    loan: [{ id: 'l1', name: 'FairMoney', amount: 30000, meta: 'Fri' }],
    ajo: [{ id: 'j1', name: 'Chioma', amount: 5000, txnIds: ['x', 'y'], meta: 'Fri' }],
    refund_match: [{ id: 'r1', name: 'Jumia', amount: 8999, candidates: [{ id: 'p1', label: 'Jumia ₦8,999 on 2 Oct' }, { id: 'p2', label: 'Jumia ₦8,999 on 9 Oct' }], meta: 'Fri' }],
    regular_payment: [{ id: 'g1', name: 'Mrs Bello', amount: 150000, months: 3, meta: 'Fri' }],
    category: [{ id: 'c1', txnId: 'c1', name: 'Mama Put Ikeja', amount: 4500, suggestions: ['Food', 'Groceries', 'Other'], meta: 'Fri' }],
    cash: [{ id: 'cash', amount: 17000, count: 1, txnIds: ['w1'], period: 'this month', meta: 'Fri' }],
    who_is_this: [{ id: 'w1', contactKey: 'ada', name: 'Ada Okafor', amount: 2000, meta: 'Fri' }],
    subscription: [{ id: 'sub1', detectionKey: 'netflix', name: 'Netflix', amount: 4400, months: 2, meta: 'Fri' }],
    apple_service: [{ id: 'ap1', amount: 2500, meta: 'Fri' }],
    goal: [{ id: 'go1', pocket: 'OWealth', goal: 'Laptop', amount: 10000, meta: 'Fri' }],
    which_account: [{ id: 'wa1', senderKey: '0803...', label: '0803...', count: 4, accounts: [{ id: 'a1', label: 'GTBank' }], meta: 'Fri' }],
  };
  // This is a shape check, one of every kind at once, not a cap check (the queue cap
  // is tested in isolation below) - raised so the seven priority 3/4 kinds here do not
  // trip over each other for the default budget of 5.
  const { cards: q } = build(sample, { maxQueue: 100 });
  eq('every kind produced a card', q.length, Object.keys(sample).length);
  for (const c of q) {
    check(`${c.kind}: has a question`, c.question && c.question.length > 0);
    check(`${c.kind}: 2 to 4 answers`, c.answers.length >= 2 && c.answers.length <= 4);
    check(`${c.kind}: the first answer is primary`, c.answers[0].primary === true);
    check(`${c.kind}: priority is 1 to 4`, c.priority >= 1 && c.priority <= 4);
    check(`${c.kind}: no figure and no naira sign inside the question text`, !/[\d₦]/.test(c.question.replace(/\{\w+\}/g, '')));
  }
  // A6, part one: the heading count is the number of cards, always.
  const counts = countsOf(q);
  eq('A6 heading count equals the cards', counts.total, q.length);
}

// ── A1: an import of three months leaves a handful of cards, and small money is guessed
{
  // 214 transactions: 6 to Shoprite, 4 to one new eatery, 1 big unknown, and 200
  // small ones under the floor spread over 40 names.
  const category = [];
  for (let i = 0; i < 6; i++) category.push({ id: `sh${i}`, txnId: `sh${i}`, merchantKey: 'shoprite', name: 'Shoprite', amount: 12000 + i, suggestions: ['Groceries', 'Shopping'], meta: 'Oct' });
  for (let i = 0; i < 4; i++) category.push({ id: `mp${i}`, txnId: `mp${i}`, merchantKey: 'mama put', name: 'Mama Put', amount: 4500, suggestions: ['Food', 'Other'], meta: 'Oct' });
  category.push({ id: 'big', txnId: 'big', merchantKey: 'unknown ltd', name: 'Unknown Ltd', amount: 60000, suggestions: ['Shopping', 'Other'], meta: 'Oct' });
  for (let i = 0; i < 200; i++) category.push({ id: `sm${i}`, txnId: `sm${i}`, merchantKey: `small${i % 40}x`, name: `Small ${i % 40}`, amount: 300, suggestions: ['Food'], meta: 'Oct' });

  const { cards: q, autoResolve } = build({
    category,
    own_move: [ownMoveItem],
    income: [{ id: 'i1', name: 'NYSC', amount: 77000, months: 3, meta: 'Oct' }],
  });
  check(`A1: 7 or fewer cards (got ${q.length})`, q.length <= 7);
  eq('A1: the six Shoprite payments are ONE card', q.filter((c) => c.item.name === 'Shoprite').length, 1);
  eq('A1: that card says it stands for six', q.find((c) => c.item.name === 'Shoprite').item.count, 6);
  check('A1: nothing under the floor is asked about', !q.some((c) => c.item.amount != null && c.item.amount < 2000 && c.kind === 'category'));
  const guessedSmall = autoResolve.filter((r) => r.reason === 'below_floor');
  check(`A1: the small ones are guessed, not asked (got ${guessedSmall.length})`, guessedSmall.length >= 100);
  check('A1: a guess carries the category to apply', guessedSmall.every((r) => r.category));
}

// Rule 3 in isolation: grouping is by sender, so two payments to one name are one
// card whose answer covers both.
{
  const { cards: q } = build({
    category: [
      { id: 'a', txnId: 'a', merchantKey: 'shoprite', name: 'Shoprite', amount: 5000, suggestions: ['Groceries'] },
      { id: 'b', txnId: 'b', merchantKey: 'shoprite', name: 'Shoprite', amount: 6000, suggestions: ['Groceries'] },
    ],
  });
  eq('two payments to one sender are one card', q.length, 1);
  eq('grouped card copy', q[0].question, '{count} payments to {name}. What are they?');
  eq('grouped card fills to the final copy', fillTemplate(q[0].question, q[0].vars), '2 payments to Shoprite. What are they?');
  eq('the grouped card totals the group', q[0].item.amount, 11000);
  eq('the grouped card acts on both rows', q[0].targets.txnIds, ['a', 'b']);
  // A2, the card's half: the rule box is there, and on a grouped card it is ticked.
  check('A2: a grouped card offers the rule, ticked', q[0].rule && q[0].rule.checked === true);
}

// Rule 1 beats rule 3: a group of payments all under the floor is never a question,
// however many of them there are. A1 says "everything under ₦2,000 Guessed".
{
  const { cards: q, autoResolve } = build({
    category: [
      { id: 'a', txnId: 'a', merchantKey: 'kiosk', name: 'Kiosk', amount: 500, suggestions: ['Food'] },
      { id: 'b', txnId: 'b', merchantKey: 'kiosk', name: 'Kiosk', amount: 600, suggestions: ['Food'] },
    ],
  });
  eq('small payments are guessed, not grouped into a question', q.length, 0);
  eq('and both are filed as the best guess', autoResolve.map((r) => r.reason), ['below_floor', 'below_floor']);
}

// The cap: only the biggest unknown senders are asked about. The rest are guessed,
// marked, and changeable from the transaction.
{
  const items = [];
  for (let i = 0; i < 9; i++) items.push({ id: `s${i}`, txnId: `s${i}`, merchantKey: `shop${i}`, name: `Shop ${i}`, amount: 3000 + i * 1000, suggestions: ['Shopping', 'Other'] });
  const { cards: q, autoResolve } = build({ category: items });
  eq('at most three category questions', q.length, 3);
  eq('the three biggest are the ones asked', q.map((c) => c.item.amount), [11000, 10000, 9000]);
  eq('the other six are guessed as overflow', autoResolve.filter((r) => r.reason === 'overflow').length, 6);
  const raised = build({ category: items }, { maxCategoryCards: 9, maxQueue: 9 });
  eq('the cap is a setting, not a law of nature', raised.cards.length, 9);
}

{
  const { cards: q } = build({ category: [{ id: 'a', txnId: 'a', merchantKey: 'kilimanjaro', name: 'Kilimanjaro', amount: 9000, suggestions: ['Food', 'Groceries', 'Other'] }] });
  eq('a single card offers the rule unticked', q[0].rule.checked, false);
  eq('three suggestions plus a way out', q[0].answers.map((a) => a.label), ['Food', 'Groceries', 'Other', 'Something else']);
  eq('the best guess carries the pill', q[0].answers[0].pill, 'Best guess');
  check('the way out opens a picker rather than answering', q[0].answers[3].opensPicker === true);
}

// ── The gate, generalised (phone check 8 Nov 2026: real queues hit 14, 15, 31, 34,
// 89 cards, because the floor and cap only ever governed `category`) ─────────────

// The floor now applies to every priority 3/4 kind, not only category.
{
  const { cards: q, autoResolve } = build({ subscription: [{ id: 'sub1', detectionKey: 'x', name: 'Small Co', amount: 500, meta: 'Fri' }] });
  eq('a priority 4 item under the floor is never asked', q.length, 0);
  eq('and it is recorded as below the floor', autoResolve.map((r) => r.reason), ['below_floor']);
  check('but nothing unsafe is guessed on the user\'s behalf for a non-category kind', autoResolve[0].category === null);
}

// Priority 1 and 2 are exempt from the floor: they matter by definition, however
// small the amount (a small amount moving to the wrong account is still wrong).
{
  const { cards: q } = build({ own_move: [{ ...ownMoveItem, id: 'tiny', txnId: 'tiny', amount: 500 }] });
  eq('a priority 2 card under the floor is still asked', q.length, 1);
}

// The whole-queue cap now spans every kind, not only category versus category.
{
  const input = { who_is_this: [], subscription: [], apple_service: [], goal: [] };
  for (let i = 0; i < 3; i++) input.who_is_this.push({ id: `w${i}`, contactKey: `c${i}`, name: `Person ${i}`, amount: 2000 + i });
  for (let i = 0; i < 3; i++) input.subscription.push({ id: `s${i}`, detectionKey: `sub${i}`, name: `Sub ${i}`, amount: 3000 + i });
  for (let i = 0; i < 3; i++) input.apple_service.push({ id: `a${i}`, amount: 4000 + i });
  const { cards: q, autoResolve } = build(input);
  eq('nine priority 3/4 cards across three kinds are still capped at the queue limit', q.length, 5);
  eq('the overflow is recorded, not silently lost', autoResolve.filter((r) => r.reason === 'queue_overflow').length, 4);
  check('never more than 5 queued, the research-doc target', q.length <= 5);
}

// Priority 1 and 2 are exempt from the cap too: a disagreement or a totals change
// is never dropped silently, however many are waiting.
{
  const input = {
    not_on_statement: Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, name: `Person ${i}`, amount: 50000 + i, bank: 'GTBank' })),
  };
  const { cards: q, autoResolve } = build(input);
  eq('six priority 1 cards are all kept, over the queue cap', q.length, 6);
  eq('nothing priority 1 is ever auto-resolved', autoResolve.length, 0);
}

// Mixing exempt and capped kinds: the cap spends its budget on priority 3/4 only.
{
  const input = {
    own_move: [ownMoveItem],
    not_on_statement: [{ id: 'n1', name: 'Tunde', amount: 100000, bank: 'GTBank' }],
    who_is_this: Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, contactKey: `c${i}`, name: `Person ${i}`, amount: 2000 + i })),
  };
  const { cards: q } = build(input);
  eq('the two priority 1/2 cards are both kept', q.filter((c) => c.priority <= 2).length, 2);
  eq('priority 3/4 is capped to the queue limit regardless', q.filter((c) => c.priority >= 3).length, 5);
  eq('total obeys the cap plus the exempt cards', q.length, 7);
}

// ── A4: a skipped category card resolves to its guess after 14 days ──────────────
{
  const input = { category: [{ id: 'k', txnId: 'k', merchantKey: 'kilimanjaro', name: 'Kilimanjaro', amount: 9000, suggestions: ['Food', 'Groceries'] }] };
  const key = build(input).cards[0].key;

  const fresh = build(input, { skips: { [key]: daysAgo(1) }, now });
  eq('A4: a card skipped yesterday is still in the queue', fresh.cards.length, 1);
  check('A4: and it is marked skipped', fresh.cards[0].skipped === true);

  const stale = build(input, { skips: { [key]: daysAgo(14) }, now });
  eq('A4: after 14 days the card is gone', stale.cards.length, 0);
  eq('A4: and the item is filed as the best guess', stale.autoResolve, [{ reason: 'skipped_out', kind: 'category', txnIds: ['k'], category: 'Food' }]);
}

// Rule 6, the other half: a card that changes the totals never resolves itself, however
// long it is skipped.
{
  const input = { own_move: [ownMoveItem] };
  const key = build(input).cards[0].key;
  const after = build(input, { skips: { [key]: daysAgo(90) }, now });
  eq('a priority 2 card survives 90 days of skipping', after.cards.length, 1);
  eq('and nothing was guessed on the user\'s behalf', after.autoResolve.length, 0);
}

// Skipped cards drop to the back of the queue, not out of it.
{
  const input = {
    own_move: [ownMoveItem],
    not_on_statement: [{ id: 'n1', name: 'Tunde', amount: 100000, bank: 'GTBank' }],
  };
  const urgentKey = build(input).cards[0].key;
  const { cards: q } = build(input, { skips: { [urgentKey]: daysAgo(1) }, now });
  eq('the skipped urgent card moved behind the unskipped one', q.map((c) => c.kind), ['own_move', 'not_on_statement']);
}

// ── Ordering ─────────────────────────────────────────────────────────────────────
{
  const { cards: q } = build({
    who_is_this: [{ id: 'w', contactKey: 'ada', name: 'Ada', amount: 2000 }],
    category: [{ id: 'c', txnId: 'c', merchantKey: 'mama', name: 'Mama Put', amount: 4500, suggestions: ['Food'] }],
    own_move: [ownMoveItem],
    not_on_statement: [{ id: 'n', name: 'Tunde', amount: 100000, bank: 'GTBank' }],
  });
  eq('priority order, urgent first', q.map((c) => c.kind), ['not_on_statement', 'own_move', 'category', 'who_is_this']);
}

{
  const { cards: q } = build({
    own_move: [
      { ...ownMoveItem, id: 'small', txnId: 'small', amount: 1000 },
      { ...ownMoveItem, id: 'big', txnId: 'big', amount: 90000 },
    ],
  });
  eq('inside a priority, the bigger amount comes first', q.map((c) => c.item.amount), [90000, 1000]);
}

// ── A6: counts ───────────────────────────────────────────────────────────────────
{
  const { cards: q, counts } = build({
    category: [
      { id: 'a', txnId: 'a', merchantKey: 'shoprite', name: 'Shoprite', amount: 5000, suggestions: ['Groceries'] },
      { id: 'b', txnId: 'b', merchantKey: 'shoprite', name: 'Shoprite', amount: 6000, suggestions: ['Groceries'] },
    ],
    cash: [{ id: 'cash', amount: 17000, count: 2, txnIds: ['w1', 'w2'], period: 'this month' }],
  });
  eq('A6: total is cards, which is what "1 of n" counts', counts.total, 2);
  eq('A6: things is what the cards are about (B5)', counts.things, 4);
  eq('A6: to sort counts transactions, not cards', counts.toSort, 2);
  eq('A6: cash to log is money, for Home and Money to share', counts.cashToLog, 17000);
  eq('A6: and total still equals the queue length', counts.total, q.length);
}

// Home's line (brief 4.1): hidden when empty, and it says the same numbers.
{
  eq('Home shows nothing with an empty queue', homeLine(countsOf([])), null);
  const { counts } = build({
    category: [{ id: 'a', txnId: 'a', merchantKey: 'x', name: 'X Ltd', amount: 5000, suggestions: ['Food'] }],
    cash: [{ id: 'cash', amount: 17000, count: 1, txnIds: ['w'] }],
  });
  const line = homeLine(counts, 'this month');
  eq('Home line copy', line.title, '2 things need a quick look');
  eq('Home second line carries only what applies', line.parts, ['1 to sort', { cash: 17000, period: 'this month' }]);
  eq('one thing reads in the singular', homeLine({ total: 1, things: 1, byPriority: { 1: 0, 2: 1, 3: 0, 4: 0 }, toSort: 0, cashToLog: 0, urgent: 0 }).title, '1 thing needs a quick look');
}

// ── A7: at most one push a day, the rest to the 8 pm summary ─────────────────────
{
  const urgent = countsOf(build({ not_on_statement: [{ id: 'n', name: 'Tunde', amount: 100000, bank: 'GTBank' }] }).cards);
  eq('A7: the first urgent card pushes', interruptions(urgent, { pushedToday: false }).push, true);
  eq('A7: a second push the same day does not go', interruptions(urgent, { pushedToday: true }).push, false);
  eq('A7: but it is still in the 8 pm summary', interruptions(urgent, { pushedToday: true }).digest, true);
  eq('A7: no push on a day the queue was already cleared', interruptions(urgent, { pushedToday: false, clearedToday: true }).push, false);

  const totals = countsOf(build({ own_move: [ownMoveItem] }).cards);
  eq('priority 2 never pushes', interruptions(totals).push, false);
  eq('priority 2 shows a badge', interruptions(totals).badge, 'dot');
  eq('priority 2 is in the summary', interruptions(totals).digest, true);

  const twoCats = countsOf(build({ category: [
    { id: 'a', txnId: 'a', merchantKey: 'a', name: 'A Ltd', amount: 5000, suggestions: ['Food'] },
    { id: 'b', txnId: 'b', merchantKey: 'b', name: 'B Ltd', amount: 5000, suggestions: ['Food'] },
  ] }).cards);
  eq('two category cards: a count, no push, no summary', interruptions(twoCats), { badge: 'count', push: false, digest: false });

  const threeCats = countsOf(build({ category: [
    { id: 'a', txnId: 'a', merchantKey: 'a', name: 'A Ltd', amount: 5000, suggestions: ['Food'] },
    { id: 'b', txnId: 'b', merchantKey: 'b', name: 'B Ltd', amount: 5000, suggestions: ['Food'] },
    { id: 'c', txnId: 'c', merchantKey: 'c', name: 'C Ltd', amount: 5000, suggestions: ['Food'] },
  ] }).cards);
  eq('three or more category cards reach the summary', threeCats.byPriority[3] >= 3 && interruptions(threeCats).digest, true);

  const optional = countsOf(build({ who_is_this: [{ id: 'w', contactKey: 'ada', name: 'Ada' }] }).cards);
  eq('priority 4 interrupts nothing', interruptions(optional), { badge: false, push: false, digest: false });
}

// ── Filtering: Money's "Sort them" opens the category cards only (brief 4.1) ─────
{
  const input = {
    own_move: [ownMoveItem],
    category: [{ id: 'c', txnId: 'c', merchantKey: 'mama', name: 'Mama Put', amount: 4500, suggestions: ['Food'] }],
  };
  const { cards: q } = build(input, { kinds: ['category', 'grouped_category'] });
  eq('filtered to category cards', q.map((c) => c.kind), ['category']);
  const grouped = build({ category: [
    { id: 'a', txnId: 'a', merchantKey: 'shoprite', name: 'Shoprite', amount: 5000, suggestions: ['Groceries'] },
    { id: 'b', txnId: 'b', merchantKey: 'shoprite', name: 'Shoprite', amount: 6000, suggestions: ['Groceries'] },
  ] }, { kinds: ['category', 'grouped_category'] });
  eq('a group survives the filter', grouped.cards.map((c) => c.kind), ['grouped_category']);
}

// ── Progress segments (brief 4.2) ────────────────────────────────────────────────
{
  const many = { own_move: Array.from({ length: 12 }, (_, i) => ({ ...ownMoveItem, id: `t${i}`, txnId: `t${i}`, amount: 1000 + i })) };
  eq('more than 8 cards caps the segments, so the screen draws one bar', build(many).segments, 8);
  eq('three cards draw three segments', build({ own_move: [ownMoveItem] }).segments, 1);
}

// ── Templates and initials ───────────────────────────────────────────────────────
{
  eq('amounts go through the money formatter', fillTemplate('Is {amount} from {name} your monthly income?', { amount: 77000, name: 'NYSC' }), 'Is ₦77,000 from NYSC your monthly income?');
  eq('a hidden-amount formatter hides the amount, sign and all', fillTemplate('What was {amount} at {name}?', { amount: 4500, name: 'Shoprite' }, () => '•••'), 'What was ••• at Shoprite?');
  eq('an unfilled token stays visible rather than printing undefined', fillTemplate('Who is {name}?', {}), 'Who is {name}?');
  eq('initials skip bank noise words', initialsOf('TRF TO SHOPRITE NIGERIA'), 'SN');
  eq('one word gives two letters', initialsOf('Shoprite'), 'SH');
  eq('nothing to go on gives a question mark', initialsOf('123'), '?');
}

// A card with one answer is not a question: the screen draws 2 to 4 buttons, so it is
// never built.
{
  const { cards: q } = build({
    which_account: [{ id: 'wa', senderKey: 'X', label: 'X', count: 2, accounts: [] }],
    refund_match: [{ id: 'r', name: 'Jumia', amount: 500, candidates: [] }],
  });
  eq('nothing to choose between is not asked about', q.length, 0);
  const withOne = build({ which_account: [{ id: 'wa', senderKey: 'X', label: 'X', count: 2, accounts: [{ id: 'a1', label: 'GTBank' }] }] });
  eq('one account plus Cash is a real question', withOne.cards.length, 1);
  eq('and it has two answers', withOne.cards[0].answers.map((a) => a.label), ['GTBank', 'Cash']);
}

// ── An empty queue ───────────────────────────────────────────────────────────────
{
  const { cards: q, counts } = build({});
  eq('nothing waiting is an empty queue', q.length, 0);
  eq('and an empty count', counts, { total: 0, things: 0, byPriority: { 1: 0, 2: 0, 3: 0, 4: 0 }, toSort: 0, cashToLog: 0, urgent: 0 });
}

console.log(`actionCards: ${pass} checks passed`);
