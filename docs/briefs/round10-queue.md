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
| refund_match | 3 | 0 (all 104 are under the ₦2,000 floor and resolve silently) |
| Total | | 0 |

By priority: all 0. Queue overflow and floor are logged in `autoResolve` (220 items), not hidden: they resolve as guesses.

## Tests

`lib/actionCards.test.js` pins `PRIORITY.refund_match === 3` and checks that 40 ambiguous refunds produce at most `MAX_QUEUE` cards and none at priority 1 or 2. Full `npm test`: 68/68.
