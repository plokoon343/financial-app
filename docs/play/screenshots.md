# Play Console: screenshots and graphics spec (16 Nov 2026)

**No screenshots were captured by the session that wrote this.** The app needs a phone or emulator with the seeded reviewer account, and a previous attempt to run the app through Metro stalled, so by the brief's rule this is a spec only. Take them on the owner's phone (or an emulator) from the preview or closed-test build, signed in as the seeded reviewer account (`app-access.md`), so all numbers are the fictional sample data and no real data appears.

## Rules from Play
- Phone screenshots: 2 to 8 required; use 8. PNG or JPEG, 16:9 or 9:16, each side 320 to 3840 px. Use **1080 x 1920** (9:16).
- Feature graphic: **1024 x 500**, PNG or JPEG, no alpha.
- App icon: 512 x 512, 32-bit PNG.
- No misleading UI: screenshots must show the real app. Captions added in a frame are fine, but the UI inside must be unedited and match the build you ship.
- No emoji and no em dashes in captions. No "best", ranking or price claims. Do not show a real person's name, bank balance or account number.
- Order matters: the first 2 or 3 show in search results.

## How to capture
1. Install the build, sign in as `playreview@automonie.com`, re-run the seed so the dates end today (see `app-access.md`).
2. Android Settings, turn on Do Not Disturb, set the clock to a tidy time (for example 9:41), battery full, no notifications in the shade.
3. Capture with the phone's screenshot. On a phone that is not 1080 x 1920 (most are taller, 1080 x 2400), crop to 9:16 with the status bar included, or capture from an emulator set to 1080 x 1920.
4. Optional framing: dark teal background `#052825`, caption at the top in white Poppins, 64 px. Keep captions to 6 words or fewer.
5. Use the dark theme (the app is `userInterfaceStyle: dark`).
6. Hide-amounts switch off, so numbers show. Sample data uses fictional names only.

## The 8 phone screenshots
| # | Screen (route) | State to show | Caption |
|---|---|---|---|
| 1 | Home (`(tabs)/index`) | The month's spending total, safe to spend, and the Action Center card with 3 alerts waiting. Scrolled to the top | Your money, in one place |
| 2 | Money (`(tabs)/money`) | The transactions list with the This month chip selected, categories visible, a mix of salary, food, transport, transfers. A Guessed dot on one row | Every transaction, sorted for you |
| 3 | Paste or import alerts (`sms-import`) | A fictional bank alert pasted in, the parsed result below it with amount, direction, merchant and the edit control, before Save. On the Play build, do not show the SMS scan card unless the build has SMS | Alerts become entries you can check |
| 4 | Automatic tracking (`automatic-tracking`) | The list of sources: bank alerts, bank app notifications, forwarded email, share, statements. Shows what is on and off | Pick how alerts come in |
| 5 | Safe to spend (`cashflow`) | The safe-to-spend figure and the projection chart for the month, with sample bills in the list | Know what is safe to spend |
| 6 | Budgets and goals (`(tabs)/grow`, then Budgets) | Food 40,000 and Transport 25,000 budgets with progress bars, the Laptop fund goal at 35% | Budgets and goals that stay in view |
| 7 | Bills and subscriptions (`subscriptions` or `bills`) | The two sample subscriptions and bills with next dates; the cancel steps opened on one | See what renews, and when |
| 8 | Privacy and data (`settings`, then privacy section) | App lock, Hide amounts, Download my data, Delete account visible. If the screen does not group them, show the App lock screen and the Download my data row | Your data, your control |

Notes:
- Screen 3 is the one most likely to be questioned: it shows alert reading. Use fictional text only, for example `DR Alert: NGN2,500.00 POS PURCHASE SHOPRITE LEKKI. Bal: NGN45,320.50.` Do not show a real bank's alert from the owner's phone.
- If the build has no SMS (`production-nosms`), screenshot 3 should show the Paste flow, which exists in both builds.
- Do not show Plus pricing or a purchase sheet (prices are managed in Play Console).
- Do not show the AI assistant, bill payment or bank linking unless `/api/features` has them on and they have been tested.
- Do not show the Student plan screen.

## Feature graphic (1024 x 500)
- Background: the approved teal vermicular texture (`assets` texture in the app repos) over `#083d37`, with the brand mark and the lowercase "automonie" wordmark, left third.
- Right side: a cropped phone frame of screenshot 1 (Home) at a slight angle, or three small stat cards (Spent, Safe to spend, Saved). Fictional numbers.
- One line of text, 48 to 56 px, max 6 words: "Every naira, sorted." No emoji, no em dash, no price.
- Keep important content inside the central 924 x 400 region. Play crops the edges on some devices.
- Export as a 24-bit PNG without transparency.

## Icon
`finpilot-mobile/assets/images/icon.png`: check it is 512 x 512 and has no transparency issues. If it is larger, export a 512 version; the adaptive icon in the build is already set up (`android-icon-foreground.png` and background).

## Tablet, Chromebook, Wear, TV
Not needed: `supportsTablet` is false on iOS and the app is phone-first. Play lets you skip tablet screenshots, though tablet users see a letterboxed app. Optional later.
