# What to give the design chat for Round 12 (21 Nov 2026)

Paste this into the design chat before asking for anything. It is the state of the app as it really is, so the brief that comes back is implementable instead of a redesign of a product we do not have.

## The six things the owner asked for

1. The birthday question shows at signup, or to an existing user who has not answered, and disappears for good once answered.
2. Better insights, and a restructure of the app, because insights are too hidden.
3. Detect loans and debts, and offer repayment reminders.
4. Nothing overfills anywhere. The insights page currently does.
5. A better avatar, woven into the experience rather than decoration.
6. A review of a user's complete end-to-end journey, and then perfect it.

## What already exists, so the chat does not redesign it

**Navigation today.** Five slots at the bottom: Home, Money, the centre + button, Plan, You. Insights has no tab and has not had one since Round 6, when the + button took the fifth slot. That is the real cause of item 2: on 20 Nov the only ways in were a Home section that hid itself whenever you actually had insights, and tapping your streak number on Profile. Two doors were added on 21 Nov (an always-on "See all" on the Home read, and a named Insights row in You), but that is a patch, not a structure. **The restructure question is: what are the five slots, and where does Insights live?**

**Round 11 just rebuilt every screen** to an approved direction (Expressive Teal, Ankara Pop for brand moments, Soft Clay objects). Home, Quick look, Money, Plan, Profile, Settings, loading states and the birthday moment are all new, in build `455f8ec5`. The brief is `docs/briefs/round11-phase1.md` and the boards are the design canvas it names. Round 12 should build on that direction, not replace it.

**Birthday is already close to item 1.** Part I replaced the month-chip and day-box editor with a date picker screen, and Home only offers the prompt when `user.birthdayDay` is unset and the prompt has not been dismissed. Verify it on the new build before asking for more. What may still be wanted: where a new user is asked during signup.

**Loans and debts are partly detected already.** `backend/lib/txnKinds.js` classifies `loan_in` (money received that is borrowed) and `debt_repayment` (money paid back), and knows the Nigerian lending apps by name (Okash, FairMoney, Palmcredit, Carbon, Renmoney, QuickCheck, Aella, Branch, Migo, Sokoloan, Kwikcash, Newcredit, Lendigo, Creditville, Specta, C24, Credit Direct). There is also an "Owed to you" feature. So item 3 is mostly a product and reminder design on top of detection that exists, not new parsing.

**Reminders exist but are fragile.** There is no reliable external cron. The first-month journey scheduler decides a user's moment on demand when the app asks, precisely so nothing silently stops. Any repayment reminder must survive the same constraint: either it is computed when the user opens the app, or it needs a trigger the owner sets up.

**The avatar is built but shallow.** Part G added a layered-SVG avatar builder (skin tone, hair, headwear, glasses, background). It is stored on the phone only, so it does not follow the account to a new device; syncing it is one new field on the user.

**A level and XP engine now exists**: server-side ledger, daily cap, levels Starter, Tracker, Planner, Saver, Strategist, Boss, and unlocks. Sharing a card earns nothing because the server never records a share. Everyone is at zero XP until a backfill is approved.

**Merchant logos are deferred.** The service and a pinned override list are built, no provider key is set, so rows show glyph avatars. Logo.dev's free tier needs a public attribution credit, which is why it stopped.

## Constraints the chat must respect

- The app moves no money. Wallet, auto-savings, debts and bill payments are retired. Detecting a loan and reminding someone is fine; collecting, lending or paying is not, and it would also drag the Play declaration into organisation-only territory.
- No emoji, no em dashes, Naija English, warm and short. Pidgin only as an optional celebration caption, never in errors, money facts or settings.
- Every screen follows the active theme: Dark, Light, Teal. Touch targets at least 44 px, contrast at least 4.5:1, a still version of every animation for reduce motion.
- Trust copy must be true in code. No number without a real source: Round 11 left out a level chip, an XP bar and a goal pace line rather than invent them.
- Amounts never appear on anything shared.
- A Play closed test is imminent: 12 testers for 14 continuous days. New builds can reach testers during the test, so Round 12 can land in pieces.

## What the brief that comes back must contain

1. **Parts in build order**, each small enough to be one commit, with what done looks like.
2. **The navigation decision for item 2**, stated outright: the five slots, where Insights lives, and what moves or merges to make room.
3. **For item 4 (overfilling)**, the actual rule: maximum items per section, what truncates, what wraps, what scrolls, and at 200 percent font scale and 360 px width. "Do not overfill" is not implementable; "a section shows at most 5 rows and then See all" is.
4. **For item 3**, the product rules: what counts as a loan, how a repayment date is known or guessed, what the reminder says, how often, and what happens when the user says it is wrong. Detection is the easy half.
5. **For item 6**, name the journey being reviewed, end to end: install, sign up, first capture, first categorisation, first week, first month. Each step needs its own screens and its own definition of success, or it is not reviewable.
6. **Anything that needs data we do not have**, listed separately, so it can be built or dropped on purpose rather than discovered late.

## Ask the chat to decide these, because the code cannot

- Does Insights become a tab? If so, what leaves the bar, and does the + button stay in the centre?
- Is a repayment reminder a push, a Home card, or both? Remember: one push a day across the whole app, quiet hours 10 pm to 8 am.
- Does the avatar sync to the account (one backend field) or stay per phone?
- Should the XP backfill run, so existing users do not start at zero?
- Does sharing a card earn XP, which needs the client to tell the server a share happened?
