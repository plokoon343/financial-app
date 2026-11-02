# Claude Code Brief: Round 6, Trust, Review and Polish (2 Nov 2026)

Read this whole brief before writing code. Then read `docs/briefs/mobile-overhaul.md` and the approved Screen Specs (`Automonie_ScreenSpecs_Handoff_v1.md`). Where this brief and the Screen Specs disagree, this brief wins, and the disagreement is named here. Supporting research: `docs/design/ingestion-dedupe-review-research.md` ("Automonie: Ingestion, Dedupe and Review Research", sections 1 to 14) - section numbers below refer to it.

Source of every decision: the research doc (sections 1 to 14).

Flags used:
- **[needs build]**: new app or web code.
- **[needs backend]**: new API, data model, job or config on the server.
- **[config]**: a value that must live in server config, never hard-coded.

---

## 0. Rules for this round (read first)

1. **Numbers must agree everywhere.** Home, Money, Plan and the Action Center read the same queries for the same period. A number that disagrees between two screens is a release blocker.
2. **AI never extracts amounts or decides debit or credit.** Rules only. AI may suggest a category or a clean merchant name.
3. **Never "Transfer" as a spending category.** Person's name or "Sent to people". Moves between the user's own accounts are left out of totals.
4. **No raw narration as a title.** Raw text only on Transaction detail under "Original alert".
5. **No emoji and no em dashes in UI copy.** Ionicons only.
6. **Semantic colour tokens only.** No hex, rgb or named colours outside the theme file.
7. **Undo instead of confirm** for anything reversible.
8. **Trust copy must be true in code.** Follow the trust language brief.
9. **Email forwarding stays as it is this round.** Do not remove or change it. It will be revisited.
10. **Screenshots are allowed by default** (changed from Round 4, see 6.4).

---

## 1. Build order

Work top to bottom. Each block ends with its acceptance tests. Do not start a block until the previous block's tests pass.

| Order | Block | Why first |
| --- | --- | --- |
| 1 | Bugs B1 to B6 from the screenshots | Numbers disagree today |
| 2 | Observation model, dedupe and linking | Everything else sits on it |
| 3 | Categories, merchant catalogue, clean names | Every screen shows them |
| 4 | Action Center (Screen Spec in section 4 of this brief) | The core review experience |
| 5 | Subscriptions and regular payments | High-value, visible |
| 6 | Theme tokens, contrast fixes, interaction standards | Polish across all screens |
| 7 | Onboarding | Depends on 2 to 5 |
| 8 | Motion, haptics, responses | Depends on screens existing |
| 9 | Low-support features | Depends on sources and status |
| 10 | Remaining gaps (section 13) | |
| 11 | Brand moments | Last |

---

## 2. Block 1: Bugs from the screenshots (fix first)

| # | Bug | Required fix | Test |
| --- | --- | --- | --- |
| B1 | Apple charges ("Web Pur Apple Com Bill...") are filed as "Cash out, not counted as spending" | Cash is only ATM and POS-agent withdrawals. apple.com/bill is a card purchase: category Subscriptions (or Apps), effect Spending. Re-run classification on existing data | Two Apple charges of ₦510 and ₦1,326 show as Spending; "taken out as cash" no longer includes them |
| B2 | Home "₦190.9K cash to log" vs Money "₦1,836 taken out as cash" | One function computes cash to log for a stated period. Both screens show the period ("this month") | Same figure and period on Home and Money |
| B3 | Home "Updated 1 day ago · 4 transactions" vs Money "6 transactions · Updated just now" | One last-sync value and one count query per period | Same values on both |
| B4 | Home shows safe to spend while Plan says income is not set | Approved spec: no income means Home shows "Net this [Month]" and "See what's safe to spend / Add your monthly income. Takes 10 seconds." | With no income, no safe to spend figure anywhere |
| B5 | Action Center "To sort 1" over "2 transactions need a category" | Counts from one query | Heading count equals items |
| B6 | Shared Access receipt read as labels then values, title "Transfer to Remark", amount "84000", no direction | Pair labels with values by layout (same line, or nth label with nth value when the receipt lists labels then values). Then apply the own-account rule: sender and beneficiary names match the user, so it is "Moved to OPay", Own move, no question. Use Session Id and Transaction Reference as dedupe keys | Test T19 below passes |

**T19 (real layout, redacted):** a shared Access receipt listing labels (Transaction Amount, Transaction Type, Transaction Date, Sender, Beneficiary, Remark, Session Id, Transaction Reference, Transaction Status) followed by values (₦84,000, INTER-BANK, 2026-10-25 11:01:36, [user name], [user name], [OPay account], OPAY DIGITAL SERVICES LIMITED, [session id]). Expected: one Transaction, ₦84,000, debit at Access, "Moved to OPay", Own move, excluded from totals; if an OPay credit of ₦84,000 arrives within 10 minutes, it links as the other side.

---

## 3. Block 2: Observations, dedupe and linking (section 2)

### 3.1 Data model [needs backend]

- **Observation:** userId, source (sms, notification, share, statement, manual, mono, email), accountRef, direction (rules only), amountKobo (integer, rules only), eventTime (from text, else receivedAt), receivedAt, balanceAfterKobo, reference (session ID or ref), counterpartyRaw, channelHints, rawHash, status (final, pending).
- **Transaction:** one or more Observations; effect (Income, Spending, Own move, Cancelled, Debt); category; counterpartyClean; links[] (ownMove, reversal, refund, fee, payback); createdBy (rule, user) on every merge and link.
- Amounts in kobo. Times in Africa/Lagos.

### 3.2 Merge ladder (same user, same direction, same amount)

1. Same source and same rawHash within 24 hours: drop.
2. Same reference on both: merge, any sources, any gap.
3. Same accountRef and same balanceAfter: merge.
4. Same accountRef (or same bank when one side lacks digits), compatible counterparty, inside the window:
   - SMS with notification: 15 minutes
   - Alert with share: 48 hours
   - Alert with manual entry: 48 hours
   - Alert with statement row: same value date, plus or minus 1 day
   - Mono with anything: same value date, plus or minus 1 day
5. One candidate: merge. Two or more: Action Center "Is this the same as...".

Never merge two Observations from the same source at steps 3 to 5.

### 3.3 Field winners

Amount and direction: statement, SMS, Mono, notification, share, manual. If sources disagree, do not merge; raise the "Which is right?" card. Time: alert, then statement. Balance: latest alert. Counterparty: longest clean name. Category: user choice, user rule, learned merchant, suggestion.

### 3.4 Linking

- **Own move:** debit on A, credit on B, both the user's, same amount (credit may be smaller by a known fee), within 10 minutes (60 for card-to-wallet funding). Auto-link when counterparty matches the user's name or the wallet provider; else ask once and save as a rule.
- **Reversal:** credit, same account and amount, within 72 hours, reversal wording or same reference. Both Cancelled. Fee credits link to their fees.
- **Refund:** credit from the same merchant within 90 days, equal to or less than one earlier debit. Link if exactly one match. Reduces that category's spending; never Income.
- **Fee:** debits at the same account within 2 minutes after a parent, amount in the fee table [config], seeded with ₦6.98, ₦10, ₦25, ₦50 and 7.5% VAT values of those. Children of the parent. Detail shows "₦15,060 including ₦60 charges".
- **Cash:** ATM and POS-agent withdrawals are Own moves into a Cash account; manual cash spends draw it down.
- **Holds:** pending observations never count; a final charge within 7 days replaces the hold; else drop (13.7).

### 3.5 Statement import

Reconcile first (opening + credits - debits = closing) or reject with the gap named and "Try another file". Match rows with the ladder. Unmatched rows: "Added from statement". Alerts in the period with no row: flag "Not on your statement" (urgent Action Center card).

### 3.6 Undo

Every merge and link can be undone from Transaction detail: "Not the same" splits; "Not a move between my accounts" unlinks. Each undo is logged as a correction.

### 3.7 Behaviour matrix

Implement all 32 rows of the matrix in section 2 of the research doc. Each row names detection, effect, link and when to ask. The matrix is the spec; this brief does not repeat it.

### 3.8 Acceptance tests

All of T1 to T18 in section 2 of the research doc, plus T19 above. Inputs other than GTBank SMS are synthetic: replace them with redacted real alerts from our own corpus before release, and keep both.

---

## 4. Block 4: Action Center Screen Spec

Question this screen answers: **"Is there anything I need to check, and can I do it in a few taps?"**

### 4.1 Entry points

- Home: slim line under the greeting, hidden when the queue is empty. Copy: "[N] things need a quick look". Second line, only the parts that apply: "[n] to sort · ₦[X] cash to log this month". Uses the same counts as the screen (B5).
- Bell, when a queue item is urgent.
- Money: "N need a category [Sort them]" opens the Action Center filtered to category cards.
- Push (8 pm summary, or urgent) opens the first card directly.
- After a 3-month import: "We found [N] transactions. [n] need a quick look."

### 4.2 Layout (top to bottom)

1. Header: back (44 by 44, 48 with padding), title "Quick look", right "[i] of [n]".
2. Progress: one segment per card, filled with primary for answered ones. More than 8 cards: a single bar.
3. One card (surface, border, radius 22, padding 20 to 24):
   - Item: logo or initials circle, or for own moves "Bank A → Bank B" circles; amount at hero-adjacent size (40/600 for single items); one meta line "[Day date] · [time] · [source]".
   - Divider.
   - Question at 19/500, one line of helper text at 13 if needed.
   - Answers: 2 to 4 buttons, 56 tall, full width. First = most likely, filled primary with onPrimary label (near-black on mint). A "Best guess" pill on suggested categories.
   - Optional checkbox "Do the same for future [name] payments", checked by default on grouped cards.
   - "See the original alert" (collapsed, opens raw text in a sheet).
4. "Skip for now" text button below the card.
5. Footer helper at 12: "You can change any answer later from the transaction."

No other content on the screen. No list of sections. No editable raw fields.

### 4.3 Card types (priority order; copy is final)

| Priority | Card | Question | Answers (default first) |
| --- | --- | --- | --- |
| 1 | Not on statement | "₦[X] from [name] is not on your [bank] statement. Did this money arrive?" | Yes, it arrived / No, remove it / I'm not sure |
| 1 | Sources disagree | "Your bank text and app alert show different amounts. Which is right?" | ₦[A] / ₦[B] |
| 2 | Own move | "Did this go to another account of yours?" | Yes, it's mine / No, I sent it to someone |
| 2 | Same as | "Is this the same as ₦[X] to [name] at [time]?" | Yes, same one / No, they're different |
| 2 | Income | "Is ₦[X] from [name] your monthly income?" | Yes / No, it's something else |
| 2 | Loan | "Is this ₦[X] a loan?" | Yes, a loan / No |
| 2 | Ajo | "You've sent [name] ₦[X] twice. Is this ajo or a contribution?" | Yes, ajo / No, just sending |
| 2 | Refund match | "Which purchase is this ₦[X] refund for?" | [purchase] / [purchase] / Neither |
| 2 | Regular payment | "Do you pay [name] ₦[X] every month?" | Yes / Not regularly |
| 3 | Category | "What was ₦[X] at [name]?" | Top 3 suggestions / Something else |
| 3 | Grouped category | "[n] payments to [name]. What are they?" | Top 2 / Something else, plus checkbox |
| 3 | Cash | "What did the ₦[X] cash go on?" | Category tiles with amount fields, "Save ₦[sum]", "Leave the rest" |
| 4 | Who is this | "Who is [name]?" | Family / Friend / Work / Skip |
| 4 | Subscription | "Is [name] a monthly subscription?" | Yes / No |
| 4 | Apple service | "Which Apple service was this?" | iCloud / Apple Music / An app / Something else |
| 4 | Goal | "Count ₦[X] in [pocket] toward your [goal] goal?" | Yes / No |
| 4 | Which account | "Which account was this?" | User's banks / Cash |

### 4.4 Behaviour

- **Ask only when needed:** user rule or merchant confirmed twice: apply silently. Confident suggestion: apply and mark "Guessed" (small dot on the row). Ask only when confidence is low and the item changes totals or is ₦2,000 or more. [needs backend]
- **Grouping:** items with the same counterparty and same question type become one card.
- **Learning:** the same answer twice for a name creates a rule automatically; toast "Done. We'll do this every time. Change". [needs backend]
- **Undo:** every answer shows "Saved. Undo" for 10 seconds; answers can be changed from Transaction detail.
- **Skip:** moves the card down. Category cards skipped for 14 days resolve to the best guess (Guessed) and leave the queue. Priority 1 and 2 cards stay.
- **Never a gate:** Home, Money and Plan always work; numbers include guesses and say "Includes [n] guessed categories".
- **Offline:** answers save on the phone and sync later, with no error shown.
- **Done state:** check mark with burst, "All sorted." / "Your numbers are up to date.", a summary (Answered, New rules made, Filed for you, no questions), "Back to Home".
- **Empty state (opened with nothing to do):** same done screen without the summary.

### 4.5 Interruptions

| Priority | Home badge | Push | 8 pm summary |
| --- | --- | --- | --- |
| 1 | Yes | Once, no amount on lock screen when amounts are hidden | Yes |
| 2 | Yes | No | Yes |
| 3 | Count only | No | If 3 or more waiting |
| 4 | No | No | No; shown after the others |

At most one push a day across the whole app (security events excepted); none on a day the user already cleared the queue.

### 4.6 Gestures

Buttons are the path. Swiping a card off means Skip only. No other gesture on this screen.

### 4.7 Mockup

Canvas "Automonie Action Center" (four phone artboards in Dark): own-move card, grouped category card, cash card, all sorted. See the reference image sent with this brief (`Action Center: one question, one tap`): Quick look 1 of 3 "Did this go to another account of yours?" with the Access→OPay circles and ₦84,000; 2 of 3 grouped Shoprite category card; 3 of 3 cash-withdrawal category tiles; done state "All sorted."

### 4.8 Acceptance tests

| # | Test | Expected |
| --- | --- | --- |
| A1 | Import 3 months for a test user | 7 or fewer cards; everything under ₦2,000 Guessed |
| A2 | Answer "Food" twice for the same merchant | Rule created with toast; third item never asked |
| A3 | Tap Undo within 10 s | Item returns to the queue as it was |
| A4 | Skip a category card, advance the clock 14 days | Card gone, item marked Guessed |
| A5 | Answer offline, reconnect | Answer synced; no error shown |
| A6 | Heading counts | Equal to the number of cards |
| A7 | Two pushes due on one day | Only one sent; the other in the 8 pm summary |
| A8 | Screen reader | Reads question, item, answers, Skip, in that order |

---

## 5. Block 3: Categories, catalogue and clean names (sections 12 and 13)

### 5.1 Categories [needs backend]

Use the proposed list in section 13 of the research doc, plus income categories: Salary, Allowance, Business and hustle income, Money from people, Interest, Other income. Compare with the current list; migrate existing transactions with a mapping table. Each category: id, name, group, Ionicon, colour token per theme, effect, budgetable. Rename keeps the id; hide keeps history; merge and delete have a 24-hour undo. Tests C1 to C3.

### 5.2 Merchant and subscription catalogue [needs backend] [config]

One server-delivered table, updated without an app release: service, category, name patterns, subscription-only, cadence, plans and prices with a last-checked date, cancel link, logo. Seed from section 12 and 13.2. Patterns marked unverified must be confirmed against real alerts before they auto-apply.

Logos: fetch once from a logo provider (Logo.dev or Brandfetch; Clearbit's free logo API has shut down), store on our own storage if the provider's terms allow, serve from there. Never show a logo on a guess: only on a catalogue match or user confirmation. Fallback: category icon, then initial. Logos sit on a white rounded tile in Dark and Teal.

### 5.3 Clean names [needs backend]

Match order: user rule, learned merchant, catalogue, close spelling (suggest only). Strip channel words, terminal IDs, long digits, references and bank codes; brand spelling on a catalogue match; Title Case for people; if nothing readable remains, "Card payment" or similar. Users can rename a merchant once for everywhere. Tests M1 to M4.

### 5.4 Fix the Money list now

"Vat", "Stamp Duty Charge For Trxn...", "POS PUR 11 PLC FESTAC 23RD...", "-Transfer Fr..." must all become clean names or fold under their parent transfer.

---

## 6. Block 5: Subscriptions and recurring money (sections 12, 13.3 to 13.6)

### 6.1 Subscriptions [needs build] [needs backend]

- Plan, Coming up: Subscriptions row, up to 5 overlapping logos, "[n] subscriptions · about ₦[X] a month". Replace the purple date tiles with logos and text dates.
- Subscriptions screen: "₦[X] a month · ₦[Y] a year"; rows by next charge (logo, name, plan guess, "₦[X] · Renews [date] · [bank]"); sections Active and Stopped; badges "Price up ₦[X]" (old price struck through), "Charged twice", "Renews tomorrow", "Not charged this month".
- Detail: three-figure strip (Spent this month · Times charged · Usual amount), charge history, "Remind me before it renews", "How to cancel" (steps and the service's own link), "I cancelled this", "Not a subscription".
- Add by hand from a searchable logo grid; prefill from config.
- Import reveal: "We found [n] subscriptions costing about ₦[X] a month."
- Detection: catalogue (first charge for subscription-only services), pattern (amount within 10%, or 15% on dollar cards; 28 to 31, 6 to 8 or 360 to 370 days; two hits then ask), Google "GOOGLE *[product]" (ignore TEMPORARY HOLD), Apple "apple.com/bill" (ask which service once).
- DStv and GOtv renamed packages from 5 Nov 2026 (Access to Starter, Family to Select, Compact to Sports, Compact Plus to Premium): plan aliases in config, so the rename is not a price rise.
- Alerts within the one-push limit: renews tomorrow (default on for yearly and ₦5,000 or more), price up, charged twice.
- Tests S1 to S8.

### 6.2 Regular payments, electricity, irregular income, owed to me

Build 13.3 to 13.6 exactly as specified, with tests O1 to O3, E1, R1. Banned words still apply: no "save automatically", "auto-save", "autopay".

### 6.3 Remaining gaps

Build 13.7 to 13.12 (holds, dollar amounts, formatting, screen readers, web parity, minimum version and signed remote parser rules). Tests H1, H2, D1, D2, V1, V2.

### 6.4 Screenshots setting (replaces Round 4) [needs build]

- Default: screenshots allowed everywhere.
- You, Privacy and security: switch **Block screenshots**, off by default. Helper: "Stops screenshots and screen recording in Automonie. The app preview in your recent apps is also hidden."
- On: set the secure-window flag on every screen (blocks screenshots and recording, blanks the recent-apps preview).
- Exception: sign-in and code-entry screens are always blocked, because they show codes. (Plo can remove this exception.)
- Test: default install takes a screenshot of Home; switch on, screenshot is blocked and recent-apps preview is blank; switch off, screenshots work again.

---

## 7. Block 6: Themes and interaction standards (sections 4 and 5)

### 7.1 Token changes [needs build]

| Theme | Token | From | To |
| --- | --- | --- | --- |
| Light | primary | #118f92 | #0e7c7f |
| Light | income | #059669 | #047857 |
| Light | warning | #d97706 | #b45309 |
| Light | textFaint | #94a3b8 | #64748b (on surface only) |
| Dark | textFaint | #6b7280 | #7c8696 |
| Teal | textFaint | #6b7280 | #8b93a1 |
| All | heroStart | #139DA0 | #0e7c7f, or a 20% black overlay under hero text (Plo to choose) |
| Dark, Teal | heroBorder | none | white at 8% |
| All | onPrimary on mint | white | #0B0E11 |

Add tokens: borderStrong, onPrimary, onHero, warningSurface, danger, overlay, skeleton, chart1 to chart5, chartGrid, chartProjection, categoryTint.

### 7.2 Theme rules

- Lint rule: no colour literals outside the theme file. [needs build]
- Automated contrast test over every text and icon pair in all three themes; fails the build below 4.5:1 (text) or 3:1 (large text, icons, input borders, chart marks). [needs build]
- Status is never colour alone: icon plus word.
- Shadows only on Light; Dark and Teal use border and surfaceAlt.
- Status and navigation bar icons set per theme on every screen and modal.
- Fix the + sheet: one tint for all icon tiles (single-accent rule); add Plus tags to Scan a receipt and Ask about your money. Decide on "Speak a transaction": add to spec or hide.
- Daily recap must not open as a modal over Home: make it a card in the Automonie read.
- Splash: mint logo on black, or the signature animation.

### 7.3 Interaction standards

| Area | Standard |
| --- | --- |
| Touch targets | 48 by 48 dp minimum (raised from 44); hitSlop on small icons; 8 dp between targets |
| Safe areas | Edge to edge; all screens and sheets pad by system insets; no hard-coded bar heights |
| + button | Scroll content ends with bottom space = nav height + 26 + bottom inset + 16; sheets open above the nav |
| Keyboard | Focused field and main button stay visible; Next moves fields; tap outside closes |
| Nested scroll | One FlashList per screen; no vertical list inside a vertical scroll view; horizontal pagers lock direction |
| Row swipe | Starts after 15 px mostly horizontal, fails on 10 px vertical; always a tap alternative |
| Back gesture | No custom swipe starting within 24 dp of the screen edges; back closes keyboard, then sheet, then card stack, then screen |
| Small screens | Design at 360 px; no fixed-height text boxes; buttons wrap to two lines; hero amount may shrink to 70% then wraps |
| Large text | Up to 200% font scale with no overlap or cut-off digits |
| Loading | Skeletons sized like content; reserved image space; "3 new" pill instead of pushing the list |
| Totals | Full amounts in totals ("₦15,200"), short forms only on charts |

### 7.4 Gestures (section 7)

Swipe left on a list row: quick actions (Categorise; never delete). Swipe a card off: Skip. Swipe sideways on a pager: next page (with dots and a peeking next card). Swipe down on a sheet: close. Long press: select (plus a "Select" button). Hold: peek hidden amounts (plus the eye). Pull down: refresh on Home and Money only. Never by swipe: delete, Not a transaction, unlink, cancel Plus, turn a source off. Teach row swipe once: the first uncategorised row nudges left 24 px for half a second.

### 7.5 Step budgets (fail review if exceeded)

See 0 taps: safe to spend. 1: answer a card, sort a merchant group, mark own move from a card, hide amounts, undo. 2: categorise from Money, paste an alert, create a budget from a category total, turn on bank texts, share the recap. 3: log a cash spend, share from a bank app, turn on notifications. 4: upload a statement.

### 7.6 Acceptance tests

Every screen in the QA list (section 4 of the research doc) passes in Dark, Light and Teal, at 360 px, at 200% font scale, with gesture and 3-button navigation, on a 3 to 4 GB RAM Android release build. Screenshot grid stored per release (Maestro). [needs build]

---

## 8. Block 7: Onboarding (section 8)

Six acts, one question per screen, progress bar by act, every skip lands in "Finish setting up":

1. Hello: the signature animation (a messy bank text turns into a clean transaction). Get started / I have an account.
2. About you, no account yet: first name; Student, Corper, Working, Hustling, Between things; pick up to 3 goals; banks and wallets logo grid (OPay, PalmPay, Moniepoint, Kuda first). Corper prefills the ₦77,000 allowance.
3. See it work: a sample alert is sorted; one sample quick-look card ("What was ₦4,500 at Mama Put?"); small celebration.
4. Make it yours: create account; birthday day and month (optional).
5. Connect: SMS pre-permission (approved spec), notification access with a 3-frame animation and auto-advance on return, confirm bank apps.
6. Your money, live: 3-month import with live counter; reveal ("We found [n] transactions across [n] banks"); subscriptions reveal; first quick look (7 or fewer); income (detected or typed); safe to spend reveal with count-up; one-tap first budget; daily summary permission ask ("Want a short money check at 8 pm?").

Then Home with at most three coach marks (hero, Action Center line, + button) and the Round 5 quests.

Paths that must work: declines bank texts (no guilt; share and statement practice); import finds nothing (statement prompt); iPhone (share and statement path, same reveal); corper with no allowance yet ("Did your allawee land?" in the 25th to 30th window); leaves halfway (resume where they left); returning user (straight to Home, "Turn on tracking on this phone" card).

Acceptance: 70% of new installs reach the safe to spend reveal on day 1; 75% turn on a source; 60% answer the first real quick look; no single screen loses more than 8%. Instrument every step. [needs backend]

---

## 9. Block 8: Every action, every response (section 10)

### 9.1 Motion and haptic vocabulary [needs build]

| Name | Duration | Haptic (expo-haptics) |
| --- | --- | --- |
| Press | 80 to 120 ms, scale 0.97 | None (selection on chips) |
| Settle | 200 to 280 ms, ease out | None |
| Confirm | 300 ms | Light impact |
| Celebrate | 800 to 1,200 ms | Success notification |
| Warn | 300 ms | Warning notification |
| Count | 600 ms | None |

Crisp effects only, never long vibrations. With "Remove animations" on, motion becomes a fade and celebrations a static badge. Sound off by default.

### 9.2 Responses

Implement every row of the response table in section 10 of the research doc (open the app, new transaction, answer a card, clear the queue, swipe, save manual entry, paste, upload, turn on a source, source stops, budget at 80%, over budget, goal reached, hide amounts, delete, search with no result, Ask, payday, server error), with its copy and failure state.

Rules: no spinner over 300 ms without a skeleton or a step label; no dialog for an error fixable on the same screen; every error names the next step and has a button.

---

## 10. Block 9: Low support (section 6, building on Round 5)

- Missing payment finder on Money and in Help. [needs build] [needs backend]
- Tracking-stopped detection per bank against its usual gap; amber status with "Fix it" opening battery and app settings; link to per-brand steps. [needs backend]
- "Why is this here?" on Transaction detail (sources it came from). [needs build]
- Number explainers: tap any total or safe to spend to see how it was worked out. [needs build]
- Statement reconcile failures name the gap. [needs backend]
- Plan page billing clarity (next charge, how to cancel via Google Play). [needs build]
- Known-issue banner from a server flag. [needs backend] [config]
- "Report a problem" from Transaction detail, the Action Center and each source row, attaching IDs and status, never raw text unless ticked. [needs build]
- Practice mode includes one sample quick-look card.
- Ticket tagging by reason; weekly loop. Measure tickets per 100 weekly active users.

---

## 11. Block 11: Brand moments (section 11)

Build after everything above is stable:

- Voice: plain labels, playful headlines, toasts, empty states and pushes. Catchphrase candidates for testing: "Where my money go?", "Money don land", "Sapa radar". Kind, never shaming.
- Signature animation used in welcome, + sheet, new-transaction arrival and marketing (Reanimated, plus Lottie or Rive for illustration).
- Mascot reacting to state; never beside errors about missing money or on permission and security screens.
- Monthly recap stories (no naira amounts), personality card, levels with playful names, goal cards (amount off by default), NYSC year recap. Every shared card carries a small automonie.com mark.
- Home screen widget: safe to spend for today, respecting hidden amounts. [needs build]
- Gentle streak with one free skip a week and no guilt push.
- Unlockable themes and mascot outfits as quest rewards.
- Calendar moments planned a month ahead: payday windows, 1st of month, Valentine's, school resumption, Black Friday, Detty December.
- "Do again" row on Home (Chowdeck's "Order again" pattern): last cash log, last paste, last budget check.

---

## 12. Definition of done for Round 6

- All tests in this brief and in the research doc pass: T1 to T19, A1 to A8, C1 to C3, M1 to M4, S1 to S8, O1 to O3, E1, R1, H1, H2, D1, D2, V1, V2, plus the screenshot setting test.
- B1 to B6 fixed and verified on the screens they appeared on.
- Every screen passes the theme and interaction QA list.
- No hex colour outside the theme file; no em dash or emoji in UI strings (add a check to CI). [needs build]
- Release build meets Round 4 performance budgets: cold start under 2 s, tab switch under 100 ms.

---

## Suggested sessions (added, so this can be worked the way every other round in this project has been: fresh session per slice, Trello card per slice, budget then check `get_usage`)

This brief's own build order (section 1) is sequential and gated on tests - blocks 2 to 11 genuinely depend on what came before. That is different from every other round so far, where sessions could run in parallel. Treat it as a pipeline, not a menu: one session per block, in order, each one reading this file plus the research doc's matching section before starting. A session should stop and report rather than guess when a prior block's acceptance tests have not actually been run against a live DB or a phone - "sits on top of it" blocks (3 onward) cannot be honestly verified otherwise.

| Session | Block(s) | Rough budget | Notes |
| --- | --- | --- | --- |
| R6-1 | Block 1 (B1-B6 bugs, T19) | 4% | Do first regardless of anything else; these are today's trust-breaking bugs |
| R6-2 | Block 2 (Observation model, dedupe, linking) | 10%+, likely needs its own multi-session split (data model, then merge ladder, then linking, then statement reconcile) | The foundation; everything after reads from this |
| R6-3 | Block 3 (categories, catalogue, clean names) | 6% | Needs R6-2 committed |
| R6-4 | Block 4 (Action Center rebuild) | 8% | The mockup image is attached to this brief in the repo's session notes; needs R6-2 and R6-3 |
| R6-5 | Block 5 (subscriptions, regular payments, gaps 13.3-13.12) | 8% | Large; may itself need 2-3 sessions |
| R6-6 | Block 6 (theme tokens, contrast, interaction standards) | 6% | Can start once the data/screen work above it is stable; touches every screen file so run alone |
| R6-7 | Block 7 (onboarding rebuild) | 6% | Needs blocks 2-5 |
| R6-8 | Block 8 (motion/haptics/responses) | 4% | Needs screens to exist |
| R6-9 | Block 9 (low-support features) | 5% | Builds on Round 5's support work |
| R6-10 | Block 10 (remaining gaps 13.7-13.12, if not folded into R6-5) | 3% | |
| R6-11 | Block 11 (brand moments) | 5% | Last, as the brief says |

Total is far beyond one week's usual budget rhythm (see `round5-PLAN.md`'s usage rules) - expect this to run over multiple weeks, same as the Play Store push ran over `round7-audit.md` through `round9-...md`. Do not start R6-2 until Block 1 is committed and its fix verified; everything from R6-3 onward genuinely cannot be honestly built on a foundation that has not shipped.

## Progress
(Each session appends: session, commits, what was tested and how, what's left.)
