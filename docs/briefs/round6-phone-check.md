# Round 6 phone check (build 58621ec2, 8 November 2026)

First device check of the whole round. Roughly 20 commits of work land at once, and every progress note in `round6-trust-review-polish.md` carries the same caveat: nothing was run against a phone or a live database.

Install fresh: delete the old app first, then install. The runtime fingerprint moved for the native `87e0247` change, and installing over the top risks the embedded-bundle mismatch that caused earlier crashes.

Organised by screen, so the app is walked once. Tick what passes, and for anything that fails write down what you did and what you saw, not just "broken".

---

## 0. Launch (do this first)

- [ ] App opens. No "Something went wrong" screen, no blank dark-teal frame.
- [ ] Force-close and reopen twice. Both previous crashes were deterministic on cold start, so a single good launch is not proof.
- [ ] Splash is **mint on black**, not white. 6a found the black background was being overridden by the theme colour, so a white splash means that fix did not take.

If it crashes: the error screen shows the first 8 stack lines. Photograph them. That is what made the last diagnosis possible.

---

## 1. Home

- [ ] **No safe-to-spend figure if income is not set** (B4). Instead: "Net this [Month]" plus a prompt to add monthly income. The old bug showed a safe-to-spend hero while Plan said income was missing.
- [ ] **Cash to log names its period** (B2) and the figure matches Money's. The old bug was Home showing an all-time total (₦190.9K) against Money's monthly one (₦1,836).
- [ ] **Transaction count and "updated" match Money** (B3). Home previously said "Updated 1 day ago, 4 transactions" while Money said "6 transactions, Updated just now".
- [ ] **Daily recap is a card in the Automonie read, not a modal over Home.**
- [ ] No "Transfer" as a spending category anywhere in the insights.
- [ ] If "Other" is over 15% of the month, a read card says so, at most once a month.

## 2. Money list

The four names that were wrong (5.4). Each should now read clean:

- [ ] `VAT` reads "VAT", not "Vat"
- [ ] A stamp duty row reads "Stamp duty", not "Stamp Duty Charge For Trxn Ref..."
- [ ] A POS purchase reads the shop name only, not "POS PUR 11 PLC FESTAC 23RD..."
- [ ] `-Transfer Fr John Okafor` reads the person's name. This one had a real bug: "Fr" was not recognised as an abbreviation for "from".
- [ ] Rows with only digits and codes read "Card payment", never the digits.
- [ ] **Totals show full amounts** ("₦15,200"), not compact ("₦15.2K"). Short forms belong on charts only.
- [ ] Footer count equals the rows actually on screen. Failed transactions should not be listed.
- [ ] Apple charges show as **Spending**, not "Cash out, not counted as spending" (B1). Note: existing rows stay wrong until the backfill runs, so judge this on a *new* Apple charge, or accept it as expected-wrong for now.
- [ ] Swipe a row sideways: quick actions appear, and **delete is never one of them**.
- [ ] Scroll fast with a slightly diagonal thumb. No row should open by accident.
- [ ] Scroll to the very end. The last row is fully tappable and not hidden behind the + button.

## 3. Action Center

- [ ] **One card at a time**, not a long page of sections. The old screen was a scrolling list with big buttons.
- [ ] Heading count equals the number of items it is about (B5). "To sort 1" over "2 transactions need a category" was the bug.
- [ ] The likely answer is highlighted first on each card.
- [ ] **OWealth interest alerts do not appear raw** under "Alerts to check". Interest is a known pattern: Income, grouped monthly.
- [ ] Answer a card. It saves, offers "Undo", and the next card rises.
- [ ] Answer the same way twice for one sender. A rule should be created automatically, with a toast saying so.
- [ ] Clear the queue. "All sorted" state appears.
- [ ] Skip a card. It drops down the queue and is not punished.
- [ ] **If a "not on your statement" or a refund-match card appears, answer it and check something actually happens.** These two did nothing but write a log row until `df02270`, so they are the least-exercised path in the build.

## 4. Self-transfer (the case that started this)

This is the one that made you think notification capture was broken.

- [ ] Send money from one of your accounts to another (GTBank to OPay was the original).
- [ ] Both sides arrive, then **they link into one row reading "Moved to OPay"**, marked as a move and left out of spending totals.
- [ ] It does **not** appear as two separate transactions, and it does not ask you anything.
- [ ] Transaction detail shows where each side came from, and offers "Not the same" to split it.
- [ ] Any transfer fee or stamp duty folds under the transfer ("₦15,060 including ₦60 charges") rather than standing as its own row.

## 5. Plan

- [ ] No safe-to-spend hero while income is unset (this was the B4 bug's real home: the Cashflow screen, which Plan opens).
- [ ] Coming up shows subscriptions with a count and monthly total.
- [ ] Known services (Netflix, Spotify) are recognised. Unknown ones are not given a logo on a guess.
- [ ] Owed-to-me list appears if you have lent money or split a bill.

## 6. Themes

Switch between **Light, Dark and Teal** and walk Home, Money and the Action Center in each.

- [ ] Text is readable in all three. Light was the failing one: primary, income, warning and faint text were all too pale.
- [ ] Button labels on mint are near-black, not white (white was 1.92:1).
- [ ] Card borders are visible in Light. Surface against background is only 1.08, so the border is doing the work.
- [ ] Hero card text is readable, with the brand teal gradient intact and a darkening only behind the text.
- [ ] Nothing is signalled by colour alone. Over-budget, needs-a-category and security states each carry an icon and a word.
- [ ] Status bar icons are the right colour on every screen, including sheets.

## 7. The + sheet

- [ ] **All icon tiles are one tint**, not the old purple/blue/orange/yellow mix.
- [ ] Sheet opens above the nav bar and nothing is cut off.
- [ ] Paste a bank alert: a preview of the parsed transaction appears before saving.
- [ ] Log a cash spend in 3 taps or fewer.

## 8. Stress the layout

- [ ] Set system font size to maximum. Walk Home, Money, Plan. Nothing overlaps, no digits are cut off, buttons wrap rather than truncate.
- [ ] Try both gesture navigation and 3-button navigation.
- [ ] Swipe in from the left and right screen edges on several screens. The system back gesture must never trigger a row action.

## 9. Support (Block 9)

- [ ] The missing-payment finder is reachable and asks which bank and roughly when.
- [ ] "Check my setup" reports the real state of your sources.
- [ ] Automatic tracking shows "N waiting to send" when the phone is holding alerts, and the "Sync data" button reports honestly ("Checked. Nothing queued." rather than claiming a sync).

---

## Not in this build, so do not test for it

- The Block 1 reclassify backfill has never run against production. Existing Apple charges stay filed as cash until `POST /api/admin/reclassify-kinds` is run. Only new charges prove B1.
- Blocks 7 (onboarding), 8 (motion and haptics) and 11 (brand moments) are not built. Expect the old first-run experience, no signature animation, and no mascot.
- Category rename, hide, merge and delete have working backend routes and **no client calling them**. Same for merchant renaming. So they are not reachable from the app yet.
- Real merchant logos were never fetched. The catalogue holds slugs, not images.

## Result

Write findings into the Progress section of `round6-trust-review-polish.md` under a new heading. Blocks 7, 8 and 11 are gated on this check, because onboarding in particular should not be built as a tour of screens nobody has seen working.
