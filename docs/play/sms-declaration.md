# Google Play SMS Permissions Declaration: draft (24 Oct 2026)

For the owner to paste into Play Console (App content > Sensitive app permissions > SMS and Call Log). Drafted from what the code does today (finpilot-mobile, round 5 S7). Re-read every line against the build you submit; if something here stops being true, change the answer, not the code comment. The owner files the form.

## Which permissions, and the one thing to decide first
- **READ_SMS: used.** The "Scan my SMS" and "Bring in your last 3 months" features read the inbox on demand.
- **RECEIVE_SMS: declared (owner decision, 16 Oct) but not used by any code today.** There is no incoming-message receiver in the app. Google rejects permissions an app does not need, and it asks for a video of the feature using each one. Either (a) build the live "new bank text arrives" receiver before submitting, or (b) remove RECEIVE_SMS from `app.config.js` (READ_SMS alone covers everything the app does now). Recommendation: (b), and add it back with the receiver. The answers below cover READ_SMS only; add a matching paragraph if you keep RECEIVE_SMS.
- SEND_SMS is blocked in every build.
- **Fallback:** if Google declines, build the Play app with the `production-nosms` profile (APP_SMS=off). The profile is described in finpilot-mobile/RELEASING.md and gets added to eas.json at the next native build (adding it earlier would have cut the beta APK off from over-the-air updates). It ships with no SMS permission and no SMS reader; paste, email forwarding, statements and bank-app notifications still work.

## Core functionality (the "SMS-based money management" use case)
Automonie is a personal money tracker for people in Nigeria. Banks and wallets (GTBank, Access, Zenith, First Bank, UBA, OPay, Kuda, PalmPay, Moniepoint and others) send a text for every debit and credit. Reading those texts is how the app builds a person's spending record without them typing each transaction. The feature is the app's main way to log transactions, not an extra.

## Why we need READ_SMS
To read transaction alerts sent by the user's bank or wallet so they can be turned into entries in the user's own record (amount, direction, date, merchant, bank). There is no other way to get this data from a phone: the banks provide no consumer API, and a text is the only record the user already has of a transaction.

## What we do with the data, and what we do not
- **Only known bank and wallet senders are read.** The app checks each message's sender ID on the phone against a list of banks and wallets (`src/lib/smsSenders.ts`). A message from a phone number, a numeric short code, or an unknown sender name is dropped on the phone: it is not parsed, not shown, and not sent anywhere. Personal messages never leave the phone.
- Messages from a bank that are not transactions (one-time passwords, offers and loan promotions, balance notices, failed transactions) are also dropped on the phone.
- Reading is **on demand**: the user taps "Scan my SMS" or "Bring in your last 3 months". The app does not read in the background and does not run a receiver.
- The user sees every parsed transaction and can edit or remove it before it is saved. Rows the app is unsure about are held for review and are never added to totals automatically.
- What is sent to our server, only when the user confirms the import: the parsed fields (amount, direction, date, description, category, bank, last 4 digits of the account) and the text of that one bank alert, used to improve parsing when the user corrects a row. Nothing else from the inbox is sent.
- We do not sell SMS data, do not use it for advertising, and do not share it with third parties for their own purposes.
- The user can stop at any time (revoke the permission in Android settings) and can delete imported transactions or their whole account in the app.

## The permission prompt
Before Android's own dialog appears, the app shows its own screen: "Bring in your bank alerts. Automonie reads bank alerts only. Personal texts never leave your phone." with Turn on, Not now and How this works. If the user says no, the app keeps working: they can paste alerts, forward bank emails, upload a statement or enter transactions by hand.

## Is this the default SMS handler? Do we send or edit messages?
No. Automonie is not a messaging app and never sends, deletes or changes a text. SEND_SMS is blocked.

## Evidence to have ready for the reviewer
1. A short video: open the app, Automatic tracking, tap the "Bring in your last 3 months" card, see the explain-first screen, then Android's dialog, then the list of parsed bank alerts with a personal message in the inbox that does not appear.
2. A test phone or screenshots with a few bank texts for the reviewer. The Play review account (`backend/scripts/seed-play-review.js`) holds the sign-in; the sample texts have to be on the review phone, so include them as screenshots of the result.
3. Privacy policy section on SMS (automonie.com/privacy). Check it matches this page before submitting.

## Parser coverage (server-side rules, no AI), from the anonymised test set
Command: `node backend/scripts/parser-coverage.js`.

| bank | alerts | rules only | amount | direction | date | non-txn dropped | fees found | parser entry |
|---|---|---|---|---|---|---|---|---|
| acct-003 | 11 | 100.0% | 100.0% | 100.0% | 100.0% | - | 5/5 | shared |
| classifier-synthetic | 19 | 100.0% | 100.0% | 100.0% | 100.0% | 10/10 | 4/4 | shared |
| fcmb | 7 | 100.0% | 100.0% | 100.0% | 100.0% | - | - | own |
| noise | 16 | - | - | - | - | 16/16 | - | shared |
| opay | 3 | 100.0% | 100.0% | 100.0% | 100.0% | - | - | own |
| premiumtrust | 2 | 100.0% | 100.0% | 100.0% | 100.0% | - | - | own |
| uba | 10 | 100.0% | 100.0% | 100.0% | 100.0% | - | 1/1 | own |
| union | 4 | 100.0% | 100.0% | 100.0% | 100.0% | - | - | own |
| ALL | 72 | 100.0% | 100.0% | 100.0% | 100.0% | 26/26 | 10/10 | |

Read this honestly: 100% on 72 alerts is a clean result on a small set, not proof for every bank. **No test alerts yet for GTBank, Access, Zenith, First Bank, Fidelity, Wema, Sterling, Stanbic, Ecobank, Polaris, Kuda, PalmPay, Moniepoint, Carbon, FairMoney and about 60 other registry entries.** Those go through the shared patterns and are checked only by the phone-side parser (`npm run parser:accuracy`: amount, direction and parsed 100%, bank identification 83% on its own set). Next step to widen coverage: add anonymised real alerts per bank to `backend/corpus/alerts/<bank>.jsonl` (the owner's phone has a few hundred; run `backend/scripts/anonymise-corpus.mjs`).
