# Round 7, A1: security audit (26 Oct 2026)

**Status: PARTIAL.** Stopped at the weekly usage budget guardrail (50%) before covering the web app, mobile app, the website, `npm audit`, and the secrets grep. What is below is real - each finding was read in the actual file, not guessed - but it is only the backend auth/access-control/data-handling checks. A follow-up session should finish the rest of the A1 checklist (frontend/, finpilot-mobile, automonie-web, dependency audits, secrets grep, CORS/CSP/HSTS headers, mobile SecureStore/MMKV/FLAG_SECURE) before the F fix session starts.

Severity: critical / high / medium / low. "Fixed" means done in this session's commit; everything else is a listed fix for the F session.

## Auth

| # | Finding | Severity | File:line | Fix | Status |
|---|---|---|---|---|---|
| 1 | `jwt.verify` (two call sites) did not pin `algorithms`, relying on the jsonwebtoken library's default inference from the secret type. Low exploitability in practice (a string secret already restricts verification to HMAC algorithms, so this is not an active "alg: none" bypass today), but it is a one-line hardening and a common audit flag. | Low | `backend/server.js:2148` (the `auth` middleware) and `backend/server.js:234` (the rate-limiter key generator) | Pass `{ algorithms: ['HS256'] }` to both `jwt.verify` calls. | **Fixed** |
| 2 | JWT secret: fails fast and refuses to start if `JWT_SECRET` is unset - no fallback to a public/default value. | - | `backend/server.js:151-156` | None needed. | Confirmed good |
| 3 | Password hashing: bcrypt, cost factor 10, used consistently (register, Google-random-password, change-password, reset-password, student verification). 10 is an acceptable minimum; 12 would be stronger but this is not a finding worth blocking on. | Low | `backend/server.js:2228-2229` and 4 other `bcrypt.hash(..., genSalt(10))` call sites | Consider bumping to 12 in a future pass; not urgent. | Reported only |
| 4 | Password reset tokens: hashed at rest (`hashToken` = SHA-256), checked against `resetTokenExpiry: { $gt: new Date() }`, and cleared (`resetToken = undefined`) on successful use - single-use and time-boxed. There is a narrow, low-value TOCTOU: the token is read with `findOne` and cleared with a separate `.save()`, not an atomic `findOneAndUpdate`, so two requests racing within the same request-handling window could both succeed before either clears the token. Requires already knowing/guessing the raw token, which the hash and the auth-rate-limiter already guard against. | Low | `backend/server.js:2858-2875` | Make the "claim" atomic: `User.findOneAndUpdate({ resetToken, resetTokenExpiry: { $gt: now } }, { $unset: { resetToken: 1, resetTokenExpiry: 1 }, $set: { password, sessionsValidFrom: now } })`, then hash the new password before that call. | Reported only |
| 5 | Two-step verification (email OTP): code hashed (`hashToken`), 15-minute expiry, checked and cleared on success. Account-deletion link tokens (`DeletionRequest`) are claimed atomically via `findOneAndDelete`, which is the stronger pattern - worth applying the same pattern to password reset (finding 4). | - | `backend/server.js:2298-2320` (OTP), `2793-2796` (deletion link, atomic) | None needed beyond finding 4. | Confirmed good |
| 6 | Google sign-in: verifies the ID token against `GOOGLE_CLIENT_IDS` via `google-auth-library`'s `verifyIdToken`, checks `payload.email_verified`, and never trusts a client-supplied email directly. | - | `backend/server.js:2397-2415` | None needed. | Confirmed good |
| 7 | Rate limits: `authLimiter` (20 / 15 min, keyed by IP) covers register, login, verify-OTP, resend-verification, Google auth, forgot/reset-password, account-deletion request, waitlist, newsletter subscribe, admin setup. Login itself shares this general limiter rather than having its own tighter one; 20 attempts per 15 minutes per IP is on the generous side specifically for password-guessing against one account (mitigated by bcrypt's cost, but still worth narrowing). | Medium | `backend/server.js:244-250`, used at `2286` (`/api/login`) | Add a second, stricter limiter for `/api/login` specifically (e.g. 8-10 / 15 min), or key the general one by `email + ip` so one IP can't exhaust attempts across many accounts, or vice versa. Needs care since `authLimiter` is shared by 12+ routes with different risk profiles - a real F-session fix, not a one-liner. | Reported only |
| 8 | Account enumeration: `/api/login` and `/api/forgot-password` both return deliberately generic messages ("Invalid credentials", "If an account with that email exists..."). `/api/register` returns "User already exists" when the email is taken, which does confirm an email is registered - standard practice for most sign-up flows, low severity, not worth the UX cost of hiding it. | Low | `backend/server.js:2252` | None recommended; noting for completeness since the brief asked to check for it. | Reported only |

## Access control

| # | Finding | Severity | File:line | Fix | Status |
|---|---|---|---|---|---|
| 9 | Spot-checked roughly 20 of the ~50 routes that take an `:id` (notifications, transactions, goals, bills, contacts, accounts incl. merge's *destination* id, subscriptions, pending-alerts, nudges, cash-allocation, mark/unmark-transfer, categories, rules) - every one filters its Mongoose query by `userId: req.user._id` (or is behind `superAdminAuth` for the admin routes, which legitimately reach any user's data). Did **not** have time to check the remaining ~30 before the usage guardrail. | - | `backend/server.js` (sampled lines across 2996-8776) | **Finish the remaining ~30 `:id` routes in a follow-up pass** - this is the single most important unfinished piece of this audit. A quick way to scope it: `grep -n "app\.\(get\|post\|put\|patch\|delete\)('/api/[^']*:id" backend/server.js` lists all 50; cross off the ones already checked here. | Reported only, unfinished |
| 10 | `GET /api/newsletter/asset/:id` has no `auth` middleware and does not check ownership. By design: it serves a newsletter's embedded image so it loads in email clients that can't send an Authorization header. The asset itself is not user-specific (no `userId` field on `NewsletterAsset`), so there is nothing to leak beyond "which newsletter image exists at this id," which is not sensitive. | - | `backend/server.js:3485-3491` | None needed; confirming it's intentional, not an oversight. | Confirmed good |
| 11 | `POST /api/account-deletion/confirm` and `GET /api/account-deletion/:token` operate on a one-time hashed token (not the user's Mongo id), claimed atomically with `findOneAndDelete` - cannot be used to target an arbitrary account by guessing an id. | - | `backend/server.js:2793-2820` | None needed. | Confirmed good |
| 12 | `/api/public/promo` is the only route under `/api/public/*`; it is read-only (a promo banner), takes no id, and returns nothing user-specific. | - | `backend/server.js:3346` | None needed. | Confirmed good |

## Input handling

Not reached before the budget guardrail - NoSQL-injection guard coverage, file-upload limits, PDF-parsing limits, and regex-DoS risk in the parsers still need checking. (Memory from an earlier session notes a NoSQL-injection guard was already added in a prior security pass - worth confirming it still covers every route rather than assuming.)

## Secrets, data handling, dependencies

Not reached before the budget guardrail. Still to do: grep all four repos + the mobile bundle for hardcoded keys (report env var names only); confirm AI-provider stripping matches the privacy policy on every code path; confirm logs never print alert text/tokens/passwords; CORS allow-list review (a `allowedOrigins` list exists at `backend/server.js:166-169` - worth a closer look at whether it's enforced correctly and whether `ALLOWED_ORIGINS` extra-origin parsing is sound); CSP/HSTS headers on the web app and the marketing site; mobile SecureStore-for-tokens / MMKV-cache-only / FLAG_SECURE-default-for-Play-build (this project's own history says `screenSecurity` already defaults `true` for the Play variant via `isPlayBuild` - worth a quick re-confirmation, not a full re-audit); `npm audit` in backend, frontend, finpilot-mobile and automonie-web.

## Summary for the F fix session

**Fixed now (small and safe):** #1 (JWT algorithm pinning, both call sites).

**Worth fixing in the F session, ranked:**
1. Finish the `:id` ownership-check sweep (#9) - unfinished, not necessarily broken, but needs to be finished before Play submission.
2. Narrow `/api/login`'s rate limit (#7).
3. Make password-reset token consumption atomic (#4).
4. Everything under "Input handling" and "Secrets, data handling, dependencies" above - entirely unaudited this round.

**Nothing found so far rises to critical or high.** That is a meaningfully smaller finding set than a from-scratch audit would normally produce for an app this size, which most likely reflects that only ~40% of the checklist was covered, not that the other 60% is clean. Treat this report as a solid first pass on auth/access-control, not a clean bill of health for the whole product.
