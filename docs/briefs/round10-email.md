# Round 10 Part F: email handoff and the Gmail notification experiment

Written 15 Nov 2026. Branches: backend and web on `claude/round10-part-f-email-851e83` (financial-app), mobile on `claude/round10-part-f-email-mobile` (finpilot-mobile, worktree at `..\finpilot-mobile-part-f`). Nothing pushed, nothing built, no OTA.

## F1: Finish on your computer (built)

Phone: the Email forwarding screen now has one card, "Finish on your computer": a QR code, "Email me the link", "Copy link", and three ticks (Link opened, Gmail confirmed, First bank email) polled every 5 seconds. The step-by-step Gmail guide, the "Open Gmail settings" button and the "Desktop site" note are gone from the phone. The help article summary no longer tells people to use Desktop site either.

Web: `/setup/email?t=<token>` (route outside the login shell, `frontend/src/components/EmailSetup.jsx`). Step 1 the private address with copy, step 2 the confirmation code shown live (it reuses the Round 9 detection: `gmailVerifyCode` is set by the inbound webhook, the page just polls for it), step 3 download the filter file (same XML builder as the app, now `gmailFilterXml`). The same three ticks show on the page.

Token rules (`backend/lib/emailHandoff.js`):

- 24 hours, one user, 24 random bytes. Only a SHA-256 hash is stored. Rows delete themselves (TTL index).
- Single use, enforced by one atomic update that only matches an unopened, unexpired token, so two tabs racing cannot both win. A second visit gets "expired or already used".
- Redeeming trades the token for a page session key (same user, ends 2 hours after opening or at the token's expiry, whichever is first). The page keeps it in `sessionStorage`, so a refresh works but the link itself cannot be replayed. The token is removed from the address bar and history on load.
- Every page endpoint looks up the one user behind the session key. `pageView` carries no id, name or email (tested).
- "Email me the link" sends only to the account's own address on file. At most 6 links per user per hour.
- Gmail "confirmed" ticks when the user presses "I entered it" on either screen, or when the first bank email arrives (which proves forwarding works).

Endpoints: `POST /api/email-handoff`, `POST /api/email-handoff/send`, `GET /api/email-handoff/ticks` (phone, signed in); `POST /api/email-handoff/redeem`, `GET /api/email-handoff/view`, `POST /api/email-handoff/confirmed`, `GET /api/email-handoff/filter.xml` (page, session key header). The QR is rendered server side as SVG (new backend dependency `qrcode`), so the phone needed no new package and F1 ships by OTA.

URL base: the link uses `HANDOFF_BASE_URL`, else `FRONTEND_URL` (the web app, `app.automonie.com`). The brief says `automonie.com/setup/email`. The Vite app is not served from the bare domain, so I did not guess; set `HANDOFF_BASE_URL` on Render if the page should live there.

What was tested: `lib/emailHandoff.test.js` (in `npm test`) proves expiry at and after 24 hours, single use, concurrent redemption (exactly one wins), raw token never stored, session tied to one user and ending at 2 hours, hourly cap, the tick logic, and that the page view leaks no personal field. It runs against an in-memory fake of the model that honours the exact filter shapes used, because there is no Mongo here. The routes themselves were syntax-checked and the web page built, but not exercised end to end against a database or a browser. "Ticks update on both screens" is true by construction (both read the same `ticksFor` over the same user fields), not by a live run.

Not verified: that Gmail's own import accepts the filter XML (unchanged from Round 9, still flagged for the owner to try once on a real Gmail).

## F2: pre-filled Gmail filter link (NOT proven, file import stays)

What I tried: opened `https://mail.google.com/mail/u/0/#create-filter/from=alert%40gtbank.com&forwardTo=test%40example.com` in the built-in browser. Result: Google redirected to its sign-in page and kept the fragment, so I saw nothing about whether Gmail would act on it. I did not sign in to anyone's Gmail. I have no signed-in test Gmail account, so I cannot say the link works, and I have not claimed it does.

Decision: step 3 stays the file import. What is still open, for someone with a Gmail account to try in two minutes: (1) paste the URL above while signed in and see whether the filter dialog opens with From filled; (2) try `#search/from%3A...` then "Create filter" from the search options, which is documented to carry a query. Even if (1) works, `forwardTo` is probably not honoured (Gmail asks the user to pick it), and the dialog is a single `from` field, so a long sender list may not fit. Record the outcome here when tried.

## F3: Bank emails (from Gmail notifications) (built, OFF, native)

Built and off by default at three levels: the server flag `FEATURE_GMAIL_BANK_EMAILS` is unset (the row is hidden, `/api/features` returns `gmailBankEmails: false`), the phone switch defaults to off, and with no sender list downloaded the filter keeps nothing. Not enabled for anyone.

How it works (`modules/automonie-capture`):

- `BankNotificationListener`: a Gmail notification (`com.google.android.gm`) is handled before anything else. Switch off: return immediately. Switch on: run `GmailBankFilter`; if it is not a verified bank transaction email, return. Nothing is uploaded, stored, counted, or recorded as a last event, and Gmail never reaches "Other apps we found" (the JS `NON_BANK` rule already hides it too). Bank ones go through the same upload path and server parser as bank-app notifications.
- The filter (pure Kotlin `GmailBankFilter.kt`, spec and test in `src/lib/gmailBankFilter.ts`): the sender (Gmail's notification title is the display name) must equal or start, as a whole word, with a verified bank name (names 3+ characters, aliases 4+), or a verified alert address must appear in the text; AND the text must carry an amount; AND it must contain transaction wording.
- Sender rules come from `GET /api/bank-email-senders` (verified `BankEmailSender` rows only, public bank facts), downloaded to the phone. Gmail content is never sent to find out whether it is bank mail.
- Pre-permission screen `src/app/gmail-notifications.tsx`: what is read, kept, dropped and sent, "Turn on" / "Not now". Reached from the new "Bank emails (from Gmail notifications)" row in Automatic tracking.

Tests: `npx tsx scripts/gmail-filter.test.ts` (22 checks, pass): 16 mixed cases (5 bank, 11 not: marketing, OTP, promo with an amount, shop receipt, newsletter, friend, payroll, look-alike names) over one shared vector file; the uploaded set equals exactly the bank cases; no sender list means nothing uploaded. The Kotlin port has `GmailBankFilterTest.kt` over the same vectors, but I could not run it here (no Android toolchain). Run `./gradlew :automonie-capture:testDebugUnitTest` before the build. The Kotlin and TypeScript copies are separate code held together by the shared vectors, which is a known weakness of this approach.

Known limits to expect in the trial: the title is a display name, so a phisher who names themselves "GTBank" and writes a fake debit would pass the filter (it would still need the server's parse and our review rules; the sender-address check is not possible from a notification); a bank whose display name is not in our name list is missed; Gmail collapses several mails into a summary, and summaries are skipped. These show up as misses in the gate below, not as privacy leaks, because every miss is a drop.

### Ship gate (from the brief)

Ship to users only if 5 test phones over 7 days capture at least 80% of bank alert emails with correct amounts. Anything short of that and F3 stays off.

How to measure:

1. Five phones, Android, each with a Gmail account that already receives alerts from at least one verified bank. Build with F3, set `FEATURE_GMAIL_BANK_EMAILS=true` on a test environment only, switch on per phone.
2. Denominator: each phone's owner exports, at day 7, the list of bank alert emails received that week (Gmail search `from:(verified senders) after:<start>`; count and note each amount). Do not paste email bodies anywhere; amount, date and bank are enough.
3. Numerator: the transactions that arrived with source notification via `com.google.android.gm` in that window (the admin ingestion view, or `db.transactions` by phone user, test accounts only).
4. Capture rate per phone and overall = emails with a matching transaction (same amount, same direction, within a minute of the notification) divided by emails received. "Correct amount" means the amount matches the email exactly.
5. Also count precision: any transaction created from a non-bank Gmail notification. The target is zero. One is a fail and a privacy bug to fix before anything else.
6. Pass: overall capture rate at least 80% AND at least 4 of 5 phones individually at 80% or more AND zero non-bank uploads. Write the per-phone table here, with phone model and Android version, then the decision.

Results: not run yet.

## Needs doing by the owner

- F1 is OTA-able on mobile and deployable on web/backend. It needs `INBOUND_EMAIL_SECRET` and the inbound MX (Round 9, keys-pending) before the forwarding itself delivers anything; the handoff page and ticks work without them, with "Forwarding goes live shortly" shown.
- Run the Kotlin test, then the next EAS build carries F3 (native; cannot go by OTA).
- Try the F2 URLs on a real Gmail.
