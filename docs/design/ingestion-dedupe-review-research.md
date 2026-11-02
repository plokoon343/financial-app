# Automonie: Ingestion, Dedupe and Review Research

Nov 2, 2026 · @Plo koon

Saved from chat as supporting research for `docs/briefs/round6-trust-review-polish.md`. Section numbers in that brief refer to this document.

Run Automonie on bank texts plus bank-app notifications, with statements for history and Mono as a later paid upgrade. Email forwarding stays as it is for now and will be revisited.
- Setup becomes two system switches inside the app, instead of a Gmail filter and confirmation code.
- If Google refuses READ_SMS, bank-app notifications carry automatic tracking alone, with a monthly statement prompt for banks that only send texts.
- iOS gets share, statements, manual entry and receipts now; a Shortcuts automation is a tested opt-in later.
- Every transaction gets one effect (Income, Spending, Own move, Cancelled, Debt), and the dedupe engine merges by reference, balance, then time window, never merging two alerts from the same source.

## 1. Automatic sources

Recommendation: make bank texts plus bank-app notifications the main automatic source, statements the way to fill history and gaps, and Mono the paid upgrade later. Email forwarding is left unchanged for now; the email options below are kept for when it is revisited. Setup for the main source is two system switches inside the app.

### Options compared

| Option | Steps for the user | Reliability | Cost to Automonie | Play / NDPA risk | Categorisation quality | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| Bank texts (READ_SMS) | 1 permission tap, then 3-month import | High for banks that send SMS. Real time, works offline | Free | Needs Play declaration under "SMS-based money management". Human review | Good: short, fixed bank templates | Primary |
| Bank-app notifications | 1 trip to Android Settings | High for wallets (OPay, PalmPay, Moniepoint, Kuda) that alert by push. Misses alerts sent while the app was off | Free | Prominent disclosure and consent required for background access to personal data. No separate declaration form found: unverified, assume review | Good, but text is shorter than SMS | Primary, paired with SMS |
| Share to Automonie | 2 taps per item | Depends on the user | Free | None | Good | Keep as the manual catch-all |
| Statement upload with bank auto-detect | Download from bank app, pick file | Highest: complete and reconcilable | Free (parsing cost only) | Low; delete file after parsing, as the + sheet already promises | Best: full narrations | History and gap filler |
| Mono open banking | Bank login inside Mono widget | Good, but every refresh is billed | Negotiated terms: ~₦80 per new account link, ~₦100 per refresh beyond quota, plans from ~₦50k a month | Low (licensed partner). Mono is now a Flutterwave company | Good | Paid tier, later |
| Gmail / Outlook via OAuth | Sign in, accept a broad warning | Good | Gmail read scopes are restricted and need an annual CASA security assessment; Tier 2 from about $540 per app per year, plus weeks of review | High: gmail.readonly reads the whole inbox, which breaks "Automonie reads bank alerts only" | Poor, same email problem | Reject |
| IMAP with an app password | Turn on 2-step verification, make an app password, paste it | Medium | Free | High: storing a credential that opens the whole inbox contradicts "We never ask for your login" | Poor | Reject |
| Bank sends alerts to an Automonie address | Bank form or branch visit, per bank | Medium | Postmark inbound | High: banks change alert settings by form; security notices and any emailed codes would land with us, and the user stops getting their own alert emails | Poor | Reject |

### Why email categorised badly, and why that matters beyond email

Categorisation quality comes from the merchant and counterparty name, not the channel. Email alerts bury those names in HTML. The fix in Section 2 (clean counterparty, rules, person names for transfers) applies to every source, so do not expect any channel alone to fix categories.

### What Nigerian fintechs actually do

- ZenFi reads SMS, notifications, IMAP email and statements, with automatic tracking only on Pro.
- Open banking is thin: Okra shut down in May 2025 and the CBN said in October 2025 that open banking had not gone live. Mono remains the practical aggregator.
- Open-source parsers for Nigerian alerts are paste or SMS based, for example a GTBank parser that reads Acct, Amt, CR/DR, Desc and Avail Bal lines.

### Fallback if Google refuses READ_SMS

Ship the no-SMS build already kept as a fallback: bank-app notifications become the only automatic source, with share and statements behind them. Two rules:
1. Never read bank texts through the Messages app's notifications. Play policy says apps must not derive SMS data by other methods. Keep messaging apps on the never-list in Automatic tracking.
2. Prompt a monthly statement upload for any bank with no app notifications, so traditional banks still get complete months.

Submit the declaration early, with a screen recording of the on-device filter and the pre-permission screen. Declarations get rejected when the core use is unclear.

### What iOS users would get

iOS has no SMS or notification access, so iOS is semi-automatic:
- Share extension for alerts, screenshots and PDFs (the main route).
- Statement upload, manual entry, receipt scan.
- Mono on the paid tier.
- Later, test first: a Shortcuts automation that runs an Automonie action when a text contains bank words. Indian budget apps already do this, but setup takes several steps, so it is an opt-in power feature, not the default.

## 2. How money moves for young Nigerians

Almost every naira movement reaches Automonie as a debit or credit alert with an amount, a direction, a narration and often a balance. What changes by channel is the narration wording and the fees that ride along. Bank transfers run on NIBSS Instant Payment (NIP), and each one carries a session ID that banks label differently: Session ID, Reference or Transaction Ref. That ID is the best dedupe key when it appears.

About alert wording: the only bank template verified from a public source here is GTBank SMS, which uses labelled lines Acct, Amt (with CR or DR), Desc and Avail Bal. GTBank labels its balance "Avail Bal" and Zenith uses "Bal" with a masked account, while OPay writes a sentence, according to one open-source project. Treat every other narration marker below as unverified and confirm it against Automonie's own alert corpus before writing a rule.

### Channels, fees and how each looks

| Channel | What the alert looks like (fields) | Fees that can appear as separate debits | Notes |
| --- | --- | --- | --- |
| Bank transfer (NIP) | Debit at sender, credit at receiver; narration names the other person; session ID sometimes shown | Transfer fee ₦10 / ₦25 / ₦50 by amount band; a draft April 2026 guide would make transfers under ₦5,000 free and ₦5,000 to ₦50,000 cost ₦10. Draft: check before hard-coding | Core case. Person name is the category title |
| Stamp duty | Separate ₦50 debit at the sender for transfers of ₦10,000 or more, since 1 Jan 2026 (replaced EMTL, which hit the receiver) | It is the fee | Old statements (before 2026) show it on credits instead |
| USSD | Same as a transfer or airtime debit | ₦6.98 per session, collected for the mobile network | Fee may land as its own debit |
| POS card payment | Debit with merchant or terminal name | Usually none for the buyer | Merchant name is often truncated |
| POS cash withdrawal (agent) | Looks like a transfer to an agent or a POS debit | Agent fee; the draft 2026 guide sets ₦100 per ₦20,000 plus agent fee for not-on-us | Becomes cash: see matrix |
| ATM withdrawal | Debit with ATM marker | Free at your own bank; ₦100 per ₦20,000 at another bank, plus up to ₦500 at off-site ATMs | Becomes cash |
| Online card payment | Debit with merchant name, may be in USD for foreign merchants | FX and card fees possible | Subscriptions live here |
| Wallet to wallet (OPay, PalmPay, Moniepoint, Kuda) | Push notification more often than SMS; same-wallet transfers may show no session ID | Often free | Notifications are the main source |
| Card or bank funding a wallet | Debit at the bank, credit in the wallet | Possible funding fee | Own-account move, not spending |
| Airtime and data | Debit naming network or "airtime" | Usually none | Category: Airtime and data |
| Bills (electricity, TV) | Debit naming biller; electricity token sometimes in the alert | Biller fee possible | Never show the token in lists |
| Subscriptions (Spotify, Netflix, Apple, Google) | Card debit, monthly, same merchant and similar amount | FX | Detect by repetition |
| Betting top-ups | Transfer or card debit to a betting company | Possible | Category: Betting. Never moralise |
| Savings pockets (OWealth, PiggyVest, Cowrywise, Kuda) | Debit to savings product, or move inside the same app | None usually | Own-account move if the user tracks that pocket, otherwise "Saved" |
| Interest | Small credit, often daily on wallets like OWealth | None | Income, but grouped so it does not spam the list |
| Loans and repayments | Credit from lender, later debits to lender | Interest inside repayments | Loan received is not income |
| Salary and allowance | Credit, monthly, same sender. NYSC pays ₦77,000 federal allowance between the 25th and 30th | None | Income |
| Refund or reversal | Credit, often with "reversal" or "refund" wording (unverified); failed POS and web refunds are due within 48 to 72 hours under CBN rules | Fee may also be reversed | Cancels the original, not income |
| Failed transaction | Debit then matching credit, or a declined notice with no money moved | None | Net zero |
| SMS alert charges | Small debits; GTBank charges ₦6 per SMS since May 2025 | It is the fee | Bank charges category |
| VAT on fees | 7.5% on platform fees, sometimes as its own debit | It is the fee | Bank charges |
| Dollar cards and international | Naira debit to fund the card; USD spend may arrive from the card app | FX spread | Funding is an own-account move |
| Crypto on and off ramp | Transfer to or from an exchange; withdrawals now carry ₦50 stamp duty plus VAT on the fee | Yes | Treat as a move to an untracked account |
| Ajo / esusu | Regular transfers to the same person, then one large credit back | Transfer fees | Ask once, then a rule |
| Splitting bills, family | Transfers to people | Transfer fee, stamp duty | "Sent to people", by name |
| Cash | No alert at all | None | Only manual entry or "what did this cash go on" |

### Behaviour matrix

Every transaction gets exactly one effect: Income, Spending, Own move (left out of totals), Cancelled (nets to zero) or Debt (loan in or out, left out of income and spending). Ask the user only when the effect is unclear, never just to confirm a category the app is already sure of.

| # | Case | How to detect | Shown as | Effect | Merge or link | Ask the user when |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Transfer to a person | Debit, transfer narration, counterparty is a person's name | Person's name; group "Sent to people" | Spending | Link its fee and stamp duty (row 11) | Never for the category. Offer "Who is [name]?" (Family, Friend, Ajo, Business) once per new person, optional |
| 2 | Transfer received from a person | Credit, transfer narration, person's name | Person's name | Income | Check row 3 first | Only if the sender matches the user's own name |
| 3 | Move between my own two accounts | Debit at bank A and credit at bank B, same amount, within 10 minutes, and either the counterparty name matches the user's name or bank B is a linked source | "Moved to [Bank B]" | Own move | Link the pair; one item in the list, hidden from totals by default | If only one side is seen and the counterparty is the user's own name: "Did this go to another account of yours?" |
| 4 | Same transaction from several sources | Same account, direction, amount, close in time | One transaction | As the original | Merge per the dedupe rules; keep every source as evidence | Only when two candidates tie |
| 5 | Bank or card funds a wallet | Bank debit naming the wallet provider, wallet credit of the same amount | "Added to OPay" | Own move | Link pair | If the wallet is not a tracked source: "Is [OPay] your own wallet?" Answer becomes a rule |
| 6 | Wallet pays a merchant | Wallet debit with merchant | Merchant | Spending | None; the funding in row 5 was not spending, so nothing counts twice | Never |
| 7 | Failed transfer then reversal | Debit, then credit of the same amount to the same account within 72 hours, reversal wording or same reference | Original shown struck through, "Reversed" | Cancelled | Link both; fees reversed too if a matching fee credit arrives | Never |
| 8 | Refund weeks later | Credit from the same merchant, amount equal to or less than an earlier debit, within 90 days | "Refund from [merchant]" | Reduces that merchant's category spending (negative spending), not income | Link to the original debit if one clear match; otherwise stands alone in the same category | If two or more earlier debits could match |
| 9 | Cash withdrawal (ATM or POS agent) | ATM marker, or transfer to a POS agent | "Cash withdrawal" | Own move into a Cash account | Fee split off as Bank charges | Never at the time. Adds to "₦X cash to log" |
| 10 | Spending that cash | Manual entry with Paid from: Cash | The category picked | Spending | Draws down the Cash balance | Daily digest: "What did the ₦X cash go on?" with category chips and "Leave it" |
| 11 | Fees on a transfer (fee, stamp duty, VAT) | Small debits within 2 minutes of a transfer at the same bank, amount matches a known fee | Folded under the transfer: "₦15,060 including ₦60 charges" | Spending, category Bank charges | Child of the transfer | Never |
| 12 | USSD session fee | Debit of ₦6.98 near a USSD transaction | Bank charges | Spending | Child of that transaction if within 10 minutes | Never |
| 13 | SMS alert and maintenance charges | Small recurring debits with charge wording | Bank charges | Spending | Group monthly in the list | Never |
| 14 | POS card purchase | Card debit with merchant or terminal | Merchant | Spending | None | Only if no category reaches the confidence bar |
| 15 | Online card payment and subscriptions | Card debit, same merchant monthly at a similar amount | Merchant, marked Subscription after 2 repeats | Spending | Adds to Coming up | Once: "Is [Netflix] a monthly subscription?" |
| 16 | Airtime and data | Network name or airtime wording | Airtime and data | Spending | None | Never |
| 17 | Bills (electricity, TV) | Biller name | Bills | Spending | None | Never |
| 18 | Betting top-up | Betting company counterparty | Betting | Spending | None | Never |
| 19 | Betting withdrawal | Credit from betting company | Betting (money back) | Reduces Betting spending; extra above top-ups that month is Income | None | Never |
| 20 | Move to a savings pocket in a tracked app | Debit to savings product inside a tracked wallet | "Set aside in [OWealth]" | Own move | Counts toward goals if mapped | Once: "Count this toward a goal?" |
| 21 | Save into an untracked app (PiggyVest, Cowrywise) | Transfer to the savings company | "Saved to [PiggyVest]" | Own move into an off-app account | Withdrawal later is the reverse own move | Once per app: "Is this your savings?" |
| 22 | Interest | Small credit with interest wording, often daily | "Interest", grouped per month | Income | Group daily credits | Never |
| 23 | Loan received | Credit from a lender | "Loan from [lender]" | Debt | Starts a loan item | If the lender is unknown: "Is this a loan?" |
| 24 | Loan repayment | Debit to the same lender | "Loan repayment" | Debt (principal) | Links to loan | Never; interest split is not attempted |
| 25 | Salary or allowance | Monthly credit, same sender, similar amount | "Salary" or "NYSC allowance" | Income | Feeds income detection | Once: "Is this your monthly income?" |
| 26 | Funding a dollar card | Naira debit to the card provider | "Added to [card]" | Own move | Card spends, if tracked, are Spending | Once per provider |
| 27 | Crypto buy or sell | Transfer to or from an exchange | "Moved to [exchange]" | Own move to an untracked account | None | Once per exchange |
| 28 | Ajo or esusu | Repeated transfers to one person, later one large credit from them | "Ajo with [name]" | Own move (contributions and payout) | Rule after the user answers | After the second regular transfer: "Is this ajo or a contribution?" |
| 29 | Splitting a bill | You pay a merchant, friends send money back soon after | Merchant, then "[Friend] paid you back" | Payback reduces that spending, not income | Link paybacks to the bill if the user taps "Split" | Offer "Did anyone pay you back for this?" only when credits from people arrive within 48 hours of a large debit |
| 30 | Sending money to family | Transfers to the same people often | Person's name; group "Family" if tagged | Spending | None | Once per person (row 1) |
| 31 | Declined or failed notice, no money moved | Wording says declined or failed and balance unchanged | Not shown | None | Discard; keep raw text for 30 days for audit | Never |
| 32 | Manual entry, then the alert arrives | Manual item and a later alert, same bank, amount, within 48 hours | One transaction, alert data wins | As the original | Merge; keep the user's category and note | If more than one manual item matches |

### Dedupe and linking rules

Store every alert, share, statement row and manual entry as an Observation, and build Transactions from Observations. Merging attaches more Observations to one Transaction; linking ties two Transactions together (own move, reversal, refund, fee). Both are reversible. This keeps the evidence, makes "Not the same" a one-tap undo, and lets the count of real transactions be checked.

**Data shape:**
- Observation: userId, source (sms, notification, share, statement, manual, mono), accountRef (bank plus last digits when shown), direction (rules only), amountKobo (integer, rules only), eventTime (parsed from text, else receivedAt), receivedAt, balanceAfterKobo, reference (session ID or ref), counterpartyRaw, channelHints, rawHash.
- Transaction: one or more Observations, effect (Income, Spending, Own move, Cancelled, Debt), category, counterpartyClean, links[].
- All times in Africa/Lagos. Amounts in kobo.

**Merge ladder (same user, same direction, same amount):**
1. Re-delivery: same source and same rawHash within 24 hours: drop silently.
2. Reference match: same reference (session ID or bank ref) on both: merge, any sources, any time gap.
3. Balance match: same accountRef and same balanceAfter: merge.
4. Window match: same accountRef (or same bank when one side has no account digits), counterparty compatible (similar, or missing on one side), and inside the window for that pair of sources: SMS with notification 15 minutes; alert with share 48 hours; alert with manual entry 48 hours; alert with statement row same value date plus or minus 1 day; Mono with anything same value date plus or minus 1 day.
5. One candidate: merge automatically. Two or more: ask "Is this the same as [name, ₦X, time]?" with the best guess first.

Never merge two Observations from the same source at steps 3 to 5. Two ₦500 airtime SMS a minute apart are two purchases. Count check: for any cluster of matching Observations, the number of Transactions equals the largest number of Observations any single source contributed.

**Which source wins each field:**
- Amount, direction: Statement, SMS, Mono, notification, share, manual (they should agree; if not, flag for review and do not merge).
- Date and time: Alert time (SMS or notification), then statement date.
- Balance after: Latest alert, then statement.
- Counterparty: Longest clean name across sources.
- Category: User's choice, then a user rule, then a learned merchant, then a suggestion.

**Linking rules:**
- Own move: a debit on account A and a credit on account B, both the user's, same amount, within 10 minutes (60 minutes for card-to-wallet funding). Allow the credit to be smaller by an amount in the fee table. Auto-link when the counterparty matches the user's name or the wallet provider; otherwise ask once and save the answer as a rule.
- Reversal: a credit on the same account, same amount as a debit, within 72 hours, with reversal wording or the same reference. Mark both Cancelled. Link any fee credit to its fee.
- Refund: a credit from the same merchant within 90 days, equal to or less than an earlier debit. Link if exactly one match.
- Fee: debits at the same account within 2 minutes after a parent transaction whose amount is in the fee table (configurable, seeded with ₦6.98, ₦10, ₦25, ₦50 and their 7.5% VAT values). Attach as children.
- Cash: ATM and POS-agent withdrawals move money into a Cash account; manual cash spends draw it down.

**Statement import:**
1. Reconcile first: opening plus credits minus debits must equal closing, or reject with a fix button.
2. Match each row to existing Transactions with the ladder above.
3. Unmatched rows become new Transactions marked "Added from statement".
4. Alerts in the statement period with no matching row get flagged "Not on your statement". This can catch a fake credit alert, a known scam pattern.

**Undo:** Every merge and link stores who made it (rule, user) and can be undone from Transaction detail: "Not the same" splits a merge; "Not a move between my accounts" unlinks a pair. Each undo is logged as a correction for learning.

### Test cases (T1-T18)

These 18 cases are the acceptance suite for the dedupe engine; each must give exactly the expected Transactions. GTBank inputs follow the verified Acct / Amt / Desc / Avail Bal layout. Every other input is a synthetic field set (bank, direction, amount, time, balance, counterparty), not a real alert template; replace them with redacted real alerts from the corpus before release.

| # | Input A | Input B (and C) | Expected result |
| --- | --- | --- | --- |
| T1 | GTBank SMS: Acct ...6083, Amt 2,000.00 DR, Desc TRF to ADA OKAFOR, Avail Bal 127,696.51, 10:02 | Notification from GTBank app, ₦2,000 debit to Ada Okafor, 10:03 | 1 Transaction, "Ada Okafor", Spending ₦2,000, sources SMS and notification |
| T2 | Same SMS as T1 delivered twice, identical text | (none) | 1 Transaction (re-delivery dropped) |
| T3 | GTBank SMS: ₦500 DR airtime, 10:00, Bal 9,500 | GTBank SMS: ₦500 DR airtime, 10:01, Bal 9,000 | 2 Transactions (same source never merges; balances differ) |
| T4 | GTBank SMS: ₦50,000 DR, Desc TRF to [user's own name], 14:00 | Kuda (synthetic): ₦50,000 credit from [user's own name], 14:01 | 1 linked pair "Moved to Kuda", Own move, excluded from totals |
| T5 | Access (synthetic): ₦20,000 debit to OPay, 09:00 | OPay notification (synthetic): ₦20,000 wallet credit, 09:00. Then OPay: ₦4,500 debit to a restaurant, 13:00 | Funding is an Own move; only the ₦4,500 restaurant debit counts as Spending |
| T6 | Zenith (synthetic): ₦15,000 debit to Tunde, ref R1 | Zenith: ₦15,000 credit, same ref R1, reversal wording, 40 minutes later | Both Cancelled; net effect ₦0; list shows one struck-through item marked Reversed |
| T7 | GTBank SMS: ₦15,000 DR to Tunde, 12:00:10 | GTBank SMS: ₦10 DR and ₦50 DR, 12:00:40 | 1 Transaction "Tunde" ₦15,000 with ₦60 Bank charges as children; detail shows "₦15,060 including ₦60 charges" |
| T8 | UBA (synthetic): ₦20,000 ATM withdrawal, plus ₦100 fee | Manual: ₦3,000 food, Paid from Cash, next day | Withdrawal is Own move to Cash; ₦100 Bank charges; ₦3,000 Food Spending; "₦17,000 cash to log" remains |
| T9 | Card debit ₦8,999 to an online store, 1 Oct | Credit ₦8,999 from the same store, 24 Oct | Refund linked; store's category spending for October nets to ₦0; not Income |
| T10 | Statement row: 3 Oct, ₦2,000 debit, Ada Okafor | Existing T1 transaction (2 Oct 22:59 Lagos time) | Merged (within plus or minus 1 day); statement added as a source |
| T11 | Statement for October | Alert: ₦100,000 credit on 15 Oct with no matching row | Credit flagged "Not on your statement"; user asked to check with the bank |
| T12 | Share to Automonie: screenshot text ₦7,500 debit to Bolt, 18:20 | Notification: ₦7,500 debit to Bolt, 18:20, same day | 1 Transaction (alert and share within 48 hours) |
| T13 | Manual: ₦12,000, Paid from GTBank, "Rent share", 08:00 | GTBank SMS ₦12,000 DR to Ngozi, 08:05 | 1 Transaction, alert data wins, keeps user category and note |
| T14 | Manual: ₦1,000 from GTBank, 09:00, and Manual: ₦1,000 from GTBank, 09:10 | GTBank SMS ₦1,000 DR, 09:15 | Ask "Is this the same as..." with two choices (two candidates) |
| T15 | Monthly credit ₦77,000 from NYSC, 27 Sep | Same on 27 Oct | Second one triggers "Is this your monthly income?"; on Yes, both become Income, NYSC allowance |
| T16 | Transfer ₦5,000 to Chioma on the 1st, 2nd and 3rd months | Credit ₦30,000 from Chioma in month 6 | After the second transfer, ask about ajo; on "Ajo", all become Own move to "Ajo with Chioma" |
| T17 | Decline notice (synthetic): card payment declined, balance unchanged | (none) | No Transaction; raw kept 30 days |
| T18 | SMS: ₦3,000 debit to a person whose name equals the user's | Nothing from any other source within 10 minutes | Shown as Spending with prompt "Did this go to another account of yours?"; Yes converts it to Own move to an untracked account |

## 3. Action Center: use cases

The Action Center should ask only questions whose answer changes the user's numbers, one at a time, answerable in one tap, with the likely answer already highlighted. Everything else gets a best guess, marked so it can be fixed later. Target: most users see 0 to 3 questions on a normal day and never more than 5 in the queue.

### Rules that keep it simple

1. Guess first, ask last. A user rule or a merchant confirmed twice is applied silently. A confident suggestion is applied and marked "Guessed" (a small dot on the row, no question). Ask only when confidence is low and the item matters: it changes totals, or it is ₦2,000 or more.
2. One question per card, one tap per answer. 2 to 4 big buttons, the most likely one first and highlighted. No typing unless the user taps "Something else".
3. Group by sender. "6 payments to Shoprite" is one card. The answer covers all six.
4. Learn every answer. Answering the same way twice for a name creates a rule automatically, with a toast: "Done. We'll do this every time. Change". The user never has to ask for a rule.
5. Undo everywhere. Every answer shows "Saved. Undo" for 10 seconds, and can be changed later from Transaction detail.
6. Skip is always allowed and never punished. Skipped cards drop down the queue. After 14 days a skipped category question resolves to the best guess, marked Guessed, and leaves the queue.
7. Never block the app. The queue is never a gate in front of Home, Money or Plan. Numbers show with guesses included and say so: "Includes 4 guessed categories".

### What the user sees and does

- Home: one slim line, hidden when empty: "3 things need a quick look". Tap opens the Action Center.
- Action Center screen: title "Quick look", a progress line "1 of 3", then one card at a time. Each card shows the clean name, amount, when and bank, the question, the answer buttons, and "Skip for now". "See the original alert" sits collapsed under the card.
- When done: "All sorted. Your numbers are up to date." and a single button back to Home.
- Money list: rows still waiting show amber "Needs a category"; swipe left answers the same question in place.
- Transaction detail: the same question appears inline at the top for that item.

### Question types (ordered by priority; wording is final UI copy)

| Priority | When it appears | Card wording | Answers (default first) | What happens after |
| --- | --- | --- | --- | --- |
| 1 Urgent | A credit alert is missing from the statement for that period | "₦100,000 from Tunde is not on your GTBank statement. Did this money arrive?" | Yes, it arrived / No, remove it / I'm not sure | No: removed from totals, tip to check with the bank. Not sure: kept, flagged |
| 1 Urgent | Two sources disagree on the amount or direction | "Your bank text and app alert show different amounts. Which is right?" | [₦ amount A] / [₦ amount B] | The other observation is set aside, not deleted |
| 2 Changes totals | Money goes to someone with your name, or to a wallet that is not tracked | "Did this ₦50,000 go to another account of yours?" | Yes, it's mine / No, I sent it to someone | Yes: becomes a move, left out of spending; asks once "Which one?" with known banks plus "An account I don't track" |
| 2 Changes totals | Same amount, same bank, two possible matches | "Is this the same as ₦1,000 to MTN at 9:10?" | Yes, same one / No, they're different | Yes merges; No keeps both and remembers the pair |
| 2 Changes totals | A credit repeats monthly from one sender | "Is ₦77,000 from NYSC your monthly income?" | Yes / No, it's something else | Yes sets income and safe to spend; past months update |
| 2 Changes totals | A credit from a sender that looks like a lender | "Is this ₦30,000 a loan?" | Yes, a loan / No | Yes: left out of income; repayments link to it |
| 2 Changes totals | Second regular transfer of the same amount to one person | "You've sent Chioma ₦5,000 twice. Is this ajo or a contribution?" | Yes, ajo / No, just sending | Yes: all past and future become "Ajo with Chioma", not spending |
| 2 Changes totals | A refund could belong to two earlier purchases | "Which purchase is this ₦8,999 refund for?" | [purchase 1] / [purchase 2] / Neither | Links the refund to that purchase |
| 3 Category | New name, low confidence, ₦2,000 or more | "What was ₦4,500 at Mama Put Ikeja?" | Top suggestion / 2nd / 3rd / Something else | Category set; second same answer creates the rule |
| 3 Category | Group of 2 or more from one name | "6 payments to Shoprite. What are they?" | Groceries / Shopping / Something else | All six set, rule created |
| 3 Category | Cash withdrawn and not yet logged, shown in the daily digest | "What did the ₦17,000 cash go on?" | Category chips with amount fields / Leave it | Logged parts become spending; "Leave it" stops asking about that withdrawal |
| 4 Optional | First transfer to a new person | "Who is Ada Okafor?" | Family / Friend / Work / Skip | Groups "Sent to people" by relationship. Asked once per person |
| 4 Optional | Same card charge in two months | "Is Netflix a monthly subscription?" | Yes / No | Yes adds it to Coming up |
| 4 Optional | Money moved to a savings pocket while a goal exists | "Count ₦10,000 in OWealth toward your Laptop goal?" | Yes / No | Yes updates the goal ring |
| 4 Optional | Pasted or shared alert with no bank found | "Which account was this?" | Banks the user has / Cash | Bank set; the sender pattern is remembered |

### When to interrupt and when to wait

| Kind | Badge on Home | Push notification | In the 8 pm digest |
| --- | --- | --- | --- |
| 1 Urgent | Yes | Yes, once, no amount on the lock screen when amounts are hidden | Yes |
| 2 Changes totals | Yes | No | Yes |
| 3 Category | Count only | No | Yes, if 3 or more waiting |
| 4 Optional | No | No | No; shown only inside Action Center after the others |

At most one push a day from the Action Center. Never push on a day the user already opened the app and cleared the queue.

### Use cases, start to finish

1. New user imports 3 months. 214 transactions come in. The app guesses most, then shows: "We found 214 transactions. 7 need a quick look." The 7 are the biggest unknown groups and any own-account moves. Everything under ₦2,000 is guessed and marked. The whole first review takes under a minute.
2. Ordinary day. 6 alerts arrive. 5 match rules or known merchants and are filed silently. 1 new merchant over ₦2,000 waits in the queue. Home says "1 thing needs a quick look". No push.
3. Moving money between own banks. GTBank debit and Kuda credit arrive a minute apart, both tracked: linked automatically, no question. If Kuda is not tracked and the name matches the user: one card, "Did this go to another account of yours?".
4. Corper's allowance. Second ₦77,000 from NYSC: "Is this your monthly income?" One tap sets income, and safe to spend appears on Home for the first time.
5. Cash day. ₦20,000 withdrawn at an ATM. Nothing asked at the time. In the 8 pm digest: "What did the ₦20,000 cash go on?" The user taps Food and Transport, types two amounts, done; the rest can be left.
6. Possible fake credit. A statement upload does not show a credit the app recorded. Push: "A ₦100,000 credit isn't on your statement. Check it." One card, three answers.
7. User ignores the queue for two weeks. Category questions resolve to guesses and disappear. Questions that change totals stay, and Home keeps the single line. No extra nagging.
8. User got it wrong. They open the transaction, tap the category, change it. The rule updates and they choose "Apply to past ones too" or "Only this one".

### How we know it is simple enough

| Measure | Target |
| --- | --- |
| Items filed with no question | 85% or more |
| Questions per active user per week | 5 or fewer |
| Median time to answer a card | Under 3 seconds |
| Answers undone or changed later | Under 10% |
| Users with items waiting longer than 7 days | Under 20% |

## 4. Theme consistency (Dark, Light, Teal)

The Light theme fails contrast today: its primary, income, warning and faint text colours are too pale on white. Dark and Teal mostly pass, except faint text. The fix is a small set of colour swaps plus one rule Claude Code must follow everywhere: components use semantic tokens only, never a raw colour.

The bar is WCAG 2.2: 4.5:1 for normal text, 3:1 for large text (about 18 px regular or 14 px bold and up) and for icons, borders of inputs and chart marks.

### What fails today (measured on the approved tokens)

| Theme | Token | Ratio on surface | Status | Change to |
| --- | --- | --- | --- | --- |
| Light | primary #118f92 | 3.91 | Fails text, and white button labels on it fail too | #0e7c7f (4.99 on white, 4.61 on background) |
| Light | income #059669 | 3.77 | Fails text | #047857 (5.48 / 5.07) |
| Light | warning #d97706 | 3.19 | Fails text (amber "Needs a category" is text) | #b45309 (5.02 / 4.64) |
| Light | textFaint #94a3b8 | 2.56 | Fails everything | #64748b (4.76 on surface; 4.40 on background, so faint text sits on surface only) |
| Dark | textFaint #6b7280 | 3.87 | Fails text | #7c8696 (5.71 on background) |
| Teal | textFaint #6b7280 | 3.46 | Fails text | #8b93a1 (5.40 on surface) |
| Teal | expense #ef4444 | 4.44 | Fails as small text; fine for bars | Use for bars only; verify a lighter red before using it as text |
| All | white on hero start #139DA0 | 3.30 | Fails for small hero text | Darken the gradient start to #0e7c7f (white 4.99), or put a 20% black overlay under hero text |
| All | Mint #1DD3A8 button | White label 1.92 | Fails | Always near-black #0B0E11 label on mint (10.08) |
| Dark, Teal | Hero end #0b5f62 vs background | 2.83 / 2.12 | Card edge melts into the page | Add a heroBorder token: white at 8% opacity |

Ratios computed with the WCAG formula. Unchanged passes include body text (15 or more on every theme) and textSecondary (6.5 or more).

### Token rules for Claude Code

1. One theme file holds every colour. Components read theme.colors.* only. A lint rule rejects hex, rgb and named colours anywhere else. [needs build]
2. Semantic names, not colour names: background, surface, surfaceAlt, border, borderStrong (3:1, for inputs), text, textSecondary, textFaint, primary, onPrimary, income, expense, warning, warningSurface, danger, heroStart, heroEnd, heroBorder, onHero, overlay, skeleton, chart1 to chart5, chartGrid, chartProjection, categoryTint (function of category colour).
3. Every foreground token has a pair. onPrimary for text on primary, onHero for text on hero, and so on. Never place text on a fill without its paired token.
4. Status is never colour alone. Over budget, needs a category and security events each carry an icon and a word.

### How each element adapts

| Element | Rule |
| --- | --- |
| Cards | surface fill plus 1 px border in all themes. Light needs the border because surface vs background is only 1.08 |
| Hero card | Same gradient in all themes (brand), text always onHero, heroBorder on Dark and Teal |
| Charts | Actual line primary, projection textSecondary dashed, grid chartGrid at low contrast, every series 3:1 against surface; legends use words, not colour only |
| Category icons | 40 px circle at 14% of the category colour; the icon itself in full category colour must reach 3:1 against that tint. Check each category colour per theme in the token test |
| Icons | Ionicons take color={theme.colors.text...}. No icons exported with baked colours |
| Illustrations | SVG with fills bound to tokens (two or three tokens per illustration). No PNG with a painted background |
| Gradients and shadows | Shadows only on Light (they vanish on dark); Dark and Teal use border and surfaceAlt for lift |
| Skeletons | skeleton token, same shape as content, no shimmer colour that flashes on Light |
| Status bar and navigation bar | Light icons on Dark and Teal, dark icons on Light; set per theme on every screen, including modals |
| Merchant logos | Shown on a white rounded tile in Dark and Teal so dark logos stay visible |

### Theme QA checklist

An automated token test checks every text and icon pair against its background for all three themes and fails the build below the bar. [needs build] Then screenshots:
- Screens: Home (new user, normal, income not set, over budget), Money list, filter sheet, Transaction detail, + sheet, Automatic tracking, SMS pre-permission, Action Center (card, empty, done), Plan, New budget sheet, You, Ask, every onboarding step, every empty, loading and error state.
- For each: Dark, Light, Teal x hidden amounts on and off. Store as a grid per release (Maestro can drive the app and capture these). [needs build]
- Look for: text on wrong token, invisible borders, logos lost on dark, status bar icons wrong colour, charts unreadable, red used where it is not over budget or security.

## 5. No scrolling, viewing, tapping or swiping issues

Most of these bugs come from four causes: content hidden behind system bars, one scrolling list inside another, swipes that start where Android's back gesture lives, and fixed heights that break with large text. Each standard below names its test on a real phone.

| Area | Standard | Test on a real mid-range Android |
| --- | --- | --- |
| Touch targets | 48 by 48 dp minimum (Android's guideline); raise the spec's 44 to 48. Small icons get invisible padding (hitSlop). 8 dp between targets | Turn on Developer options "Show layout bounds"; tap every icon with a thumb |
| Safe areas and notches | Apps targeting Android 15 draw edge to edge by default. Every screen and sheet pads by the system insets (react-native-safe-area-context); nothing hard-codes a status bar height | Test with gesture navigation and with 3-button navigation; check top and bottom of every screen |
| Centre + button | Scrolling content ends with bottom space = nav height + 26 raise + bottom inset + 16. Sheets and dialogs open above the nav. The + never covers the last row or a button | Scroll every list to the end; last row fully tappable |
| Keyboard | The focused field and the main button stay visible above the keyboard; sheets use the bottom-sheet keyboard handling; tapping outside closes the keyboard; Next moves to the next field | Fill every form on a 360 px phone with a tall keyboard |
| Nested scroll | Never a vertical list inside a vertical scroll view. Each screen is one FlashList with its sections as rows. Horizontal swipers (the Automonie read) inside a vertical list lock direction after the first movement | Scroll Home and Money diagonally; nothing jumps or sticks |
| Swipes vs scrolling | Row swipe starts only after 15 px of mostly horizontal movement and fails on 10 px vertical (gesture-handler offsets). Swipe is always a shortcut; a tap path exists for every swipe action | Scroll Money fast with a slightly sideways thumb; no row should open |
| Swipes vs back gesture | No custom swipe starts within 24 dp of the left or right edge, where the system back gesture lives. Back closes, in order: keyboard, sheet, card stack, screen | Swipe from each edge on every screen; back must never trigger a row action |
| Small screens | Design at 360 px wide. No text in a fixed-height box. Buttons grow to two lines instead of cutting words. Hero amount may shrink to 70% at most, then wraps | Run with Display size set to largest on a 360 px phone |
| Large text | Support system font scale up to 200%. Layouts reflow; nav labels may truncate with ellipsis but never overlap icons; amounts never cut off digits | Font size at maximum: walk every screen in the QA list from section 4 |
| Loading | Skeletons the exact size of content; images and logos reserve their space; new transactions arriving while the user scrolls show a "3 new" pill instead of pushing the list | Throttle network, open each screen; nothing jumps after load |
| Pull to refresh | Only on Home and Money; shows "Updated just now" when done | Pull while a list is mid-scroll |
| Performance | Release-build budgets from Round 4: cold start under 2 s, tab switch under 100 ms. Lists stay smooth with 2,000 transactions | Profile on the release build, not debug |

### Test phones and setup

- Devices: at least one 3 to 4 GB RAM Android in your users' price range, plus one larger phone. Use real release builds.
- Settings to cycle: gesture and 3-button navigation, font size and display size at maximum, Dark, Light and Teal, battery saver on.
- Developer options: Show layout bounds, Pointer location (to see where touches land), animator duration 5x (to catch layout jumps).
- Pass rule: a screen passes only when it works at 360 px, 200% text, both navigation modes and all three themes.

## 6. A low-support app

Round 5 already plans the support tools (fix buttons, self-check, Help Centre, tutorials). What it lacks is a link from the reasons people will actually write in to a fix inside the app. For an alert-reading app, those reasons are predictable, so each one gets an answer before the user needs to ask.

### Expected reasons for help, and the in-app answer

| Likely reason | In-app answer | Flag |
| --- | --- | --- |
| "A payment is missing" | Missing payment finder on Money and in Help: asks which bank and roughly when, checks that source's status, last alert time and battery settings, then offers the fix (turn on, allow in battery settings, paste the alert, upload a statement) | [needs build] |
| Tracking stops after a while | Detect when notification access or SMS reading stops (no alerts for longer than that bank's usual gap). Show a status line with "Fix it" that opens the phone's battery and app settings. Several Android makers limit background apps; link to per-brand steps from Help | [needs build] |
| "This is counted twice" | "Not the same" on Transaction detail (section 2 undo), plus "Why is this here?" showing which sources it came from | [needs backend] |
| "My numbers look wrong" | Number explainers: tap any total or safe to spend to see how it was worked out, in one line each: income, minus spent, minus bills due, with links to the parts | [needs build] |
| Wrong category | Already covered: one tap to change, rule offered, past items updated (section 3) | |
| Statement won't upload | Reconcile failure names the gap ("₦2,400 doesn't add up between pages 3 and 4") with "Try another file" and "Send to support with this file" | [needs backend] |
| Plus trial, billing, cancelling | Plan page shows next charge date, how to cancel (opens Google Play subscriptions), and what happens to data on Free | [needs build] |
| Deleting data or account | Two-step delete in You, with what is removed and when, matching the NDPC work in Round 4 | |

### Additions on top of Round 5

1. Known-issue banner. A server flag shows one calm line in the app when something is broken for everyone ("Access Bank texts are arriving late today. Nothing is lost."). This stops a wave of identical tickets. [needs backend]
2. Report from the spot. "Report a problem" on Transaction detail, the Action Center and each source row. The report attaches the item's IDs and source status, never the raw alert text unless the user ticks it. [needs build]
3. Practice the Action Center. Practice mode includes one sample quick-look card, so the first real question is familiar.
4. Quests tied to real use cases: answer your first quick look, link a move between your accounts, log a cash spend, set your income. Each teaches one behaviour from sections 2 and 3.
5. Ticket loop. Tag every ticket with one reason from the table. Any reason with 3 or more tickets in a week gets a product fix ticket, and the fix is checked against the next week's count.

### Measures

| Measure | Target |
| --- | --- |
| Tickets per 100 weekly active users | Set the baseline in the first month, then cut it by half within 3 months |
| Share of tickets solvable by an existing in-app fix | Under 30% (higher means the fix is hard to find) |
| Missing payment finder: solved without a ticket | 70% or more |
| Users with a source broken for more than 3 days | Under 5% |

## 7. Tap or swipe, and the step budget for every action

Tap is the default for every action. Swipe is only ever a shortcut for something that also has a visible tap path, and each swipe direction means one thing across the whole app. Hidden gestures are rarely found, so key actions must stay visible; a swipe must not clash with other swipes such as navigation, and accidental swipes need a salient undo.

### Where each gesture is allowed

| Gesture | Means, everywhere | Used on | Tap alternative |
| --- | --- | --- | --- |
| Tap | Do it | Everything | (it is the path) |
| Swipe left on a list row | Show quick actions for this row | Money list: Categorise. Never delete | Open the row, same actions at the top |
| Swipe a card off (Action Center) | Skip for now | Quick-look cards only | "Skip for now" button |
| Swipe sideways on a pager | Next page | Automonie read cards, recap stories, onboarding illustrations; always with dots and the next card peeking | Arrows or dots are tappable; stories advance on tap |
| Swipe down on a sheet | Close it | All bottom sheets | Close button or tap outside |
| Long press | Select several | Money list | "Select" in the header |
| Hold | Peek | Hidden amounts (hold 3 s) | Eye button |
| Pull down | Refresh | Home and Money only | Not needed: data refreshes on open |

Never by swipe: deleting, "Not a transaction", unlinking, cancelling Plus, turning a source off. These sit behind a tap and an undo or a confirm.

Teach each gesture once. The first time a Money list has an uncategorised row, that row nudges left by 24 px for half a second to show the action behind it. No other gesture tutorial.

### Step budget

Each step costs effort, and the cheapest ways to cut it are bigger targets, fewer screens to read and fewer things to remember between screens. Every common action gets a ceiling. A build that goes over fails review.

| Action | Ceiling (taps, typing excluded) | How |
| --- | --- | --- |
| See what's safe to spend | 0 | Hero on open, cached numbers show instantly |
| Answer a quick-look question | 1 | Default answer highlighted |
| Sort all payments to one merchant | 1 | Grouped card |
| Categorise one transaction from Money | 2 | Swipe, then chip; or open, then chip |
| Log a cash spend | 3 | + then "Log cash" (amount keypad opens, Cash and last category preselected), then Save |
| Add from a bank alert | 2 | + then "Paste a bank alert" reads the clipboard and shows a preview; Save |
| Share from a bank app | 3 | Share, Automonie, Save |
| Upload a statement | 4 | +, Upload, pick file, Save (password step only when the PDF asks) |
| Create a budget | 2 | "Set a budget" on any category total opens prefilled with a suggestion, Save |
| Mark a move between my accounts | 1 from a card, 2 from detail | |
| Turn on bank texts | 2 | Turn on, then the system Allow |
| Turn on app notifications | 3 | Turn on, system toggle, back (app detects the return and moves on) |
| Hide or show amounts | 1 | Eye on Home |
| Share the monthly recap | 2 | Open recap, Share |
| Undo anything | 1 | Toast button |

### Rules that keep steps low

1. Prefill from where the user came from. Opening "Add" from the Food category prefills Food; from GTBank, prefills GTBank.
2. Remember the last choice. Last bank, last three categories first.
3. Undo instead of confirm for anything reversible. Confirm dialogs only for things that cannot be undone (deleting the account, clearing data).
4. Open the keyboard for you on screens with one field; use a number keypad for amounts.
5. One screen, one decision. No screen asks two unrelated questions.
6. Never ask for what the app already knows. Bank comes from the sender, date from the alert, amount from rules.

## 8. Onboarding, end to end

Onboarding can cover a lot without feeling long if users see Automonie work before they create an account, answer one question per screen, and can skip anything that isn't essential. This builds on the 10-step plan in Round 4.

### The flow, in six acts

| Act | Screens (one question each) | Why | Skippable |
| --- | --- | --- | --- |
| 1. Hello | Animated welcome: a messy bank text turns into a clean, sorted transaction. "Get started" / "I have an account" | Shows the promise in 3 seconds | No |
| 2. About you (no account yet) | First name; What best describes you (Student, Corper, Working, Hustling, Between things); What do you want help with (pick up to 3: see where my money goes, stop running out before month end, save for something, track my side hustle, split money with friends); Which banks and wallets do you use (logo grid, OPay, PalmPay, Moniepoint, Kuda first) | Sets copy, defaults and which features lead. Corper prefills the ₦77,000 allowance | Name no; rest yes |
| 3. See it work (practice) | A sample alert drops in and gets sorted. Then one sample quick-look card: "What was ₦4,500 at Mama Put?" User taps Food, gets a small celebration | Teaches the Action Center before real data | Yes |
| 4. Make it yours | Create account (existing sign-in). Birthday day and month: "So we can celebrate you." | Account only after value is seen | Birthday yes |
| 5. Connect | SMS pre-permission screen, then system Allow; Notification access: 3-frame animation of the Settings steps, deep link, auto-advance on return; Confirm "Your bank apps" | Two system steps, each with one reason | Yes, with a clear alternative |
| 6. Your money, live | "Bringing in your last 3 months" with a live counter and short facts while it works; Reveal: "We found 214 transactions across 3 banks."; First quick look (7 questions or fewer); Income: "Is ₦77,000 from NYSC your monthly income?" or enter it; Safe to spend reveal: hero counts up to the number; Suggested first budget from real spending, one tap; Daily summary ask: "Want a short money check at 8 pm?" | The payoff | Each step yes |

Then Home, with at most three coach marks (hero, Action Center line, + button), and the "Getting started" quests from Round 5.

### Paths that must work

- Says no to bank texts: no guilt screen. "No problem. You can still track by sharing alerts or uploading a statement." Shows the share practice and adds "Turn on bank texts" to Finish setting up.
- Import finds nothing (new phone, cleared texts): "Your phone doesn't have older bank texts. Upload a statement to see your last months." with Upload and Later.
- iPhone or no Android access: acts 5 and 6 become share and statement upload, with the same reveal at the end.
- Corper with no allowance seen yet: income set from the corper choice; at the 25th to 30th window, a check "Did your allawee land?"
- Leaves halfway: reopening resumes at the same act. Nothing typed is lost.
- Returning user: "I have an account" signs in and goes straight to Home, with a "Turn on tracking on this phone" card if sources are off on this device.

### Rules

1. One question per screen, big tap targets, the likely answer first.
2. A segmented progress bar by act, never by screen count.
3. Every skip lands in "Finish setting up" on You, so nothing is lost.
4. Total time goal: under 3 minutes to the safe to spend reveal, excluding the import wait.
5. Mascot appears in acts 1, 3 and 6; never on permission screens, where the trust copy leads.

### Measures

| Measure | Target |
| --- | --- |
| Reach safe to spend reveal on day 1 | 70% of installs that open the app |
| Turn on at least one automatic source | 75% |
| Answer the first real quick look | 60% |
| Drop-off at any single screen | Under 8% |

## 9. The bar: what the best apps do

The apps young Nigerians love win on two things first, reliability and a voice with personality, and only then on looks. OPay's design is called weaker than rivals, yet users stay for speed and few failures; Chowdeck's heaviest users stay because the food arrives, and leave when fees rise or support fails. Automonie can beat both by pairing OPay-level dependability with a far better looking app.

| App | What it does that works | What Automonie takes from it |
| --- | --- | --- |
| OPay | Very fast transfers and rare failures; suggests the right bank as you type an account number; warns when another bank's network is down so you know the money may be late. Its UI is judged weaker than rivals. Stayed up while banks had outages; account number is your phone number | Predict the answer before the user types it. Tell people early and honestly when a bank is slow (known-issue banner, section 6). Never fail silently |
| Chowdeck | Playful copy and a catchphrase ("You don chow?"); a five-tier loyalty ladder with funny names earned by rating, reviewing and referring; round-the-clock support that compensates for delays. An order tracker described as more transparent than rivals, and riders who call when an order is late | A real voice with a catchphrase. Visible "what's happening now" status like an order tracker. Levels with names people want to screenshot. Speak up first when something goes wrong |
| Chowdeck and Glovo heavy users | Reliability is the loyalty; people switch when fees rise or support fails; subscriptions (ChowPass, Glovo Prime) appeal to the cost-conscious | Plus must feel like a clear saving or win, not a paywall. One bad missing-transaction week loses a user |
| Kuda | Clean, intuitive interface; Spend and Save sets money aside on each transaction | Calm, uncluttered screens |
| PalmPay | Rewards and merchant discounts, but the interface feels cluttered and the marketing aggressive | The warning: rewards and promos must never crowd the money view |
| Duolingo | Value before sign-up, goal and reason questions, a mascot in every key moment | Section 8, and the mascot plan in section 11 |
| Spotify Wrapped | 2025 edition: 200 million users engaged in 24 hours and over 500 million shares, company-reported | A recap people want to post. Automonie's version shows personality and patterns, never naira amounts |

Gap in this research: public sources describe these apps' features and reputation, not their screen-by-screen design. To match Glovo and Chowdeck visually, record screen videos of their key flows (open app, browse, order, track, rate) on a real phone and review them against sections 7 and 10. That is a half-day task worth doing before the visual redesign.

## 10. Every action, every response

Every tap answers within 100 ms, every change of state is shown and felt, and every failure says what happened and offers a fix. Haptics follow Android's guidance: crisp clicks, never long buzzy vibrations, light for frequent events and stronger only for important ones, always in sync with the visual.

### Motion and haptic vocabulary

| Name | Duration | Used for | Haptic (expo-haptics) |
| --- | --- | --- | --- |
| Press | 80 to 120 ms, scale to 0.97 | Every button, row, chip | None (selection on chips only) |
| Settle | 200 to 280 ms, ease out | Sheets, cards, list inserts | None |
| Confirm | 300 ms | Saved, answered, sorted | Light impact |
| Celebrate | 800 to 1,200 ms | Goal reached, queue cleared, first safe to spend | Success notification |
| Warn | 300 ms | Over budget, source stopped | Warning notification |
| Count | 600 ms | Numbers changing on the hero and totals | None |

When the phone's "Remove animations" setting is on, every motion drops to a simple fade and celebrations become a static badge.

### Response for each action

| User action or event | Instant response | Then | Copy | If it fails |
| --- | --- | --- | --- | --- |
| Open the app | Last numbers show at once from cache | Changes count up when fresh data lands; "Updated just now" | | Offline: "You're offline. Showing your numbers from 2 hours ago." |
| New transaction arrives while open | Row slides in at the top of today with a 1.5 s highlight | Totals count | | |
| New transactions while scrolling | "3 new" pill at the top | Tap scrolls up | | |
| Answer a quick-look card | Chosen button fills, Confirm haptic | Card leaves, next rises | Toast: "Saved. Undo" | Network error: answer kept on the phone, synced later, no error shown |
| Clear the last card | Celebrate | Mascot thumbs up, numbers refresh | "All sorted. Your numbers are up to date." | |
| Swipe a row to categorise | Row follows the thumb, action revealed | Chip tap: row colour tint settles | Toast with Undo | |
| Save a manual or cash entry | Sheet closes, row inserts highlighted | Cash left to log updates | "Logged. ₦17,000 cash left to log." | Missing amount: field shakes once, no dialog |
| Paste a bank alert | Preview of the parsed transaction | Save | | "We couldn't read this one. Check it's a bank alert, or add it by hand." with both buttons |
| Upload a statement | Steps tick: Reading, Checking totals, Matching | Result: "128 added, 86 already here" | | Doesn't add up: names the gap and offers "Try another file" |
| Turn on a source | Switch animates, status shows "Working" with one pulse | | | Permission refused: calm explainer, alternative offered |
| A source stops working | Status turns amber with "Fix it" | One push if over 24 hours | "Bank texts paused. Tap to fix." | |
| Budget reaches 80% | Bar fills to amber | Push only if "Warn me at 80%" is on | "Food is at 80% with 9 days to go." | |
| Over budget | Bar turns red (the only allowed red) | | "₦3,200 over on Food this month." No scolding | |
| Goal reached | Celebrate, ring completes | Share card offered | "You hit your Laptop goal." | |
| Hide amounts | Numbers blur over 200 ms | Hold to peek for 3 s | | |
| Delete or "Not a transaction" | Row collapses | 10 s undo | "Removed. Undo" | |
| Search with no results | Suggestions: nearest names, change the period | | "Nothing for 'shopritee'. Did you mean Shoprite?" | |
| Ask a question | Answer streams in, numbers from the database | Source table, "See all" | | "I couldn't work that out. Try asking about one month or one category." |
| Payday detected | Hero counts up | Next day: one card "Plan this month" | "Money don land. ₦77,000 from NYSC." | |
| Any server error | Nothing lost on screen | Retries quietly 3 times | | Only then: "Something went wrong on our side. Try again." with Retry |

### Rules

1. No spinner longer than 300 ms without a skeleton or a step label.
2. No dialog for an error the user can fix on the same screen; mark the field instead.
3. Every error names the next step and has a button for it.
4. Sound is off by default; one optional success sound in settings.

## 11. Making it irresistible

Automonie becomes a brand people talk about through one recognisable voice, one signature animation, moments worth screenshotting, and timing tied to the Nigerian calendar. Attention must always be earned with something useful, never by nagging. These are ideas to test, not researched facts, except where a source is linked.

### Voice

- Plain labels, playful moments. Buttons, menus and numbers stay plain English. Headlines, toasts, empty states, celebrations and pushes carry the personality, with light Pidgin and Gen Z slang.
- A catchphrase, the way Chowdeck owns "You don chow?". Candidates to test: "Where my money go?" (the question Automonie answers), "Money don land" (income arrives), "Sapa radar" (the forecast warning).
- Kind, never shaming. "Sapa radar: at this pace, money gets tight around the 24th. Want a plan?" is fine. Anything that mocks spending is not.

### Signature animation

One move that only Automonie has: a messy bank text morphs into a clean, sorted transaction. It appears in the welcome screen, on the + sheet, when a new transaction lands, and in ads and social clips. Build with Reanimated for UI motion and Lottie or Rive for illustrated pieces.

### Mascot

The Duolingo-style companion already wanted. It reacts to state (calm, pleased, a little worried, celebrating), lives in onboarding, empty states, celebrations and the recap. It never appears beside errors about missing money or on permission and security screens.

### Moments worth sharing

| Moment | What it is | Share format |
| --- | --- | --- |
| Monthly recap | Stories: top category, biggest day, money personality, a comparison with last month in words | Story-size card, no naira amounts (existing rule) |
| Money personality | The eight archetypes | Card already planned |
| Levels | Playful names earned by habits (checking money, sorting, budgets kept), like Chowdeck's tiers. For example: Just Vibes, Budget Baby, Sapa Dodger, Money Odogwu | Level-up card |
| Goal reached | Celebration and card | "I just hit my Laptop goal" card, amount optional and off by default |
| NYSC year recap | For corpers at passing out: the service year in money patterns | Card |
| Calendar moments | Payday windows (the corper allowance lands between the 25th and 30th), the 1st of the month reset, Valentine's, school resumption, Black Friday and Detty December. Each gets a themed Home read, a recap angle and social content, planned a month ahead | |

### Reasons to open daily, without nagging

1. Home screen widget showing safe to spend for today, respecting hidden amounts. [needs build]
2. The 8 pm summary carries a real number or one question, never "We miss you".
3. A gentle streak for days the user checks their money, with one free skip a week and no guilt push when it breaks.
4. Unlockable themes and mascot outfits as quest rewards, so the Teal theme has company.
5. One push a day at most across the whole app, quiet between 10 pm and 8 am, except security events.

### Brand outside the app

The same voice and signature animation in the Play Store screenshots, the WhatsApp channel, short videos and the website. Every recap and card carries a small "automonie.com" mark so shares bring people back.

## 12. Subscriptions

Subscriptions get their own home: a count and monthly total on Plan, a Subscriptions screen with each service's real logo and next charge date, and alerts for price rises, double charges and renewals. Known services are recognised from their first charge using a catalogue; unknown ones after two regular charges. Prices and plan names live in a config table, not in code, because they change often: Netflix Nigeria raised prices three times between April 2024 and June 2025, to ₦2,500 to ₦8,500 a month, and DStv and GOtv switch to renamed packages on 5 November 2026, with old packages mapped to new ones (Access to Starter, Family to Select, Compact to Sports, Compact Plus to Premium).

### What the user sees

- Plan, Coming up: a Subscriptions row: up to five overlapping logos, "6 subscriptions · about ₦24,300 a month". Tap opens the screen.
- Subscriptions screen: header "₦24,300 a month · ₦291,600 a year". Rows sorted by next charge: logo, name, plan guess ("Standard"), "₦6,500 · Renews 14 Nov · GTBank". Sections: Active, then Stopped (not charged when expected).
- Badges on a row: "Price up ₦1,000" · "Charged twice" · "Renews tomorrow" · "Not charged this month".
- Subscription detail: charge history, "Remind me before it renews" switch, "How to cancel" (steps plus a link to the service's own page), "I cancelled this", "Not a subscription".
- Add one by hand: a searchable logo grid of the catalogue; picking one prefills name, logo, plan and price from config.
- After the 3-month import: a reveal card, "We found 5 subscriptions costing about ₦19,800 a month."
- Home read and recap: "Subscriptions take 26% of your allowance." · "Your most loyal subscription: Spotify."

### Detection

1. Catalogue match: the counterparty matches a catalogue pattern. If the service only sells subscriptions (Netflix, Spotify, Showmax), mark it from the first charge with no question.
2. Pattern match for anything else: same merchant, amount within 10% (15% for dollar-card charges, since exchange rates move), interval of 28 to 31 days (monthly), 6 to 8 (weekly) or 360 to 370 (yearly). Two hits, then the Action Center asks once: "Is [name] a monthly subscription?"
3. Google charges show as "GOOGLE *" followed by the product, and verification holds show as "GOOGLE *TEMPORARY HOLD". Use the product name; ignore holds.
4. Apple charges show as "apple.com/bill" for every Apple service, so the alert does not say which one. Show "Apple" and ask once: iCloud, Apple Music, an app, or something else.
5. Never show a logo on a guess. A wrong logo is worse than none. Logo only on a catalogue match or a user confirmation; otherwise category icon, then initial (the existing fallback order).

### The catalogue

One config table, editable without an app release: service, category, name patterns, subscription-only yes or no, usual cadence, plans and prices with a last-checked date, cancel link, logo. Patterns marked unverified must be confirmed against real Automonie alerts before shipping.

| Service | Category | How it may appear | Pattern status |
| --- | --- | --- | --- |
| Netflix | Streaming | NETFLIX | Unverified |
| Spotify | Music | SPOTIFY | Unverified |
| YouTube Premium, Google One, apps on Google Play | Streaming, Cloud, Apps | GOOGLE *YouTube, GOOGLE *[product] | Format verified |
| iCloud, Apple Music, App Store | Cloud, Music, Apps | apple.com/bill | Format widely reported; ask which service |
| Showmax | Streaming | SHOWMAX | Unverified |
| DStv, GOtv | TV | DSTV, GOTV, MultiChoice, or via a bill-payment provider | Unverified; plan names change 5 Nov 2026 |
| Prime Video | Streaming | AMAZON PRIME, PRIMEVIDEO | Unverified |
| Boomplay, Audiomack, Apple Music | Music | BOOMPLAY, AUDIOMACK | Unverified |
| ChatGPT, Canva, CapCut | Apps and tools | OPENAI, CANVA, CAPCUT | Unverified |
| ChowPass, Glovo Prime | Food delivery | CHOWDECK, GLOVO | Unverified; both programmes are real |
| Data plan auto-renewal (MTN, Airtel, Glo) | Airtime and data | Network name with data wording | Unverified; treat as Recurring, not Subscription, unless the user says so |
| Gym, school fees, rent | Other recurring | Transfer to a person or business | Pattern match only (rule 2) |

Logos: Clearbit's free logo API has shut down; Logo.dev and Brandfetch are the common replacements. Fetch once into the catalogue and serve from Automonie's own storage so the app never waits on a third party, if the provider's terms allow caching. Check each provider's licence and the brands' own guidance before launch; this is not legal advice. Logos sit on a white rounded tile in Dark and Teal (section 4).

### Alerts (all optional, sensible defaults)

| Alert | Default | Copy |
| --- | --- | --- |
| Renews tomorrow | On for yearly ones and anything ₦5,000 or more | "Spotify renews tomorrow: ₦1,600 from GTBank." |
| Price went up | On | "Netflix went up from ₦6,500 to ₦7,500." |
| Charged twice | On | "Showmax charged you twice this month. Check it?" |
| Not charged when expected | In-app badge only | "Not charged this month. Did you cancel?" |

These follow the one-push-a-day limit; extra alerts wait for the 8 pm summary.

### Edge cases

- Shared plans: a friend's regular transfer back links to the subscription as a payback, and the screen shows "Your share: ₦2,500".
- Failed charge then retry: a reversal plus a new charge the same day is one charge, not "Charged twice" (uses the reversal link from section 2). "Charged twice" needs two successful charges within 3 days.
- Free trial: ₦0 or a small verification charge followed by nothing is not a subscription. If the catalogue knows the trial length, show "Trial ends in 2 days" once a first full charge is expected.
- Plan change: a new amount from the same service is a price change unless it matches another catalogue plan; then show "Changed to Premium".
- Cancelled: two missed cycles move it to Stopped automatically; "I cancelled this" moves it at once.

### Test cases (S1-S8)

| # | Input | Expected |
| --- | --- | --- |
| S1 | First debit to NETFLIX, ₦6,500 | Subscription from first charge, Netflix logo, no question |
| S2 | ₦3,000 to "Iron Gym" on 2 Sep and 1 Oct | After the second: one question; on Yes, monthly subscription, initial icon (no logo) |
| S3 | apple.com/bill ₦1,000 | Shown as Apple; one question with iCloud, Apple Music, an app, something else |
| S4 | GOOGLE *TEMPORARY HOLD ₦50, then reversed | Ignored, not a subscription, not spending |
| S5 | Netflix ₦6,500 for 3 months, then ₦7,500 | "Price up ₦1,000" badge and push |
| S6 | Showmax charge, reversal, charge again same day | One charge, no "Charged twice" |
| S7 | DStv "Compact" paid in October; "Sports" price in November | Plan shown as Sports with "New package name" note, not a price rise |
| S8 | Spotify charges stop for two months | Moves to Stopped; monthly total drops |

## 13. Gap check: other things like subscriptions

A full pass over sections 1 to 12 found 12 more gaps of the same kind: features users will expect that were implied but never specified. The biggest is that the category list itself was never defined.

| Gap | Why it matters | Proposal | Flag |
| --- | --- | --- | --- |
| Category list | Every screen and question depends on it | Proposed Nigerian list below; check against the categories in the current app before adopting | [needs backend] migration |
| Merchant catalogue beyond subscriptions | Logos and instant categories for the places people pay most | Same catalogue and logo rules as section 12, seeded with delivery (Chowdeck, Glovo), rides (Bolt, Uber, inDrive), shops (Shoprite, Jumia, Konga), networks (MTN, Airtel, Glo), electricity companies, betting companies, banks and wallets. Patterns unverified until checked against real alerts | [needs backend] |
| Regular payments that are not subscriptions | Rent, school fees, ajo, family support, loan repayments need reminders too | A "Regular payments" group in Coming up, separate from Subscriptions, using the same pattern detection | [needs backend] |
| Prepaid electricity | No due date, but people run out | "You usually buy light every 9 days. Last bought 8 days ago." in Coming up | [needs backend] |
| Irregular income | Hustlers and freelancers have no fixed salary, so safe to spend breaks | For "Hustling" users, income = average of the last 3 months, shown as "about", with a way to set it by hand | [needs backend] |
| Who owes me | Splits and lent money are common | "Owed to me" list from split bills and money marked as lent, cleared when the person pays back | [needs build] |
| Pending and held charges | Holds look like spending | Holds and pending items never count; if a final charge does not follow within 7 days, drop them | [needs backend] |
| Dollar amounts | Dollar cards and foreign charges | Show the dollar figure and the naira debit; never convert with a guessed rate | [needs build] |
| Money formatting | Consistency builds trust | ₦ with commas; kobo hidden unless not zero; short forms (₦1.2m) only on charts; "Today", "Yesterday", then dates, in Lagos time | [needs build] |
| Screen readers | TalkBack reads "N 4 5 0 0" | Every amount has a spoken label: "4,500 naira spent" | [needs build] |
| Web app parity | Users switch between phone and app.automonie.com | Action Center answers, rules and subscriptions sync both ways; web shows the same queue | [needs build] |
| Old app versions | Rule and parser fixes must reach everyone | Server-side minimum version with a friendly "Update to keep tracking" screen | [needs backend] |

### Proposed categories

A proposal from this research, written for young Nigerians, to compare with the app's current list. Each has one Ionicon and one colour per theme.

| Group | Categories |
| --- | --- |
| Daily life | Food and groceries · Eating out and delivery · Transport and rides · Airtime and data |
| Home | Rent and housing · Electricity · TV and internet · Water and gas |
| People | Family support · Sent to people (default for person transfers) · Gifts and events (owambe, aso ebi) · Giving (church, mosque, charity) |
| You | Shopping · Fashion and beauty · Health · Education and school fees · Fun and outings · Subscriptions |
| Money | Savings (own move) · Loans and repayments · Bank charges · Betting |
| Work | Business and hustle |
| Fallback | Other |

Users can rename, hide and add categories; rules and learned merchants follow renamed ones.

### 13.1 Categories in full

The spending list above has no income side. Add income categories: Salary · Allowance (NYSC, stipend) · Business and hustle income · Money from people · Interest · Refunds and paybacks (these reduce spending, see section 2) · Other income.

Each category record: id, name, group, Ionicon, colour token per theme, effect (Income, Spending, Own move, Debt), and whether it can hold a budget. Savings and Loans are never budgetable spending.

Rules:
1. Rename keeps the id, so rules, budgets and history follow.
2. Hide removes it from pickers; existing transactions keep it and show it greyed in filters.
3. Merge moves all transactions, rules and budgets to the target, with undo for 24 hours.
4. Delete is merge into Other, with the same undo.
5. A user-added category gets the next unused colour token and a chosen icon from a short list.
6. When Other passes 15% of a month's spending, the Automonie read says so once: "₦18,000 is in Other this month. Sort a few?" and opens a grouped Action Center.

Tests (C1-C3):
| # | Input | Expected |
| --- | --- | --- |
| C1 | Rename Food and groceries to Chop money | All past rows, the budget and the Shoprite rule show Chop money |
| C2 | Merge Fun and outings into Eating out, then undo within 24 hours | Everything returns exactly as before |
| C3 | Other reaches 16% on the 20th | One read card that month, never repeated |

### 13.2 Merchant catalogue and clean names

The catalogue from section 12 covers every common merchant, not only subscriptions. Same fields, same logo rules, delivered from the server and updated without an app release.

Seed groups (patterns unverified until checked against real alerts): delivery (Chowdeck, Glovo), rides (Bolt, Uber, inDrive), shops (Shoprite, Jumia, Konga), networks (MTN, Airtel, Glo), electricity companies, TV, betting companies, banks and wallets, schools and churches only by user rule.

Match order:
1. The user's own rule.
2. The user's learned merchant (confirmed twice).
3. Catalogue exact or alias pattern.
4. Close spelling match: suggests only, never auto-applies, and never shows a logo.

Clean name rules (the existing rule: no raw narration as a title):
1. Strip channel words and codes: transfer and POS prefixes, terminal IDs, long digit strings, session references, bank codes.
2. A catalogue match replaces the name with the brand's own spelling (MTN, GTBank, Chowdeck).
3. A person's name becomes Title Case (ADA OKAFOR to Ada Okafor).
4. If nothing readable is left, the title is the category plus channel ("Card payment"), never digits, and the raw text stays on Transaction detail.
5. The user can rename any merchant once and it applies everywhere ("Iya Basira" instead of a terminal name).

Tests (M1-M4):
| # | Raw counterparty | Expected title |
| --- | --- | --- |
| M1 | A transfer narration ending in a person's name in capitals | That name in Title Case, Sent to people |
| M2 | A POS narration with a terminal ID and a shop name | The shop name only |
| M3 | Only digits and codes | "Card payment", category asked if over ₦2,000 |
| M4 | A narration close to SHOPRITE but misspelled | Suggestion "Shoprite?" in the Action Center, no logo until confirmed |

### 13.3 Regular payments (not subscriptions)

Rent, school fees, ajo, family support and loan repayments get the same pattern detection as section 12, shown as a Regular payments group in Coming up, separate from Subscriptions.

- Detected: same person or business, similar amount (within 15%), steady interval. Two hits, then one Action Center question: "Do you pay Mama ₦20,000 every month?" Yes / Not regularly.
- Added by hand: "Rent, ₦600,000, every year, next on 1 March." Big yearly or termly payments show a countdown and a tracking line: "About ₦50,000 a month gets you there." Tracking only: no "save automatically" wording (existing banned list).
- Reminders: off by default, offered once per item; 3 days before for yearly and termly, 1 day before for monthly.
- Missed: if the expected payment does not appear within 5 days, a badge says "Not paid yet this month", never a push.

### 13.4 Prepaid electricity

Prepaid meters have no due date, so Automonie learns the rhythm instead.

- After 3 electricity purchases, Coming up shows: "Light: usually every 9 days, about ₦8,000. Last bought 8 days ago." Interval and amount are the medians of the last 6 purchases.
- A reminder one day before the usual date is opt-in only.
- Tokens never show in lists or pushes (existing rule). On Transaction detail the token sits behind "Show token" with a copy button, because people do need it.
- Postpaid electricity is a regular payment (13.3).

### 13.5 Irregular income

For users who chose "Hustling", or whose income changed by more than 25% between two of the last three months, safe to spend uses a careful estimate.

- Planning amount: the lowest of the last three full months, labelled "Planning on ₦85,000 (your lowest recent month)". One tap switches to the average or a typed amount.
- Hero: "About ₦X safe to spend", never an exact-sounding figure; the line under it shows "₦60,000 in so far this month".
- When more arrives: a gentle read card: "₦40,000 more came in. Safe to spend is up." No push.
- Business money: hustlers can mark a bank or wallet as "Business"; its money stays out of personal totals and gets its own simple in and out view.

### 13.6 Owed to me

Lent money and split bills become a short list on Plan: "Owed to you: ₦12,000 from 3 people."

- Adding: on any transfer to a person, "I lent this"; on a bill, "Split this" (pick people from those you have sent money to, equal or custom shares).
- Effect: lent money is not spending (Debt in section 2). The user's own share of a split bill stays spending.
- Paid back: a credit from that person within 90 days, equal to or less than what they owe, is suggested as a payback with one tap; partial payments reduce the balance.
- Reminding them: "Remind on WhatsApp" opens WhatsApp with a friendly message the user can edit and send. Automonie never messages anyone itself.
- Writing it off: "Forget it" turns the remainder into spending under Gifts and events.

Tests (O1-O3, E1, R1):
| # | Input | Expected |
| --- | --- | --- |
| O1 | Transfer ₦10,000 to Tunde, marked "I lent this" | Not in spending; Owed to you ₦10,000 |
| O2 | Tunde sends ₦6,000 three weeks later | Suggested as payback; on Yes, ₦4,000 still owed |
| O3 | User taps Forget it | ₦4,000 becomes Gifts and events spending on the original date |
| E1 | Five electricity buys, 8 to 10 days apart | Coming up shows "usually every 9 days" |
| R1 | ₦20,000 to Mama on the 1st, twice | One question; on Yes, Regular payments shows Mama monthly |

### 13.7 Pending and held charges

- An alert with hold or pending wording, or a known hold descriptor such as "GOOGLE *TEMPORARY HOLD", becomes a Pending observation: shown in grey on Transaction detail only, never in totals or lists.
- A final charge on the same account for the same or a nearby amount within 7 days replaces the hold (merge, section 2).
- No final charge after 7 days: the hold is dropped silently.
- A balance that drops because of a hold is not treated as a mismatch.

### 13.8 Dollar amounts

- Accounts carry a currency. A dollar card is its own account in USD.
- Funding it from naira is an Own move (section 2). Spending on it is Spending in dollars.
- Totals in naira include dollar spending only when Automonie knows the real rate the user paid: the naira paid divided by the dollars received on the most recent funding. Otherwise totals show "plus $24 on your dollar card" separately. No guessed or market rate, ever.
- Rows show both when known: "$9.99 · about ₦16,500 at your rate".

### 13.9 Money and date formatting

| Situation | Format |
| --- | --- |
| Whole naira | ₦4,500 |
| With kobo | ₦4,500.50 (kobo only when not zero) |
| Charts and tight spaces | ₦1.25m, ₦850k |
| Hidden amounts | ₦•••• |
| Safe to spend below zero | ₦0 with "You're ₦X over for this month" (approved spec) |
| Dates | Today, Yesterday, then "Mon 2 Nov", and the year only for past years |
| Times | Follow the phone's 12 or 24 hour setting, Lagos time |
| Periods | Every number says its period (approved rule): "in November", "this week" |

### 13.10 Screen readers

- Every amount has a spoken label: "4,500 naira, spent at Shoprite, yesterday".
- The hero reads "Safe to spend until 30 November: about 52,000 naira".
- Hidden amounts read "amount hidden".
- Icon-only buttons have names ("Hide amounts", "Add").
- Action Center cards read in order: question, then the item, then answers, then Skip.
- Test with TalkBack on through the full QA screen list in section 4.

### 13.11 Web app parity

- The web app at app.automonie.com shows the same Action Center queue, subscriptions, regular payments and Owed to me.
- Answers, rules and edits sync both ways through the same API; each field keeps an edit time, and the newest edit wins.
- Answers given offline on the phone are queued and sent when back online; the web shows them once they arrive.
- An item answered on one device disappears from the other's queue at the next refresh.

### 13.12 Minimum version and remote rules

- A config endpoint returns: minimum version, recommended version, catalogue version and parser rules version.
- Below the minimum: a full screen, "Update Automonie to keep tracking", with a Play Store button. Nothing else works, so nothing is counted wrong.
- Below the recommended version: a dismissible card at most once a week.
- Parser rules and the catalogue are delivered as signed data, so most alert-format fixes reach every user without an app update. They stay deterministic rules (AI still never extracts amounts or direction).

Tests (H1, H2, D1, D2, V1, V2):
| # | Input | Expected |
| --- | --- | --- |
| H1 | Hold ₦5,000, then a final charge of ₦4,850 two days later | One transaction of ₦4,850; hold gone |
| H2 | Hold ₦50 with nothing after 7 days | Dropped; never counted |
| D1 | ₦170,000 paid for $100, then a $9.99 charge | Row shows "$9.99 · about ₦16,983 at your rate" |
| D2 | $9.99 charge with no funding seen | Totals add "plus $9.99 on your dollar card", no naira figure |
| V1 | App below minimum version opens | Update screen only |
| V2 | New parser rule for a changed alert format published | Old and new alerts both parse without an app update |

## 14. What the screenshots show

The live app already has most of the approved structure, but six bugs make the numbers disagree with each other, and that is the fastest way to lose trust. The worst: two Apple charges (₦510 and ₦1,326) are filed as "Cash out, not counted as spending", which is exactly the ₦1,836 "taken out as cash" shown on Money. A subscription is being treated as a cash withdrawal.

### Bugs, in fix order

See `round6-trust-review-polish.md` section 2 (Block 1) for the full B1-B6 table and test T19 - duplicated there as the authoritative version since that brief is what sessions execute against.

### Rule breaks against the approved specs

| Seen on | Break | Fix |
| --- | --- | --- |
| Money list | Raw narration as titles: "Vat", "POS PUR 11 PLC FESTAC 23RD...", "Stamp Duty Charge For Trxn...", "-Transfer Fr..." | Clean name rules (13.2). VAT and stamp duty fold under their transfer (section 2, row 11) instead of standing alone |
| Money totals | "₦15.2K" in the totals | Full amounts in totals; short forms only on charts (13.9) |
| Action Center | OWealth interest alerts shown raw under "Alerts to check" | Interest is a known pattern: Income, grouped monthly (section 2, row 22). Never shown raw to the user |
| Action Center | A long page of sections with big buttons, and a raw alert with editable fields | One card at a time, one tap (section 3). Raw text only behind "See the original alert" |
| Home | Daily recap pops up as a modal over Home | Never block Home: the recap is a card in the Automonie read, opened by tap |
| + sheet | Purple, blue, orange and yellow icon tiles | The approved single-accent design: one tint for all tiles |
| + sheet | "Scan a receipt" and "Ask about your money" have no Plus tag | Plus tag on both (approved rule) |
| + sheet | "Speak a transaction" is not in the approved spec | Keep only if voice entry is meant to ship; add it to the spec, or hide it |
| Plan, Coming up | Purple date tiles; no service logos | Logos from the catalogue (section 12); date as text |
| Splash | Dark teal logo on black is barely visible | Use the signature animation (section 11), or mint on black |

Already right and worth keeping: the slim Action Center line on Home, the hero layout, Coming up already finding Netflix, Spotify and Claude, "Automatic tracking is on · Manage" on the + sheet, the filter and search layout, and "Fuel" correctly picked for a POS charge at a fuel station.

### What Chowdeck and Glovo show

| Pattern | Seen in | Automonie version |
| --- | --- | --- |
| A three-figure summary strip (delivery fee, time, rating) in one bordered row | Chowdeck | Merchant and subscription detail: "Spent this month · Visits · Usual amount" |
| "Order again" row of big tappable cards with a + on each | Chowdeck | "Do again" on Home: last cash log, last paste, last budget check, one tap each |
| Struck-through old price beside the new one | Chowdeck | Subscription price rise: old price struck through beside the new one |
| Closed state named with a time: "Opens tomorrow at 7:30" | Glovo | Source status with a time: "Bank texts paused since 9:10 am" |
| Gentle inline upsell ("Free delivery on every order. Enjoy 1 month for free") | Glovo Prime | Plus as one inline line where it helps, never a modal |
| Big bold display type, logo tile overlapping a hero image | Both | Bolder titles at the top of Money, Plan and detail screens |
| Tabs under the header for sections | Both | Money filters and the Subscriptions screen |

### Screenshots setting (changed)

Screenshots are allowed by default. You, Privacy and security gets a switch: Block screenshots, off by default, with the line "Stops screenshots and screen recording in Automonie. The app preview in your recent apps is also hidden." On Android this uses the system secure-window flag, which blocks screenshots and recording and blanks the recent-apps preview. This replaces the Round 4 default of blocking. One exception, recommended: the sign-in and code-entry screens stay blocked always, because they show codes. Remove that exception if everything should be allowed.
