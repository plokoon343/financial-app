# Data inventory (NDPC/NDPR, round 5 section 14)

What personal data Automonie holds, where, why, who else touches it, and for how long. Written to match `automonie-web/src/pages/privacy.astro` (effective date at the top of that file is the version stamped on new consent records, see `backend/lib/compliance.js`). Where this file and the live privacy policy disagree, the policy wins until one of them is corrected; see "Mismatches found" at the end.

MICADOT-NG LIMITED is the controller. Processors and independent third parties are listed per field below, short name only; full description is in privacy.astro section 11.

## Identity and account

| Field | Model / collection | Why we hold it | Who processes it | Retention |
|---|---|---|---|---|
| Name, email, phone | `User` (backend/server.js) | Account identity, contact, support | Render (hosting), MongoDB Atlas (storage), Brevo (email) | While account open; deleted on account deletion (see below) |
| Password | `User.password` (bcrypt hash only) | Authentication | Render, MongoDB Atlas | While account open |
| Google profile id/name/email | `User.googleId` | Google sign-in | Google (identity provider), Render, MongoDB Atlas | While account open |
| Session token (JWT) | not stored server-side; `User.sessionsValidFrom` marks tokens before it invalid | Authentication | Render | Token itself expires in 30 days; `sessionsValidFrom` kept while account open |
| Security events: login, password change, password reset, logout-all | `SecurityEvent` | Matches privacy.astro 4.3's promise to keep "records of security events" | Render, MongoDB Atlas | 12 months (TTL index), matching privacy.astro 13.2 "security logs" |
| Consent records: terms, privacy, training (Help improve Automonie), notification access, email forwarding, beta | `Consent` | NDPA proof of what was agreed to and when | Render, MongoDB Atlas | While account open; deleted on account deletion |
| 2FA / app-lock preference, notification/privacy settings | `User` (various fields) | Personalisation, security | Render, MongoDB Atlas | While account open |

## Financial data

| Field | Model / collection | Why we hold it | Who processes it | Retention |
|---|---|---|---|---|
| Transactions (date, amount, direction, description, category, bank, account mask, source) | `Transaction` | Core of the Service | Render, MongoDB Atlas; Google Gemini (paid tier) when AI reads an alert/statement the rules can't | While account open |
| Budgets, goals, bills, subscriptions, cash records | `Budget`, `Goal`, `RecurringBill`, `Subscription` | Planning features | Render, MongoDB Atlas | While account open |
| Statements uploaded (PDF/CSV/Excel) | temp file in `backend/uploads/` (multer `dest`) | Extract transactions | Render (processes in place) | **Not retained**: deleted (`fs.unlinkSync`) on every code path in `POST /api/upload-statement` (success, parse error, wrong type, exception) |
| Shared receipt/alert images | in-memory multer buffer (`captureUpload`, inbound email attachments) | Transcription (AI) or discarded | Google Gemini (paid tier) for receipt images; inbound email attachments are read for text only and the buffer is dropped | **Not retained**: never written to disk or DB |
| Original alert/statement text reviewed by the user | `ParseCorrection.rawText` | Accuracy measurement, the proprietary correction dataset (see `financial-app/docs/compliance/data-inventory.md` note below) | Render, MongoDB Atlas | While account open, **unless `User.trainingOptOut` is set**, in which case new rows stop being written (existing rows are not retroactively deleted) |
| Receipt scan images | not sent to Automonie; OCR runs on-device (mobile) | n/a | n/a (device only) | n/a |
| Accounts/banks detected or added manually | `UserAccount` | Account switcher, per-account totals | Render, MongoDB Atlas | While account open |
| Contacts (transfer counterparties) | `Contact` | People & Family ledger | Render, MongoDB Atlas | While account open |
| Capture key (notification capture), inbound email token | `User.captureKeyHash` (hashed), `User.inboundEmailToken` | Automatic tracking features | Render, MongoDB Atlas | While account open; capture key stored only as a hash, never recoverable |

## AI processing

See privacy.astro section 9 for the full statement. In code: `backend/lib/aiProviders.js` splits calls into `runPersonal` (Google Gemini paid tier; gets alert/statement/receipt text and names) and `runStripped` (free tiers — Google, xAI, Cloudflare, OpenRouter, NVIDIA; gets only a merchant name with digits/emails stripped first by `backend/lib/receipt.js`'s `redactForAi`). No AI call decides an amount or direction; the app's own rules do.

## Marketing / community

| Field | Model / collection | Why | Who | Retention |
|---|---|---|---|---|
| Waitlist email, WhatsApp number, source | `Waitlist` | Waitlist, launch notices | Brevo | Until unsubscribe or deletion request |
| Newsletter subscription | `User` fields / `Waitlist` | Newsletter | Brevo | Until unsubscribe |
| Beta opt-in | `User.betaTester`, `Consent` (type `beta`) | Beta programme, feedback | Render, MongoDB Atlas | While opted in |
| Campaign code (corper, QR) | `CampaignCode` / transaction tagging | Attribution, not profiling | Render, MongoDB Atlas | While account open |

## Payments

| Field | Model / collection | Why | Who | Retention |
|---|---|---|---|---|
| Subscription/payment records | `ProPayment` | Accounting, refunds | Paystack (card details never reach us), Google Play (Android purchases) | **Kept after account deletion** — accounting/tax records, up to 6 years (privacy.astro 13.2) |
| VTpass bill-purchase records with a `requestId` | `billpayments` collection | Accounting, refunds | VTpass, Paystack | Kept after account deletion, same as `ProPayment` |

## Staff/admin access

| Field | Model / collection | Why | Who | Retention |
|---|---|---|---|---|
| Every superadmin-gated request (who, what route, which account) | `AdminAccessLog` | NDPA accountability: staff access to user data is logged | Render, MongoDB Atlas (internal only, never shared) | 12 months (TTL index) |

## Legal/accounting data kept after account deletion

- Payment records (`ProPayment`, VTpass rows with a `requestId`) — tax/accounting law, up to 6 years.
- `DeletionReason` — the reason text only, deliberately disconnected from the email, kept to learn why people leave (privacy.astro says nothing about this directly; it does not identify a person).

## Deletion mechanics

`deleteUserData()` in `backend/server.js` removes, in one call: transactions, budgets, goals, subscriptions, bills, learned categories, parse corrections, support tickets, notifications, transfer routes, accounts, contacts, sender tags, recon logs, feedback, activity, dismissed detections, kept pairs, nudge logs, student reviews, pending alerts, correction events, AI chats, consent records, security events, activity-day rows, legacy collections (wallets/auto-savings/debts/retired bill payments), and the `User` document itself. Triggered by: `DELETE /api/me` (in-app, password-checked), `POST /api/account-deletion/confirm` (web, email-link-checked). Both send a confirmation email. This matches privacy.astro 13.2's "promptly and in any event within 30 days" (it is immediate) and "backups ... within 90 days" (outside the app's control; Render/MongoDB Atlas backup rotation).

## Mismatches found (to fix or to update the policy)

1. **Fixed this round:** privacy.astro 4.3 promised "records of security events such as sign-ins, password resets and sign out of all devices requests", but no such log existed before this round — only a single `lastLogin` timestamp that gets overwritten. Added `SecurityEvent` (12-month retention, matching 13.2's "security logs ... generally not more than twelve (12) months").
2. **Fixed this round:** section 8/17 describe consent ("notification capture, text message reading, email forwarding ... newsletters") as something you can withdraw, implying it was recorded, but nothing recorded a consent timestamp anywhere. Added `Consent`.
3. **Fixed this round:** "staff/admin access to user data" was not logged anywhere. Added `AdminAccessLog`, written by `superAdminAuth`.
4. **Not fixed, flagged for the owner:** text-message reading (privacy.astro 6.4, "builds that offer it") and iPhone Shortcuts capture (6.6) have no server-side consent recording hook, because both happen entirely on-device before anything reaches the API — there is no clean point in the backend to record them. If this matters for the audit trail, the mobile app should call a new endpoint when the permission is granted; `POST /api/me/consent` would need to be added (not done this round — flagging rather than guessing at a mobile client change under this session's budget).
5. **Not fixed, flagged for the owner:** waitlist/newsletter marketing consent (privacy.astro 18) is not in the `Consent` ledger — those are pre-account flows keyed by email, not `userId`, and adding them would mean a second consent table or a schema change to `Waitlist`. Left alone this round; the `Waitlist.unsubscribed` field already tracks withdrawal, just not the original grant timestamp (only `createdAt`, which is a reasonable proxy).
6. **Confirmed correct, no change needed:** "Uploaded statement files and shared images are not kept after they have been processed" (4.4, 6.8) — verified every code path in `POST /api/upload-statement` deletes the temp file, and receipt/share image uploads use `multer.memoryStorage()` with no later write to disk or DB.
7. **Confirmed correct, no change needed:** the ~13-month activity-day retention (4.7) matches `ActivityDay`'s `expires: 400 * 86400`.
