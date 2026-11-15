# Round 10 Part B: Quick look queue count

## What was measured, and a limit on it

The queue was built with the real `actionCardInput` and `actionCards.build` against the local dev database (`mongodb://localhost:27017/financial_app`). The owner's own account (by their email) is NOT in that database, so the owner's real queue could not be measured here. The only account with real volume is a synthetic performance fixture (800 transactions, narrations of the form "Number 19 Some Longish Narration For Payload Size"). It is a proxy, and it did expose a real structural problem. Re-run the same measurement against the owner's data before treating the target as met.

## Before (fixture account, 800 transactions)

| Kind | Priority | Cards |
|---|---|---|
| refund_match | 2 | 104 |
| every other kind | n/a | 0 |
| Total | | 104 |

By priority: 1 = 0, 2 = 104, 3 = 0, 4 = 0.

What drives the total: one kind. Every credit shares narration text with many earlier debits, so the refund linker found two or more candidate charges for 104 credits and asked about each. Priority 2 is exempt from the ask floor (₦2,000), the skip expiry and the 5-card queue cap, so nothing bounded it.

## Decisions (kinds at priority 1 or 2 with more than 2 cards)

- refund_match (104 cards): too high. The linker already links an unambiguous refund on its own, so this card only asks which of several earlier charges a credit repays. That is a category-level question, so it is priority 3. At priority 3 the floor, skip expiry and queue cap apply. Card copy and answers are unchanged. Cost, stated plainly: an ambiguous refund left unanswered is not reapplied against a category, same as before; it simply no longer forces itself into the queue.
- Not a mislabelling: no other kind had more than 2 cards. Priority 1 (not_on_statement, sources_disagree) is untouched and uncapped.

## After (same account)

| Kind | Priority | Cards |
|---|---|---|
| refund_match | 3 | 0 (all 104 are under the ₦2,000 floor, so the question is not asked) |
| Total | | 0 |

By priority: all 0. The floor and the cap are logged in `autoResolve` (220 items), not hidden.

What "auto-resolve" does and does not do, since the two kinds behave differently (`demote()` in `lib/actionCards.js`): a `category` card files its best guess on the row and marks it `categoryGuessed`, because a category is one reversible field. A `refund_match` card files nothing at all. `demote()` returns `category: null` for every non-category kind, so an unasked refund is left unlinked rather than linked to a guessed charge. That matters for the totals: the app never silently decides which earlier charge a credit repays.

## Tests

`lib/actionCards.test.js` pins `PRIORITY.refund_match === 3` and checks that 40 ambiguous refunds produce at most `MAX_QUEUE` cards and none at priority 1 or 2. Full `npm test`: 68/68.

## Measuring the real queue (added after the fixture run)

The gap above stands: the local database has no real account, so these numbers come from a synthetic fixture. To close it, `GET /api/admin/queue-breakdown` was added in `backend/server.js` (superadmin only). It returns the total, the count by priority, the count by kind with each kind's priority, what the rules kept off the queue and why, and the live floor, cap and skip-expiry values.

It is read-only by construction. `/api/action-cards` goes through `actionCardQueue()`, which calls `applyGuesses()` and writes categories; this endpoint calls `actionCardInput()` and `actionCards.build()` directly instead, so measuring cannot change what it measures.

Checked on the local database, 15 Nov 2026:

- Fixture account (800 transactions): total 0, and `autoResolve` shows `refund_match:below_floor` 104 and `category:below_floor` 116. That independently reproduces the before and after in this report.
- Two calls in a row left `categoryGuessed` at 0 rows on that account, confirming the endpoint writes nothing.
- No `email` parameter measures the caller's own account.
- A non-superadmin token is refused with 403.

To measure the owner's real queue once this is deployed, call it with their own superadmin token:

    GET https://<the Render backend>/api/admin/queue-breakdown
    Authorization: Bearer <the owner's token>

Any kind at priority 1 or 2 with more than 2 cards in that answer is the next thing to judge, by the same rule used here: priority 1 or 2 means fraud risk or it changes the totals, everything else is priority 3.

## The real queue, measured on production (15 Nov 2026)

Measured with `GET /api/admin/queue-breakdown` against the deployed backend on version `2549d7b`, on the owner's own account (919 transactions). This replaces the fixture numbers above as the figure that counts.

| Kind | Priority | Cards |
|---|---|---|
| same_as | 2 | 6 |
| regular_payment | 2 | 3 |
| category | 3 | 3 |
| refund_match | 3 | 1 |
| income | 2 | 1 |
| subscription | 4 | 1 |
| Total | | 15 |

By priority: 1 = 0, 2 = 10, 3 = 4, 4 = 1. Also `who_is_this` produced 8 cards that the cap removed (`queue_overflow`), so those questions are never asked; nothing is written for them, since `demote()` files a guess for category kinds only.

### Decisions on the kinds at priority 1 or 2 with more than 2 cards

- `regular_payment` (3 cards): demoted to priority 3. "Do you pay X every month?" neither flags fraud nor changes a total. Its own builder comment calls it "worth knowing for Coming up", which is forecast metadata. Pinned by a test, together with a check that a dozen of them cannot exceed the cap.
- `same_as` (6 cards): stays at priority 2. It asks whether two rows are one movement, so a wrong answer double-counts money. That is exactly what the priority 2 exemption is for, and demoting it would let real duplicates sit unasked and quietly inflate spending. Pinned by a test so a later pass does not demote it for the sake of the count.

### The target is not met, and relabelling cannot meet it

With `regular_payment` at 3, priority 2 still holds 7 cards (6 `same_as` plus 1 `income`), and priority 2 is exempt from the cap by design. The projected total is about 12, down from 15, against a target of 5.

The remaining count is one kind asking the same question six times. The honest fix is to group it the way `grouped_category` already groups category questions: one card that says six rows may be duplicates, answered row by row inside the card. That keeps every duplicate question asked while the queue shows one card. Raising the cap or demoting `same_as` would only hide them.

Not done in this pass: grouping `same_as` is a change to what the card shows and how it is answered, on web and mobile as well as the backend, so it is its own piece of work rather than a priority edit.

### Grouping same_as (done)

`collapseSameAs()` in `lib/actionCards.js` now shows one duplicate pair at a time, the biggest first, with a helper line saying how many more are waiting. The deferred pairs are counted, not resolved: `item.count` carries the whole set and `countsOf` adds `item.count` into `things`, so Home still reads "6 things need a quick look" while the queue shows one card. Answering the shown pair brings the next on the next build, and no pair is ever auto-resolved. Web and mobile already render `helper`, so no client change was needed.

Pinned by tests: six pairs give one card, it is the biggest, its helper names the other five, `things` stays 6, no `same_as` row appears in `autoResolve`, and a single pair shows no helper line.

Projected total on the measured queue: 15 to 7 (6 same_as collapsing to 1, regular_payment leaving the exempt tier). Re-measured after deploy below.

### Re-measured after deploy (version 5525b71)

Same account, same endpoint: **15 cards to 7.**

| Kind | Priority | Cards |
|---|---|---|
| category | 3 | 2 |
| regular_payment | 3 | 2 |
| same_as | 2 | 1 |
| refund_match | 3 | 1 |
| income | 2 | 1 |
| Total | | 7 |

By priority: 2 = 2, 3 = 5. `autoResolve`: `who_is_this` 8 over the cap, `category` 1 over the cap, `subscription` 1 over the cap, `regular_payment` 1 below the floor (demoting it to priority 3 put it under the floor, as intended).

7 against a target of 5, and that 7 is the structural floor on this account: 2 cards are priority 2 (cap-exempt by design) plus the cap's own budget of 5. Reaching 5 would mean lowering `MAX_QUEUE` to 3, which shows fewer cards without there being less to answer. Recorded as 7 rather than tuned to 5.
