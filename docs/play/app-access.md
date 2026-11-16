# Play Console: App access (16 Nov 2026)

Play Console, App content, **App access**: choose "All or some functionality in my app is restricted" and add the instructions below. Reviewers also use this account for the closed test and for the SMS declaration review.

## The honest state today
There is **no working reviewer account yet.** An account has to be created in the app (it needs an email verification code) and then filled with sample data by `backend/scripts/seed-play-review.js`, which needs production database access that only the owner has. Everything else below is ready. The steps to create it are in "How the account is seeded" and are in the owner list at the top of `release-checklist.md`. Do not submit the App access form until step 5 below passes.

## Credentials to enter in Play Console
| Field | Value |
|---|---|
| Username | `playreview@automonie.com` |
| Password | Set by the owner when the account is created. Use a long random password (a password manager's generator). Do not store it in this repo. Paste it only into Play Console. |
| Other instructions | The text block below |

The email is a placeholder choice. Any address the owner can read will do, because sign-up sends a verification code to it. If `playreview@automonie.com` does not receive mail (check Cloudflare or the domain's mailbox first), create the account with an address you can read, and use that address here and in the seed command.

## Text for the "Other instructions" box (paste as is)
```
Sign in with the username and password above. The account is a demo with fictional data (Sample Bank and Sample Wallet, about 40 sample transactions over six weeks). No Nigerian bank account, phone number or two-step code is needed. Two-step verification is off for this account.

1. Open the app and tap Sign in. Enter the email and password. The Home tab opens. Dismiss any tour.
2. Home: see this month's spending, safe to spend, and the Action Center card with 3 alerts waiting for review.
3. Money tab: scroll the sample transactions. Tap one to see its category, bank account and why it was categorised that way. Try the This month, Last month and Custom filters.
4. Tap the + button in the middle of the bar, then Add a transaction, to enter one by hand and watch the totals change.
5. Plan tab: open Budgets (Food, Transport), Goals (Laptop fund), Bills and Subscriptions.
6. Money tab, People: shows who the sample account sent money to and received from.
7. Plan tab, Cashflow: the safe-to-spend answer and the projection.
8. Bank alert import without a real bank: open Setup, then Automatic tracking, then Paste alerts, and paste this fictional alert:
   DR Alert: NGN2,500.00 POS PURCHASE SHOPRITE LEKKI. Bal: NGN45,320.50.
   The app shows the amount, direction and merchant before saving. Tap Save and it appears in Money.
9. SMS (production build only): in Automatic tracking, the "Bring in your last 3 months" card shows an explain-first screen before Android's own permission dialog. The reviewer device does not need real bank texts to see this screen. A video of the permission flow with real alerts is attached to the SMS Permissions Declaration.
10. You tab: Profile, Settings. Delete account is under Settings, Account (it asks for the password: do not delete the demo account).
11. Plans: Plus and Student plans are shown. This demo account already has Plus, so paid features (receipt scan, income report export) are unlocked. Purchases go through Google Play Billing on this build.

Nothing in the app moves money, logs into a bank, or sends messages on the reviewer's behalf.
```

## How the account is seeded (owner does this once, at least a day before submitting)
The script never creates accounts or touches passwords. It finds the account by email and adds fictional data only.

1. Install the closed-test or the latest preview build, tap Register, use the email above and a generated password. The verification code goes to that inbox.
2. Confirm the account exists: you can sign in and reach Home.
3. From `financial-app`, with the production database string in the environment:
```bash
cd backend
node scripts/seed-play-review.js --email playreview@automonie.com --yes
```
   Use `--end YYYY-MM-DD` if you want the sample dates to end on a specific day. Dates are relative to "today", so **re-run the script the day before you submit and again if a review runs long**, because the sample month ages and the Home screen reads older.
4. What it writes (from the script header): two custom banks (Sample Bank, Sample Wallet) and accounts, about 40 transactions over about six weeks (2 salaries, 3 transfers in, food, groceries, transport, airtime and data, electricity, 2 subscriptions, transfers to 3 people, bank fees and stamp duty, one move between the two accounts that is not spending), budgets (Food 40,000 and Transport 25,000), a "Laptop fund" goal at 35%, two bills, and 3 alerts waiting in review. It sets the plan to Plus with expiry in 2099, turns two-step verification off for this account only, marks the profile onboarded and the email verified.
5. Sign in again and walk through steps 1 to 11 above yourself on a phone, against production. Fix anything that differs from the text before submitting.

Re-running replaces only the seeded transactions and review items; it does not touch anything else on the account.

## Known limits to tell the reviewer, or fix first
- The seeded data has no real bank alerts. Steps 8 and 9 are the only way a reviewer sees the alert-reading flow without a Nigerian bank, so keep the sample alert in the text.
- Email forwarding (the bank-alert email path) needs a real inbox and cannot be demonstrated by the reviewer. The text does not ask them to.
- Bank-app notification capture needs a real bank app on the device. The text does not ask for it. Explain it in the sensitive-permissions notes instead.
- Google sign-in may be on or off depending on keys. The reviewer uses email and password, so it does not matter.
- No sample for the Student plan (needs a verified student email); not required to review.
- The demo account has Plus with no payment. This is a reviewer convenience only: the script sets the plan directly in the database, nothing in the app can do that.
- Keep the account out of the 12-tester count if testers are asked to use their own accounts; reviewers use this one only.
