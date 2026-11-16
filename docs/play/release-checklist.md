# Play release checklist: account to production (16 Nov 2026)

Status column reflects what is true today, 16 Nov 2026. "Done" means verified in code or on the live site today. Nothing here has been uploaded, built or submitted by the session that wrote it.

## OWNER LIST: everything only you can do or decide (act on all of it in one pass)

**Decisions**
1. **SMS or no SMS in the first Play build.** Recommendation: **start the closed test on `production-nosms` now**, file the SMS declaration in parallel, and ship SMS in a later release (full trade-off in the section "SMS decision" below). Your call.
2. **Remove `RECEIVE_SMS` from the `production` profile.** `app.config.js` still requests it, but no code uses it, and the draft SMS declaration and the brief (S11) both say to remove it. Google rejects permissions an app does not use. It was your 16 Oct decision to keep it, so I did not change it. Confirm "remove", or confirm you will build the live receiver first.
3. **Personal account developer name.** On a personal account the listing shows your legal name publicly. If that is not acceptable, wait for the D-U-N-S organisation account instead (status was "requested 31 Oct, waiting"; the brief's fallback trigger is "past 2 weeks", which is today).
4. **Bill payments and the AI assistant in the Play build**: leave off for the first release (recommended). Check `GET /api/features` with a test login on release day; it must show `assistant: false`, `billPay: false`, `sharedExpenses: false`, `bankLink: false` unless you mean otherwise.
5. **Alert-text logging** (`ParseCorrection.rawText` is written on accept as well as on correction, default on). Decide whether to keep it as is and fix the SMS declaration wording, or restrict it to corrections. See `data-safety.md`, item 1 under "Things the form cannot say cleanly".

**Credentials and accounts**
6. Create the Google Play developer account (personal, USD 25, identity verification and a phone number). Do not skip the verification step; it can take days.
7. Recruit **at least 12 testers, aim for 20** (some drop out). Each needs a Google account and an Android phone, and must stay opted in for 14 continuous days. Collect their Gmail addresses (or create a Google Group and add the group as the tester list, which is easier to manage).
8. Create the reviewer account and seed it (`app-access.md`). You need the production `MONGODB_URI` and a password you generate. Check that `playreview@automonie.com` can receive the verification code, or pick an address you can read.
9. Google Play Billing set-up in Play Console: two subscription products with ids `plus_monthly` and `student_monthly` (or set `PLAY_PRODUCT_PLUS` and `PLAY_PRODUCT_STUDENT`), prices in naira, a service account with Play Console permission, and its JSON key into Render as `GOOGLE_PLAY_SERVICE_ACCOUNT`. Optional now: `PLAY_RTDN_SECRET` and a Pub/Sub topic for renewal notices. Without the service account, purchases will not unlock plans. The closed test can run with purchases off if you prefer.
10. Create the pages Play expects, or use the email instead: `/support` returns 404 today (and `/data-deletion` returns 404; the real page is `/delete-account`). The listing only needs a contact email.
11. Collect your complaints on the 1799244d preview build, which is the base for the build you will upload. The first upload should not carry known bugs, because 12 testers are about to use it for two weeks.
12. A phone with Android 8.1 or later, on which to take the 8 screenshots (`screenshots.md`) and the SMS video.
13. Confirm the owner-side Render, Cloudflare, Brevo and Paystack items in `docs/HANDOFF.md` that still list "owner" actions (Render env keys, SPF, Brevo template push). They are not Play items, but a launch without working email (sign-up code, password reset) would fail the reviewer.
14. **Fix before production, not before the closed test:** `deleteUserData` does not remove `PlayPurchase` or `AnalyticsEvent` rows (see `data-safety.md`). I did not change it; it needs a small, tested edit.

## The clock
Google requires, for personal accounts created after November 2023: a closed test with **at least 12 testers opted in, for 14 continuous days**, then an application for production access (questions about the test, the feedback you collected and what you changed). The count starts when the 12th tester is opted in and the track is live, not when the account is created. Plan: day 0 = twelve testers are in. Earliest production request = day 14. Allow a few extra days for Google's review of the access request. If testers drop below 12, the counter can reset or stall, so over-recruit.

If you wait for the organisation account instead, none of this applies and production can be requested straight away; D-U-N-S then Play verification are the cost.

## SMS decision (put here, not decided for you)
| | Ship `production` (with SMS) | Ship `production-nosms` first |
|---|---|---|
| What the app does | "Bring in your last 3 months" and "Scan my SMS" read bank alerts from the inbox on demand | Same app, no SMS permission, no SMS reader linked, every SMS scan hidden. Paste, forwarded email, shared text, statements, bank-app notifications and manual entry all still work |
| Play review | Needs the SMS Permissions Declaration, a video, a core-functionality justification. Often slow and often rejected for finance apps; Google's permitted use cases for non-default SMS apps are narrow and the form's option labels change, so check the live form before relying on the draft in `sms-declaration.md` | Standard review, no declaration, no hold |
| Risk to the 14-day clock | A rejected declaration blocks the release, and with it the testers' build. The clock cannot run | None. The clock starts as soon as the build and 12 testers are in |
| Product impact | The best first-run: one tap fills three months | Slower first-run for people who used SMS. Most Nigerian banks also send email alerts; the app's email forwarding and notification capture cover many users, but forwarding takes setup |
| What is true in code today | READ_SMS and RECEIVE_SMS requested; RECEIVE_SMS unused; no receiver exists; the declaration says on-demand only | `APP_SMS=off` blocks READ_SMS, RECEIVE_SMS, SEND_SMS even if a library asks, unlinks the reader (`react-native.config.js`), and `canScanSms` hides the UI. The profile exists in `eas.json` today |
| Later switch | Nothing needed | Ship a later release built on `production` once the declaration is approved. Adding a restricted permission later triggers the declaration review at that point, but the app is already live, so a delay or rejection costs nothing |

**Recommendation:** closed test on `production-nosms` today. In parallel, build a `production` bundle only for the declaration video (or record the video from a preview APK, which has READ_SMS, and the Play submission can reference the same behaviour), file the declaration, and add SMS in release 2. A nuance: testers then test an app that differs from the eventual one, so keep the SMS flows covered by your own internal checks. Also never put the `production` and `production-nosms` bundles on the same track at once.

## Ordered checklist
Status key: **Done** (verified today), **Not done**, **Partly** (what remains is stated).

### A. Before the account clears (can all be done now)
| # | Step | Status |
|---|---|---|
| A1 | Privacy policy live at `https://www.automonie.com/privacy` | **Done** (200). Re-read sections 4, 5 and 13 against `data-safety.md` |
| A2 | Terms live at `/terms`; security page at `/security` | **Done** (200) |
| A3 | Delete-account page live at `https://www.automonie.com/delete-account` and the backend flow behind it (request, emailed link, confirm) | **Done** (200; flow in `server.js` `/api/account-deletion/*`). Not re-tested end to end today |
| A4 | In-app delete account with password (`DELETE /api/me`) | **Done** in code. Not re-tested on a phone |
| A5 | Data safety answers written | **Done**: `data-safety.md` |
| A6 | Store listing copy written | **Done**: `store-listing.md` |
| A7 | App access instructions written | **Done**: `app-access.md`; the account itself is **Not done** |
| A8 | Content rating answers written | **Done**: `content-rating.md` |
| A9 | Screenshot and feature-graphic spec written | **Done**: `screenshots.md`; the images are **Not done** |
| A10 | SMS declaration drafted | **Partly**: `sms-declaration.md` exists; one wording issue (alert text logged on accept) and the RECEIVE_SMS decision are open |
| A11 | Gather your complaints on build 1799244d and fix the real ones | **Not done** (not collected yet) |
| A12 | Support page `/support` | **Not done** (404); optional, email is enough |
| A13 | Target API level check | **Done**: see "Checks" below. Build targets 36 |
| A14 | `app.json` `version` | **Done, no change needed**: 1.0.0 is fine for a first release. `autoIncrement` with a remote version source bumps `versionCode` on every `production` build. Check the current remote value with `eas build:version:get -p android` before the first build, in case the beta builds already pushed it high; Play only needs it to rise, never repeat |
| A15 | App icon 512 x 512, feature graphic 1024 x 500, 8 screenshots 1080 x 1920 | **Not done** |
| A16 | `production-nosms` profile exists in `eas.json` | **Done** |

### B. Account and set-up (after the account is created)
| # | Step | Status |
|---|---|---|
| B1 | Create the Play developer account, finish identity and device verification | **Not done** (owner is doing it) |
| B2 | Create the app in Play Console: name, default language, App, Free, declarations | **Not done** |
| B3 | Fill App content: Privacy policy URL, App access, Ads (none), Content rating, Target audience (18+), Data safety, Financial features (personal finance management), Government (no) | **Not done**. All answers are in this folder |
| B4 | Create Play Billing products `plus_monthly`, `student_monthly`, set prices, activate | **Not done** |
| B5 | Service account and Render env `GOOGLE_PLAY_SERVICE_ACCOUNT` (+ optional `PLAY_RTDN_SECRET`) | **Not done** (cannot be checked from here) |
| B6 | Store listing: paste from `store-listing.md`, upload graphics | **Not done** |
| B7 | Create the reviewer account, seed it, walk the steps in `app-access.md` | **Not done** |
| B8 | SMS Permissions Declaration | **Not done**. Only if the first closed-test build requests SMS. Skip while on `production-nosms`; file it with release 2 |

### C. First build (nothing built today)
| # | Step | Status |
|---|---|---|
| C1 | Clean checkout: `git status` clean in `finpilot-mobile`, nothing unpushed, then `npx tsc --noEmit` on the committed tree (standing rule: two launch crashes came from broken routes and a dirty tree) | **Not done**. The tree was clean at the start of this session (branch `main`, `1cb9fd6`) but tsc was not run |
| C2 | Check every route in `src/app/_layout.tsx` resolves to a real file (the check that would have caught both previous launch crashes) | **Not done** |
| C3 | Build the bundle: `eas build -p android --profile production-nosms` (recommended first) or `--profile production` | **Not done**. Takes about 20 to 30 minutes of EAS queue time. Do not build with unpublished WIP: stash it first |
| C4 | Download the .aab, install with `bundletool` or upload to internal testing and install from the Play link; confirm cold launch, sign-in and one transaction | **Not done** |
| C5 | Confirm the manifest from the built bundle has only the permissions in "Manifest check" below, and `targetSdkVersion` 36 (`aapt dump badging` or the Play Console bundle explorer) | **Not done** |

### D. Testing tracks
| # | Step | Status |
|---|---|---|
| D1 | Internal testing: upload the .aab, add yourself, install from Play, check purchase flow with a licence tester account | **Not done** |
| D2 | Create the **closed testing** track, upload the same .aab, add the tester list or Google Group, set a country (Nigeria), write the tester note (`store-listing.md`) | **Not done** |
| D3 | Send testers the opt-in link and a short instruction (join, install, use it every few days, send feedback from Profile). **Opt-in count must reach 12** | **Not done** |
| D4 | **Day 0**: twelfth tester opted in. Write the date here: ____ | **Not done** |
| D5 | Collect feedback, fix, ship at most a few updates to the closed track. Keep 12 opted in. Do not remove testers | **Not done** |
| D6 | Day 14 or later: in Play Console, Apply for production access, answer the questions (how you recruited, what feedback you got, what changed) | **Not done** |

### E. Production
| # | Step | Status |
|---|---|---|
| E1 | Fix before production: `deleteUserData` gap for `PlayPurchase` and `AnalyticsEvent` (owner list item 14) | **Not done** |
| E2 | If going with SMS in release 2: file the SMS declaration with the video, then upload the `production` bundle | **Not done** |
| E3 | Create a production release (staged rollout 20% first), add release notes from `store-listing.md`, submit for review | **Not done** |
| E4 | After approval: confirm the site download link and the Play badge, watch Android vitals for 24 hours | **Not done** |

## Checks
**Target API level.** Google Play requires new apps and updates to target Android 16 (API level 36) from 31 August 2026 (existing apps must stay at API 35 or higher to remain available to all devices; the official policy page is `support.google.com/googleplay/android-developer/answer/11926878`). The app is on Expo SDK 54.0.38 with React Native 0.81.5; React Native's own `gradle/libs.versions.toml` in `node_modules` sets `targetSdk = "36"` and `compileSdk = "36"`. So the managed build targets 36 and meets the requirement. **Verify from the built bundle (step C5)**, because a config plugin can override it, and check Play Console's own "Target API level" notice when you upload.

**Version.** `app.json` `version` is 1.0.0 and `eas.json` uses `appVersionSource: "remote"` with `autoIncrement: true` on the `production` profile (the `production-nosms` profile extends it and inherits both). No bump needed for a first release. The beta APK (build 1799244d) shares the same marketing version, which is harmless. Note: `runtimeVersion` policy is `fingerprint`; a Play build and a beta build have different fingerprints (different permissions), so OTA updates reach each separately: use `npm run update:play` for Play builds, not the beta script.

**Manifest check: what Play will question.** From `app.json`, `app.config.js`, the plugin list and the capture module's manifest (not read from a built bundle):
| Permission or component | Where it comes from | Play's likely reaction |
|---|---|---|
| `READ_SMS`, `RECEIVE_SMS` | `app.config.js` (production only) | Restricted. Needs the declaration. RECEIVE_SMS is unused by code: likely rejection |
| `SEND_SMS` | blocked in every build | None |
| `BIND_NOTIFICATION_LISTENER_SERVICE` service `BankNotificationListener`, exported with the system permission | capture module | Not restricted, but the reviewer may ask. Needs the in-app explanation, already present |
| `QuietShareActivity`, exported, accepts `application/pdf` and `image/*` | capture module | Normal share target. Fine |
| `INTERNET` | capture module | Fine |
| `RECORD_AUDIO` | `expo-speech-recognition` | Microphone; Play needs a reason string; present in plugin config. Fine |
| `CAMERA` | `expo-image-picker` | Reason present |
| `USE_BIOMETRIC` and `USE_FINGERPRINT` | `expo-local-authentication` | Fine |
| `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `VIBRATE`, `WAKE_LOCK` | `expo-notifications` | Fine |
| `com.android.vending.BILLING` | `expo-iap` | Fine, needed |
| `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` | blocked in `app.json` | None |
| Advertising ID (`AD_ID`) | Not requested by the app. A library could merge it in; check the merged manifest | If present, declare it or remove it with `tools:node="remove"`. Not seen |
| ML Kit OCR `com.google.mlkit.vision.DEPENDENCIES` meta-data | capture module | Downloads a Google model at install; fine |
| Foreground service | none | Fine |
| App signing | EAS manages the keystore; Play App Signing: opt in when you create the app | Confirm you can download the upload certificate, so a lost EAS login is not fatal |

**Possible defects found, not changed:** (1) `RECEIVE_SMS` unused but requested. (2) `deleteUserData` misses `PlayPurchase` and `AnalyticsEvent`. (3) The SMS declaration's claim that alert text is sent "only when the user confirms" and "to improve parsing when the user corrects a row" is narrower than the code, which logs on accept too. None blocks a closed test on `production-nosms`.

## Time estimate (work backwards from the clock)
- Day -3 to -1 (now): finish the owner list, fix known bugs on 1799244d, make screenshots.
- Day 0 minus the build: C1 to C5, about half a day.
- Day 0: twelfth tester opted in.
- Day 14: apply for production access. Allow roughly 7 days (Google's review of the production application). Realistic first production date is about 3 weeks after the 12th tester joins.
