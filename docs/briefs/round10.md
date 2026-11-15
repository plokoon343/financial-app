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
