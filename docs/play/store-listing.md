# Play Console: store listing copy (16 Nov 2026)

Voice: plain, direct, Nigerian-first, no hype. No emoji, no em dashes. Every claim below was checked against the code on 16 Nov 2026. Claims about SMS apply only to the `production` build; swap in the "no SMS" line for `production-nosms` (marked below).

Things this copy deliberately does NOT say, because they are not true today:
- No bank connection. The app does not log in to your bank. Mono bank linking exists in code but is switched off.
- No money movement from savings or "auto-save". The app never moves your money.
- No "AI financial advisor". The assistant is off until the owner switches it on; do not mention it unless `/api/features` shows `assistant: true` on release day.
- No claim of bank-grade or "military-grade" security, and no claim of regulation (it is not a bank or a licensed lender). Trust copy must stay true in code.
- No pricing in the listing (Play shows the price from the subscription setup).

## App name (30 characters max)
`Automonie: Money Tracker`  (24 characters)

Play rule: no price, ranking or "best" words in the name. The brand is lowercase "automonie" in the app; Play shows the title as typed. Alternative: `automonie` alone.

## Short description (80 characters max)
Pick one. Character counts checked.

1. `Track every naira from your bank alerts. Private, free to start.` (64)
2. `Your bank alerts, sorted into spending you can read. Built for Nigeria.` (71)

Recommended: option 2. It names the source (bank alerts) and the country. Option 1 says "free to start": true (Free plan exists) but it invites a pricing question the listing must be ready for.

## Full description (4000 characters max)
Counts at about 3,200 characters. Paste as is.

```
Your bank sends an alert for every naira that moves. Automonie turns those alerts into a clear record of where your money goes, so you do not have to type each transaction.

Built for Nigeria. Works with the way Nigerians actually bank: GTBank, Access, Zenith, First Bank, UBA, OPay, Kuda, PalmPay, Moniepoint and many more, in naira.

HOW YOUR TRANSACTIONS GET IN
- Bank alert texts. Tap "Bring in your last 3 months" and the app reads bank alerts only. Personal messages stay on your phone and are never read or sent.
- Bank app notifications. If you choose, Automonie can read alerts from the bank apps you approve. You turn this on yourself in Android settings.
- Forwarded emails. Forward your bank's alert emails to your own Automonie address and they are sorted automatically.
- Share an alert. Share any bank alert text or receipt to Automonie from another app.
- Statements. Upload a PDF or CSV statement from your bank or OPay.
- Type it or say it. Add a transaction by hand or log it by voice.
You see every transaction before it counts. Anything the app is not sure about waits for you in an Action Center instead of quietly changing your totals.

WHAT YOU GET
- Spending by category, by month, by bank account, and by person.
- Safe to spend: a straight answer on what you can spend until your next income.
- Budgets and goals, with gentle reminders when you are close to a limit.
- Bills and subscriptions: see what you pay regularly, get a reminder before a renewal, and see steps to cancel.
- Your own money moves are not counted as spending. Moving money between your own accounts, cash withdrawals, bank fees and reversals are kept apart so your totals mean something.
- A People view for money you send and receive from friends and family.
- Income and spending report you can export as a PDF.
- Cash tracking: break a cash withdrawal into what you actually spent it on.

BUILT ON TRUST
- You decide what to share. Every source is optional, and you can turn each one off.
- Your data is yours. Download it, or delete your account and your data from inside the app.
- Lock the app with your fingerprint, face or PIN. Hide amounts with one switch.
- Automonie never moves your money, never asks for your bank password, and never sells your data or shows ads.
- Bank fees, stamp duty and reversals are recognised, so a fee is not mistaken for spending.

PLANS
Free: tracking, categories, budgets, goals and the basics. Plus: extra tools such as receipt scanning and report exports. Student plan for verified students. Subscriptions are billed through Google Play and can be cancelled any time in Google Play.

Automonie is a money tracker. It is not a bank, does not hold your money, and does not give investment advice.

Questions or ideas? hello@automonie.com
```

**For the `production-nosms` build, replace the first bullet under "How your transactions get in" with:**
`- Paste an alert. Copy any bank alert text and paste it in, and the app reads it for you.`
and remove "Bring in your last 3 months".

## Claim-by-claim check (so the copy stays true)
| Claim | Evidence |
|---|---|
| Reads only bank alerts, personal messages not read or sent | `src/lib/smsSenders.ts` sender allow-list; SMS declaration |
| Read on demand, "Bring in your last 3 months" | SMS declaration; no receiver exists |
| Notification capture from approved bank apps, you turn it on | `BankNotificationListener`, Android Notification access setting, `NON_BANK` filter |
| Forward emails to your own address | Inbound email, `<token>@automonie.app` |
| Share an alert or receipt | `expo-share-intent`, `QuietShareActivity` |
| Statements PDF or CSV, OPay | parser pipeline, `opayStatement.js` |
| Voice logging | `expo-speech-recognition` |
| Action Center holds uncertain rows | Holds and low-confidence review, `PendingAlert` |
| Safe to spend | `cashflowMath.js`, cashflow forecast |
| Own moves, cash, fees, reversals kept apart | `txnKinds.js`, `internalTransfers.js`, `reversals.js` |
| People view | `Contact` ledger, People and Family |
| Export PDF report | verified income report (C6), `expo-print` |
| Cash tracking | cash tracking (C4) |
| Fingerprint, face or PIN, hide amounts | `expo-local-authentication`, `hideAmounts` |
| Download your data, delete account | `GET /api/me/export`, `DELETE /api/me` |
| Never moves your money | Code never initiates a transfer from the user's bank |
| Never asks for your bank password | No bank login flow is live |
| No ads, never sells data | No ad SDK; privacy policy |
| Plus: receipt scanning and exports | `plans.PLUS_FEATURES`; the plan-ended notice names "receipt scanning and report exports" |
| Billed through Google Play | `usesPlayBilling` on the Play build |
| Student plan | `student` schema and plan |

**Decision for the owner:** the bill-pay feature (VTpass airtime and electricity purchases) is code-complete behind `/api/features` `billPay`. The copy does not mention it. If it is switched on for the Play build, Play's payments policy and the money-transmission questions change, so decide separately and add it to the listing and the Data safety page only if it is live.

## What's new (500 characters max) for the first release
```
First release on Google Play.

- Bring in your bank alerts from SMS, bank app notifications, forwarded emails, shared text and statements
- Categories that learn from your corrections
- Safe to spend, budgets, goals, bills and subscription reminders
- Lock with fingerprint, face or PIN
- Download your data or delete your account in the app

Tell us what to fix: hello@automonie.com
```
(about 420 characters). Closed testing note, for the tester group only: "Thank you for testing. Please use the app for two weeks and send feedback from Profile, then Send feedback."

## Other listing fields
| Field | Value |
|---|---|
| App category | Finance |
| Tags | Personal finance, Budgeting, Expense tracker |
| Contact email | hello@automonie.com (confirm this mailbox receives mail; it is the Brevo sender, check inbound) |
| Contact website | `https://www.automonie.com` |
| Contact phone | optional; leave blank |
| Privacy policy | `https://www.automonie.com/privacy` |
| Default language | English (United Kingdom) or English (Nigeria) if offered |
| Target countries | Start with Nigeria only. Add others later. |
| Developer name shown | The personal account's legal name, shown publicly on the listing. An organisation account would show MICADOT-NG LIMITED. Owner should know this before choosing "personal". |
| Support URL | `https://www.automonie.com/support` returns 404 today. Use the contact email, or create the page first. Same for `/data-deletion` (the delete page that exists is `/delete-account`). |
| App icon | 512 x 512 PNG, 32-bit, from `assets/images/icon.png` (check the size; the brand icon is the gradient teal mark) |
| Feature graphic | 1024 x 500, see `screenshots.md` |
