# Round 11: UI direction, phase 1 (16 Nov 2026)

Owner: Plo. Repo: finpilot-mobile, plus small fixes in the website repo (Part K). Model: Sonnet. Work part by part, one commit per part, in the order below.

## Source of truth

- Design canvas (approved direction): https://claude.ai/artifact/6ofX6fCBKTKbT5gnAmQQyD Boards: Home, Action Center, Money, Plan, Profile, Settings, Loading (Light), Birthday, Share card.
- Idea bank with the owner's picks and phase plan: https://claude.ai/artifact/W8ogbpckddkfiA5sazgm7r Codes in this brief (H1, P8, M11...) refer to that doc.
- If a board and this brief disagree, the board wins on look, this brief wins on behaviour. If either clashes with something already in the code that looks deliberate, stop and list it before changing it.

Read both with the Artifact tool (action "read" with the URL), not a web fetch.

Pull first. The last commit the owner saw was `28a06a1 Drop the mascot` (the mascot stays dropped).

## The look in one paragraph

Expressive Teal for every app screen: near-black or light canvas, big bold numbers, mixed shapes (circles, pills, scalloped badges), rounded cards (20 to 32 px), one accent per screen, springy motion. Ankara Pop only for brand moments (birthday, recaps, share cards, splash flourishes, website): an original geometric pattern in brand colours, never copied from a real fabric. Soft Clay for objects (avatar, coins, badges): soft 3D look via radial gradients.

## Rules for every part

1. Copy: Naija English, warm and short. Pidgin only as an optional celebration caption, never in errors, money facts or settings. No emoji. No em dashes in UI copy. Never the word "Transfer" in row titles.
2. Every screen, loading state, sheet and splash follows the active theme (Dark, Light, Teal). No hardcoded `#000000` or `#052825` backgrounds outside the theme file.
3. Touch targets at least 44 px. Text contrast at least 4.5:1 (check muted greys on all three themes).
4. Every animation has a still version when the system "reduce motion" setting is on.
5. Share cards and anything meant to leave the app never show naira amounts.
6. Trust copy must be true in code. Do not add new security claims.
7. Do not change ingestion, categorisation or dedupe logic in this round.

## Part A: Foundations

1. Tokens in `src/constants/colors.ts` for all three themes: `canvas`, `card`, `cardBorder`, `textPrimary`, `textMuted`, `accent` (mint #1DD3A8), `brand` (teal #139DA0), `heroBg` (#0B6E71 on Dark), `warn` (amber #F4B740), `good` (leaf #44BC7E), `danger`, plus tinted backgrounds for icon tiles (accent at about 14 to 18% opacity). Add `radius` tokens: 14 (small tile), 20 (chip card), 24 (section card), 28 to 32 (hero).
2. Amount font: add `@expo-google-fonts/inter` (600, 700, 800). Use Inter with tabular numbers for every money amount via `src/components/Amount.tsx`. Poppins stays for everything else. Confirm the naira glyph renders in Inter on a real Android device; if it does not, tell the owner before continuing.
3. Shared components (new, in `src/components/`): `IconTile`, `StatusChip`, `ScallopBadge` (20-point scalloped SVG with a colour prop), `PillTabBar` (active tab gets a mint pill behind its icon, centre + button stays), `LogoTile` (see Part J).
4. Motion primitives with Reanimated: `usePressSpring` (scale to 0.97 and back, M11), `RollingNumber` (M12), list stagger on first load only (M18, 30 ms), bottom sheet slight overshoot (M16). Haptics through `src/lib/haptics.ts`: light tick on sort, success on goal hit, warning on over budget (M19).

## Part B: Theme-true loading (L1 to L5, M14, M21, M24)

The owner saw a teal splash while on Light. Fix the whole chain:

1. Native splash (`app.json`, `expo-splash-screen`): it cannot know the app theme, so set a light and a dark variant that follow the system, and keep it on screen only until the saved theme is read (`preventAutoHideAsync`, hide after `theme.tsx` has loaded prefs).
2. `AnimatedSplash.tsx`: remove "always black, by design". Background, mark and progress colours come from the active theme.
3. `Skeleton.tsx`: shapes sized like the real content, shimmer in theme colours. Replace spinners on Home, Money, Plan, Action Center, Profile.
4. Long waits (statement import, first sync): a rotating line under the mark ("Counting your kobo...", "Finding where the money went...", "Almost there..."), plus a plain progress note ("Sorting 3 months from 2 banks").
5. Offline state: friendly illustration and "We'll update when you're back online".

Check: switch to each theme, kill the app, reopen. No frame in a different theme.

## Part C: Home (H1 to H6, Home board)

Top to bottom: avatar + greeting by time of day + streak chip + bell; stories row (October recap, 60s lesson, Badges, Your cards; seen ones lose the coloured ring); hero card (safe to spend, big Inter number, daily allowance line, status pill On track / Getting tight / Over, payday countdown); three tiles (spent today, bills this week, goal %); Quick look peek stack showing the top card and count; Today's rows. Hero collapses into a slim bar with safe to spend on scroll (M17). Hero background shifts gently by state: teal when on track, amber tint when tight (M5, a slow colour change, not a pulse).

## Part D: Action Center / Quick look (Action Center board)

- Card stack, progress segments at the top, "5 things, about 1 minute".
- Top card: LogoTile, merchant, amount, "Looks like Food and eating out. Right?", category chips, "Always put X in Food" checkbox (on by default, creates the rule).
- Swipe right confirms, swipe left opens the category picker (`react-native-gesture-handler`). Visible buttons for both; swiping is never the only way.
- A coloured trail in the category colour follows the card off screen (M9), light haptic on each sort.
- "Up next" list below for non-sort actions (renewal, possible duplicate, bill due).
- Queue cap is 5 (`backend/lib/actionCards.js`). Priority 1 and 2 are currently exempt, so the queue can exceed 5: log how often that happens before changing anything, and report the numbers.

## Part E: Money (H7 to H9, Money board)

Month switcher pill; Money in / Money out tiles with coloured dots; spending-days heatmap (darker = more, today outlined, future days empty); filter chips (All, Money out, Money in, top categories); rows grouped by day with day totals, LogoTile, and the category as a soft tinted tag under the name. Income rows use an up-arrow IconTile in leaf green.

## Part F: Plan (H10 to H12, Plan board)

1. Until payday timeline: today marker, upcoming bills as amber squares, payday as a green circle, one status pill ("No tight days ahead" / "Tight around 24 Nov").
2. Budgets as jars: static fill level with a slightly wavy top edge, colour goes amber from 80% used. The sloshing liquid animation (M3) is phase 4, not now.
3. Goal as a coin stack: filled coins for progress, dashed outlines for what is left, "On pace for March".
4. Subscriptions shelf: row of LogoTiles with renewal dates (amber if within 7 days), count and monthly total in the header, "+N" to see all.

## Part G: Profile / You (P1 to P7, Profile board)

Identity card: Ankara pattern band, avatar overlapping it, level chip ("Planner, Level 3"), name, member since, plan, XP bar to next level. Stats strip (day streak, sorted, goals hit; no amounts). Badge shelf of ScallopBadges, locked ones grey with a lock. "My cards" gallery of past share cards with "Share again". Settings via the gear at top right. Avatar builder (P2): simple illustrated avatars (skin tone, hair or headwrap, cap, glasses) replacing the initial circle; layered SVG parts.

## Part H: Settings (P8 to P15, Settings board)

Rebuild as grouped cards, not one long list: search field at top; Look and feel card with three theme preview buttons (tapping one switches the app with a circular reveal from the tap point, P10); Account and money card (Banks and statements, Payday and budgets, Nudges and reminders) with StatusChips; Privacy card (Privacy centre, Block screenshots switch with "Stops screenshots of your money screens", App lock); app icon picker unlocked by level (P15); Delete account at the bottom, separate, calm red outline. Every row has an IconTile and a one-line plain-English subtitle. Keep all existing settings; only regroup and restyle. Screenshots stay allowed by default.

## Part I: Birthday (B1 to B3, B5, Birthday board)

Replace the current birthday prompt entirely.

- On the first open on the user's birthday: full-screen moment, Ankara header fading into the canvas, brand confetti (small shapes and naira signs, under 2 seconds, skippable), clay avatar with a party hat, date eyebrow, "Happy birthday, {first name}", "Another year, more wins. Your Home has a party look for today.", primary "Get your birthday card", secondary "Go to Home". Show once.
- Home gets a subtle festive header for that day (B3).
- A chip on Home 7 days before: "6 days to your birthday" (B5).
- The birthday card itself (S14) is phase 2; for now the button can open the existing share flow with a birthday-styled card using the Share card board's layout (no amounts).

## Part J: Merchant logos (owner decision, 16 Nov)

The owner wants real merchant logos wherever possible. This replaces spec Addendum C's glyph-avatar approach in `src/lib/merchantLogos.ts`.

1. Backend: a logo service resolves merchant name to a logo once (a provider such as logo.dev or Brandfetch; check their terms for commercial use and report which was picked and why), stores the image on our side (R2 or our API), and serves it from our domain. The phone never calls the third-party provider directly.
2. Mobile and web: `LogoTile` shows our cached logo on a white rounded tile; while loading it shows the tile with no flicker; if no logo exists it falls back to the current brand-colour plus glyph avatar, and only then to a coloured initial.
3. Keep a manual override list for top Nigerian merchants (MTN, Airtel, Glo, DStv, GOtv, Bolt, Uber, Chowdeck, Glovo, Jumia, Chicken Republic, Netflix, Spotify, banks) so the most common rows are never wrong.
4. Bank logos already exist (`bankLogos.generated.ts`); leave them.

## Part K: Website quick fixes (automonie.com)

1. Replace every phone mockup with screenshots of the new Home and Money (neutral names; no "Transfer to Mum").
2. Fix the stat counters that show "0": count up when scrolled into view, and show the final value if JS or motion is off.
3. Remove "forward the emails" and "Install on iPhone (web)" from the copy until those are decided.

## Not in this round

Phase 2 to 4 items: signature alert-to-row morph (M1), payday coin drop (M2), recap card flip (M7), full share card system (S1 to S25), streak and level engine changes, quests, widget, liquid budgets (M3), radar forecast (M10), website hero animation and scroll demo. Do not start these.

## When you finish each part

- Screenshots of the changed screens in Dark, Light and Teal on a real Android phone.
- A short list of anything that could not be matched to the board, and why.
- Confirm no copy rule was broken (search the diff for emoji, the em dash character and "Transfer").

## Conflicts found when this brief was filed (16 Nov 2026)

1. **Rule 7 ("do not change categorisation") versus the owner's instruction to fix the bugs.** The bugs found on build `1799244d` (see `round11-ui.md`) include banks and shops being offered as people, a retired `Transfer` category still appearing as an answer, and sub-naira questions reaching the queue. Those live in categorisation and card-production code. Resolution: the bug fixes run as their own track, outside the UI parts, and rule 7 holds for everything else.
2. **Part D asks to log how often the queue exceeds 5 before changing anything.** That measurement already exists: `GET /api/admin/queue-breakdown` (Round 10 Part B), and the owner's real queue went 15 to 7 on 15 Nov. Use it rather than building a second one.
3. **Part B item 1 conflicts with `app.json` today**, which sets `userInterfaceStyle: "dark"`. Following the system means changing that to `automatic`, which affects every screen, not only the splash.
4. **The Play closed test is waiting on these fixes.** The 14-day tester clock cannot start until a build is uploaded, so the bug track is also the launch track.

## Part A progress note (16 Nov 2026, mobile repo)

Status: built, `tsc` clean, `expo lint` 0 errors (13 old warnings, none from Part A), contrast audit 210 passed / 0 failed on Dark, Light and Teal, motion test 12 passed. Not pushed, no build, no OTA, nothing wired into a screen yet.

### What was built

1. **Tokens** (`src/constants/colors.ts`, all three themes, nothing removed): `canvas`, `card`, `cardBorder`, `textPrimary`, `textMuted`, `accent`, `brand`, `heroBg`, `warn`, `good` (`danger` already existed), tile tints `tileAccent / tileBrand / tileWarn / tileGood / tileDanger`, and `radius` = tile 14, chip 20, section 24, hero 30. The audit gained checks for the new pairs (tile glyphs, ink on accent/warn/good, onHero on heroBg, textMuted on card).
2. **Amount font**: `@expo-google-fonts/inter` 0.4.2, only 600, 700 and 800 are bundled (subpath requires). `Amount.tsx` now draws Inter with tabular numbers; weight follows the style's `fontWeight` (700 default). fontTools result: U+20A6 present in all three files (advance 1559, 1551 and 1541 units, digits 866, 883 and 904, upm 2048) and `tnum` present in GSUB in all three. The naira sign and the digits come from the same face and weight, so no fallback is needed. Still to do: look at it on a real Android phone, which needs an EAS build.
3. **Components**: `IconTile`, `StatusChip`, `ScallopBadge` (20 points, colour prop, `scallopPath` exported), `PillTabBar` (react-navigation `tabBar` renderer, mint 64x32 pill, raised + button, takes `icons`, `onAdd`, `fabRef`), `LogoTile` (our cached `logoUrl`, then the glyph avatar from `merchantLogos.ts`, then a coloured initial; white tile painted first so no flicker).
4. **Motion** (`components/motionPrimitives.tsx`, rules in `lib/motionRules.ts`): `usePressSpring` (0.97), `RollingNumber` (odometer digits), `StaggerItem` (30 ms, first load per list key only, capped at 10 rows), `useSheetAnimationConfigs` (gorhom spring with overshoot) and `useSheetSlide` (hand-rolled sheets). Haptics: `haptic.tick`, `haptic.goalHit`, `haptic.overBudget`.
5. **Reduce motion**: every primitive reads `useReducedMotion()` and takes a still path (no scale, plain `Amount`, no stagger, 120 ms timing instead of a spring). The decisions are pure functions tested by `npx tsx scripts/motion-primitives.test.ts`. The on-device check (turn on "Remove animations" and confirm press, amounts, lists and sheets stay still) is still owed.

### Could not match to the board, and why

- **Canvas and card colours: resolved, owner chose the board (16 Nov).** Dark is now #0B0E11 canvas, #15191E card and surface, #1A1F25 raised, #232830 border (was true-black OLED). To keep every pair at 4.5:1 I nudged Dark `textFaint` to #8490a1 and `expense` to #f35858. Light and Teal are unchanged. Still hardcoded `#000000` and left for Part B: `_layout.tsx` (window background and pre-font view), `AnimatedSplash.tsx`, `ErrorBoundary.tsx`, `app.json` splash and adaptive icon.
- **`userInterfaceStyle: "dark"`** in `app.json` left alone (Part B).
- **Mint, amber and leaf as text.** #1DD3A8, #F4B740 and #44BC7E are fills and dots only; on Light they fail as text. Text uses `primaryText`, `warning`, `income`. Documented on the tokens.
- **Tile opacity** is 16% on accent, brand and warn (Dark, Teal), 14% good, 10% danger, and 6 to 8% on Light. Anything higher failed 4.5:1 for the glyph on its own tile.
- **Spending-days heatmap colours** and the Ankara, clay and avatar art are not part of A.
- **Brand button on the board** is #139DA0 with white, which is about 3.5:1. Fine for the large + glyph (non-text), not for small text.

### Decided myself

- Not every existing `money()` call site moved to `Amount`: hundreds are inline in sentences. `Amount` is Inter now, and each screen part (C to G) should route its amounts through it as it is rebuilt.
- `PillTabBar` is built but not wired into `(tabs)/_layout.tsx` (it changes bottom insets and the tour target). Wiring example is in its header comment.
- `LogoTile` takes `logoUrl` but nothing passes one yet (Part J). Initial-colour hues come from `featureColors`.
- Separate `motionPrimitives.tsx` (Reanimated) beside the older `motion.tsx` (RN Animated); the old one is untouched.
- Did not touch the Action Center card component or the backend.
- The note lives in the financial-app repo, uncommitted there; the mobile commit holds the code.

## Part B progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (same 13 old warnings, none new), contrast audit 210 passed / 0 failed on Dark, Light and Teal, motion test 12 passed, new `scripts/loading-states.test.ts` passed. No build, no OTA, backend untouched. I read the Loading (Light) board and matched it.

### What was built

1. **Native splash** (`app.json`): light variant `#f4f6fa` (Light canvas), dark variant `#0B0E11` (Dark canvas), same mint mark, both follow the system. `userInterfaceStyle` is now `automatic`. `SettingsProvider` (`theme.tsx`) now renders children only after the saved theme is read and then calls `hideAsync`, so no frame is drawn in the default theme. `_layout.tsx` no longer hides on fonts; it keeps a 5 second backstop so the splash can never hang. `ErrorBoundary` (sits above the theme) follows the system scheme with colours from the theme file.
2. **`AnimatedSplash`**: ground, wordmark and bar come from the active theme. Reduce motion draws the final state and holds 600 ms.
3. **`Skeleton`**: `skeleton` token ground, a theme-tinted highlight sweeping on one shared clock, no sweep with reduce motion. New `SkeletonCard`, `ActionCardSkeleton`, `ProfileSkeleton`, `PlanSkeleton`. Replaced spinners on Action Center, Plan (Budgets, Plans) and Profile (new: it had none, shows skeleton until first load ends, even if it failed). Home, Money and Plan (grow) already had skeletons and now get the shimmer.
4. **`LongWait`**: mark, rotating line ("Counting your kobo...", "Finding where the money went...", "Almost there..."), plain note. Used on statement import (note is real: "Uploading 40%", then "Reading every page... (12s)") and first insight (no note, nothing true to say). Reduce motion: still mark, line holds on the first.
5. **`OfflineState`**: still cloud illustration, "You are offline", "We'll update when you're back online.", optional 44 px Try again. Shown on Home (no data and summary unreachable) and Money (no cached list and a genuine network failure, via new `isOfflineError`; a server 500 does not claim offline). Also fixed: Money used to sit on the skeleton forever when offline with no cache.

### What only a real build can confirm

The native splash colours and the `automatic` switch (app.json is native config). I checked `expo config` resolves, nothing more. Also not proven: no wrong-theme frame on cold start in each of Dark, Light, Teal. The JS chain is arranged so none can happen (splash held until the theme is read, children not mounted before it), but the acceptance test (switch theme, kill, reopen, x3) needs a phone. Screenshots in three themes are owed for the same reason.

### Known limit

The native splash follows the system, not the app theme. A Teal or Dark user on a Light phone still sees the light splash for a moment, then the app. That cannot be fixed natively; the only frame then is the splash, never a mid-way teal.

### What `userInterfaceStyle: automatic` affects

Native chrome now follows the system: Android keyboard, native alerts and pickers (datetimepicker), `Alert`, and the system status/navigation bar defaults. The app's own screens do not change (they use the theme palette). Risk: on a Light phone with the app on Dark, native dialogs and the keyboard are light. Check these on device. `android.backgroundColor` moved from `#000000` to `#0B0E11`.

### Left as is

`#000000` remains only at `app.json` Noir alternate icon background (an icon colour, not a screen). `#052825` only in the Teal palette in `colors.ts`. Unused `loadingText` style in `first-insight.tsx` left.

## Part C progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (same 13 old warnings, none new), contrast audit 222 passed / 0 failed on Dark, Light and Teal (12 new checks for the two new hero grounds), motion test 12 passed, new `scripts/home-view.test.ts` 18 passed, touch-target audit lists nothing from the new files. No build, no OTA, no push, backend untouched. **No screenshots**: Home needs a logged-in session against the live backend and I have no test account, so Expo web would only have shown the login page. Owed on a phone, in Dark, Light and Teal.

### What was built

Top to bottom, as the Home board: avatar (initial on brand teal), greeting by time of day, streak chip, bell; stories row; hero; announcement slot; three tiles; Quick look peek stack; Today's rows; then everything Home already had.

1. **Hero** (`HomeHero.tsx`): safe to spend as a 48 px Inter 800 `RollingNumber` (tap still opens the "how we got this" explainer), the daily allowance line, a solid status pill (On track mint, Getting tight amber, Over white on red) and the payday countdown. The ground is `heroBg`, shifting over 2.2 s to new tokens `heroTight` (#8A5C06) and `heroOver` (#8E3030). Both added to all three palettes and to the contrast audit (white and 90% white text, 4.5:1).
2. **Slim bar** (`SlimHeroBar`): once the hero has scrolled out, a 48 px pill pinned under the status bar shows "Safe to spend", the amount and a status dot, on the same animated ground. Scroll drives a shared value, so scrolling never re-renders Home. Hidden from screen readers (it repeats a number already on the page).
3. **Tiles**: Spent today, Bills this week, Goal, each tappable (Transactions, Bills, Goals) with the press spring.
4. **Quick look peek** (`QuickLookPeek.tsx`): the top card of `GET /api/action-center/cards` (the same call the Action Center makes, minus answers already queued), two card edges behind it when more than one waits, merchant, the question, and "3 to sort" or "7 to look at". If that call fails, the old one-line Action Center card is shown instead.
5. **Stories** (`HomeStories.tsx`): gradient ring while unseen, plain ring once opened (uses the existing seen list). Opens the existing `/recap` screen.
6. **Today's rows**: today's transactions, up to five. On a day with none, the same slot is titled "Recent" and shows the latest five, so it never reads empty.
7. **Skeleton**: the Home skeleton now has the tile row and the peek card.

### Where every number comes from

- Safe to spend, daily allowance, over, days left: `GET /api/home/summary` (unchanged).
- Status pill: new `homeStatus` in `src/lib/homeView.ts`. Over when the server says over or nothing is left. Getting tight when the share of income still safe to spend is under 60% of the share of the month still to go. Income used is the larger of stated monthly income and this month's actual income, the same rule the server uses for safe to spend. No income known means no pill (no honest verdict).
- Payday countdown: `paydayIn`. Only when a deposit of at least half the stated monthly income has landed on the same day of the month in two or more of the last five months. Otherwise the line is left out. The cashflow forecast's `payDay` was not used: it defaults to 28 when it finds nothing, which is a guess.
- Spent today: today's `expense` rows in the shared list (account scope applies).
- Bills this week: `GET /api/bills`, active bills due today to six days ahead. Bills only; subscriptions are not counted, so the label does not say more than it knows. If the request fails the tile is left out. Zero shows "None due".
- Goal: `GET /api/goals`, the unfinished goal with the nearest deadline, percent floored and capped at 99. No goals shows "Set one" (opens Goals). If the request fails the tile is left out.
- Streak chip: the existing check-in streak (`getStreak`), shown only above zero.

### Where the announcement and journey cards sit now

- **Announcement card**: directly under the hero, unchanged component, before the tiles. Nothing was placed between the hero and it.
- **Journey card**: still directly below the Ask bar, unchanged. Order below the hero is now: announcement, tiles, Quick look, Today's rows, Ask bar, Journey card. Both previously sat higher on the page only because Budgets and the insight carousel were above Ask; those moved down.

### Could not match to the board, and why

- **Stories "60s lesson", "Badges", "Your cards" are not drawn.** There is no lesson content, no badge shelf and no cards gallery yet (Part G). A dead circle would be a made-up feature, so the row holds only real recaps: Yesterday, Last week, the month name (first 10 days of a month) and Wrapped (December). Add the other three when their screens exist.
- **Avatar** is an initial on teal, not the illustrated avatar (Part G builds the avatar builder).
- **Hero decoration** is the scallop at the top right; the board's small white pill shape is omitted.
- **Quick look card** has no swipe hint ("Swipe right to confirm") because swiping lands in Part D; the peek only opens the Action Center.
- **Hero footer** keeps only "After N in bills due" and "Updated ..." / "Offline". The in/out columns and "N transactions this month" were dropped (Money shows them).

### Decided myself / things that moved

- **RecapCard removed from Home.** It was the round 6 card for an unseen recap; the stories row now carries the same recaps with the same seen list, and keeping both would show each recap twice. The component file is untouched.
- **Set-up and prompt cards moved below the board content**: tip, trial chip, bank setup card, birthday cards, salary and manual-bank nudges. They used to sit above the hero and would have pushed it off the first screen. The account switcher stays up top (it renders only with two or more accounts).
- **Insight carousel and Budgets** are not on the board; kept, now after the prompts.
- **Reduce motion**: hero colour has no travel (set straight to the status colour), the amount renders plain (no roll), the slim bar appears with no fade or slide, tile and story presses do not scale, story and row entrances do not stagger. All through the existing primitives; on-device check with "Remove animations" is still owed.
- Payday and status rules above are product choices; flag if you want a different threshold.

## Part D progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (same 13 old warnings, none new), contrast audit 222 passed / 0 failed on Dark, Light and Teal, motion test 12 passed, new `scripts/quick-look.test.ts` 23 passed, touch-target audit lists nothing from the new files. No build, no OTA, no push, backend untouched. **No screenshots and no on-device swipe test**: the screen needs a logged-in session against the live backend and I have no test account. Owed on a phone in Dark, Light and Teal, plus the "Remove animations" check.

### What was built (`src/app/actions.tsx`, `SwipeCard.tsx`, `lib/quickLook.ts`)

1. **Header and progress**: round back button, "Quick look", and "5 things, about 1 minute" (12 seconds a card, never under a minute). Progress is one 6 px segment per card the visit started with (a single bar past 8), filled as cards are answered. Before this it counted from an index that never moved, so it stayed empty.
2. **Stack and top card**: two card edges behind the real card, then the card: tag chip (Sort this, Check this, Possible duplicate, Renewal...), `LogoTile` 60, merchant, `Amount` in Inter (negative for spending), the question, chips, "Always put X in Food" checkbox, "See the original alert" and "Report a problem".
3. **Question in the board's voice**: "Looks like **Food**. Right?" only when the server named a best guess. With no best guess the server's own question is shown untouched.
4. **Chips**: one per answer (44 px high, the board draws 36), single select, "Something else" opens the picker. Skip is its own button below.
5. **Swipe** (`react-native-gesture-handler` Pan, Reanimated): right confirms the selected chip, left opens the category picker. Buttons for both (pencil and tick, 64 px) with the same actions; Confirm is disabled until a chip is selected. Past 96 px commits, otherwise springs back. The card tilts a few degrees with the drag.
6. **Trail and haptic**: a card-shaped trail in the category colour (new `categoryHue`, decorative fill only) follows the card out and fades; a left drag trails amber. `haptic.tick()` on every answer. **Reduce motion**: no trail, no tilt, no fly-off, the answer applies at once and the next card appears; the drag itself still follows the finger.
7. **Up next**: the non-sort cards behind the top one (renewal, possible duplicate, bill due, own move, refund and so on) as rows with `LogoTile`, tag and question. Tapping one pulls it to the top, where it uses its own answer buttons. Skipped cards go to the back as before.

### Honouring `primary` (the 16 Nov fix)

- The selected chip starts as the answer the server marked `primary` and nothing else (`initialPick`). No primary means nothing selected, Confirm disabled, and a right swipe springs back with "Pick a category first, then confirm." No code path picks a default. A "Something else" answer is never pre-selected even if marked primary. `who_is_this` and other non-sort cards never get a selection from this screen; their buttons look filled only if the server said `primary`.
- The "Best guess" pill is no longer drawn (the question line says it); it stays in the accessibility label.
- Pinned in `scripts/quick-look.test.ts` (primary selected, no primary selects nothing, picker chip never selected, who_is_this never selected).

### Could not match to the board, and why

- **Sort kinds only are chip cards**: `category` and `grouped_category`. `who_is_this` and `cash` stay in the card shell with their own answer buttons (no primary to confirm, cash needs amounts), and swiping those only skips, as before. Swipe is never the only way for any kind.
- **Priority order wins over "sort first"**: the top card is whatever the server ranks first, so a priority-1 "is this money on your statement" card sits on top, not in Up next.
- **Checkbox default**: the brief says on by default. The server sends `checked: false` for single `category` cards and the old screen respected that (comment: "offered rather than assumed"). I followed the brief for sort cards (on), left every other kind as the server sends it. **Flag for the owner**: a single guessed purchase now makes a rule unless unticked. If you want the old default back for single cards it is `ruleDefault` in `lib/quickLook.ts`.
- **Board tilts the top card -2 degrees at rest**: not done, a resting tilt makes the card look mis-set. It tilts only while dragged.
- **Merchant logos**: `LogoTile` shows the glyph avatar or an initial until Part J supplies `logoUrl`.
- **Board's "More" chip** is labelled "Something else" (server text). **Source line** ("From GTBank alert, 1:12 pm") shows the server's `meta`, whatever it holds.
- **Ordering of Up next vs the stack**: sort cards behind the top one are not listed, only counted by the progress row and the stack edges.

### Queue numbers (Part D asked to log how often the queue exceeds 5)

**Could not get them.** `GET /api/admin/queue-breakdown` needs a super-admin login and I have no token or test account, and I did not look for one. Nothing was built to measure it and the cap (5, `backend/lib/actionCards.js`) is untouched. To get them: call that endpoint as the owner, per user if wanted (`?email=`). The brief's own figure is that the owner's queue went 15 to 7 on 15 Nov.

### Decided myself

- Progress, ETA and "done" now count the cards in the list, so skipped cards still count as waiting (they were already never "answered").
- The screen uses the board tokens (`canvas`, `card`, `cardBorder`, `textPrimary`, `textMuted`, `accent`); the old PanResponder skip-swipe and the slide animations are gone, replaced by `SwipeCard`.
- Header position label ("1 of 4") removed; the ETA line replaces it.

## Part E progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (same 13 old warnings, none new), contrast audit 276 passed / 0 failed on Dark, Light and Teal (54 new checks), `scripts/money-view.test.ts` 62 passed (the old 38 plus 24 new, including a multi-month custom range), motion test 12 passed, touch-target audit lists nothing from Money. No build, no OTA, no push, backend untouched. **No screenshots and no on-device check**: Money needs a logged-in session against the live backend and I have no test account. Owed on a phone in Dark, Light and Teal, plus the "Remove animations" check. I read the Money board and followed it.

### What was built

`src/app/(tabs)/transactions.tsx` (rebuilt header and list), new `MoneyRow.tsx`, `MoneyHeatmap.tsx`, `lib/moneyHeat.ts`, `lib/moneyTag.ts`, more helpers in `lib/moneyView.ts`.

1. **Month pill**: arrows plus the month name ("November 2026"). It goes back one month at a time to the oldest month we hold (never more than 36), and Next stops at this month. Tapping the month opens the existing date-range sheet, so Custom is still one tap away; with a custom range on, the pill shows "1 Oct to 16 Nov", the left arrow is off and the right one becomes a close button back to months. The old "This month / Last month / Custom" chips are gone (the pill replaces them).
2. **Money in / Money out tiles** with a leaf dot and an amber dot, full amounts in Inter 800 via `Amount`. New `fit` prop on `Amount` shrinks the type to one line; it never shortens the figure.
3. **Spending-days heatmap**: one cell per day, 10 columns, five-step ramp (`heat0` to `heat4` tokens, all three themes), today outlined, future days drawn as empty outlines. One tap target for the whole grid (a tap picks the nearest day and shows "Tue 10 Nov: ₦9,300 out" underneath, full amount). Caption defaults to the busiest day. Shown for a month or a custom range up to 62 days; longer custom ranges and the "Money in" filter hide it.
4. **Filter chips**: All, Money out, Money in, then the three biggest spending categories of the period. Chips own only Show and category; banks, sort and own-moves from the filter sheet are kept. The sheet is still there (filter button).
5. **Rows**: grouped by day, day header with day totals, `LogoTile` 42, name, category as a soft 16% tinted tag, then time and bank in muted text. Money in rows use the up-arrow `IconTile` (circle, leaf green) and a green plus amount. Swipe left to set a category, long press to select, guessed-category dot: all kept.
6. **Kept as they were**: account switcher, search, "N need a category" nudge, cash-to-log row, transfer confirm card, error banner, insight line, "Missing a payment?", footer count and "Includes N guessed categories", the offline and loading states.

### The numbers (nothing about what counts changed)

- Money in / Money out still come from `totalsOf` over `applyView`, which is unchanged: own moves, cash withdrawals, loans, reversals and failed rows stay out. `moneyMath.ts` was not touched. A test pins "heatmap total equals the Money out tile".
- Heatmap cell = sum of `expense` rows for that local calendar day over the same rows on screen. Level = day / biggest day in the period, rounded up to steps 1 to 4. So a day is "dark" relative to your own biggest day, not to a fixed amount. One huge day will make ordinary days read pale; I chose this over percentile ranking because it is explainable in one line.
- Day totals in the list still show in and out separately ("+₦15,000 · −₦4,500"), not a net, so nothing is hidden by netting.
- Month pill offsets 0 and -1 are exactly the old `rangeFor('month')` and `rangeFor('last')` (tested). Custom range maths is the old `rangeFor('custom')`, unchanged.

### The period filter (known sore spot)

`scripts/money-view.test.ts` passes, including a new three-month custom range check (first and last day both included, day before and after excluded) and a reversed range. The list stays inside an `ErrorBoundary` keyed on the selection, and the heatmap has its own boundary so a drawing failure cannot blank the list. I still cannot reproduce the 1 Nov crash without a device; the old Custom path (sheet, DateTimePicker, Show these dates) is the same code.

### Could not match to the board, and why

- **"Darker = more" is not true on Dark and Teal.** The board's own Dark ramp gets brighter as spend rises (mint #1DD3A8 is the top step). I followed the board's colours, and wrote the legend as "Less ... More" with the five swatches so it is true on every theme. On Light it is genuinely darker = more.
- **Heatmap cells are not 44 px**, they are about 27 by 22 as on the board. The grid is one 44 px+ target instead, and the screen-reader label gives the busiest day and the number of spending days.
- **Filter chips are 44 px touch height** (38 drawn), the board draws 36.
- **Heatmap low steps are decorative**: step 1 is 1.57 to 1.97:1 against the card on the three themes, below 3:1. Steps 3 and 4 clear 3:1 on all themes. No figure rides on colour alone because tapping a day shows the amount. Light "Money in" leaf dot is 2.4:1 on white; it sits next to the words "Money in".
- **Category tag text** is the category colour pulled toward white or black until it reads 4.5:1 on its tint (worst case across 19 colours is 4.60 on Teal), so tags are slightly paler or darker than the raw hue the board shows.
- **No logos yet**: `LogoTile` shows the glyph avatar or a coloured initial until Part J supplies `logoUrl`. Person rows show an initial tile.
- **Day total** shows in and out, the board shows one number.
- **Search** looks across all time as before and hides the pill, heatmap and chips.
- **Hide amounts**: with it on, the amount in a row blurs and a press on the amount itself peeks instead of opening the row (the rest of the row opens it).

### Decided myself

- Tag label "Cash" for a legacy `ATM/POS` category, "Sent to people" / "Received from people" for `Transfer`. Chips never offer Transfer, ATM/POS, Other or Other Income (retired in Round 10).
- Money tile colours follow the board (plain text, dots carry the colour); the old green Money in is gone.
- Row dividers removed (board has none). Insight line shows only on this month.
- "Sort them" pill raised to 44 px.
- New tokens `heat0` to `heat4` in all three palettes; `Amount` gained `fit`. `TxnRow` is untouched (Home, practice and sample screens still use it); Money now uses `MoneyRow`.

## Part F progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (13 old warnings, none new), contrast audit 330 passed / 0 failed on Dark, Light and Teal (54 new checks), new `scripts/plan-look.test.ts` 42 passed, `plan-view.test.ts` 11 passed, motion, home, money, quick-look and loading tests still pass. No build, no OTA, no push, backend untouched. **No screenshots and no on-device check**: Plan needs a logged-in session against the live backend and I have no test account. Owed on a phone in Dark, Light and Teal, plus the "Remove animations" check. I read the Plan board and followed it.

### What was built (`(tabs)/grow.tsx`, `PlanTimeline`, `BudgetJars`, `GoalCoinStack`, `SubsShelf`, `lib/planLook.ts`)

1. **Until payday**: bar from the last payday to the next, solid mint up to a today dot, an amber square per bill, renewal or regular payment due before payday, a green circle at the end, labels "Today, 17 Nov" / first bill and "+N" / "Payday, 30 Nov", and one pill. Payday is `paydayIn` from Part C (same detection as Home). With no payday found the bar runs 30 days from today, titled "Next 30 days", no green circle, plus "We have not found your payday yet." Payday today is not drawn as a countdown ("Payday is today."). Tap opens the cashflow forecast. Electricity is left off the bar: it is a "usually due" estimate, not a date.
2. **Budget jars**: static fill with a slightly wavy top edge, three per row, up to six, "All N budgets" below. Amber from exactly 80 percent used, a small alert icon beside the percent on amber and over (mint and amber are near-equal in lightness on Dark, so colour alone is not the cue). Over budget fills the jar, says "N% used" in the real percent and "N over". Each jar also shows the full amount left. No sloshing: the wave is a fixed shape. Tap opens Budgets.
3. **Goal coin stack**: five coins, filled for progress (rounded, but never five until the goal is met), dashed outlines for the rest, amounts, and a line of facts: "₦304,000 to go, by March 2027", "Goal reached", "Not started. Aim: ... by ...", or "... to go. The date has passed." Up to three goals, each its own card.
4. **Subscriptions shelf**: `LogoTile`s (4 shown), renewal label under each ("Today", "Tomorrow", weekday inside the week, otherwise "2 Dec"), amber within 7 days, header "Subscriptions · N" and "₦X a month", "+N" for the rest. Hidden when there are no active subscriptions (Coming up still links to them).

### Where a plainer line replaced a prediction (or the claim was left out)

- **"On pace for March" is not shown anywhere.** A goal's `current` is typed in by the user, goals keep no history of when it moved, and the app has no pace rule. Any finish month would be a new forecasting rule written in a UI part, so the line states what is left and the user's own deadline instead. If you want the pace line, it needs a rule decided first (for example from `createdAt` and `current`, with a minimum age), then a backend or `planView` change.
- **"No tight days ahead" and "Tight around 24 Nov" are only drawn when earned** (`timelineVerdict`). Otherwise: no income set gives "Add your monthly income to see tight days." (tappable); under a week of tracking gives "Tight days show after a week of tracking." (same rule as the forecast card); forecast failed gives "Tight days are not available right now."; fewer than three days of runway gives no pill and no line.
- **The window checked stops before payday**, and before the first income the forecast itself assumed if that comes first. The forecast endpoint adds income on its own `payDay`, and that is 28 when the history is thin, so a verdict past it would rest on a guess: it could hide a shortfall or invent a clear run. When the detected payday and the forecast's day agree, the window is the days before payday. Nothing is recomputed: the verdict reads the endpoint's own balance series.
- **Starting point caveat**: the forecast starts from this month's tracked income minus spending, not a bank balance (`startingFrom: this_month`). The existing "where November is heading" card already relies on that and still does. Worth saying in the build notes for testers.
- **Subscriptions with a date already behind us** show "No date", never amber and never "overdue". Yearly plans count a twelfth in the monthly total (same as the Subscriptions screen).

### Could not match to the board, and why

- **Board shows one goal**; I show up to three, one card each, because the old screen listed three.
- **Timeline labels are evenly spaced**, not under their marks (as on the board), so the middle label names only the first bill, with "+N" for the rest.
- **Jar fills on Light** are darker than the board's mint and amber (`planFill #0e8e91`, `planWarn #ad4f08`, `planPayday #047857`, new tokens in all three palettes): the board's fills vanish on a white card. Dark and Teal use the board's colours exactly.
- **Subscription logos** are the glyph avatar or a coloured initial until Part J supplies `logoUrl`; the board's image placeholder is not drawn.
- **Subscription total** is labelled "a month" as on the board; it is an estimate when yearly plans are present.
- **Board has no forecast card or Coming up list.** I kept both (deliberate, in use) and moved them below the four board pieces: order is Until payday, Budgets, Goals, Subscriptions, Where November is heading, Coming up, Owed to you, Income report. Flag if you want either removed; Coming up now partly repeats the bar and the shelf.
- **Plan skeleton** was left as Part B built it.

### Decided myself

- Reduce motion: the timeline fill, the marks, the jar rise and the coin drops each play once per session through new `useEntranceProgress` (rule `planEntrance` in `motionRules.ts`, tested); with "Remove animations" on, or after the first play, everything is drawn in its final state from the first frame.
- Contrast: jar fill, amber fill, dots, squares, circle, coin rim, empty-coin dashes and jar outline all clear 3:1 on their ground in the three themes; pill, percent, amber and over text clear 4.5:1. The mint-versus-amber lightness check is waived (documented in the audit) because shape, icon and label carry the state.
- `plan-view.test.ts` had a stale check (`shortNaira`, removed in Round 10 when amounts went full); I dropped that one line so the file runs. Nothing else in it changed.
- New `Forecast.payDay` optional field in `planView.ts` (the endpoint already returned it).

## Part G progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (12 warnings, all old, none from Part G), contrast audit 357 passed / 0 failed on Dark, Light and Teal (9 new checks), new `scripts/profile-view.test.ts` all passed, motion, loading, money, quick-look, plan-look, plan-view and why-category tests still pass. No build, no OTA, no push, backend untouched. **No screenshots and no on-device check**: Profile needs a logged-in session and I have no test account. Owed on a phone in Dark, Light and Teal, plus the "Remove animations" check. I read the Profile board and followed it.

### What was built

`(tabs)/profile.tsx` (new top), `ProfileParts.tsx` (`IdentityCard`, `StatsStrip`, `BadgeShelf`, `MyCards`), `AnkaraBand.tsx`, `AvatarArt.tsx` (`AvatarArt`, `UserAvatar`), new `avatar.tsx` builder screen, `lib/avatar.ts`, `profileView.ts`, `sharedCards.ts` (pure) with `avatarStore.ts`, `profileStore.ts`, `sharedCardsStore.ts` (storage).

1. **Header**: "You" and a 44 px gear at top right that opens `/settings` (Privacy and data, as before; Part H rebuilds it).
2. **Identity card** on `heroBg`: Ankara band, avatar overlapping it with a ring and a pencil (opens the builder), chip, name, "Member since August 2026 · Free plan".
3. **Stats strip**: day streak, sorted, goals hit. Counts only, no amounts. The old "Set aside for goals" amount stat is gone.
4. **Badge shelf**: 20-point `ScallopBadge`s, earned filled (mint, amber or leaf), locked grey (`border` fill) with a lock. Four show by default, "See all 11" shows the rest. Tap a badge to see what it is or how to get it.
5. **My cards**: thumbnails of past share cards, newest first, tap to share again, dashed empty tile until the first one.
6. **Avatar builder (P2)**: skin tone (6), hair (short, afro, braids, bun, none) and colour, headwear (none, cap, headwrap) and colour, glasses, background. Layered SVG with a soft clay highlight. Replaces the initial circle on Profile and on Home. Kept on this phone only (AsyncStorage, per account). Hair behind a cap or headwrap is trimmed so they do not clash.
7. **Ankara band**: original lozenge, dot and stripe pattern in theme tokens. No text is ever drawn on it, which is how the band stays contrast-safe; the audit covers what sits next to it.

### Real numbers versus empty states (the judgement call)

| Board element | What I did | Source |
|---|---|---|
| Level chip "Planner, Level 3" | **Not drawn.** There is no level engine and the brief rules one out. The chip slot shows this month's money personality name (e.g. "Soft Life Economist") when `computeArchetype` has one, otherwise nothing. | Real: `lib/archetype.ts` |
| XP bar "340 XP to Boss" | **Not drawn.** Where it sat, a "Setup 3 of 5" bar shows only while "Finish setting up" is unfinished, and goes away when it is done. It is a different thing from XP and is labelled as setup. | Real: `checklist()` |
| Member since | Read from the account id (a MongoDB ObjectId starts with its creation time). The server sends no created date. If the id is not an ObjectId the line is left out. | Derived: `memberSince()` |
| Plan | "Free plan", "Plus plan", or "Plus trial, 5 days left". | Real: `user.tierName`, `trialDaysLeft` |
| Day streak | The existing check-in streak (with its one free freeze a month). | Real: `getStreak()` |
| Sorted | The existing on-phone counter of transactions the user sorted. **It is per phone, not per account**, and it only counts from when the counter was added. | Real: `getSortedCount()` |
| Goals hit | Goals whose saved amount has reached the target. A goal the user deletes stops counting (goals keep no history). | Real: `/api/goals` |
| Badges | 11 badges, each earned from something already recorded: first sort, 50 sorted, 250 sorted, 7 and 30 day streak, goal set, goal hit, budget set, automatic tracking on, first recap watched, shared a card. Every one is earnable today. Earned ones are remembered per account on the phone, so a broken streak or a deleted goal never takes one back. A new account shows all 11 locked. | Real counts, local memory |
| My cards | Nothing existed: the app never kept the images it shared. From this build on, a card shared from Insights or a recap is copied into the app's documents folder and listed (newest first, 12 kept). **Empty for everyone until they share one**, and cards shared before this build are not recoverable. Cards carry no naira amounts (the share card never shows them). | New, local |
| Board's 14 badges, "Sapa-proof", "Soft Life Planner", "Next on 1 Dec" | Not copied: they have no rule behind them. | None |

### Could not match to the board, and why

- **No level, XP or level-gated anything.** See above. If you want them, it needs an engine decided first (what earns XP, the level names, what unlocks), then a backend or on-phone ledger. The Settings board's "app icon picker unlocked by level" (P15, Part H) has the same gap.
- **Avatar is local to the phone.** It does not follow the account to a new phone, and the backend has no field for it. Syncing it is a small backend change (one field on the user).
- **Avatar art is mine, not the board's**: the board has one hand-drawn example, so the parts (face shapes, hair, headwrap knot, cap) are my own drawing and will want a look on a device. Skin tones are six steps from light to very dark; add more if the owner wants.
- **Stat cards are 72 px tall** and the whole card is the tap target. Streak opens Insights, Sorted opens Quick look, Goals opens Goals.
- **Money personality card, Plus card, setup list, Quests and the old rows** (Money setup, Privacy, App with theme, Sign out) are kept below the new board pieces. The board has none of them, but removing them would orphan Hide amounts, App lock, the theme switch, notifications and sign out before Part H regroups them. Part H should absorb these rows. "Your profile" (the old tappable row to `/account`) is now a "Your details" row at the top of Money setup.
- **Birthday**: not touched. The editor still lives in `/account` and the setup checklist links there unchanged.
- **Hardcoded illustration colours** live in `constants/colors.ts` as `avatarArt` (same on every theme on purpose), so the no-raw-hex lint stays clean.

### Decided myself

- Badge names and the "how" lines are mine, short and plain. Streak badges use the existing check-in streak, not a new "longest streak" (the app does not store one).
- Sharing records a card only after the share sheet closes, and failing to save a copy never blocks the share.
- Existing Profile tests: there are none for the screen; the shared logic tests all still pass.

## Part H progress note (17 Nov 2026, mobile repo, one commit, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (12 old warnings, none from Part H), contrast audit 384 passed / 0 failed on Dark, Light and Teal (9 new checks), new `scripts/settings-view.test.ts` all passed, motion, profile, loading and plan tests still pass. No build, no OTA, no push, backend untouched. **Not run on a device or in a browser**: Settings needs a logged-in session and the reveal needs `react-native-view-shot` natively. Owed on a phone in all three themes, plus the "Remove animations" check and an interrupted switch (double tap).

### Settings rows, before and after

Before (old `settings.tsx` one long list, plus the two switches only Profile had) and where each lives now:

| Before | Now |
|---|---|
| Theme (Light, Dark, Teal) | Settings, Look and feel: three preview buttons with circular reveal. Profile's own theme switch is untouched |
| App icon | Look and feel row, opens `/app-icon` |
| Language (English, read-only) | Look and feel, plain row |
| How it works (replay) | Help and beta card |
| Help | Help and beta card |
| Beta tester switch, Send feedback form | Help and beta row "Beta and feedback", opens new `/settings-beta` (both unchanged) |
| Block screenshots | Privacy card switch (same store, still off by default) |
| App lock | Privacy card switch |
| Fingerprint login, PIN login (+ Change PIN), Auto sign-out, Change password | Privacy card row "Sign-in and password", opens new `/settings-security` (all unchanged) |
| Privacy and data card: read-only note, Help improve Automonie switch, Automatic tracking, Bank alerts by email, How we protect your data, Export transactions (PDF) | Privacy card row "Privacy centre", opens new `/privacy-centre` (all six, same wording) |
| Notifications card (new transactions mode, quiet hours, six category switches, birthday messages, show amounts) | Account and money row "Nudges and reminders", opens new `/settings-notifications` (component reused untouched), plus a Daily reminders link to `/reminders` |
| Delete account (card, password modal, Google fallback text) | Bottom of Settings on its own, calm red outline. Modal flow unchanged; the explainer moved from the card into the modal |
| Hide amounts (Profile only) | Privacy card switch (same store; Profile keeps its copy) |
| Header Info button | Dropped (its text described the old long list) |

After: 15 rows on the main screen, 25 more reachable from sub-screens. Search runs over all of them (`lib/settingsIndex.ts`, 41 entries); sub-screen settings show in an "Also found in" card that opens the screen. The test lists all 31 old settings by name and proves each exists and is found by its own name. `/api/features`: the old Settings had no gated rows, so none are gated now. Banks opens `/accounts`, never `/connect-bank`, so the hidden bank-linking, AI, bill-pay and shared-expense screens stay unreachable from here.

### What was built

`settings.tsx` rewritten; new `settings-security`, `settings-notifications`, `settings-beta`, `privacy-centre` screens (registered in `_layout.tsx`); `SettingsParts.tsx` (card, row with `IconTile` and subtitle, header, screen); `ThemeReveal.tsx` + `lib/themeReveal.ts`; `lib/settingsIndex.ts`. Chips are `StatusChip`s from real data: bank count from `/api/accounts`, budget count for this month, reminders on or off from the saved reminder prefs. Nothing shows until the answer arrives.

### Theme reveal (P10)

Picture of the old look, theme committed underneath it, picture of the new look, then a circle of the new picture grows from the tap point over the old one (460 ms). **The theme is set before any picture is shown**, so an interruption can only drop the overlay: it can never leave a half switch. A second tap, a failed capture or leaving the screen all just set the theme and remove the overlay; a failsafe timer removes it regardless. Reduce motion, no tap point or the same theme: plain `setMode`, no pictures. Limit: it covers the Settings screen only, not the status bar or other screens; the tap is on Settings so that is what the user is looking at.

### Decided myself

- **App icon picker is ungated.** There is no level engine (Part G), so I did not invent one or gate on something unrelated. The picker is the existing `/app-icon` screen (Default, Midnight, Noir) and it still tells the user when the installed build cannot switch icons. If a level engine arrives, gating is one condition on that row.
- **Block screenshots subtitle is "Blocks screenshots and screen recording across the app".** The board says "Stops screenshots of your money screens", which is not true: the guard sets the secure flag on the whole window (and covers the app in recent apps). I did not write a promise the code does not keep. Default stays allowed. Delete-account entry still forces a block while its modal is open.
- **Payday and budgets** opens `/budget`. There is no payday setting (it is detected from income), so the board's "25th" chip is not shown; the chip is the budget count.
- **Nudges and reminders** has no "Tone: Gentle" (no tone setting exists); subtitle is "What we tell you, and when", chip is Reminders on or off.
- Sub-screens exist because the old rows (forms, notification settings, PIN) cannot sit in a card of one-line rows. They are not on the board.
- Delete account confirm button in the modal is now a red outline (white on the old red fill was 3.76:1 on Dark and Teal).
- Selected theme border uses `primaryText` (mint fails 3:1 on the Light card).
- Spelling and copy: "Privacy centre" per the board. No emoji, em dash or "Transfer" in the diff.

### Could not match to the board

- Board's Banks chip "2 banks" and Nudges chip "Daily": only the real-data versions above.
- Board's App lock subtitle says "Fingerprint"; mine says "Fingerprint or face" because the setting uses whichever the phone has.
- Level chip, XP and "unlocked by level" copy: not drawn, see above.
- Profile still holds its own old rows (Money setup, Privacy and security, App) from Part G. I did not remove them, since Profile is not Part H; they point at the same stores, so nothing disagrees. Folding them into one place is a decision for the owner.

## Part I progress note (17 Nov 2026, mobile repo, one commit `87ccee1`, not pushed)

Status: built. `tsc` clean, `expo lint` 0 errors (12 old warnings, none from Part I), contrast audit 414 passed / 0 failed on Dark, Light and Teal (10 new checks plus 5 for the fixed-dark share card), new `scripts/birthday-view.test.ts` all passed, onboarding, profile, settings, home and motion tests still pass. No build, no OTA, no push, backend untouched. **Not run on a device**: the moment needs a logged-in account whose birthday is today. Owed on a phone in all three themes, plus the "Remove animations" check and a kill-and-reopen on the birthday.

### What was built

1. **Moment** (`app/birthday-moment.tsx`): Ankara band fading into the canvas (Part G's `AnkaraBand`, now taking `fadeTo`, `colors` and `idSuffix`), confetti, avatar with a clay party hat (`PartyHatAvatar`, the user's own Part G avatar plus a drawn hat), date eyebrow, "Happy birthday, {first name}", the board's line, primary "Get your birthday card", secondary "Go to Home".
2. **Once, and only with a birthday**: Home opens the moment when `shouldShowMoment` says so (birthday is today and today's day key is not the stored one). The screen writes the day key the moment it appears, not when a button is tapped, so killing the app and reopening the same day does not show it again. No saved birthday, never. It is also held back while the setup flow is still running. Rules are pure in `lib/birthdayView.ts` and tested: shows once, next year again, no birthday, half a birthday, 29 February on 28 February in normal years.
3. **Confetti**: 26 pieces (bars, dots, diamonds, naira signs, theme tokens), 1.8 s in total, visible "Skip" button. Reduce motion: no movement, 14 pieces sit still.
4. **Festive Home header (B3)**: on the day, an Ankara strip fading into the canvas above the greeting, and the greeting reads "Happy birthday". The old "Happy birthday" line on Home now says "Get your birthday card" and reopens the moment, so the card is reachable all day.
5. **Chip (B5)**: "6 days to your birthday" from 7 days out to 1 day out ("1 day to your birthday"), not on the day, not at 8 days. Boundary is tested, including across a year end.
6. **Birthday card**: `BirthdayCard`, in the Share card board's layout (Ankara frame, dark inner card, eyebrow, hat avatar, big line, one date chip, brand footer), story size 9:16. The button runs the existing share flow (capture to PNG, system share sheet, copy kept in My cards on Profile; plain text if sharing is unavailable). It carries a name and a day and month, no year and no naira amount.

### What happened to the old editor

The month-chip row and typed day box are **gone**. `BirthdayField` was rewritten: twelve month tiles, then a grid of that month's days (44 px circles), so only a real date can be picked and nothing is typed. It now lives on a new screen, **`/birthday`** ("Your birthday": Ankara-topped card showing the date as you pick, Save, Clear birthday). The Account editor (`/account`) no longer edits birthdays: it shows a read-only row "Birthday, 14 March, Change" that opens `/birthday`, and saving the profile no longer sends birthday fields. The Home "When's your birthday?" card with "Don't ask again" already existed (Round 6, reused, not duplicated) and now opens `/birthday`; the "Add your birthday" checklist rows on Profile and in setup point there too. The setup flow's birthday step uses the same new picker. The "Birthday messages" notification preference is untouched.

### Could not match to the board, and why

- **Hat and avatar are my drawing.** The board's avatar is a flat example; the hat is a clay cone on the user's own avatar, tilted. Wants a look on a device.
- **Confetti is on the canvas background, not under the Ankara band**, and the naira signs are the app font, not the board's Poppins 800 sizes exactly.
- **Date chip on the card, not three chips**: the board's chips are personality traits; a birthday card has none, so one date chip.
- **Card is the first version only**; the full card system is phase 2 (S14).
- **Setting a birthday needs the year-free picker only**: there is no calendar widget, by design (we never ask for a year).
- The moment's Skip button is a pill at top right, not on the board.
- Home's festive strip only draws on the day; "party look" beyond the strip (tinted hero etc.) was not attempted.

## Part J progress note (17 Nov 2026, backend + web + mobile)

Status: built and committed in `financial-app` and `finpilot-mobile`, not pushed. Backend `npm test` 74 of 74 files (new `logoService.test.js`, 53 checks), web build passes, mobile `tsc` clean and lint 0 errors. Not run against the live provider or production data, because no key exists yet. No EAS build, no OTA.

### Provider decision: logo.dev (not Brandfetch), with one condition

- **Brandfetch is out for this use.** Its comparison page says Logo API images "must be hotlinked rather than stored", and not downloaded, proxied or re-hosted; Brand Search results must not be stored at all. Our brief requires storing and serving from our own domain, so Brandfetch's Logo API breaks its terms.
- **logo.dev allows it, through its API.** The self-hosting page says every plan can download the images the API returns, keep them in our own storage or CDN and refresh on change. Its fair-use page forbids copying from the CDN (`img.logo.dev`) or running a server that fetches CDN images and passes them on. So the adapter (`lib/logoProvider.js`) only uses the secret-key API: `GET /v2/search` (name to domain) then `GET /v2/brands/logo` (download url and etag), and stores the file. It never touches `img.logo.dev`.
- **Free tier (Community):** 500K CDN requests a month (hard stop) and $5 of API credits a month; API credits are what our server-side route uses. **Free commercial use requires a visible "Logos provided by Logo.dev" link** on the production site. Paid plans remove it: Startup $33 a month (1M requests, $15 credits), Pro $150 a month (5M, $150 credits). The owner must either add that link (website footer or the app's About screen) or pay for Startup. I did not sign up for anything.
- **Cost at scale:** we resolve each merchant once (and re-check at most every 30 days), so spend follows the number of distinct merchants, not users or rows. A few thousand distinct merchants is a one-off of a few thousand search and logo calls, which should sit inside the $5 credit; the per-call credit cost is not published on the pages I read, so check the dashboard after the first week. `LOGO_DAILY_CAP` (default 300 resolutions a day) stops a bad day from running up credits.
- **Not verified against the live API:** the exact shape of `/v2/brands/logo` (`url`, `etag`) comes from the self-hosting page, not a live call, and the override domains marked in `lib/logoOverrides.js` are from memory. Do one live check with a key before relying on it. If the provider is unavailable or the terms change, the override list and hand-placed files keep working alone.

### Where images are stored

In MongoDB, collection `merchantlogos`, one document per merchant (128px webp, roughly 5 to 15 KB), served by our API at `GET /api/logos/<id>.img` with a 30-day immutable cache, ETag and a cross-origin resource policy so the web app can load it. This needs no new infrastructure and is fine into the low tens of thousands of merchants. Move to R2 if it grows past that; only the `store` object in `server.js` would change. You can also pin a hand-made image: put `<id>.png|webp|jpg` in `backend/data/logos/` and it is served as is, with no provider call.

### How the key is derived

`keyFor` in `lib/logoService.js`: the override list first (`lib/logoOverrides.js`: MTN, Airtel, Glo, 9mobile, DStv, GOtv, StarTimes, Showmax, Bolt, Uber, inDrive, Chowdeck, Glovo, Chicken Republic, Domino's, KFC, Jumia, Konga, Shoprite, Netflix, Spotify, YouTube, Apple, Google, Amazon, OPay, PalmPay, Moniepoint, Kuda, Paystack, Flutterwave, PiggyVest, Cowrywise and 15 banks), then the catalogue slug (the one subscriptions already use), then `deriveCategoryKey` words. Spelling variants ("N FLX", "NETFLIX.COM LAGOS NG") share one id. Overrides ask the provider by their pinned domain, so there is no name guessing for the common rows.

### Caching and privacy

- `POST /api/logos/lookup` (signed in) answers from the cache at once and queues anything missing in the background (one at a time, 150 ms apart), so no screen ever waits on a logo. A name with no logo yet gets one on a later ask; clients remember a miss for 5 minutes.
- Found is kept. "No logo" is cached for 30 days. A failed attempt (rate limit, timeout) backs off 1h, 2h, 4h up to 24h. A name already resolved or known to have none never reaches the provider until then. Tests cover all of this.
- Only business names go out: a pinned override, a catalogue brand, or a name `cleanName` calls a business. People and unknown names are never sent to the provider, so a stranger's name does not leave us and a person never gets a random company logo. The provider only ever sees a merchant name or domain, never a user id or amount. Those unknown small shops stay on the glyph or initial.
- Clients: mobile `LogoTile` now fetches its own logo when the caller passes none (`src/lib/logoUrls.ts`, batched, session-cached); all four callers (Money rows, Quick look, subscriptions shelf, Action Center) work with no change. `LogoTile`'s look is untouched. Web: the Transactions row avatar uses `src/lib/logoUrls.js`.

### Owner to do

1. Set `LOGO_DEV_SECRET_KEY` on Render (secret `sk_` key). Optional: `LOGO_DAILY_CAP`, `API_PUBLIC_URL` (defaults to the request host).
2. Add the "Logos provided by Logo.dev" link on the website footer, or upgrade to Startup.
3. Mobile needs a new build or OTA to show logos; web ships with the next deploy.
