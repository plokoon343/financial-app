# Round 7: pre-Play-Store audit (owner, 26 Oct 2026)

Goal: the next build is the Play Store candidate, so it must be right. Order: finish round 6 D and E, then these three audits (they can run in parallel; each only REPORTS + fixes small safe things in its own area, big fixes become a list), then one fix session, then the build, then the owner's phone test (round5 S9 checklist), then Play prep (round5 S11). Usage rules as round5-PLAN.md: fresh Sonnet session each, `get_usage` at start, budget below + 2 max, commit only own files, Trello card per audit.

## A1: Security audit (est. 4%). Prompt: "Read docs/briefs/round7-audit.md and do A1."
Backend (server.js, lib/), web app, mobile app, website forms. Check and report with severity (critical / high / medium / low), file:line, and a fix:
- Auth: JWT expiry and secret strength, password hashing, reset tokens (single use, expiry), two-step, Google sign-in token checks, rate limits on login/reset/OTP, account enumeration in messages.
- Access control: every `/api/*` route that takes an id checks ownership (userId) — list any that don't; admin routes behind `superAdminAuth`; public routes (`/api/public/*`, waitlist, inbound webhook, capture key routes, unsubscribe, delete-account link) can't leak or change other users' data.
- Input: NoSQL injection guard still on every route, file upload limits and type checks, PDF parsing limits, regex DoS in the parsers, HTML escaping in emails and the web app (no `dangerouslySetInnerHTML` from user data).
- Secrets: nothing secret in the repos, mobile bundle or website (search for keys), env names only in reports.
- Data: what reaches AI providers matches the privacy policy (stripping on every path), logs don't print alert text, tokens or passwords; CORS allow-list; security headers (CSP, HSTS) on web and site; mobile: SecureStore for tokens, no sensitive data in AsyncStorage/MMKV unencrypted beyond the cache, FLAG_SECURE default for the Play build.
- Dependencies: `npm audit` for backend, web, mobile, site; list high/critical with whether they're reachable.

## A2: Performance audit (est. 3%). Prompt: "...do A2."
Code-level (the owner measures on a phone later): Home summary is one request; list rendering (FlashList where lists are long, memoised rows, no inline objects); cached-first on every main screen (MMKV); bundle size and the biggest JS modules; images sized right (share art, logos); backend slow endpoints (add timing logs to the 10 most-used routes, find N+1 queries and missing Mongo indexes for userId+date queries); cold start work done before first paint. Report the top 10 issues by impact with fixes; fix the cheap ones (indexes, memoisation) directly.

## A3: UX and UI audit (est. 4%). Prompt: "...do A3."
Walk every screen in the mobile app (Expo web preview, `mobile-web` launch config, local API on a `*_test` DB with seeded data) in Dark and Light at 360 and 412 wide, plus the web app. Against `docs/design/screen-specs-v1.md` and the design pack bar: one job per screen, every number has a period, no broken empty states, no text under 12, contrast, + button never covers content, keyboard never covers inputs, tap targets 44+, back button behaviour, loading states (no blank or spinner where cache exists), copy rules (no em dash, no emoji, trust lines true), consistency (one card style, one list row), first-run experience (sign-up to first insight under 3 minutes). Output: a table # · screen · issue · severity · fix, with screenshots of the worst 10; fix small copy/spacing issues directly.

## F: Fix session (after A1 to A3; budget from their lists)
Fix every critical and high item from A1, the top performance items from A2, and the high UX items from A3. Then the build session (one EAS preview build carrying round 6 A's native fixes too, site link sync), then the owner's S9 phone test, then S11.

## Owner decisions recorded (26 Oct)
- Teal background request withdrawn.
- Email forwarding: keep Postmark's free tier for now (see the chat answer); revisit when volume grows.

## A2 results: performance audit (26 Oct 2026, Sonnet)
Code-level; numbers below are from the local API on a throwaway DB with 5,000 transactions (relative, not phone timings). Backend and mobile commits: see git log "Round 7 A2".

| # | Issue | Impact | Status |
|---|---|---|---|
| 1 | Home needed 5 requests on every open (summary, bell count, reminders, budgets, plus the transaction list). The bell count pulled 50 full notification rows just to read a number. | High | **Fixed:** the Home summary now carries the bell count and this month's budgets; Home makes 3 requests (summary, reminders, transactions). Older servers still work (the app falls back to the two old calls). The brief's "one request" is not reachable while Reminders and the shared transaction list are separate. |
| 2 | The Home summary rebuilt the whole Action Center (subscription detection, duplicate scan, sender grouping) on every Home open, and the Reminders call did it again. 276 ms cold. | High | **Fixed:** 20 second per-user memo used by Home and Reminders; the Action Center screen still builds fresh. Warm: 24 ms. |
| 3 | `GET /api/transactions` returns every row, every time, unpaginated (5,000 rows: about 190 ms locally and a large JSON for the phone to parse and rewrite to MMKV on every refresh and every edit). | High | Partly: `.lean()` added (no Mongoose document wrapping). **Open (needs a design):** a "changed since" sync (`?since=` with `updatedAt`, plus deletions) so a refresh sends only what changed, and storing the cached list in chunks. |
| 4 | Missing Mongo indexes for the common per-user queries. Only `{userId, date}` and `{userId, importBatch}` existed. | Medium | **Fixed:** added `{userId, type, date}` (spend and income reads), `{userId, category}` (needs-a-category count), sparse `{userId, reference}` (self-transfer pairing). Mongoose builds them on the next deploy start (one-off, a few seconds on a large collection). |
| 5 | No visibility into slow routes. | Medium | **Fixed:** every API request is timed; anything over 600 ms logs `[slow] METHOD route ms` (route pattern only, no ids, query or body; `SLOW_REQUEST_MS` changes it); `GET /api/admin/perf` (superadmin) lists count, average, p95 and worst per route since the last restart. Use it after a few days of real use to pick the next fixes. |
| 6 | Money is a `SectionList` with swipeable rows. FlashList is installed but only the bank picker uses it; the longest list in the app is not on it. | Medium | **Open:** convert Money to FlashList (flat data with day headers as items, sticky header indices). Needs on-phone testing, so it goes to the fix session, not a blind change. |
| 7 | Cold start has a fixed intro animation (about 0.8 s) before routing even when the session and cached Home are ready. | Medium | **Open (cheap, a decision):** play it only on first launch, or let routing start under it. |
| 8 | Bundle images: `texture-full.png` 570 KB, `logo-glow.png` 331 KB, two app-icon previews 185 KB each, 8 personality images 77 to 126 KB. All ship in the app. | Low to medium | **Open:** resize the texture and glow (visible change, so the owner should approve); load the icon previews lazily. |
| 9 | `@gorhom/bottom-sheet` is installed but unused; sheets are RN Modals. | Low | **Open:** only worth doing if the sheets feel slow on the phone. |
| 10 | Home and Plan recompute insight rows over the whole transaction list when it changes; admin stats runs a count per user (admin only). | Low | **Open:** fine at today's sizes; revisit with #3. |

Not measured here: cold start to Home on a phone, tab-switch time and scroll frame rate (the owner's S9 timings). Backend `npm test` 47/47; checked on a test DB: summary fields, warm and cold timings, the perf table.

## A1 results: security audit (26 Oct 2026, Sonnet) - PARTIAL, stopped at the usage guardrail

Full report: `docs/security/round7-a1-audit.md`. Backend `f864283`, pushed. `npm test` 47/47.

Covered: JWT (secret strength, now-pinned verify algorithm), password hashing, password-reset token single-use/expiry, 2FA, Google sign-in token verification, rate limits on auth routes, account-enumeration in messages, and a spot-check of about 20 of the roughly 50 `:id` routes for userId ownership (all correctly scoped). **Fixed:** `jwt.verify`'s two call sites now pin `algorithms: ['HS256']` instead of relying on the library's default inference - low exploitability as it stood, a one-line hardening regardless.

**Nothing critical or high found so far** - but this is a first-pass finding, not a clean bill of health: the session stopped at the weekly usage guardrail (~50%) before reaching input handling (NoSQL guard coverage, upload limits, PDF-parsing limits, regex-DoS), secrets (the grep across all four repos + the mobile bundle), data handling (AI-provider stripping, log hygiene, CORS, CSP/HSTS headers), mobile storage (SecureStore/MMKV/FLAG_SECURE - likely fine per earlier sessions' work, not re-confirmed), `npm audit` in any of the four repos, the web app, the mobile app, or the website. The remaining ~30 `:id` routes also still need checking.

**A follow-up A1 session should finish the rest of the checklist before the F fix session starts** - treat this round's "no critical/high" as provisional, covering roughly 40% of the brief.

## A3 results: UX and UI audit (26 Oct 2026, Sonnet)

Full report with the findings table and screenshots: `docs/briefs/round7-a3-ux-audit.md` (screenshots in `docs/design/round7-a3/`). Mobile `56ab766`, pushed. `npx tsc --noEmit` and `npx expo lint` both clean (lint's 9 warnings are pre-existing, unrelated to this change).

Walked the mobile app via the Expo web preview against a seeded local API (new `api-test` launch config on a throwaway DB), Light/Dark at 360/412, plus a pass over the web app at desktop and 375 width.

**Critical finding: the bundled Poppins font has no glyph for the ₦ (NAIRA SIGN, U+20A6) character** - confirmed with `fontTools` against the actual `.ttf`. In the Expo web preview this corrupts every single money amount in the app (a line drawn through the whole number, not just the ₦) because React Native's `fontFamily` takes one font with no fallback stack; the web app is unaffected because its CSS declares a font stack that lets the browser swap just the missing glyph. Root cause is certain; whether the same *visual* corruption reproduces on real iOS/Android (native font-fallback engines may handle a missing glyph more gracefully than this Chromium environment did) is not confirmed - put it first on the S9 phone-test list. Not fixed here: this needs a real decision (render ₦ separately in a font that has it, or switch fonts) and device verification, not a blind inline edit.

**Fixed directly:** inconsistent decimal display in the mobile transaction list (`-₦500.00` next to `-₦3,600` in the same list) - `lib/format.ts` now shows kobo only when an amount actually has them, regardless of size.

Six more findings (Medium/Low): unlabelled Sign In button for screen readers, "Create one" routing through the onboarding carousel instead of straight to register, two different recap interstitials stacking on first session view, a clipped plan label on Profile, an unlabelled web settings icon, and a `transform-origin` console warning whose source wasn't pinned down in the time available. Full detail and fixes in the linked report.

**Also checked and found NOT to be a bug:** the web app's responsive sidebar (a first look mid-resize was misleading; a fresh load and a real rotation both reflow correctly), and the "9 to review" (Home) vs "3 alerts" (Action Center) counts (they reconcile - alerts + recurring-charge candidates).

**Not done this round:** Goals detail, Subscriptions, Bills, Settings sub-screens, Connect Bank, Ask assistant, and a line-by-line diff against `docs/design/screen-specs-v1.md` (this was a checklist walkthrough, not a spec diff).
