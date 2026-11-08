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

## Progress

### All seven bugs plus the structural gate, 8 Nov 2026, Sonnet

`financial-app` backend and `finpilot-mobile`, both pushed, one commit per fix as asked. `npm --prefix backend test` 66/66 files (actionCards 168 checks, up from 156; dedupe, counterparty, cleanName, txnLinks and alertParser all grew new checks for this). `npm --prefix frontend run build` clean. Mobile `tsc --noEmit` clean, `expo lint` no new issues (the one pre-existing error in `help.tsx` is unrelated, confirmed by checking it predates this session), `money-view.test.ts` 36/36, `plan-view.test.ts` 12/12, `contrast-audit.ts` 148/150 (the same 2 pre-existing failures as before this session, confirmed by stashing the diff and re-running). Did NOT add AI anywhere, per the brief's own rule and this doc's own conclusion.

**The structural fix, first, as asked.** `backend/lib/actionCards.js`'s `ASK_FLOOR`/`MAX_CATEGORY_CARDS`/overflow path ran only inside `groupCategories()`. The floor (do not ask below 2,000 naira) now applies to every priority 3 or 4 card; a new `MAX_QUEUE` (5) caps the whole queue across every kind. Priority 1 and 2 are exempt from both - they are fraud-risk or change totals by definition, so dropping one silently would be the trust failure these cards exist to prevent. A demoted card resolves through the same path category already used (its "Best guess" answer, when one exists and is safe to apply); everything else is simply not asked about this round rather than having an unconfirmed answer invented for it.

**P1 (self-transfer not detected on email).** `parseAlertsWithRescue` - the function the email path and the paste-a-bank-alert path both call - never accepted or forwarded `userName` at all, so `receiptOwnMove` could never fire on either source. It now does, and both call sites pass the signed-in user's name.

**P2 (counterparty name doubled).** `extractCounterparty`'s capture read everything after the FIRST "to"/"from" to the end of the string, so a narration stating both sides of a transfer (exactly what a self-transfer alert says) swallowed both names into one garbled string. The capture now stops at the next "to"/"from".

**P3 (exact duplicate still asked about).** The dedupe score already classified the finding's own example (identical amount, name and time) as `'duplicate'` (the 85+ MERGE tier) - the same_as card producer just never consulted that tier, only the lower `'probable'` one. A pair the score calls certain is now merged silently, through the same undoable path the user's own "Yes, same one" answer already used.

**P4 and P5 (refund candidates indistinguishable; OWealth churn).** One root cause: the refund producer matched credits against debits with no notion that OWealth (and the same-shaped auto-save/withdrawal churn on other wallets) is savings-pocket movement, not a purchase or a refund. `lib/opayStatement.isInternal` already encoded this rule for the statement-upload path; the refund producer now consults it too, on both sides of the match.

**P6 (ajo on a catalogue business).** The ajo producer read `extractCounterparty` directly, which has no notion of a catalogue match. `cleanName` already resolves the same narration correctly (a catalogue entry wins over the counterparty guess); the producer now requires `counterpartyType === 'person'` before treating two payments as ajo.

**P7 (notification title read as app name).** Native, in `modules/automonie-capture`: `BankNotificationListener` passed the triggering notification's own title into `CaptureStore.noteDiscovered`, and `discovered()` returned that same stored string as the app's name. It now asks `PackageManager` for the app's real label, falling back to the stored title only if the app has since been uninstalled. **This is a native change and needs a build, not an OTA** - it will do nothing on an already-published binary. The JS fallback in `lib/autoCapture.ts` was also hardened (a real app name is never a sentence) so an already-OTA'd binary gets a smaller version of the same protection without waiting for that build.

**What the queue count looks like now.** Not measured against the owner's live data from here - every session in this round has carried that same caveat, and this one does too. What can be said from the code: the structural cap makes 14 to 89 cards structurally impossible regardless of what the producers do, since priority 3 and 4 together can never exceed 5. Priority 1 and 2 have no cap, by design, but P1, P3 and P6 were all priority-2 cards in the owner's own screenshots (`own_move`/`category` via the self-transfer, `same_as`, `ajo`), and each is now a card that should never have been produced at all for that exact data - so the honest expectation is that the owner's real queue drops from the 14/15/31/34/89 range to within the 0-to-5 target, with whatever genuine priority-1/2 questions are left (a real disagreement, a real totals change) still asked regardless of count, which is the intended behaviour. **Needs the device check repeated** before this is more than an expectation.
