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
