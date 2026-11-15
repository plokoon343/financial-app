# Round 10: categories, queue, global UI, announcements, first month, email handoff

Saved from chat, 15 Nov 2026. Source of every decision: the doc "Automonie Round 10: Design, Onboarding, Announcements, Categories" (sections 1 to 5) and the Design canvas "Automonie Round 10".

Usage rules as before: fresh Sonnet session per part, `get_usage` first, commit own files, one publisher. Parts are in build order; do not start a part until the one before it passes its tests.

Hard rules carried over: AI never decides amount or direction; never show "Transfer" as a spending category; no raw narration as a title; no emoji or em dashes in UI copy; semantic colour tokens only; undo instead of confirm; trust copy true in code.

Flags: [mobile] finpilot-mobile, [backend] financial-app/backend, [web] financial-app/frontend, [native] needs an EAS build, not an OTA.

## Part A: Categorisation (doc section 5) [backend] [mobile] [web]

Why: the keyword categoriser matches words inside other words. 13 of 17 realistic narrations were misfiled on 15 Nov ("rent" in "current", "vat" in "private" and "Salvation", "rida" in "Farida", "cot" in "Scott", "mobil" in "mobile", "train" in "training"). And the call sites call `categorizeTransaction` directly, so user rules, contact labels and learned merchants apply only on some paths. (The brief says 16 call sites; `grep -c "categorizeTransaction(" backend/server.js` reports 14 on 15 Nov, so grep the whole backend, not just `server.js`.)

A1. Whole-word matching. In `lib/categorize.js`, match every keyword with the same edge-anchored pattern `lib/merchants.js` uses (`b()`), not `lower.includes`. Spell out shortened keywords that relied on partial matching (for example "stamp dut"). Add "allowance", "allawee", "nysc" to income as Allowance.

A2. One entry point. New `lib/categorise.js` exporting `categorise({ txn, user, maps })` returning `{ category, source, guessed }`. Replace all direct calls (grep `categorizeTransaction(`). Order, first hit wins:

1. user rule (merchant or person)
2. contact label (relationship or set category)
3. special kinds from existing linking (own move, reversal, fee, cash, loan): these set the kind, not a spending category
4. learned merchant (answered twice)
5. approved global consensus for the merchant key
6. merchant catalogue
7. whole-word keyword rules
8. person detection via `cleanName` `counterpartyType === 'person'`: Sent to people (out) or Money from People (in)
9. channel default: unknown card or web purchase, Other with `guessed: true`
10. AI suggestion (stripped data only), `guessed: true`

A3. Retire "Transfer" and "ATM/POS" as visible categories. Remove both from `constants/categories` on mobile and web. Extend `POST /api/admin/reclassify-kinds` (dry run by default, `apply=1` to write) to move machine-set rows only (never a user's choice, never reviewed rows): person transfers to Sent to people, cash withdrawals to an own move into Cash, card purchases through `categorise`. Report counts per change before applying; the owner approves the apply.

A4. One table. Move keyword lists from `categorize.js` into `data/merchantCatalogue.json` (or a sibling `keywordRules.json` in the same remote-rules delivery), so fixes ship as data. Resolve the DStv/GOtv conflict: Subscriptions everywhere (they are Utilities in `merchants.js` today).

A5. Store and show the reason. New field `categorySource` on transactions (rule, contact, learned, consensus, catalogue, keyword, person, default, ai). Transaction detail shows "Why this category?" with one line per source (canvas artboard "Transaction detail: why this category"):

- rule: "Your rule"
- contact: "[Name] is [Family]"
- learned: "You picked this twice"
- consensus or catalogue: "[Merchant] is always [Category]"
- keyword, person, default, ai: "Our guess", with an amber "Check it"

A6. Measure. Labelled test set of 300 redacted real narrations under `backend/test/fixtures/categories.json` (no names, account numbers or real amounts). CI fails below 90% correct. `/api/admin/ingestion/accuracy` adds per-category accuracy and share of rows decided by each source.

Tests (all must pass): the 17 narrations in doc section 5 with their "Should be" values; K1 to K5 in doc section 5; the same user rule applies on SMS, notification, email, share, statement and manual paths; no row ever comes back with category "Transfer" or "ATM/POS".

## Part B: Quick look queue count (doc section 1, second device check Q1) [backend]

1. First, measure: log the queue for the owner's account broken down by card kind and priority. Write the numbers into `docs/briefs/round10-queue.md`. Do not change the cap before this.
2. For each priority 1 or 2 kind with more than 2 cards, decide from the data whether it is truly priority 1 or 2 (fraud risk or changes totals) or a priority 3 card mislabelled. Re-label the mislabelled ones in their producers in `lib/actionCards.js`.
3. Target on the owner's real data: 5 or fewer cards on a normal day. Priority 1 stays uncapped.

Test: the owner's queue count before and after, by kind, recorded in the report.

## Part C: Global UI fixes (doc section 1) [mobile] [web]

- C1 Naira glyph [native]. Poppins has no U+20A6 (R7 audit, fontTools). Ship a Poppins build with a matching naira glyph in every weight used (or a one-glyph fallback font per weight, set as the first fallback). Check on web and Android that the sign renders at the same weight as the digits.
- C2 Tabular figures on every amount (`fontVariant: ['tabular-nums']`).
- C3 One hero per screen: Home safe to spend, Money month total (full amount, no short form), Plan forecast. Other sections become plain rows without card boxes.
- C4 Primary actions bottom, full width, 56 tall.
- C5 Accessibility labels: Sign In, "Create one" (and point it to `/register`), web gear icon (R7 findings 4, 5, 8).
- C6 + sheet: one tint for all tiles; Plus tags on Scan a receipt and Ask; order Paste a bank alert, Add manually, Log cash, Upload a statement, Scan a receipt, Ask.
- C7 Profile: drop the clipped plan label from the email row (R7 finding 7); remove the birthday prompt from Profile (second device check Q2). Existing users get one Home card with "Don't ask again".
- C8 Automatic tracking: each source row shows last alert time in words and an amber "Fix it" when stale.

Tests: screenshots of Home, Money, Plan, Transaction detail and + sheet in Dark, Light, Teal at 360 px and 200% font scale; contrast audit stays green; no amount shows short form outside a chart.

## Part D: Announcements (doc section 4) [backend] [web] [mobile]

Model `Announcement`: title (60), body (240 card; longer email body allowed), button label and link, kind (update, feature, event, maintenance, outage, security, must_update), channels (card, email, fullscreen), audience filter (plan, audience, platform, app version range, banks, signup date range, active or inactive in last N days, beta testers), startsAt, endsAt (required for cards), status (draft, scheduled, live, ended), createdBy, approvedBy, stats (delivered, seen, tapped, dismissed, emailOpened). Per-user state: seen, tapped, dismissed, fullscreenShown.

Rules:

- Full-screen only for outage, security, must_update. Security and full-screen need a second superadmin's approval.
- One card on Home at a time, directly under the hero; priority by kind, then newest. Also listed in the bell.
- Email via Brevo. Feature and event only to users who allowed product emails; service kinds to everyone in the audience. At most one announcement email a week per user, service kinds excepted.
- Never sends a push. Never covers the numbers. Every card has an end date.

Endpoints: `GET /api/announcements/active` (the user's current card and any unread full-screen), `POST /api/announcements/:id/{seen,tap,dismiss}`, admin CRUD under `/api/admin/announcements` (superadmin and newsletter editors), `POST /api/admin/announcements/:id/test` (sends card preview and email to the sender), `POST /api/admin/announcements/:id/approve`, `POST /api/admin/announcements/:id/end`, `GET /api/admin/announcements/audience-count` for the live count.

Admin composer [web]: canvas artboard "Admin: announcement composer". Kind chips, title, message, button, channels (full-screen disabled unless the kind allows), audience, start and end, live preview in Dark, Light, Teal and email, "Send me a test" required before scheduling email or full-screen, stats after sending, "End now".

App [mobile]: card component under the hero (canvas "Home with announcement slot"), full-screen screen (canvas "Critical announcement"), bell entries. Must update reuses the minimum-version screen.

Migrate: the PIXLCO card (`lib/promo.js`, `lib/promo.ts`) and the known-issue banner (`/api/global-banner`, `GlobalBanner.tsx`) become announcements; retire the old endpoints once the app version that reads announcements is the minimum.

Templates: feature, vote, maintenance, bank slow, must update, policy change (copy in doc section 4).

Tests: audience filter returns the right users for each filter; a card past endsAt never shows; dismissed never returns; full-screen shows once; a feature email skips users without product-email consent; second approval enforced; "End now" removes it on next fetch.

## Part E: The first month (doc section 3) [backend] [mobile]

Add a server-side journey scheduler that picks at most one planned moment per user per day, from the account's created date, skipping any moment whose job is already done. Reuse existing pieces: nudges (`data/nudge-copy.json` keys such as `payday_detected`, `budget_80`, `weekly_recap`, `month_start`, `inactive_5d`), recaps, quests, `betterMonth.ts`.

Moments (doc section 3 table): day 0 evening summary; day 1 "Here's what we found"; day 2 first rule toast; day 3 first budget; day 4 cash check; day 5 missing bank check; day 7 weekly recap; first payday or corper allowance window; day 10 Ask sample for Free users; day 14 two-week check or win-back email; day 21 Sapa radar (income set) or "How long will the money last?" (students); day 25 to 30 better than last month (only if real); month end recap; month end + 1 plan next month.

Rules: one planned moment a day, one push a day across the app, quiet 10 pm to 8 am; moments configurable from the server without a release.

Tests: a simulated 30-day account receives each moment once on its day; a user who already set a budget never gets the day 3 card; never two pushes in a day; corper path replaces payday.

## Part F: Email handoff and the Gmail notification experiment (doc section 2) [mobile] [web] [backend]

F1 Finish on your computer. Replace the mobile step-by-step Gmail guide with canvas "Email: finish on your computer": QR code, "Email me the link", "Copy link", and three live ticks (link opened, Gmail confirmed, first bank email). New web page `automonie.com/setup/email?t=<one-time token>` (token valid 24 hours, single user, never shows other data): private address prefilled, step 1 add forwarding address, step 2 confirmation code shown live (round 9 already detects it), step 3 download and import the filter file. Remove the "Desktop site" instructions from the phone.

F2 Test a pre-filled Gmail filter link. Try whether a Gmail web URL can open filter creation with the sender list prefilled. If it works, make step 3 one click; if not, keep the file import. Record the result in `docs/briefs/round10-email.md`.

F3 Experiment, off by default [native]. "Bank emails (from Gmail notifications)": in `modules/automonie-capture`, when this switch is on, read Gmail notifications, keep only those whose sender matches a verified bank sender (`bank_email_senders`), drop everything else on the phone before any upload, parse with the same rules as bank-app notifications. Own pre-permission screen; Gmail stays off the "Other apps we found" list. Ship to users only if 5 test phones over 7 days capture at least 80% of bank alert emails with correct amounts; write the results in `docs/briefs/round10-email.md`.

Tests: token expires and is single-use; ticks update on phone and web; F3 never uploads a non-bank notification (unit test on the filter with mixed notifications).

## Done means

- All tests above pass; backend `npm test`, web build, mobile `tsc` and lint clean.
- Reports written: `round10-queue.md`, `round10-email.md`.
- Phone check by the owner on the build that carries C1 and F3.

## Progress

- 15 Nov 2026: brief saved. Part A next.
- 15 Nov 2026, Part A built (categorisation), not yet applied or shipped. Backend `npm test` 68/68, web build passes, mobile `tsc` clean and lint 0 errors.
  - A1/A4: `lib/categorize.js` now matches every keyword whole-word (same edge anchor as `merchants.js`); lists live in `backend/data/keywordRules.json` (hot-reloaded on file change, ships as data on deploy). Added allowance/allawee/nysc -> Allowance. DStv/GOtv/Startimes/Multichoice are Subscriptions in `merchants.js` too. Fixed a bug found by the fixtures: `merchants.js` matched bare "top up" as airtime, so "Target savings top up" filed as Airtime.
  - A2: new `lib/categorise.js` with the 10-step order. Every direct call is gone (server.js 14 sites, `alertParser.js`, `reclassify.js`; a test fails if one comes back). SMS, notification, email, share-confirm and pending-confirm all land in `ingestAlert`, which now loads the user's maps; statement upload, SMS parse, Mono and `/api/import-transactions` use `applyCategorise`; manual `POST /api/transactions` decides when no category is sent. Mobile on-device parser no longer emits Transfer/ATM-POS (it says Other and the server decides on import). Old `applyLearnedCategories`/`applyGlobalCategories` removed.
  - A3: Transfer and ATM/POS are `retired` in `backend/constants/categories.js` (kept so old rows resolve), removed from web and mobile lists. `POST /api/admin/reclassify-kinds` now also calls `retireRow` and returns `counts` per change; still dry run unless `apply=1`. NOT applied to production.
  - A5: `categorySource` on Transaction, set on every path; PUT and apply-rule set it to `rule`. "Why this category?" with the brief's copy on web (`TxnDetail.jsx`) and mobile (`transaction.tsx`), amber "Check it" on guesses.
  - A6: `backend/test/fixtures/categories.json`, 357 labelled redacted rows (above the 300 target, all distinct), `lib/categoryAccuracy.test.js` fails below 90% (first run 96.4%, 100% after fixing the real faults it found; I tuned code against these rows, so a fresh unseen set will read lower). `/api/admin/ingestion/accuracy` adds `categories.byCategory` and `categories.bySource`.
  - Questions and readings I chose (all keep existing data intact):
    1. The doc's section 5 (the 17 narrations and K1 to K5) is not in the repo and I could not open it. `lib/categorise.test.js` carries my own 17 narrations built from the misfires named in this brief, and K1 to K5 as the five precedence cases. Please check them against the doc's "Should be" column.
    2. "Sent to people" is not a stored category anywhere; the web only relabelled bare Transfer rows with it. I added it as a People-group category (not budgetable, not consensus-eligible) and store it for person transfers out. Money from People already existed.
    3. "Own move into Cash": there is no Cash account to move into, so a withdrawal becomes the existing `cash_withdrawal` kind (out of spending, feeds Cash tracking) with category Other.
    4. "Learned merchant (answered twice)": there is no category-level answer count. I used the merchant-name rule (`MerchantNameRule`, confirmations >= 2) and take that merchant's catalogue category. "User rule" is the existing `LearnedCategory` row.
    5. "Machine-set only": rows have no marker for a user's own category on old data, so `retireRow` skips reviewed rows, cash breakdowns, `source: manual` and any row whose `categorySource` is rule/contact/learned. Run the dry run and read `counts` before approving.
    6. Step 10 (AI) is supported only when a caller passes a validated `aiSuggestion`; nothing passes one yet.
    7. The six-path rule test is unit plus source-level (no Mongo here); I added the same checks to `scripts/api-regression.js` but could not run it. Run it against a `_test` database before the next release.

- Part B (queue count): measured, report in `docs/briefs/round10-queue.md`. The owner's account is not in the local database, so the measurement used the 800-transaction fixture account: `refund_match` produced 104 priority-2 cards (exempt from floor and cap). Re-labelled to priority 3 in `lib/actionCards.js`, pinned in `actionCards.test.js`. Target of 5 or fewer is met on the fixture but NOT verified on the owner's real data; run the same measurement on it once available. Backend only, tests 68/68.

### A3 backfill: production dry run, 15 Nov 2026 (NOT applied)

`POST /api/admin/reclassify-kinds` with no `apply`, against production on version `2549d7b`. Scanned 4854 rows across all users, 2857 would change:

| Change | Rows |
|---|---|
| Transfer to Other Income | 1303 |
| Transfer to Other | 1195 |
| Transfer to Sent to people | 138 |
| Transfer to Other (own move) | 81 |
| ATM/POS to Other | 65 |
| Transfer to Money from People | 58 |
| kind: reversal to income | 8 |
| kind: reversal to expense | 7 |
| ATM/POS to Sent to people | 4 |

`ownMoveChanged` was 0.

Read before applying: only 196 of 2857 rows land on a person category (Sent to people, Money from People). 2498 become Other or Other Income, which clears a retired label without adding information, and no cash withdrawal became an own move into Cash, although A3 expects that. On real production narrations the person and cash detection is firing far less than it does on the tuned fixtures, so applying now would file 2498 rows as Other and leave a better backfill to re-touch them later. Those rows stay machine-set, so a later pass can still move them, but the owner should decide whether to improve detection first. Not applied; waiting on the owner.

### Detection improved, then re-measured (version 480cd05)

Tuned against the 249 rows still carrying retired labels on the owner's own account (fetched through that account's own `/api/transactions`, so no other user's narrations were read). Three real shapes were missing:

- The sender named BEFORE the verb: "<name> has sent you", which OPay and Moniepoint use and which has no "to" or "from" for the person reader to find. Now handled, with "Paystack has sent you" and "OPay has sent you" pinned as NOT people.
- A name followed by masked account digits or a reference blob ("TRANSFER TO <name> OPay *****1234/TRF|...") left `<name> *****` as the candidate, which failed the name-shape test. The noise is stripped before the name is judged.
- "POS WD <agent>", the abbreviation real alerts use for cash taken at an agent. `CASH_OUT` knew "ATM" and "cash withdrawal" but not this, which is why `ownMoveChanged` was 0. Only the abbreviation was added: "POS WITHDRAWAL SHOPRITE ABUJA" is labelled Groceries in the fixture, and a named shop on the row should keep its merchant category. Both are pinned by tests.

Effect on the owner's own account: Money from People 25 to 28, Other 19 to 15, Other Income 14 to 11, and 3 rows correctly became cash withdrawals. The 33 ATM/POS rows that remain are genuine `POS PUR` and `WEB PUR` against unreadable terminal ids, so Other is the true answer there.

Effect on the whole production dry run, same 4854 rows scanned and 2857 changed:

| Change | Before | After |
|---|---|---|
| Transfer to Other Income | 1303 | 1300 |
| Transfer to Other | 1195 | 1191 |
| Transfer to Sent to people | 138 | 139 |
| Transfer to Money from People | 58 | 61 |
| Transfer to cash withdrawal (Other) | 0 | 3 |
| ATM/POS to Other | 65 | 65 |

About 10 rows of 2857 moved. The shapes that dominate the other users' 2491 Other rows are not the shapes on the owner's account, and identifying them would need a narration census across accounts the owner has not asked for. Stopping here is a judgement, not a completed job: the backfill clears retired labels, and roughly 2500 rows will read Other because the narration genuinely names no one.

One argument for applying as it stands: the web and mobile pickers no longer offer Transfer or ATM/POS, so those rows currently show a category the user cannot choose again. Still not applied; the owner decides.

### Part C: global UI fixes, 15 Nov 2026

Mobile `npx tsc --noEmit` clean, `npx expo lint` 0 errors (13 warnings, all pre-existing). Web `npm run build` passes. Backend untouched. Contrast audit (`scripts/contrast-audit.ts`) was 148 pass / 2 fail on Light `textFaint` before this round's work; fixed (`#64748b` to `#5a6a80`), now 150 / 0. Nothing pushed, no EAS build, no OTA.

| Item | State | Evidence |
|---|---|---|
| C1 naira glyph | Done in code, web verified, Android NOT checked | fontTools confirmed U+20A6 absent from all six stock Poppins weights (300-800) and from the Google-hosted web Poppins. `finpilot-mobile/scripts/build-poppins-naira.py` builds patched Poppins per weight (N plus two bars sized from that weight's stem, so it carries the same weight as the digits). One approach for both platforms: mobile loads `assets/fonts/Poppins_*.ttf` under the same family keys; web self-hosts `public/fonts/*.woff2` and no longer loads Google's Poppins. Web screenshots show the sign at digit weight. See "Owner check on the Android build" below. |
| C2 tabular figures | Done | Finding: stock Poppins has NO `tnum` feature (digits are proportional: "1" is 320 units, "0" is 628), so `tabular-nums` alone did nothing. The patched fonts add a real `tnum` (all digits 640 wide). Mobile: `text.tsx` sets `fontVariant: ['tabular-nums']` on every Text and TextInput. Web: `font-variant-numeric: tabular-nums` on `body`, and buttons/inputs now inherit the font (they fell back to Arial). Date column in the Money screenshot lines up. |
| C3 one hero per screen | Mostly already true; full amounts done; two boxed nudges left | Home already has one HeroCard (safe to spend) and Plan already has one card (forecast); both lower sections are plain rows. Money already opens with a plain month total. The short form is gone: `formatNaira` (mobile) and `fmtNaira` (web) always return the full amount; `compactAxis` / `fmtNairaCompact` exist for chart axes only; the Profile "Set aside for goals" tile and `shortNaira` no longer abbreviate. Left as is: the boxed "needs a category" and cash rows on Money, and the conditional cards on Home; I could not judge them without a device and did not guess. |
| C4 primary action bottom, 56 tall | Partly done | `Button` is now `minHeight: 56`, `alignSelf: 'stretch'` everywhere. Save on `add-transaction` moved to a pinned footer. Other screens (goals, budget sheets, scan) still have the button inside the scroll body; not moved, no way to check each on a device from here. |
| C5 accessibility labels | Done | `Button` now sets `accessibilityRole="button"`, `accessibilityLabel={title}` and busy/disabled state (covers Sign In and every other Button). Login "Create one" has role link and label and already routed to `/register`. The "gear" in R7 finding 8 is the sun/moon theme toggle on the web auth screens (there is no gear on login); it now has `aria-label` "Switch to light/dark mode" on Login, Register, Forgot and Reset. |
| C6 + sheet | Done | `QuickAddSheet.tsx`: one tint, order Paste a bank alert, Add manually, Log cash, Upload a statement, Scan a receipt, Ask. Plus tag on Scan and Ask is now always shown (it was shown only to non-Plus users). Log cash opens add-transaction with cash preselected (the old `/cash` screen only breaks down withdrawals). "Speak a transaction" is not in the brief's order; I kept it as a seventh tile at the end when the device supports it. |
| C7 Profile | Done | Plan label removed from the email row. Birthday removed from the Profile "Finish setting up" list. Home already carries one birthday card with a "Don't ask again" control (`index.tsx`, `birthdayPromptDismissed`), so no new card was needed. |
| C8 automatic tracking rows | Done | Each source row already printed "Last alert 3 days ago" in words. Added an amber "Fix it" on Bank texts, Bank app notifications and Email alerts when the last alert is older than 7 days (same threshold the email row used). Not seen on a device. |

Short-form check: `grep` for compact/`K`/`M` formats finds only chart axes (`FinancialTrends` ticks, `FinancialReports` via `fmtNairaCompact`, `compactAxis`) and `AdminDashboard.compactNaira`, an owner-only platform-totals tile I left alone because those totals reach ₦B and would overflow; say if it should go full too.

Screenshots: `docs/design/round10-c/` holds 16 files, all web: `web-{home,money,plan,txn-detail}-{dark,light}-360w-{100,200}pct.png`. Captured with headless Chrome against the local API and a seeded local account (fictional data, never production).

**No mobile screenshot was captured.** The Expo web run stalled repeatedly (one exit with code 134, then 30 to 45 seconds per page load) and wrote no files; the capture was stopped on purpose. Not captured: every mobile shot of Home, Money, Plan and Transaction detail; the Teal variants (Teal exists only on mobile, so there are no Teal shots at all); and the + sheet (mobile only; the web + goes straight to Import). The mobile 200% font-scale shot cannot be captured on React Native web at all, because the browser does not apply the OS font scale to React Native text. That is a limit of the tool, not a skipped test, so the owner's device check (largest Android font size on Home and the + sheet) is what covers it, along with Teal and the + sheet. The contrast audit does cover the Teal palette (150 pass, 0 fail).

Web limits: only Light and Dark exist on web; the web 200% shots set `html { font-size: 200% }`, which scales rem-sized text only, not a true OS font scale; the web Money list is a table that overflows at 360 px and the detail panel overlaps the header buttons (both pre-existing, not changed).

Owner check on the Android build (C1 and C2 cannot be confirmed without it): (1) on Home, Money and a transaction, look at the naira sign next to the digits in a bold amount and a regular one: it must be the same weight and height as the digits, with no thin or different-looking sign; (2) the Money day totals and a list of amounts with different digits (1, 8, 4) should line up in a column; (3) set Android font size to the largest and open Home and the + sheet: nothing clipped; (4) open the + sheet and check the six tiles are in the brief's order with Plus on Scan and Ask; (5) Profile: no plan text after the email; (6) Automatic tracking: an amber Fix it on any source quiet for 7+ days. Because the font files changed, the next build needs a new binary (an OTA cannot ship fonts); the files are in `assets/fonts/`.

#### Part C independently re-checked, 15 Nov 2026

Checked in the main session rather than taken on trust:

- All six patched mobile fonts (`finpilot-mobile/assets/fonts/Poppins_*.ttf`) carry U+20A6 and a real `tnum`, confirmed with fontTools. All five web woff2 files in `frontend/public/fonts/` carry U+20A6, and no `fonts.googleapis.com` reference is left in the web app.
- Mobile `npx tsc --noEmit`: clean. Web `npm run build`: clean. `scripts/contrast-audit.ts`: 150 passed, 0 failed.
- The mobile screenshots could not be captured from the main session either: the Expo web server on port 8081 belongs to another session, and this session's browser cannot reach it. They stay outstanding, alongside the owner's Android check of C1 and C2.

### A3 backfill APPLIED to production, 15 Nov 2026

Applied by the owner's decision, on backend version `480cd05`, after a dry run run immediately before showed exactly the same counts as the recorded ones (4854 scanned, 2857 changed). Result: `applied: true`, 2857 rows changed, counts identical to the table above. A dry run straight afterwards reports **0 changed**, so nothing is pending.

Left behind on purpose: on the owner's own account 7 rows still read Transfer and 7 still read ATM/POS. Every one of them has `reviewedAt` set, so `retireRow` refused to touch a row a person had already reviewed. The guard is doing what it should, and that is the right default.

Known residue to decide on later: those reviewed rows now display a category the pickers no longer offer, so the user cannot pick it again if they edit the row. Two honest options when it matters: leave them (a person's own choice outranks a tidy taxonomy) or show a one-off prompt on exactly those rows asking for a current category. Not done, not urgent, and it must never be solved by silently overwriting a reviewed row.

### Part D: announcements, 15 Nov 2026

Backend `npm test` 69/69 files pass (new `lib/announcements.test.js`, 71 checks). API checks `scripts/api-announcements.js` against a throwaway local `automonie_test` DB with email off: 34/34 pass. Web `npm run build` passes. Mobile `npx tsc --noEmit` clean, lint 0 errors (warnings pre-existing). Nothing pushed, nothing run against production, no announcement sent, no EAS build, no OTA.

| Brief item | State | Where |
|---|---|---|
| Model + per-user state | Done | `Announcement`, `AnnouncementState` in `server.js`; every field in the brief. `emailOpened` is returned as `null` ("not tracked"), never 0, because there is no open-tracking webhook. |
| Audience filter | Done | `lib/announcements.js` `matchesAudience` (plan, audience, platform, version range, banks, signup range, active/inactive N days, beta only). ONE resolver, `resolveAudience()`, is used by `audience-count`, the email send and the test. |
| Endpoints | Done | `GET /api/announcements/active`, `POST /api/announcements/:id/{seen,tap,dismiss}`, admin list/create/get/patch/delete, `templates`, `audience-count`, `:id/test`, `:id/approve`, `:id/end`, plus `import-legacy` and cron `POST /api/cron/announcements`. Scheduling is `PATCH {status:'scheduled'}`. |
| Approval rule, server side | Done | Security, or the full-screen channel, needs `approvedBy` set by a superadmin who is not `createdBy`. Editing any content clears the test and the approval. Full-screen on a non-outage/security/must_update kind is refused at validation. |
| Email via Brevo | Done, send loop not exercised live | Product kinds (update, feature, event) need `productEmails` and one announcement email a week; service kinds (maintenance, outage, security, must_update) go to the whole audience, not counted against the week. Resumable with `ANNOUNCEMENT_EMAIL_CAP` (default 300/day). Product mail goes as the newsletter no-reply identity, service mail as `Automonie <hello@automonie.com>`. One-click unsubscribe reuses `GET /unsubscribe` (it now also resolves a user token and switches `productEmails` off). The eligibility rules are unit-tested; the actual Brevo call was not made (no key locally, and nothing may be sent). |
| Web composer | Done | `frontend/src/components/AnnouncementComposer.jsx`, route `/announcements`, sidebar "Announcements" for superadmins and newsletter editors. Kind chips, title/message counters, button, channels (full-screen disabled unless the kind allows), audience with live count, start/end, preview in Dark, Light, Teal and email, "Send me a test" required before scheduling email or full-screen, Approve, stats, End now, templates. The Teal and Dark preview palettes are the phone's own, copied as preview-only constants. Not looked at in a browser. |
| Mobile card, full-screen, bell | Done in code, not run on a device | `AnnouncementCard` directly under the Home hero, `announcement.tsx` full-screen, `AnnouncementHost` (fetch on open and on return to front, opens full-screen once). Bell: the server writes a normal bell notification the first time an announcement is served (no push path touched). |
| Migration | Done in code | PIXLCO card and known-issue banner removed from mobile (`lib/promo.ts`, `GlobalBanner.tsx` deleted). `POST /api/admin/announcements/import-legacy` (superadmin) makes the equivalent announcements once each; the banner gets a 3 day end because a card must have one. Old endpoints are still served. |

Deviations and things the brief got wrong or left open:

- The brief says mobile already has a minimum-version screen for must_update to reuse. It does not: `/api/app-config` and `lib/appVersion.js` exist on the backend, but nothing in `finpilot-mobile/src` reads them. So `announcement.tsx` handles must_update itself (update copy, button to the Play Store on the Play build, otherwise the link). It does not block the app; a hard block on `APP_MIN_VERSION` is still unbuilt.
- No product-email consent existed. Added `User.productEmails` (default false, so nobody is emailed until they opt in), returned by `/api/me` and settable with `PUT /api/me`. **There is no toggle for it in the mobile or web settings yet**, so today only service kinds can reach anyone by email. This is the main thing left.
- Platform and app version were not stored anywhere. Added `User.lastClient` and `lastAppVersion`, written by the auth middleware from `X-Client` and a new `X-App-Version` header the mobile app now sends. Until a user opens a build that sends it, their version is unknown: it counts as 0.0.0, so a "version up to" filter reaches them and a "version from" filter never does. Platform filters need `X-Client`, which builds already send.
- The kinds list has seven entries but the brief only names three as service-like. I treated `update` as product mail (needs consent). Change `PRODUCT_EMAIL_KINDS` in `lib/announcements.js` if that is wrong.
- Template copy: "copy in doc section 4" is not in the repo, so the six templates (`TEMPLATES` in `lib/announcements.js`) are my own wording; replace if the doc has final text.
- Email only starts at schedule time if the start has passed; a future start needs the external scheduler to call `POST /api/cron/announcements` (header `x-cron-secret`, same as the other cron endpoints). Add that job at cron-job.org.
- A person who is over the weekly limit when the cron runs is skipped for that announcement, not queued.

Retiring the old endpoints (`GET /api/global-banner`, `/api/public/promo` PIXLCO card): every build that reads announcements must be the minimum first. The first build with the announcement client is the next mobile build after this commit (current `app.json` is 1.0.0, and 1.0.0 builds already in testers' hands read the old endpoints). When that build ships, bump it to 1.1.0, set `APP_MIN_VERSION` to at least that version once the update screen exists as a real block (see above), and only then remove the old endpoints. Until then keep them: older builds would otherwise lose the known-issue banner. The web `GlobalBanner.jsx` still reads `/api/global-banner` and is untouched; the composer does not feed it.

Owner steps: add the `/api/cron/announcements` job; decide where users switch product emails on; run "Import old PIXLCO card and banner" once after deploy if either is still live; create the first announcement as a draft and use "Send me a test" before anything real.

### Part E: the first month, 15 Nov 2026

Backend `npm test` 70/70 files pass (new `lib/journey.test.js`, 71 checks; `lib/nudges.test.js` still 54/54). API checks `scripts/api-journey.js` against a throwaway local `automonie_test` DB with push and email off: 24/24 pass. Mobile `npx tsc --noEmit` clean, lint 0 errors (the 3 warnings in `index.tsx` were already there). Web untouched. Nothing pushed, nothing run against production, no push or email sent, no EAS build, no OTA. `scripts/api-regression.js` was not usable as a check: it stops at section 7 on an unrelated `/api/help` assertion before it reaches the nudge section, so the older push-nudge checks there were read, not run (they use separate days, so the new one-push-a-day ledger does not change them).

**How it fires (decision): on demand, with the push as a bonus.** There is still no reliable external cron, so the day's moment is decided when the app asks (`GET /api/journey/today`), the same way `/api/announcements/active` works. It cannot silently stop, because nothing has to be running for a person to see their card. The hourly job (cron `/api/cron/nudges` or the existing in-process stopgap) only adds a push for the same moment; if it never fires nobody loses a moment. A moment has a window (its day plus `graceDays`, 0 to 2 days in the shipped table), so a person who is away for a week comes back to today's moment only. Tested: away days 2 to 9 and back on day 10 gets day 10's moment, none of days 2 to 7.

| Moment | State | Notes |
|---|---|---|
| Day 0 evening summary | Done | Card from 6 pm only, no grace (not owed later). New copy. |
| Day 1 "Here's what we found" | Done | Needs at least one transaction. New copy. |
| Day 2 first rule | Done | Skipped if the person already made a merchant rule. A "toast" is a Home card here; there is no toast surface. |
| Day 3 first budget | Done | Skipped if any budget exists. Push reuses `setup_budget`. |
| Day 4 cash check | Done | Skipped if a cash withdrawal was already allocated. |
| Day 5 missing bank | Done | Skipped with 3 or more banks seen. Push reuses `setup_connect`. |
| Day 7 weekly recap | Done | Push reuses `weekly_recap`. |
| First payday / corper allowance | Done | First pay-like credit after signup (reuses the nudge payday detector, now exported as `findPay`). Corpers get `corper_allowance`, everyone else `payday`; never both. Corper push line is new copy. |
| Day 10 Ask sample | Done | Free plan, Ask on, never used Ask. |
| Day 14 two-week check or win-back | Done, email unproven | Active in the last 3 days: card. Away: the win-back email, off unless `JOURNEY_EMAIL_ENABLED=true`, product-email consent, one a week, one-click unsubscribe. The send itself was not exercised (nothing may be sent). |
| Day 21 Sapa radar / "How long will the money last?" | Done | Radar needs income set and is not for students; students get their own card. |
| Day 25 to 30 better than last month | Done, phone verifies | Only a real win: the phone runs `betterMonth.ts` on its own rows and, if there is no honest win, posts `skip`, which frees the day. No push for this one (the server cannot verify it). |
| Month end recap / month end + 1 plan | Done | Last Lagos day of the month and the 1st, only for accounts at least 7 and 8 days old. Plan push reuses `month_start`. |

Rules: one planned moment a day is enforced by a unique index (user, claimed day) plus the pure `pick`; a moment is served once ever (unique user + moment id). One push a day across the app is a new `PushDay` ledger, unique per user and Lagos day: the journey push, the nudge engine and the Sunday weekly insight push all claim it first. Quiet hours 10 pm to 8 am are a fixed floor (plus the person's own window if wider) for the journey and the nudge engine. Not under the one-a-day ledger on purpose: the "new transactions added" notice and the forwarding-confirmation push, which are transactional and user-chosen. Time is Lagos for everyone: there is no per-user timezone stored.

**Configurable without a release:** moments live in `data/journey-moments.json`; `GET/PUT /api/admin/journey` (superadmin) stores overrides by moment id in `JourneyConfig` (change a day or window, copy, push line, switch a moment off, add a moment, change `journeyDays`, turn the whole journey or its push off). Copy with an emoji or a dash is refused and an invalid edit falls back to the default. There is no admin screen for it, only the endpoint.

**Part D interaction.** A journey moment uses its own Home slot, a card directly below the Ask bar, not the slot under the hero that announcements own, so the two do not overlap. Part D's behaviour is unchanged. On a day when both exist: a product announcement (update, feature, event) and the journey card both show, in their own slots. A service announcement (outage, maintenance, security, must update) or an unseen full-screen notice wins the day: `/api/journey/today` returns no moment and `held: 'announcement'`, and the moment is not consumed, so it appears after the announcement ends if it is still inside its window. Announcements never push, so there is no push conflict.

Deviations and what is left:

- Quests are not wired in. They are mobile-local with no server record, so the server cannot know a quest is done. The cards point at the same screens the quests do and use the same "already done" facts (budget, rule, cash) instead.
- Journey push is off by default (`pushEnabled` false) and the push needs the binary to have expo-notifications, so on builds without it only the card appears.
- The existing nudge engine's setup nudges for the first week remain; they now lose to the journey whenever the journey pushed that day.
- The `LIMITS.perDay: 2` in `lib/nudges.js` is now effectively 1 through the ledger; left as is.
- The Home card fetches on screen focus; it is not cached offline.

**Flaky test found and fixed, 15 Nov 2026.** `lib/journey.test.js` failed about one run in three on the check "payday push reuses the payday_detected copy". The cause was in the test, not in `journey.js`: the `pushText` call sat inside the `some()` predicate, so it ran once per variant and picked a fresh random variant each time, and the assertion only held when one of three independent picks happened to match the variant being compared, which is (2/3)^3, about 30%. The call is now made once and then looked for. Verified by 25 consecutive runs of the file (25 passes) and `npm test` at 71/71 files. No product behaviour was involved: `mergeMoments` stably maps the `payday` moment to `payday_detected`, the corper moment is a separate id, and all three variants render identically to their own text, so no wrong copy could reach a user from this.

Owner steps: nothing is needed for the cards. To turn on the push: `PUT /api/admin/journey {"pushEnabled": true}`. To turn on the win-back email: set `JOURNEY_EMAIL_ENABLED=true`. The hourly cron job already exists for the nudges and now also drives these. Needs the next mobile build or OTA for the Home card.
### Part F progress, 15 Nov 2026 (built on branches `claude/round10-part-f-email-851e83` and `claude/round10-part-f-email-mobile`, merged into `main` in both repos on 15 Nov)

Report and F3 ship gate: `docs/briefs/round10-email.md`.

- Done: F1 handoff. One-time link (24 hours, single use, one user, hash stored, atomic redeem), web page `/setup/email`, phone card with QR, "Email me the link", "Copy link" and three live ticks, "Desktop site" instructions removed. Backend `npm test` 70/70 (new `emailHandoff.test.js` proves expiry and single use), web build passes, mobile `tsc` clean and lint 0 errors.
- Done: F2 attempted and NOT proven. The Gmail URL needs a signed-in account I did not have; file import stays for step 3. Recorded in the report.
- Done, off: F3 built (Kotlin listener, filter, sender list endpoint, pre-permission screen, server flag `FEATURE_GMAIL_BANK_EMAILS` unset). Filter unit test (TypeScript, 22 checks) passes; the Kotlin test is written but NOT run.
- Keys-pending: F1 forwarding itself needs `INBOUND_EMAIL_SECRET` and the inbound MX (Round 9). "Email me the link" needs `BREVO_API_KEY` (already live). Optional `HANDOFF_BASE_URL` if the page should live on the bare domain.
- Needs an EAS build: F3 only (native). The F1 phone card is JS and can go by OTA.
- Not verified: routes against a real database and browser (no Mongo here); Gmail accepting the filter XML; F3 on a device.
