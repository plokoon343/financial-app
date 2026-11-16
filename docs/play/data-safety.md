# Play Console: Data safety form answers (16 Nov 2026)

Derived from the code, not from the privacy policy. Sources read: `backend/server.js` (user, transaction and parse-correction schemas, `deleteUserData`, the Brevo, Paystack, Expo push and AI calls), `backend/lib/aiProviders.js`, `backend/lib/aiStrip.js`, `finpilot-mobile/app.config.js`, `app.json`, and the capture module manifest. Re-read the "Things the form cannot say cleanly" section before you submit. Where the code and Google's categories do not line up, this page says so.

Answers below are for the **`production` build (with SMS)**. Where the `production-nosms` build differs, it says so.

## How Google's form works, in four rules that decide most answers
1. "Collected" means data leaves the phone and reaches our server or anyone else. Data processed only on the phone and never sent is NOT collected.
2. "Shared" means passed to a third party. Passing data to a service provider that processes it for us (email sender, payment processor, push service, cloud host) is NOT "sharing" under Google's definition. It is still "collected" by us.
3. Everything below is encrypted in transit: the app talks only to `https://api.automonie.com` (the API base in `src/lib/api.ts`). The capture module declares only the INTERNET permission.
4. Users can request deletion: yes. In the app (Settings, delete account, needs password, `DELETE /api/me`) and from the web at `https://www.automonie.com/delete-account` (email link flow, `POST /api/account-deletion/request`). Verified today: the page returns 200. Put that URL in the "Delete account URL" field.

## Top-level answers
| Question | Answer |
|---|---|
| Does the app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes |
| Do you provide a way for users to request that their data is deleted? | Yes |
| Delete account URL | `https://www.automonie.com/delete-account` |
| Partial deletion offered (delete some data without deleting the account)? | Yes: transactions, bank accounts and single items can be deleted in the app. Optional to say. |

## Data type by data type
"Optional" means the user can use the app without providing it. "Required" means the app cannot work without it. Purposes use Google's labels: App functionality, Analytics, Developer communications, Fraud prevention security and compliance, Personalization, Account management. Advertising or marketing: none anywhere.

### Personal info
| Type | Collected | Shared | Required or optional | Purposes | Where it comes from in the code |
|---|---|---|---|---|---|
| Name | Yes | No | Required | App functionality, Account management | `User.name` at sign-up |
| Email address | Yes | No | Required | App functionality, Account management, Developer communications, Fraud prevention security and compliance | `User.email`; sign-in, password reset, verification code, two-step code |
| User IDs | Yes | No | Required | App functionality, Account management | The account id, plus the Google account id if the user signs in with Google (`User.googleId`) |
| Phone number | Yes | No | Optional | App functionality | `User.phone`, asked in the profile, not needed to use the app |
| Address, Race, Political, Religion, Sexual orientation, Other | No | | | | Not collected |
| Other personal info | Yes | No | Optional | Personalization | Birthday day and month only, never the year (`birthdayDay`, `birthdayMonth`), audience (student or corper), banks the user says they use. Declare "Other info" with these as the example. |

### Financial info
| Type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| User payment info | **No** | No | | Card details never touch our server. On the Play build, Plus and Student are bought through Google Play Billing (`src/lib/playBilling.ts`), so Google holds the payment method. On the website and the beta APK, Paystack's hosted checkout holds it. We store only Paystack's reusable authorisation token, last 4 digits and card type (`User.proSub`). Last 4 and card type are on the borderline: Google's "User payment info" lists "credit card number" and "payment info"; the safe reading is that last 4 plus the type are not enough to charge a card, but if you want zero doubt, tick "User payment info" collected, not shared, optional, for "App functionality". The Play build does not store them for Play purchases, only the beta and web flow does. |
| Purchase history | Yes | No | Optional | Plan purchases are recorded: `ProPayment` (reference, amount, months) and `PlayPurchase` (Google subscription token, product, expiry). Purpose: App functionality, Account management. |
| Credit score | No | | | |
| **Other financial info** | **Yes** | **No** | **Optional per source, but it is the core of the app** | App functionality, Personalization, Analytics (only inside the user's own insights; there is no third-party analytics). This is the big one: every transaction (amount, date, description, category, bank, last 3 or 4 digits of the account, balance when an alert states it), budgets, goals, bills, subscriptions, monthly income, people the user sends money to (the People ledger, derived from transfer counterparties, not from the phone's contacts). |

### Messages
| Type | Collected | Shared | Required or optional | Purposes | Notes |
|---|---|---|---|---|---|
| **SMS or MMS** | **Yes on the `production` build. No on `production-nosms`.** | No | Optional | App functionality | Only bank and wallet alerts from a known sender list are parsed on the phone (`src/lib/smsSenders.ts`); everything else is dropped on the phone. For an alert the user confirms, the server receives the parsed fields and the alert text. The alert text is kept on the transaction (`mergedFrom.raw`) and, unless the user opts out of "Help improve Automonie", in a correction log (`ParseCorrection.rawText`). See the section "Things the form cannot say cleanly". |
| **Emails** | Yes | No | Optional | App functionality | Bank alert emails the user forwards to their personal address `<token>@automonie.app` are parsed on the server. Only the parsed result and the alert text on the transaction are kept; `User.inboundBankMails` and `inboundOtherMails` are counts only. A non-bank email is dropped. |
| Other in-app messages | Yes | No | Optional | App functionality | Support tickets and the in-app feedback (`SupportTicket`, `Feedback`), and saved AI-assistant chat history when the assistant is on (`AiChat`, last 60 messages). Name the assistant as live only if it is live on release day (see the assistant note below). |

Notification text from other apps (bank-app notifications): the app's notification listener reads notifications only from bank apps the user approves, after the user grants Notification access in Android settings. Google's form has no "notifications" type; declare the bank-alert content under **Other financial info** (collected) and mention it in the permission declaration where Play asks about the listener. Non-bank apps are skipped on the phone (`NON_BANK` list in `src/lib/autoCapture.ts`).

### Photos and videos, Audio, Files and docs
| Type | Collected | Shared | Notes |
|---|---|---|---|
| Photos and videos | **No (with a caveat)** | | Receipt photos are read on the phone with on-device text recognition (ML Kit, the Google ML Kit OCR model downloaded at install). The in-app text says the photo stays on the phone. Caveat: a **shared receipt image** (share sheet, quiet share) can be transcribed on the server by the personal AI path when `GEMINI_PAID_API_KEY` is set (`aiProviders.js`, header comment). Today that key is off by owner decision, so images are not sent. If you ever switch it on, change this answer to Photos: collected, not shared, optional, App functionality. |
| Voice or sound recordings | **No** | | Voice logging uses Android's speech recognition (`expo-speech-recognition`, service `com.google.android.googlequicksearchbox`). We receive only the typed-out transcript the user confirms as a transaction. We never receive or store audio. Whether Android's recogniser processes audio on the device or on Google's servers is up to Google and the phone, not us, and is not "our app collecting" it. Say so if Play asks. |
| Music files, Other audio | No | | |
| Files and docs | Yes | No | Optional | Statements (PDF, CSV, Excel, Word) and shared PDF receipts are uploaded for parsing. Per policy section 13 and the code (`fs.unlinkSync` after parse), the file is deleted after processing; the transactions extracted from it stay. Purpose: App functionality. |

### Health and fitness, Location, Contacts, Calendar, Web browsing
No. The app requests no location permission, no contacts permission (the People ledger is built from transfer counterparties in alerts, never from the address book), and no calendar permission.

### App activity
| Type | Collected | Shared | Purposes |
|---|---|---|---|
| App interactions | Yes | No | Analytics, App functionality. First-party only: `AnalyticsEvent`, `ProductEvent` and `ActivityDay` rows tied to the user id (help-centre use, feature use, daily check-in for the streak). No third-party analytics SDK is in `package.json`. |
| In-app search history | No | | |
| Installed apps | No | | The notification listener checks the package name of an incoming notification to decide if it is a bank app, on the phone. The list of installed apps is not read or sent. |
| Other user-generated content | Yes | No | Category names the user creates, notes on transactions, labels on people, saved receipts' notes. Purpose: App functionality. |
| Other actions | Yes | No | The user's corrections to categories (the global consensus categoriser learns from all users' corrections without personal data attached) and parse corrections. Purpose: App functionality. |

### App info and performance
| Type | Collected | Notes |
|---|---|---|
| Crash logs | **No** | No crash SDK in the app (no Sentry, Firebase, or similar in `package.json`). If a crash screen is shown, nothing is sent automatically. Confirm before submitting: Play's own pre-launch reports are Google's, not ours. |
| Diagnostics | No | |
| Other app performance data | No | |

### Device or other IDs
| Type | Collected | Shared | Required or optional | Purposes |
|---|---|---|---|---|
| Device or other IDs | Yes | No | Optional (only if the user allows notifications) | App functionality. This is the Expo push token (`User.pushTokens`), which goes to Expo's push service to deliver notifications. Also stored: the app version and client name (`lastAppVersion`, `lastClient`) from request headers. Not collected: advertising ID, Android ID, IMEI. |

## Who data goes to (declare under "shared" only if you disagree with the service-provider reading)
Google's definition excludes data transferred to a service provider that processes it on our behalf. Every row below fits that, so **Shared = No** for all data types. Listed so the owner can check each is true.

| Third party | What it receives | When | Notes |
|---|---|---|---|
| **Brevo** (email, `api.brevo.com`) | The recipient's email address and first name, the message content (sign-up code, password reset, announcements the user allowed, newsletter to the waitlist), and the birthday as a day and month contact attribute (`syncBirthdayToBrevo`). | Whenever the app sends an email | Processor. Not given transactions, amounts or alert text. |
| **Paystack** (`api.paystack.co`) | Email, amount, reference, then a reusable authorisation token comes back | Only on web and the beta APK. The Play build uses Google Play Billing instead. | Processor and merchant of record for card payments. |
| **Google Play Billing and Play Developer API** | Purchase token, product id | Play build purchases | Server verifies each purchase with Google before the plan changes (`lib/googlePlay.js`). |
| **Expo push service** (`exp.host`) | The device's push token and the notification text (which can include an amount, controlled by the user's "show amounts" switch and Hide amounts) | Whenever a push goes out | Processor. |
| **AI providers, stripped path** (Gemini free tier, Grok, Cloudflare Workers AI, OpenRouter free, NVIDIA NIM) | Merchant name only, with every name, number, phone, email and amount removed first (`lib/aiStrip.js`). A person-to-person transfer is never sent (`merchantForAi` returns null). A last check (`isStripped`) refuses anything still containing a digit, an @ or a naira sign. Used for merchant categorisation and a receipt's shop and category. | Only when the rule-based categoriser cannot decide | Contains no personal data once stripped, so it is not "personal data shared". Free tiers may log their inputs, which is why only stripped text goes. |
| **AI provider, personal path** (paid Gemini, `GEMINI_PAID_API_KEY`) | An unknown bank alert's text, a statement's text, a shared receipt image, transfer purposes, and "ask about my money" snapshots | Only if the owner sets the paid key. **Today it is off by owner decision** ("free AIs only"), so unknown alerts are handled by rules only. | If switched on, update the Data safety form and the privacy page: this is data sent to a processor. Account numbers are redacted before purpose inference (see `llmPurpose.js`). |
| **AI assistant chat** | Compact snapshot of the user's money (totals, recent transactions) in the prompt. On a free tier the user's name is dropped and descriptions are stripped. | Only if `AI_ASSISTANT_ENABLED=true` AND a provider key is set | Check `GET /api/features` on release day; if `assistant` is false, the chat is not live and this row does not apply. |
| **Sanity** | Nothing from the app. Sanity is the content system for the marketing site only. | | Not part of the Data safety form. |
| **Mono** (bank linking) | Nothing today. The code is present and inert until `MONO_SECRET_KEY` and `MONO_PUBLIC_KEY` are set; the app hides it (`/api/features` `bankLink`). | | If you ever switch it on, "Other financial info" gains a source and Mono must be declared. Do not promise "no bank connection" in the form's free text. |
| **Cloudflare** | Inbound forwarded mail transits Cloudflare Email Routing on `automonie.app`; the Worker forwards it to the API. | | Processor for email delivery. |
| **MongoDB host and Render** | All stored data | Always | Hosting provider. Processor. |

## What the backend stores for a user (all deleted with the account unless noted)
Account and profile (name, email, password hash, optional phone, income, goal, notification and privacy switches, birthday day and month, audience), transactions and everything attached (links, merged observations with source text, categories, accounts, people, budgets, goals, bills, subscriptions), learned categories, parse corrections, support tickets, feedback, notifications, consent and security-event logs, assistant chat, activity and product events. The email-forwarding address token and the capture key hash (SHA-256 only, never the key) live on the user record.

**Kept after deletion on purpose:** `ProPayment` rows (payment records for accounting). The privacy policy says payment records are kept for legal and accounting reasons; Play accepts this if it is disclosed, and the policy at `https://www.automonie.com/privacy` should state it. Verify the wording.

## Things the form cannot say cleanly (owner decisions and defects found)
1. **Alert text is kept, and the correction log is on by default.** `ParseCorrection.rawText` stores the exact source string for every parse the user accepts or corrects, unless the user turned on opt-out (`trainingOptOut` defaults to false, so collection is the default). The SMS declaration says the alert text is sent "only when the user confirms" and "used to improve parsing when the user corrects a row". The code logs on accept too. Before submission either (a) make the SMS declaration wording match the code, or (b) change the code to log only corrections. This page assumes (a). Decide.
2. **Alert text is kept on the transaction itself** (`mergedFrom.raw`, `heldAs.raw`) so the user can see why a row was merged and undo it. It is part of "SMS or MMS" and "Other financial info". The privacy policy must say the original alert text is kept with the transaction.
3. **Defect, not fixed: two collections are not wiped on account deletion.** `deleteUserData` (`server.js` around line 3215) does not delete `PlayPurchase` rows (Google subscription tokens, keyed by user id) or `AnalyticsEvent` rows (keyed by user id). Everything else carries the user id and is cleared. `PlayPurchase` is arguably a payment record like `ProPayment` and may stay, but then it must be listed with them in the policy. `AnalyticsEvent` has no reason to stay. Neither blocks a closed test. **Fix before production**, because Play checks that "delete my data" does what the form says.
4. **Mismatch in the sign-in text.** Google sign-in is built, keys-dependent (`@react-native-google-signin`). If it is on for the Play build, "User IDs" includes the Google account id and "Email address" comes from Google too. Correct as written.
5. **Phone number is optional and not needed**; the form says optional. The profile screen should not nag.
6. **"Personal info: Name" for people the user pays.** Counterparty names inside transactions are other people's names, kept inside "Other financial info". Google's form has no field for third-party data; the policy covers it. Nothing more to declare.
7. **Notification listener is a sensitive capability, not a restricted permission.** No separate declaration form, but Play's reviewer may ask. Be ready to explain: reads only approved bank apps, on a screen the user turns on, and the in-app copy says so.
8. **Voice**: do not tick audio collected. State in the review notes that audio never reaches our servers.
9. **No ads, no data sale, no data use for advertising.** Tick that data is not sold and not used for advertising (these are statements in the privacy policy, matching the code).

## Privacy policy and URLs to enter
- Privacy policy: `https://www.automonie.com/privacy` (200 today). The policy version in `backend/lib/compliance.js` is `2026-10-16`. Reread sections 4, 5 (sharing), 13 (retention) against this page before submitting.
- Delete account: `https://www.automonie.com/delete-account` (200 today).
