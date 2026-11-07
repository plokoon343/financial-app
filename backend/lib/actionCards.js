'use strict';
// The Action Center, as cards (round 6, Block 4; brief section 4, research section 3).
//
// WHY THIS MODULE EXISTS
// The screen used to be a long page of sections, each with its own buttons and, worst
// of all, raw alert text in editable fields. Research section 14 names that as a rule
// break: the user is handed the parser's job. This module turns everything waiting
// into a queue of CARDS, each one question with one tap per answer, so the screen can
// show exactly one at a time and nothing else.
//
// THE SEVEN RULES THIS FILE ENFORCES (research section 3)
//  1. Guess first, ask last. Below `askFloor` (₦2,000) a category question is never
//     asked: it resolves to the best guess and is marked Guessed.
//  2. One question per card, one tap per answer. 2 to 4 answers, the likely one first.
//  3. Group by sender. Six Shoprite payments are ONE card whose answer covers all six.
//  4. Learn every answer. A card that can make a rule carries the offer; the second
//     same answer for a name creates it (the tally lives on the server, not here).
//  5. Undo everywhere. The cards carry their targets, so an answer is reversible.
//  6. Skip is always allowed and never punished. A skipped card drops down the queue;
//     a skipped priority-3 card resolves to its best guess after `skipDays` (14).
//  7. Never block the app. This module only ever returns a list; nothing here gates
//     another screen.
//
// COPY IS FINAL (brief 4.3). Questions and answer labels are not paraphrased here and
// must not be paraphrased by callers. Amounts are NOT baked into the strings: each
// card carries a template with `{amount}`, `{name}` and friends plus a `vars` bag, so
// the client formats money with its own formatter and a user who has amounts hidden
// does not see them leak through a question. `fillTemplate` below is the one
// substitution, shared by both clients through the same rules.
//
// Pure and dependency-free: no database, no network, no clock of its own.

// ── Priorities (brief 4.3, research "when to interrupt") ──────────────────────────
// 1 urgent        the numbers may be wrong         badge + push + digest
// 2 changes totals the answer moves money around   badge + digest
// 3 category      cosmetic but worth asking        count only, digest if 3 or more
// 4 optional      nice to know                     nothing; shown last
const PRIORITY = {
  not_on_statement: 1,
  sources_disagree: 1,
  own_move: 2,
  same_as: 2,
  income: 2,
  loan: 2,
  ajo: 2,
  refund_match: 2,
  regular_payment: 2,
  category: 3,
  grouped_category: 3,
  cash: 3,
  who_is_this: 4,
  subscription: 4,
  apple_service: 4,
  goal: 4,
  which_account: 4,
};
const KINDS = Object.keys(PRIORITY);

// Interruption rules per priority (brief 4.5). The caller decides whether to send;
// this is the table it reads.
const INTERRUPTION = {
  1: { badge: true, push: true, digest: true },
  2: { badge: true, push: false, digest: true },
  3: { badge: 'count', push: false, digest: 'threshold', digestThreshold: 3 },
  4: { badge: false, push: false, digest: false },
};

// Don't ask about small money (rule 1). ₦2,000, in naira, as the brief states it.
const ASK_FLOOR = 2000;
// How many category questions the queue will ever hold. Research section 3's target
// is "0 to 3 questions on a normal day and never more than 5 in the queue", and use
// case 1 describes an import leaving "the biggest unknown groups". So the biggest
// three are asked about and the rest are filed as the best guess, marked Guessed.
// Without this cap a 3-month import of 40 unfamiliar shops is 40 cards, which is the
// long page of sections again in a different shape.
const MAX_CATEGORY_CARDS = 3;
// A skipped category question resolves to its best guess after this long (rule 6).
const SKIP_DAYS = 14;
// Eight progress segments, then a single bar (brief 4.2 item 2).
const MAX_SEGMENTS = 8;

const str = (v) => (v == null ? '' : String(v));
const lc = (v) => str(v).toLowerCase();

// ── Template filling ─────────────────────────────────────────────────────────────
// `{amount}`, `{sum}`, `{a}` and `{b}` are money and go through `money`; everything
// else is text. The naira sign is NOT written in the templates: it belongs to the
// money formatter, so a user who has amounts hidden sees the mask alone and not a
// stray "₦" in front of it.
// An unknown token is left as it is rather than printed as "undefined", because a
// visibly unfilled slot is a bug worth seeing in a screenshot.
function fillTemplate(template, vars = {}, money = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`) {
  return str(template).replace(/\{(\w+)\}/g, (whole, key) => {
    if (!(key in vars) || vars[key] == null) return whole;
    const v = vars[key];
    return key === 'amount' || key === 'sum' || key === 'a' || key === 'b' ? money(v) : str(v);
  });
}

// ── The card shapes ──────────────────────────────────────────────────────────────
// Every builder below returns the same shape, so the screen renders one component:
//   key        stable across reloads; the skip store and the answer route use it
//   kind       which question this is
//   priority   1 to 4
//   question   template, final copy
//   helper     at most one line under the question, or null
//   item       what the card is about: title, amount, meta, who, count, pair
//   answers    2 to 4; the first is the likely one and is drawn filled
//   rule       the "do the same in future" offer, or null
//   raw        the original alert text, shown only behind "See the original alert"
//   targets    the ids an answer applies to
//   vars       values for the question and the answer labels
const card = (c) => ({
  key: c.key,
  kind: c.kind,
  priority: PRIORITY[c.kind],
  question: c.question,
  helper: c.helper || null,
  item: {
    title: c.title || '',
    amount: c.amount == null ? null : Math.abs(Number(c.amount)),
    direction: c.direction || null,
    meta: c.meta || '',
    initials: initialsOf(c.title || c.name || ''),
    name: c.name || null,
    pair: c.pair || null,
    count: c.count || 1,
    logoKey: c.logoKey || null,
  },
  answers: c.answers,
  rule: c.rule || null,
  raw: c.raw || null,
  targets: c.targets || {},
  vars: c.vars || {},
  skipped: false,
});

// Two letters for the circle when there is no logo. Skips the noise words a bank
// narration starts with, so "TRF FROM SHOPRITE" reads "SH", not "TR".
const INITIAL_STOP = new Set(['trf', 'transfer', 'to', 'from', 'pos', 'web', 'pur', 'purchase', 'payment', 'nip', 'the']);
function initialsOf(name) {
  const words = str(name).replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter((w) => w && !INITIAL_STOP.has(w.toLowerCase()));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

const answer = (id, label, extra = {}) => ({ id, label, ...extra });

// ── Builders, one per card type (brief 4.3, in priority order) ────────────────────

// Priority 1. A credit we recorded is missing from the statement for its period. The
// only question in the app that can mean fraud, so it is the only one that pushes.
const notOnStatement = (it) => card({
  key: `not_on_statement:${it.id}`,
  kind: 'not_on_statement',
  question: '{amount} from {name} is not on your {bank} statement. Did this money arrive?',
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'income',
  meta: it.meta,
  raw: it.raw || null,
  answers: [
    answer('arrived', 'Yes, it arrived', { primary: true }),
    answer('remove', 'No, remove it'),
    answer('unsure', "I'm not sure"),
  ],
  targets: { txnIds: [it.txnId || it.id] },
  vars: { amount: it.amount, name: it.name, bank: it.bank || 'bank' },
});

// Priority 1. Two sources read the same movement differently. Never guessed: picking
// the wrong one silently is how an app loses trust for good. The loser is set aside,
// never deleted (research section 3).
const sourcesDisagree = (it) => card({
  key: `sources_disagree:${it.id}`,
  kind: 'sources_disagree',
  question: 'Your bank text and app alert show different amounts. Which is right?',
  title: it.name,
  name: it.name,
  amount: it.a,
  meta: it.meta,
  raw: it.raw || null,
  answers: [
    answer('a', '{a}', { primary: true, money: it.a }),
    answer('b', '{b}', { money: it.b }),
  ],
  targets: { observationIds: [it.aId, it.bId] },
  vars: { a: it.a, b: it.b, name: it.name },
});

// Priority 2. The field note from 3 Nov: a debit at one bank and a credit at another,
// one movement, two records. When both sides are tracked the linker pairs them with
// no question; this card is the case where one side cannot be proved.
const ownMove = (it) => card({
  key: `own_move:${it.id}`,
  kind: 'own_move',
  question: 'Did this go to another account of yours?',
  title: it.title,
  name: it.name,
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  pair: it.pair || null,
  raw: it.raw || null,
  answers: [
    answer('mine', "Yes, it's mine", { primary: true }),
    answer('sent', 'No, I sent it to someone'),
  ],
  rule: it.name ? { label: 'Do the same for future {name} payments', checked: false } : null,
  targets: { txnIds: [it.txnId || it.id] },
  vars: { amount: it.amount, name: it.name },
});

// Priority 2. Two rows that may be one movement. Answering No remembers the pair, so
// the question is asked once and never again.
const sameAs = (it) => card({
  key: `same_as:${it.id}`,
  kind: 'same_as',
  question: 'Is this the same as {amount} to {name} at {time}?',
  title: it.title,
  name: it.name,
  amount: it.amount,
  direction: it.direction,
  meta: it.meta,
  answers: [
    answer('same', 'Yes, same one', { primary: true }),
    answer('different', "No, they're different"),
  ],
  targets: { txnIds: [it.firstId, it.secondId] },
  vars: { amount: it.amount, name: it.name, time: it.time },
});

// Priority 2. One tap here sets monthly income and makes safe-to-spend appear for the
// first time, which is why it is asked and never guessed (B4).
const income = (it) => card({
  key: `income:${it.id}`,
  kind: 'income',
  question: 'Is {amount} from {name} your monthly income?',
  helper: it.months ? 'Seen {months} months in a row.' : null,
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'income',
  meta: it.meta,
  answers: [
    answer('yes', 'Yes', { primary: true }),
    answer('no', "No, it's something else"),
  ],
  targets: { txnIds: it.txnIds || [it.id], senderKey: it.senderKey || null },
  vars: { amount: it.amount, name: it.name, months: it.months || null },
});

// Priority 2. Borrowed money is not income. Getting this wrong inflates what the app
// says someone can spend.
const loan = (it) => card({
  key: `loan:${it.id}`,
  kind: 'loan',
  question: 'Is this {amount} a loan?',
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'income',
  meta: it.meta,
  raw: it.raw || null,
  answers: [
    answer('loan', 'Yes, a loan', { primary: true }),
    answer('no', 'No'),
  ],
  targets: { txnIds: [it.txnId || it.id] },
  vars: { amount: it.amount, name: it.name },
});

// Priority 2. Ajo and esusu are savings, not spending, and they are the single most
// common thing a Nigerian budgeting app files wrongly.
const ajo = (it) => card({
  key: `ajo:${it.id}`,
  kind: 'ajo',
  question: "You've sent {name} {amount} twice. Is this ajo or a contribution?",
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  answers: [
    answer('ajo', 'Yes, ajo', { primary: true }),
    answer('no', 'No, just sending'),
  ],
  rule: { label: 'Do the same for future {name} payments', checked: true },
  targets: { txnIds: it.txnIds || [], contactKey: it.contactKey || null },
  vars: { amount: it.amount, name: it.name },
});

// Priority 2. A refund reduces the category it came from; linking it to the wrong
// purchase moves money out of the wrong budget.
const refundMatch = (it) => card({
  key: `refund_match:${it.id}`,
  kind: 'refund_match',
  question: 'Which purchase is this {amount} refund for?',
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'income',
  meta: it.meta,
  answers: [
    ...(it.candidates || []).slice(0, 2).map((c, i) => answer(`txn:${c.id}`, c.label, i === 0 ? { primary: true } : {})),
    answer('neither', 'Neither'),
  ],
  targets: { txnIds: [it.txnId || it.id], candidateIds: (it.candidates || []).map((c) => c.id) },
  vars: { amount: it.amount, name: it.name },
});

// Priority 2. Not a subscription (no card on file, no provider to cancel): rent, a
// school fee, a monthly transfer to family. Worth knowing for Coming up.
const regularPayment = (it) => card({
  key: `regular_payment:${it.id}`,
  kind: 'regular_payment',
  question: 'Do you pay {name} {amount} every month?',
  helper: it.months ? 'Seen {months} months in a row.' : null,
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  logoKey: it.logoKey || null,
  answers: [
    answer('yes', 'Yes', { primary: true }),
    answer('no', 'Not regularly'),
  ],
  targets: { detectionKey: it.detectionKey || null, name: it.name, amount: it.amount, lastSeen: it.lastSeen || null },
  vars: { amount: it.amount, name: it.name, months: it.months || null },
});

// Priority 3. One purchase, three suggestions and a way out. The first suggestion
// carries the "Best guess" pill (brief 4.2).
const category = (it) => card({
  key: `category:${it.id}`,
  kind: 'category',
  question: 'What was {amount} at {name}?',
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: it.direction || 'expense',
  meta: it.meta,
  logoKey: it.logoKey || null,
  raw: it.raw || null,
  answers: [
    ...(it.suggestions || []).slice(0, 3).map((s, i) => answer(`cat:${s}`, s, i === 0 ? { primary: true, pill: 'Best guess' } : {})),
    answer('other', 'Something else', { opensPicker: true }),
  ],
  rule: { label: 'Do the same for future {name} payments', checked: false },
  targets: { txnIds: [it.txnId || it.id], merchantKey: it.merchantKey || null },
  vars: { amount: it.amount, name: it.name },
});

// Priority 3. Rule 3, grouping, is what keeps the queue to a handful of cards: six
// Shoprite payments are one question. The rule box is CHECKED by default here,
// because someone who answers for six at once clearly means it for the seventh.
const groupedCategory = (it) => card({
  key: `grouped_category:${it.merchantKey || it.id}`,
  kind: 'grouped_category',
  question: '{count} payments to {name}. What are they?',
  title: it.name,
  name: it.name,
  amount: it.total,
  direction: 'expense',
  meta: it.meta,
  count: it.count,
  logoKey: it.logoKey || null,
  answers: [
    ...(it.suggestions || []).slice(0, 2).map((s, i) => answer(`cat:${s}`, s, i === 0 ? { primary: true, pill: 'Best guess' } : {})),
    answer('other', 'Something else', { opensPicker: true }),
  ],
  rule: { label: 'Do the same for future {name} payments', checked: true },
  targets: { txnIds: it.txnIds || [], merchantKey: it.merchantKey || null },
  vars: { count: it.count, name: it.name, amount: it.total },
});

// Priority 3. Cash is the one card that is not a single tap, because one withdrawal
// usually became three or four different things. Tiles with amount fields, and
// "Leave the rest" so a part-answer is a complete answer.
const cash = (it) => card({
  key: `cash:${it.id}`,
  kind: 'cash',
  question: 'What did the {amount} cash go on?',
  helper: it.count > 1 ? '{count} withdrawals, {period}.' : null,
  title: it.title || 'Cash withdrawal',
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  count: it.count || 1,
  answers: [
    answer('save', 'Save {sum}', { primary: true, tiles: it.tiles || [], needsAmounts: true }),
    answer('leave', 'Leave the rest'),
  ],
  targets: { txnIds: it.txnIds || [] },
  vars: { amount: it.amount, count: it.count || 1, period: it.period || 'this month', sum: 0 },
});

// Priority 4. Asked once per person, and it is what turns a wall of "Transfer" rows
// into "Family", "Friends" and "Work" (rule 3 of this round: never "Transfer").
const whoIsThis = (it) => card({
  key: `who_is_this:${it.contactKey || it.id}`,
  kind: 'who_is_this',
  question: 'Who is {name}?',
  title: it.name,
  name: it.name,
  amount: it.amount == null ? null : it.amount,
  direction: 'expense',
  meta: it.meta,
  answers: [
    answer('family', 'Family', { primary: true }),
    answer('friend', 'Friend'),
    answer('work', 'Work'),
    answer('skip', 'Skip', { isSkip: true }),
  ],
  targets: { contactKey: it.contactKey || null, txnIds: it.txnIds || [] },
  vars: { name: it.name },
});

const subscription = (it) => card({
  key: `subscription:${it.detectionKey || it.id}`,
  kind: 'subscription',
  question: 'Is {name} a monthly subscription?',
  helper: it.months ? 'Charged in {months} different months.' : null,
  title: it.name,
  name: it.name,
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  logoKey: it.logoKey || null,
  answers: [
    answer('yes', 'Yes', { primary: true }),
    answer('no', 'No'),
  ],
  targets: { detectionKey: it.detectionKey || null, subscriptionId: it.subscriptionId || null, name: it.name, amount: it.amount, lastSeen: it.lastSeen || null },
  vars: { name: it.name, months: it.months || null },
});

// Priority 4. "WEB PUR APPLE COM BILL" is the narration behind B1, and it says nothing
// about which service it was. Four answers, because the bank will never tell us.
const appleService = (it) => card({
  key: `apple_service:${it.id}`,
  kind: 'apple_service',
  question: 'Which Apple service was this?',
  title: it.title || 'Apple',
  name: 'Apple',
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  logoKey: 'apple',
  raw: it.raw || null,
  answers: [
    answer('icloud', 'iCloud', { primary: true }),
    answer('music', 'Apple Music'),
    answer('app', 'An app'),
    answer('other', 'Something else', { opensPicker: true }),
  ],
  rule: { label: 'Do the same for future {name} payments', checked: false },
  targets: { txnIds: [it.txnId || it.id] },
  vars: { amount: it.amount, name: 'Apple' },
});

const goal = (it) => card({
  key: `goal:${it.id}`,
  kind: 'goal',
  question: 'Count {amount} in {pocket} toward your {goal} goal?',
  title: it.pocket,
  name: it.pocket,
  amount: it.amount,
  direction: 'expense',
  meta: it.meta,
  answers: [
    answer('yes', 'Yes', { primary: true }),
    answer('no', 'No'),
  ],
  targets: { txnIds: [it.txnId || it.id], goalId: it.goalId || null },
  vars: { amount: it.amount, pocket: it.pocket, goal: it.goal },
});

// Priority 4. The sender is unknown, so every alert from it is unfiled. One answer
// files this one and every future alert from the same sender.
const whichAccount = (it) => card({
  key: `which_account:${it.senderKey || it.id}`,
  kind: 'which_account',
  question: 'Which account was this?',
  helper: it.count > 1 ? '{count} alerts from this sender.' : null,
  title: it.label || it.senderKey,
  name: it.label || it.senderKey,
  amount: null,
  meta: it.meta,
  count: it.count || 1,
  raw: it.sample || null,
  answers: [
    ...(it.accounts || []).slice(0, 3).map((a, i) => answer(`account:${a.id}`, a.label, i === 0 && it.guessed ? { primary: true, pill: 'Best guess' } : i === 0 ? { primary: true } : {})),
    answer('cash', 'Cash'),
  ],
  rule: { label: 'Do the same for future {name} payments', checked: true },
  targets: { senderKey: it.senderKey || null },
  vars: { name: it.label || it.senderKey, count: it.count || 1 },
});

const BUILDERS = {
  not_on_statement: notOnStatement,
  sources_disagree: sourcesDisagree,
  own_move: ownMove,
  same_as: sameAs,
  income,
  loan,
  ajo,
  refund_match: refundMatch,
  regular_payment: regularPayment,
  category,
  grouped_category: groupedCategory,
  cash,
  who_is_this: whoIsThis,
  subscription,
  apple_service: appleService,
  goal,
  which_account: whichAccount,
};

// ── Grouping (rule 3) ────────────────────────────────────────────────────────────
// Items with the same counterparty AND the same question type become one card. Only
// category questions group today: everything else is either already one card for many
// rows (cash, which_account) or is about one specific movement whose answer cannot be
// shared (an own move, a duplicate pair, a refund match).
function groupCategories(items, { askFloor = ASK_FLOOR, maxCards = MAX_CATEGORY_CARDS } = {}) {
  const guessed = [];
  // Rule 1 first, and per row: anything under the floor is filed as its best guess
  // and never reaches a card, in a group or on its own. A1 states it plainly -
  // "everything under ₦2,000 Guessed" - so a group of small payments does not get in
  // through the side door by being numerous.
  const asked = [];
  for (const it of items) {
    if (Math.abs(Number(it.amount) || 0) < askFloor) { guessed.push({ ...it, reason: 'below_floor' }); continue; }
    asked.push(it);
  }

  const groups = new Map();
  const loose = [];
  for (const it of asked) {
    const key = lc(it.merchantKey || it.name);
    if (!key) { loose.push(it); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }

  // One entry per sender (rule 3), with its total, so the biggest unknowns are the
  // ones worth a question.
  const candidates = [];
  for (const [key, rows] of groups) {
    const total = rows.reduce((n, r) => n + Math.abs(Number(r.amount) || 0), 0);
    candidates.push({ key, rows, total });
  }
  for (const it of loose) candidates.push({ key: null, rows: [it], total: Math.abs(Number(it.amount) || 0) });
  candidates.sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)));

  const cards = [];
  for (const [i, cand] of candidates.entries()) {
    // Past the cap, the rest are guessed rather than queued. They are still marked
    // Guessed on the row and can be changed from the transaction, which is the whole
    // point of rule 1: a wrong guess the user can see beats a question they never
    // answer.
    if (i >= maxCards) { for (const r of cand.rows) guessed.push({ ...r, reason: 'overflow' }); continue; }
    const first = cand.rows[0];
    if (cand.rows.length > 1) {
      cards.push(groupedCategory({
        merchantKey: cand.key,
        id: cand.key,
        name: first.name,
        count: cand.rows.length,
        total: cand.total,
        meta: first.meta,
        logoKey: first.logoKey,
        suggestions: first.suggestions,
        txnIds: cand.rows.map((r) => r.txnId || r.id),
      }));
    } else {
      cards.push(category(first));
    }
  }
  return { cards, guessed };
}

// ── Ordering ─────────────────────────────────────────────────────────────────────
// Priority first, then the bigger amount, then the key so the order never wobbles
// between two reloads. Skipped cards go to the back of the whole queue (rule 6:
// "moves the card down"), keeping their own order among themselves.
function order(cards) {
  const rank = (c) => (c.skipped ? 10 : 0) + c.priority;
  return cards.slice().sort((x, y) =>
    rank(x) - rank(y)
    || (Math.abs(y.item.amount || 0) - Math.abs(x.item.amount || 0))
    || String(x.key).localeCompare(String(y.key)));
}

// ── The build ────────────────────────────────────────────────────────────────────
/**
 * Turn everything waiting into an ordered queue of cards.
 *
 * input: { <kind>: [item, ...], ... } using the item shapes each builder above reads.
 *        `category` items are grouped before they become cards.
 * options:
 *   skips     { [cardKey]: ISO date or Date }  when each card was last skipped
 *   now       Date
 *   askFloor  naira below which a single category question is never asked
 *   skipDays  days after which a skipped priority-3 card resolves to its guess
 *   kinds     restrict the queue to these kinds (Money's "Sort them" link opens the
 *             Action Center filtered to category cards, brief 4.1)
 *
 * Returns { cards, autoResolve, counts, segments }.
 *   autoResolve  items the caller should file as Guessed instead of asking about:
 *                below the floor, or a category card skipped past `skipDays`.
 */
function build(input = {}, options = {}) {
  const { skips = {}, now = new Date(), askFloor = ASK_FLOOR, skipDays = SKIP_DAYS, kinds = null, maxCategoryCards = MAX_CATEGORY_CARDS } = options;
  const wanted = kinds && kinds.length ? new Set(kinds) : null;
  const cards = [];
  const autoResolve = [];

  for (const kind of KINDS) {
    if (wanted && !wanted.has(kind)) continue;
    const items = Array.isArray(input[kind]) ? input[kind] : [];
    if (!items.length) continue;
    if (kind === 'category') {
      const { cards: made, guessed } = groupCategories(items, { askFloor, maxCards: maxCategoryCards });
      for (const g of guessed) autoResolve.push({ reason: g.reason, kind: 'category', txnIds: [g.txnId || g.id], category: (g.suggestions || [])[0] || null });
      // A grouped card is a `grouped_category` card, so only keep it when that kind
      // was asked for too.
      for (const c of made) { if (!wanted || wanted.has(c.kind)) cards.push(c); }
      continue;
    }
    if (kind === 'grouped_category') continue; // produced by groupCategories above
    for (const it of items) {
      const built = BUILDERS[kind](it);
      cards.push(built);
    }
  }

  // A card with one answer is not a question, it is an instruction, and the screen
  // draws 2 to 4 buttons. This happens for real: "Which account was this?" on a user
  // who has no accounts yet offers only "Cash", and a refund match with one candidate
  // left offers only "Neither". Dropping those is right - there is nothing for the
  // user to decide - and it keeps the screen's contract true by construction rather
  // than by hoping every producer remembers.
  const asked = cards.filter((c) => c.answers.length >= 2);

  // Skips (rule 6). A priority-3 card skipped longer than `skipDays` leaves the queue
  // with its best guess applied; priority 1 and 2 cards stay however long they are
  // skipped, because they change the numbers and a guess there is not good enough.
  const kept = [];
  for (const c of asked) {
    const at = skips[c.key];
    if (!at) { kept.push(c); continue; }
    const days = (now - new Date(at)) / 86400000;
    if (c.priority === 3 && days >= skipDays) {
      const guess = (c.answers.find((a) => a.pill === 'Best guess') || {}).id || null;
      autoResolve.push({
        reason: 'skipped_out',
        kind: c.kind,
        txnIds: c.targets.txnIds || [],
        category: guess && guess.startsWith('cat:') ? guess.slice(4) : null,
      });
      continue;
    }
    kept.push({ ...c, skipped: true });
  }

  const ordered = order(kept);
  return { cards: ordered, autoResolve, counts: countsOf(ordered), segments: Math.min(ordered.length, MAX_SEGMENTS) };
}

// ── Counts (B5: one query, so a heading can never disagree with its cards) ────────
// `total` is cards, which is what "[i] of [n]" counts. `things` is what those cards
// are ABOUT: a grouped card standing for six payments adds six. Home's line reads
// `things`, because "6 things need a quick look" over one card would be a lie in the
// other direction.
function countsOf(cards) {
  const byPriority = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let things = 0;
  let toSort = 0;
  let cashToLog = 0;
  for (const c of cards) {
    byPriority[c.priority] += 1;
    things += c.item.count || 1;
    if (c.kind === 'category' || c.kind === 'grouped_category') toSort += c.item.count || 1;
    if (c.kind === 'cash') cashToLog += Math.abs(c.item.amount || 0);
  }
  return { total: cards.length, things, byPriority, toSort, cashToLog, urgent: byPriority[1] };
}

// ── Home's entry line (brief 4.1) ────────────────────────────────────────────────
// Hidden when the queue is empty. The second line carries only the parts that apply,
// and both lines name the period, so Home and Money can never read differently (B2).
function homeLine(counts, period = 'this month') {
  if (!counts || !counts.total) return null;
  const n = counts.things;
  const parts = [];
  if (counts.toSort) parts.push(`${counts.toSort} to sort`);
  if (counts.cashToLog) parts.push({ cash: counts.cashToLog, period });
  return {
    title: n === 1 ? '1 thing needs a quick look' : `${n} things need a quick look`,
    parts,
    urgent: counts.urgent > 0,
  };
}

// ── Interruptions (brief 4.5) ────────────────────────────────────────────────────
/**
 * What, if anything, to send today.
 *   counts        from build()
 *   pushedToday   has any push already gone out today (one a day across the app)
 *   clearedToday  did the user already empty the queue today
 * Returns { badge, push, digest }.
 */
function interruptions(counts, { pushedToday = false, clearedToday = false } = {}) {
  const urgent = counts.byPriority[1] > 0;
  const changesTotals = counts.byPriority[2] > 0;
  const categories = counts.byPriority[3];
  return {
    // A number on the bell for anything at priority 1 to 3; priority 4 never shows.
    badge: urgent || changesTotals ? 'dot' : categories ? 'count' : false,
    // At most one push a day, never on a day the queue was already cleared, and only
    // for priority 1.
    push: !!(urgent && !pushedToday && !clearedToday),
    // The 8 pm summary carries 1 and 2 always, 3 only when there are three or more,
    // and never 4.
    digest: urgent || changesTotals || categories >= INTERRUPTION[3].digestThreshold,
  };
}

module.exports = {
  build,
  countsOf,
  homeLine,
  interruptions,
  fillTemplate,
  initialsOf,
  PRIORITY,
  KINDS,
  INTERRUPTION,
  ASK_FLOOR,
  MAX_CATEGORY_CARDS,
  SKIP_DAYS,
  MAX_SEGMENTS,
};
