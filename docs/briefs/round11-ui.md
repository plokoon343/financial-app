# Round 11: UI direction, and what the owner found on build 1799244d (16 Nov 2026)

Source: the owner's phone screenshots and notes, 16 Nov 2026, on preview build `1799244d` (Round 10). This file is the record; nothing here is fixed yet unless it says so.

## What the owner said, in their own terms

1. **The birthday UI on Profile is not what was asked for.** Month chips plus a day box, and it should not look like that.
2. **Profile and settings are poorly done, and no UI improvement is visible from one build to the next.**
3. **Shareables, on web, mobile and the site, should never be plain text.** They are bland and have no personality.
4. **The loading screen must follow the theme in use.** A dark teal splash appeared while the app was on the light theme.
5. **Categorisation is still bad**, and asking users to remember old transactions is not sustainable. Accepted as something to improve over time, not the current priority.
6. **The priority now is the UI: pick a direction and run with it.** Study PiggyVest and Chowdeck. The owner will supply mockups.

## Verified in code, 16 Nov 2026

- **Splash, item 4: confirmed, and the cause is config.** `app.json` sets `userInterfaceStyle: "dark"` and the `expo-splash-screen` plugin has a single hardcoded `backgroundColor: "#052825"` with no light variant. The plugin supports a `dark` block, so the fix is a light default plus a dark override, and `userInterfaceStyle` should be `automatic` if the app is meant to follow the system. Needs a build: splash config is native.
- **Birthday, item 1:** the UI lives in `src/app/account.tsx`, not `profile.tsx`. Round 10 C7 asked for the birthday prompt to be removed from Profile and replaced by one Home card with "Don't ask again"; the Profile editor is still there. Worth re-reading C7 before touching it, since the owner's complaint is about how it looks, not only that it exists.
- **Shareables, item 3:** today's share is a text string ("My Weekly recap on Automonie, automonie.com"). The backlog already carries the right answer: shareable image cards at 9:16 (memory note "Quiz + Wrapped ideas"). This is a build, not a tweak.

## Bugs visible in the same screenshots that the owner did not name

These are worse than the cosmetic complaints and should not go into a 14-day closed test.

1. **Banks are being offered as people.** "Who is ACCESS?", "Who is UBA?", "Who is ZBN?" with Family, Friend, Work. ACCESS, UBA and Zenith are banks. The person detection is treating a bank name as a counterparty.
2. **A shop is being offered as a person.** "Who is FROZO FOOD SUPER STORE?" with the same three options. The business heuristic is not catching it.
3. **"Family" looks pre-selected on every one of those cards.** The first option is drawn as a filled teal button, which reads as the chosen answer. If a user taps through quickly, everything becomes Family. Either restyle the primary so it does not read as selected, or stop defaulting it on a question with no best guess.
4. **A retired category is still offered.** One card answers with "Transfer (Best guess)". Round 10 A3 retired `Transfer`, and `actionCards.js` builds answers straight from `it.suggestions`, so whatever produces suggestions is still emitting it.
5. **A ₦0.75 question.** The Home own-transfer card asks about ₦0.75 moving to ₦0.09, with the note that the ₦0.66 difference is a bank charge. Own-move cards are priority 2 and therefore exempt from the ₦2,000 ask floor, so sub-naira questions reach the queue. They should not.
6. **A name is duplicated in a card title:** "3 payments to Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu". Also, those are payments to the account holder's own name, which the self-transfer rule should have caught.
7. **A refund card offers two options that are visually identical**, both truncated to "Via Gtworld Onukogu, Chidumebi Vincent Onukogu Uzodimma Rober...". Nobody can answer that question.
8. **Raw narration used as a title:** "POS PUR 11 PLC FESTAC 23RD Lagos LANG 38", which the standing rules forbid.

## The sequencing problem, stated plainly

The 14-day closed test cannot start until a build is uploaded, and the UI direction the owner wants is weeks of work that depends on mockups that do not exist yet. Those two cannot both go first.

Recommended split:
- **Before the first closed-test upload:** items 1 to 8 above, plus the splash theme (4). They are correctness and trust problems, and 12 testers will hit them in the first hour.
- **During the 14 days:** the UI direction. New builds can be pushed to a closed track at any time without restarting the clock, so testers can receive the redesign as it lands.
- **Not before launch:** the categorisation rebuild (item 5 in the owner's list). It is accepted as a slow improvement.

## UI direction: what is needed before anyone writes code

The owner will bring mockups. To make them implementable rather than another round of drift, the direction needs, in one document: the type scale, the colour tokens and how they change in light, dark and teal, the card and list shapes, the motion rules, the icon set, and what the five tabs look like at rest. PiggyVest and Chowdeck are the references the owner named. Without that, each build changes a few screens and the whole still looks unrelated, which is exactly the complaint in item 2.

## Fixed (the eight bugs above, backend only)

All eight are fixed in the backend, so they reach the installed build without an EAS build or OTA. Tests are in `backend/lib/cardBugs.test.js`, using the strings from the screenshots. I did not run them against the old code (no stashing in a shared folder); each assertion targets behaviour the old code did not have.

1. **Banks as people.** `lib/personName.js` `isPlausiblePerson` gates every `who_is_this` card in `actionCards.build`. A name made only of bank or wallet aliases (from `data/banks.json` via `bankRegistry`, plus filler like BANK or MFB) never qualifies. ZBN was missing from the registry, so I added it as a Zenith alias. "Zenith Okafor" is still a person.
2. **Shops as people.** Same gate uses cleanName's business words, which I extended (SUPER, PLC, TRADING, RESOURCES, INVESTMENTS, SUPPLIES, BAKERY, KITCHEN, NIG). This also stops those names being offered as ajo. Decision: a person must be two or more alphabetic words, so a one-word name is not asked (unknown beats wrong).
3. **Pre-selected answer.** The cause was data, not styling: both clients fill whichever answer has `primary`. Cards with no best guess (who_is_this, refund_match, sources_disagree, which_account with an unknown sender) now mark none. Mobile and web needed no change, and a real best guess (category) still draws filled.
4. **Retired category.** `categorySuggest.suggest` drops retired categories at the source (old learned rules and popular counts could still carry Transfer), and `actionCards` filters suggestions again as a guard, falling back to Other.
5. **Sub-naira question.** New `MIN_ASK = 10` for priority 1 and 2, which are exempt from the 2,000 floor. I chose 10 because it is the smallest real Nigerian transfer fee, so below it is rounding or interest dust, while any real own move is still asked. Demoted cards are recorded as `below_sanity_floor`, nothing is changed on the row.
6. **Duplicated name, and self.** `normalizeName` folds a name written twice ("A B C A B C" and its truncated form), and the card title and `{name}` are folded as a second guard. The stored account name is one word, so `lib/personName.inferHolderName` completes it from narrations that name the same person on both sides or twice in a row, only when two such narrations agree and one contains the stored word. `actionCardInput` uses that full name for own-move detection and skips category cards for payments to the holder, so they surface as the own-move question instead. Not backfilled: nothing is written to stored rows.
7. **Identical refund options.** If two labels would read the same in the first 24 characters, each leads with amount and day. If still identical they collapse to one choice plus Neither.
8. **Raw narration title.** I could not reproduce the raw string as a title. `cleanName` returned "11 Festac Lagos Lang 38" for it, so the leak may be a user rename rule or the original-alert sheet. What I fixed is the visible noise: trailing terminal location and numbers (Lagos, LANG, NG, trailing digits) are trimmed from the end only, giving "11 Festac". If it still shows raw on a phone, I need the card's `key`.

## Queued for after Round 11 phase 1 (owner's decision, 17 Nov 2026)

**The level and XP engine.** Part G left the level chip and XP bar undrawn because the brief's "Not in this round" list rules out streak and level engine changes, not because of a technical blocker. The owner wants it built once the round is finished. What it needs decided first: what earns XP (sorting a card, a check-in day, hitting a goal, setting a budget), what each is worth, the level names and thresholds, what a level unlocks, and whether the ledger lives on the server or the phone. Server is the better answer: Part G found that the existing "Sorted" counter is per phone, not per account, so a phone-local ledger would reset on reinstall. Three things unblock when it exists: the Profile level chip, the XP bar, and the Settings app icon picker (P15), which the board gates on level and which Part H had to ship ungated or gated on something real.

Also waiting on a rule rather than on code:

- **"On pace for March" on a goal** (Part F). Goals keep no history of when the saved amount moved, so a finish month needs a pace rule decided first, then a `planView` or backend change.
- **The board's 14 badges**, including "Sapa-proof", "Soft Life Planner" and "Next on 1 Dec". Part G shipped 11 badges that are all earnable from data the app already records; the rest need rules.
- **The avatar does not follow the account.** It is stored on the phone, and syncing it is one new field on the user.
- **"My cards" starts empty for everyone**, because the app never kept past share images. Cards shared before this build cannot be recovered.

## Level and XP engine: built (17 Nov 2026)

Backend commit `3600af6` in this repo, mobile commit `c775b5f` in finpilot-mobile. Not pushed, no EAS build, no OTA, backfill not run anywhere but a throwaway test database. Backend `npm test` 73/73, new `scripts/api-xp.js` (end to end on a `_test` database) 17/17. Mobile `tsc` clean, lint 0 errors (12 old warnings), contrast audit 414 passed / 0 failed, new `scripts/xp-view.test.ts` passed, profile, settings, loading and motion tests passed. Home and `account.tsx` were not touched.

### What was built

- **Engine** `backend/lib/xp.js` (pure, 36 tests): level table (Starter 0, Tracker 100, Planner 250, Saver 500, Strategist 1000, Boss 2000), action values (sorted card 5, check-in 2, budget 20, goal 50, tracking on 30, card shared 10), 50 a day cap, unlocks, backfill planner.
- **Ledger** `XpEvent` in `server.js`: one row per thing, unique on user plus key, Lagos day, source `live` or `backfill`. Keys: `card:<key>`, `checkin:<day>`, `budget:<month>:<category>`, `goal:<id>`, `tracking`. A capped award is still written (at 0 or part XP) so it cannot be paid again tomorrow.
- **Awards wired into the places that already complete the action**: `/api/action-center/answer` (card), `/api/checkin` (today only, never the `days` a client sends), `POST /api/budgets`, goal contribute and goal PUT when it crosses the target, `POST /api/capture/key`. No new endpoints for existing actions. An award never throws into the action it follows.
- **`GET /api/xp`**: xp, level, name, next, progress, today and cap, `badgeSlots`, and `unlocks` with how many XP to go. An empty ledger answers 0 at Starter.
- **`POST /api/admin/xp-backfill`**: counts first, `?apply=1` to write. It reports accounts, entries, XP, counts per action and the level accounts would land on. Safe to run twice: it skips keys already in the ledger and uses the same keys as live play, so nothing double pays.
- **Mobile Profile**: level chip ("Tracker, Level 2") and XP bar ("75 XP to Planner") on the identity card. While loading the bar says "Checking your XP". If the server cannot be reached the chip slot falls back to the money personality and the bar says XP is not available. The setup bar stays as its own, labelled bar beneath it.
- **Mobile Settings**: the App icon row shows a lock and "Unlocks at Tracker, 100 XP. 60 to go." when locked. The picker screen (`app-icon.tsx`, where the gate has to live or a deep link would skip it) shows the same line, a progress bar, the list of ways to earn XP with values, the daily cap, and a button to Quick look. It has separate loading and error states with "Try again"; neither reads as locked.

### Backfill

Run against the local database as a read-only count with the same planner (I was not allowed to forge an admin token against the dev database, so I did not call the route there): 31 users, 4 goals, 10 budgets, 1 account with tracking on. 6 accounts would get 11 entries, 230 XP in all, and all 6 land on Starter. Local data is thin, so it says little about production. Rules that decide where a real account lands:

- Goals hit and budgets set, five of each at most, so history cannot outrun live play (live is capped at 50 a day). Tracking on is 30.
- The ceiling is 250 + 100 + 30 = 380 XP, which is **Planner**. So the longest-standing account ends at Planner, not Strategist or Boss. An account with one hit goal and a few budgets ends at Tracker; one with nothing the server can prove stays Starter.
- Backfill sits outside the daily cap, is flagged `source: backfill`, and is never celebrated: the app has no level-up moment, and the first read after a backfill just shows the new level.
- Not backfilled: the phone's Sorted counter (per device), check-in days (a client can send any), cards shared (never recorded).

Before running it on production, run it without `apply` and read `landing`.

### Decided by me, change if wrong

1. **Icon picker opens at Tracker (100 XP).** The brief said gate it by level without naming one. 100 XP is about two days of normal use under the cap, so it is a near reward and not a wall.
2. **Badge shelf slots**: the shelf pins 4, 5, 6, 7, 8, 9 badges at levels 1 to 6 (it was fixed at 4). "See all 11" still shows every badge at every level, so this is a nicety and not a lock.
3. **Budget key is month plus category**, lowercase. Deleting a budget and making it again pays nothing; a new month or category does. Farming is bounded by the 50 a day cap.
4. **Backfill limits** (five goals, five budgets) are mine, to land an honest level.
5. **A capped award pays what room is left**, not all or nothing, and the action is spent either way.

### Could not do as approved

- **Sharing a card (10 XP) has no award path.** The server does not record a share: the image is made on the phone, and an endpoint the phone just calls to claim "I shared" is a number the server cannot defend. The value is in the table and tested; the award needs a server-side record of the share first (for example the share card being generated on the server, or the client uploading the share event with the card id). I did not add a claim endpoint.
- Goal XP can be farmed a little by creating a tiny goal and finishing it. The cap bounds it at 50 a day. A minimum target would close it if wanted.

### Follow-ups

- Level-up moment and toast (none built). It should read the level before and after and stay silent for backfill.
- Skipping a Quick look card pays nothing, on purpose: only an answer counts.
- Web does not show level or XP yet.
