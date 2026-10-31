# Round 9, B1 + B5: a support system people rarely need (31 Oct 2026, Sonnet)

Mobile commits (see git log "Round 9 B1"): `3735d37` (B1.3), `bdd8387`
(B1.5), `efa2551` (B1.1), `2964280` (B1.4). `npx tsc --noEmit` clean after
every commit; `npx expo lint` clean on every file this session touched
(remaining warnings are pre-existing, in files this session didn't touch).

## B1.1: every error says what happened and offers the fix

**Correction to this brief:** re-read the brief's framing closely - B1.1 asks
for an audit (a list) with the worked example built, not a rewrite of every
error string in the app. That's what's here.

**The real gap, found and fixed:** `components/ui.tsx`'s `ErrorBanner` - used
at 32+ call sites across the app - only ever rendered a text message. No
screen could offer the brief's own example ("We couldn't read this
statement... [Try again] [Upload another] [Send it to us]") without building
its own banner from scratch, which nobody had done. Added an optional
`actions` prop (backward compatible; every existing caller is untouched) and
wired it into `import-statement.tsx`'s actual failure-to-read case - the one
case in that screen that previously fell through to a plain "Could not read
this statement." with no way out. It now offers Try again, Upload another,
and Send it to us (reusing the existing `/api/support/tickets` endpoint and
"the file itself was not sent" pattern that the balance-mismatch case
elsewhere on the same screen already used).

**Audit of the rest, honestly:** grepped every `errMessage(e, '...')` fallback
(116 call sites) and `toast.error(` (14) across the app. Before treating that
as 116 problems, checked `lib/api.ts`'s `errMessage()`: it already prefers
the **server's own message** (`error.response?.data?.message`) and only
falls back to the local string on a genuine network failure or an
unexpected shape - and it already has a specific, actionable line for the
most common real failure, a cold-starting server: *"Request timed out. The
server may be waking up - try again."* So most of those 116 are a
last-resort safety net, not the primary UX; the quality of what the user
actually sees usually depends on the **backend's** message, not the
frontend fallback. `Alert.alert()` dialogs (14 files) are a separate,
healthier case: native alerts are buttons by construction, so anything
already routed through `confirmDestructive`/`Alert.alert` structurally
satisfies "offers the fix as buttons" already.

**Confirmed, real dead end (not fixed - needs its own UI, flagged for the
fix session):** `backend/server.js` has `POST /api/billing/auto-renew`
(stop a Paystack Plus subscription from renewing) with **zero callers
anywhere in the mobile app** - grepped the whole repo. `plans.tsx` has a
"Manage in Google Play" button for Play-billed users but nothing equivalent
for Paystack-billed ones. Invisible today only because the paywall is off
(`free` short-circuits the whole plans list in `plans.tsx`); a real dead
end the moment Plus goes live and someone on the beta APK wants to cancel.

**Worth the same `ErrorBanner.actions` treatment, not done this session**
(same shape as the statement-upload fix, cheap once the primitive exists):
`sms-import.tsx`'s scan-timeout/read-fail errors (already have good *text*,
e.g. "Try a narrower period, or paste an alert instead." - but that's
prose, not a tappable fix), and `email-forwarding.tsx`'s setup failures.

## B1.2: status, not silence

Mostly already true, checked rather than assumed:
- **Automatic tracking** (`automatic-tracking.tsx`) already shows per-source
  status rows (last alert time per source, app count) and a "Test it"
  button (round 6 A) - confirmed still present and correct.
- **Money** and **Home** both show `Updated {agoLabel(...)} ago` in their
  footer - confirmed in code (`lib/format.ts`'s `agoLabel`), not just
  screenshots from an earlier round.
- **Import progress**: `import-statement.tsx` already shows upload % then a
  live running clock ("Reading every page and checking the balances (Ns)")
  - never a silent spinner, confirmed in code.
- **Email forwarding**: already shows a live status line (confirmed round 7:
  "Waiting for your first forwarded email…" → connected).
- **New this session**: `/setup-check` (B1.5, below) is itself a
  status-not-silence screen - it exists specifically because the pieces
  above are scattered across different screens and there was nowhere to
  see all of them at once.

**Gap, not fixed:** static CRUD screens (Goals, Bills, Subscriptions) don't
show a "last updated" stamp - judged acceptable, since those are
user-entered records with no import pipeline behind them to go silent, not
genuinely a silence risk the way SMS/notifications/email are.

## B1.3: Undo

**Correction to this brief:** the note at the top says "Undo is not built...
B1.3 builds it" - that was stale. `lib/undo.ts` (a 10 s-delay
commit-or-undo primitive, now bumped from the 5 s it shipped with) and its
`<UndoBar/>` host already existed, already wired into account deletion,
subscription deletion/dismissal, and Action Center dismissals. What was
missing was the three **transaction-level** actions the brief names by
name: delete, recategorise, mark-as-transfer. Wired `undoable()` into
`transaction.tsx` (delete, "not a transaction", mark/unmark-transfer) and
`transactions.tsx`'s `saveCategory` (covers both the single swipe-recat and
the bulk multi-select one, in one place). `toggleInternal`'s optimistic
local state mirrors the backend's own `unmark-transfer` rule (amount sign
decides income vs expense) so what's shown during the undo window matches
what the server will actually save when it commits.

## B1.4: empty states that teach

`components/EmptyState.tsx` already does almost all of this well: a
themed illustration, a title, an explanatory message, and (where used) one
action button - already true for Transactions, Statements, Budget, Action
Center, Notifications, History, Shared and Cash before this session.
**Gap found and fixed:** Goals, Bills and Subscriptions had a message that
implied an action ("Create a savings goal...") with no button to take it -
they relied on the screen's header "+" instead. Added `actionLabel`/
`onAction` to all three, wired to the same add-form toggle the header "+"
already used, so there's no duplicate code path, just a second way in.

## B1.5: "Check my setup"

New `/setup-check`, reachable from a quiet text link at the bottom of Help
(deliberately not a pill like "Show me the tour again" - this is for the
minority who want to see every permission and source at once, not a
front-and-centre feature). Rows: notifications allowed, bank-app
notification access, SMS permission (Android), email forwarding, last
alert per source, app version/build, and free device storage
(`expo-file-system`'s `Paths.availableDiskSpace`). Green tick / amber /
off per row, with a one-tap fix wherever one exists (request the OS
permission directly, open system Settings for notification access, or go
set up email forwarding). Re-checks on screen focus, so coming back from
system Settings after fixing something updates without a manual pull-to-
refresh.

## B5: flow audit (first-time user)

Read each flow's actual screen code rather than guessing from memory.
**Not verified live on a device or in the browser preview this session** -
noted per-flow below; most were corroborated against round 7's screenshots
where the browser preview did work, or judged directly from the
validation/error copy in the code, which is a reasonable proxy for "will a
first-time user get stuck here."

| # | Flow | Steps / copy | Confusing words | Dead ends | Verdict |
|---|------|---|---|---|---|
| 1 | Add a transaction | Amount → description → category → date → paid-from; each missing field gets its own specific message ("Pick where this was paid from.", not "Fill in the form") | None found | None found | Clean |
| 2 | Upload a statement | Pick → (password if needed) → review → reconcile | None found | **Fixed this session**: a read failure used to be a dead-end text banner; now offers Try again / Upload another / Send it to us | Fixed |
| 3 | Turn on SMS | Permission request → scan → review. `permDenied` and `scanTimeout` strings already name a fallback ("paste an alert instead") in the error text itself | None found | None found | Clean |
| 4 | Set up email | Covered in round 7's live-browser pass: clean step-by-step guide, address with a copy button, live status | None found | None found | Clean (not re-verified live this session) |
| 5 | Create a budget | Category → amount; the start date (this month vs next, by the 20th-of-the-month rule) is computed *and shown* to the user before saving ("Starts 1 November and repeats every month") | None found | None found | Clean |
| 6 | Create a goal | Name → target → deadline → Create. Empty state lacked its own button - **fixed this session** (B1.4) | None found | Fixed | Fixed |
| 7 | Start Plus | **Not reachable to audit live**: `plans.tsx` hides the entire plan list while the paywall is off (`PAYWALL_ENABLED` default off, confirmed in code - "Everything is free while Automonie is in beta" is the only thing shown). Read the purchase code path directly instead: Play builds buy through Google Play's own sheet (`buyOnPlay`); the beta APK uses Paystack checkout (`api.post('/api/billing/checkout')`) - both look complete and correctly gated, just currently dormant | - | - | Can't verify live; code looks sound |
| 8 | Cancel Plus | Play-billed users get a clear "Manage in Google Play" button, which is correct (Play policy requires cancellation to go through Play's own UI). **Paystack-billed users have no way to cancel in the app at all** - the backend route (`POST /api/billing/auto-renew`) exists with zero UI callers anywhere in the mobile app (confirmed by grep). Invisible today only because the paywall is off | - | **Real dead end**, currently masked by the paywall being off | **Needs building** before Plus goes live for non-Play users |
| 9 | Delete account | Danger-zone copy is honest and specific ("straight away... can't be undone"), offers a clear workaround for Google-sign-in users with no password (automonie.com/delete-account) | None found | None found | Clean |

**Headline finding: item 8.** Not fixed this session (a cancel flow needs
its own confirmation copy and a decision on immediate-vs-end-of-period
cancellation, not a blind wire-up) - flagged for the F fix session, with a
note that it's currently invisible only because of the paywall state, so
it's easy to forget until the day it actually matters.

## Analytics events

None of B1/B5's work added new user-facing flows that need their own
events beyond what already exists (`logEvent` for insights, nudge-opened
tracking already in place). The Undo/ErrorBanner/EmptyState changes are
UI-only on top of existing save/delete calls, which are already the thing
getting measured. `help_opened`/`help_article_viewed`/etc. (B4's events)
were not touched - out of scope for B1/B5.

## Not done this round (stopped at the usage guardrail on the first attempt,
then continued; this is the honest final scope)

- The ~116-string frontend error audit was characterised (see B1.1) rather
  than itemised string-by-string - itemising all 116 would mostly be
  re-stating "Could not X. Try again." with minor wording differences; the
  systemic finding (ErrorBanner couldn't show buttons at all) was the thing
  worth fixing.
- `sms-import.tsx` and `email-forwarding.tsx` error cases that would
  benefit from the new `ErrorBanner.actions` the same way the statement
  upload now does.
- A live, on-device (or live browser preview) walkthrough of all nine B5
  flows - this round's audit is a careful code read, not a recorded click-
  through; flows 1-6 and 9 should be quick to spot-check on a phone, flows
  7-8 need the paywall turned on first.
- The cancel-Plus UI for Paystack-billed users (item 8 above).
