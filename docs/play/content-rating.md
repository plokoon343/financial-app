# Play Console: content rating and other App content declarations (16 Nov 2026)

Play Console, Policy, App content. The content rating questionnaire is run by the International Age Rating Coalition (IARC). Wording of questions changes between Play releases, so match by meaning. Everything below is answered from the code. "Judgement" marks the few places the owner must decide.

## Content rating questionnaire (IARC)
| Question | Answer | Why |
|---|---|---|
| Email address for the rating certificate | `hello@automonie.com` | contact |
| Category | **Utility, Productivity, Communication, or Other** (pick "Utility" or "Other"; not Reference or News) | A personal-finance tracker is a utility |
| Violence (any, cartoon, realistic, against humans or animals) | No | |
| Blood or gore | No | |
| Sexual content or nudity | No | |
| Profanity or crude humour | No | |
| Controlled substances (drugs, alcohol, tobacco): depiction, reference or promotion | No | |
| **Gambling** (real or simulated) | **No** | The app does not offer or link to gambling. Betting spending is just a category label on user transactions. |
| Fear, horror | No | |
| Discrimination, hate | No | |
| Users can interact or exchange content with each other | **No** | No feeds, chat between users, comments or sharing between accounts. "Shared expenses" is code-present but off (`FEATURE_SHARED_EXPENSES`). Confirm `/api/features` shows `sharedExpenses: false` on release day; if it is on, answer Yes to "users can interact" and add moderation notes. |
| User-generated content shown to other users | **No** | Everything a user writes (notes, labels, category names, feedback) is visible only to that user and the admin team handling support. |
| Shares the user's location with others | No | No location permission |
| Allows unrestricted web access (a built-in browser) | No | Links open in the system browser or a custom tab, not a general browser |
| Digital purchases (in-app purchases, subscriptions) | **Yes** | Plus and Student plans on Google Play Billing |
| Real-money gambling or contests | No | |
| Online purchases of real goods or services within the app | Judgement | Bill payments (airtime, electricity via VTpass) are in the code behind `/api/features` `billPay`. If on for this build, answer Yes; if off, No. |
| Does the app use generative AI features | **Judgement** | The AI assistant and AI categorisation exist in code. The assistant is off until `AI_ASSISTANT_ENABLED=true`; AI categorisation of stripped merchant names uses free providers when the rule-based path cannot decide. If Play's form asks about generative AI that users interact with, answer from `GET /api/features` on release day: Yes if `assistant: true`, otherwise declare only the merchant-name classification (no user conversation, no content generated for the user). |

Expected result: low maturity (IARC 3+ or Everyone) for most regions. Digital purchases can add a "includes in-app purchases" flag; that is a label, not a restriction.

## Target audience and content
| Question | Answer | Notes |
|---|---|---|
| Target age groups | **18 and over** only | A money tool with bank-alert reading and subscriptions. Tick 18+ only. Selecting under-13 triggers the Families policy and a stricter review, and the code does not support it. |
| Appeals to children | No | |
| Ads | **No ads** | No ad SDK in `package.json` |
| Contains ads question | No | |

## Other App content forms, answers
| Form | Answer |
|---|---|
| Privacy policy | `https://www.automonie.com/privacy` |
| App access | See `app-access.md` |
| Data safety | See `data-safety.md` |
| **Financial features** declaration | Required for finance apps. Select **Personal finance management** (tracking, budgeting). Do NOT select loans, banking, investment, crypto or trading, payment processing as a merchant, or "money transfer". If bill payments are switched on, also select "Bill payment" and read that policy first. State that the app is not a bank or lender. |
| Government app | No |
| News app | No |
| COVID-19 contact tracing or status | No |
| Health apps | No |
| Advertising ID | No. The app does not use it, so declare "No". (If Play flags a merged manifest permission from a library, check the AAB's merged manifest and add `tools:node="remove"` if needed. Not seen in the app config.) |
| SMS and call log permissions | Yes, see `sms-declaration.md`. Only for the `production` build. |
| **Sensitive permissions: notification listener** | Not a Play-restricted permission, but the reviewer may ask. Be ready to say: bank apps only, user-enabled in Android settings, explained in the app first. |
| Foreground services | No. The app declares none. |
| Exact alarm, full-screen intent, photo and video, health connect, VPN, accessibility | Not used. Confirm each shows "No" when you open the form. |
| In-app purchase and subscriptions | Set up products in Play Console, Monetise. The server expects subscription ids `plus_monthly` and `student_monthly` unless `PLAY_PRODUCT_PLUS` and `PLAY_PRODUCT_STUDENT` say otherwise (`lib/googlePlay.js`). See the checklist. |

## Things that need the owner's judgement
1. **Content rating for AI assistant and AI categorisation** (see the row above). Decide on release day from `/api/features`.
2. **Bill payments**: turn on for Play or not. Recommendation: leave off for the first Play release, so the financial declarations stay simple.
3. **Target audience under 18**: recommendation is no. Students are 18 and over in the Student plan; the code does not verify age.
4. **Rating certificate region differences**: some regions (for example Korea, Brazil) rate "digital purchases" up one band. Not a concern for a Nigeria-first launch.
