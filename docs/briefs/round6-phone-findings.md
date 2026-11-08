# Round 6 phone check: findings (build 58621ec2, 8 November 2026)

Owner ran the check on a real phone with real data. The round's acceptance tests all passed and the app is still wrong, which is the point of a device check.

## The headline: the Action Center is violating its own spec by about twenty times

Screenshots show queues of **14, 15, 31, 34 and 89 cards**. The spec (brief section 3, research doc section 3) sets the target at **0 to 3 questions on a normal day, never more than 5 in the queue**, and states the governing rule: *guess first, ask last*. Ask only when confidence is low **and** the item matters (changes totals, or is ₦2,000 or more).

Root cause found, not guessed: `backend/lib/actionCards.js` has `ASK_FLOOR`, `MAX_CATEGORY_CARDS` and an overflow path that demotes extra items to `guessed` - but **only inside `groupCategories()`**. Every other card kind (`ajo`, `refund_match`, the same-as duplicate card, `own_move`, `not_on_statement`...) has no floor, no cap and no overflow-to-guess path. So one card type obeys the spec and the rest flood.

This single gap explains the volume. The individual bugs below explain why the cards that do appear are often unanswerable.

## Bugs, in fix order

| # | What the owner saw | Why it is wrong | Where to look |
| --- | --- | --- | --- |
| P1 | ₦100K card titled "Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu", asking "What was this for?" with Transfer as best guess | **Own name on both sides. This is a self-transfer and must never be asked about.** Behaviour matrix row 3 and T18 cover exactly this; `internalTransfers.js` and B6's `receiptOwnMove` already implement the rule. It did not fire on an email-alert source | `internalTransfers.js`, `alertParser.js` (`userName` threading), the `category` card producer |
| P2 | The same name printed twice in one title | Sender and beneficiary are being concatenated into one counterparty string. Same class as B6's Access receipt bug, different source. A title should never repeat a name | `cleanName.js`, `counterparty.js`, the email-alert parse path |
| P3 | "Is this the same as ₦50 to Commission at 01:00?" on a ₦50 Commission at 01:00 item | Identical amount, name and time. The merge ladder should have merged this silently, or not asked. Asking the user to confirm an exact match is the opposite of guess-first | `mergeLadder.js`, the same-as card producer |
| P4 | "Which purchase is this ₦1,500 refund for?" with **both options reading "Owealth Withdrawal ( Payment) on 18 Aug"** | Two candidates the user cannot tell apart. **If candidates are indistinguishable to the reader, do not ask** - either disambiguate the labels (add time, add account) or drop the card and guess | `txnLinks.js` refund rule, `refund_match` producer |
| P5 | Dozens of "Owealth Withdrawal( Payment)" cards | OWealth is savings-pocket churn, not purchases and not refunds. Memory `ingestion-backlog-2026-09` records that internal OWealth churn is already meant to be hidden from transaction lists; it is clearly not hidden from the Action Center. These should be Own move, grouped, silent | `opayStatement.js`, `txnKinds.js`, the refund producer |
| P6 | "You've sent CHOWDECK ₦5,000 twice. Is this ajo or a contribution?" | **Chowdeck is a food delivery company and is in our own merchant catalogue**, added by R6-3. Ajo must only ever fire when the counterparty is a *person*. `cleanName.js` already returns `counterpartyType: 'person'` - the ajo producer is not consulting it | `actionCards.js:277` (`ajo`), its producer, `merchantCatalogue.json` |
| P7 | Automatic tracking lists "Pending Booking Expired!" under "Other apps we found" | That is a **notification title**, not an app name. The app-discovery path is reading the wrong field, so a single unrelated notification becomes a suggested money source | `modules/automonie-capture` + the found-apps list in `automatic-tracking.tsx` |

## The pattern

Every one of P1 to P6 is the same shape: **the information needed to not ask was already in the system, and nothing checked it.** We knew the name matched the user. We knew Chowdeck was a business. We knew the two ₦50 rows were identical. We knew OWealth is a savings pocket.

This is not a categorisation-accuracy problem. It is a problem of rules that exist and are not consulted at the point of asking.

## On bringing in more AI

The owner asked whether AI should do more of this. Considered honestly, and the answer for these failures is no:

- None of P1 to P7 would be fixed by a better model. Each is a lookup we already have and skipped. Putting AI in front of broken plumbing makes the same mistakes slower, costlier and less predictable, and it breaks brief rule 2 (AI never decides direction or amount).
- The effortlessness the owner wants comes from the **guess-first gate**, not from a model. Fixing the cap and the floor alone should take the queue from 89 to single digits.
- AI's correct and already-specced role stays: suggesting a category for a genuinely unknown merchant, and cleaning a merchant name. Memory `ai-purpose-inference-6` also stages AI for generic Transfer rows into rent/savings/family, which is real and worth having - but note the ₦100K Transfer in P1 is exactly a row that should never have reached an AI, because a rule should have called it a self-transfer first.

**Proposed gate:** fix P1 to P7 and the ask-floor, then re-run this check. If the queue is still above five for a normal user, that is the evidence that rules have run out and AI should widen. Not before.

## Birthday question

The owner wants it moved out of wherever it currently appears:
- **New users:** part of onboarding, act 4 of brief section 8. Already specced there ("Birthday day and month: so we can celebrate you"), so this lands with Block 7.
- **Existing users:** a one-off dismissible prompt with a real "Don't ask again", not a recurring nag.
- **To check:** whether the admin web app's existing global-notification mechanism (memory `global-notifications`: admin broadcast to all bells plus a dismissible site-wide banner) can carry this instead of new code. Confirm before building anything.

## Status of Blocks 7, 8 and 11

Not built. They were gated on this phone check, and this check says the foundation needs fixing first. Onboarding in particular should not be built as a guided tour of an Action Center that asks 89 unanswerable questions.
