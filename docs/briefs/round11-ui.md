# Round 11: UI direction, and what the owner found on build 1799244d (16 Nov 2026)

Source: the owner's phone screenshots and notes, 16 Nov 2026, on preview build `1799244d` (Round 10). This file is the record; nothing here is fixed yet unless it says so.

## What the owner said, in their own terms

1. **The birthday UI on Profile is not what was asked for.** Month chips plus a day box, and it should not look like that.
2. **Profile and settings are poorly done, and no UI improvement is visible from one build to the next.**
3. **Shareables, on web, mobile and the site, should never be plain text.** They are bland and have no personality.
4. **The loading screen must follow the theme in use.** A dark teal splash appeared while the app was on the light theme.
5. **Categorisation is still bad**, and asking users to remember old transactions is not sustainable. Accepted as something to improve over time, not the current priority.
6. **The priority now is the UI: pick a direction and run with it.** Study PiggyVest and Chowdeck. The owner will supply mockups.

## Verified in code, 16 Nov 2026

- **Splash, item 4: confirmed, and the cause is config.** `app.json` sets `userInterfaceStyle: "dark"` and the `expo-splash-screen` plugin has a single hardcoded `backgroundColor: "#052825"` with no light variant. The plugin supports a `dark` block, so the fix is a light default plus a dark override, and `userInterfaceStyle` should be `automatic` if the app is meant to follow the system. Needs a build: splash config is native.
- **Birthday, item 1:** the UI lives in `src/app/account.tsx`, not `profile.tsx`. Round 10 C7 asked for the birthday prompt to be removed from Profile and replaced by one Home card with "Don't ask again"; the Profile editor is still there. Worth re-reading C7 before touching it, since the owner's complaint is about how it looks, not only that it exists.
- **Shareables, item 3:** today's share is a text string ("My Weekly recap on Automonie, automonie.com"). The backlog already carries the right answer: shareable image cards at 9:16 (memory note "Quiz + Wrapped ideas"). This is a build, not a tweak.

## Bugs visible in the same screenshots that the owner did not name

These are worse than the cosmetic complaints and should not go into a 14-day closed test.

1. **Banks are being offered as people.** "Who is ACCESS?", "Who is UBA?", "Who is ZBN?" with Family, Friend, Work. ACCESS, UBA and Zenith are banks. The person detection is treating a bank name as a counterparty.
2. **A shop is being offered as a person.** "Who is FROZO FOOD SUPER STORE?" with the same three options. The business heuristic is not catching it.
3. **"Family" looks pre-selected on every one of those cards.** The first option is drawn as a filled teal button, which reads as the chosen answer. If a user taps through quickly, everything becomes Family. Either restyle the primary so it does not read as selected, or stop defaulting it on a question with no best guess.
4. **A retired category is still offered.** One card answers with "Transfer (Best guess)". Round 10 A3 retired `Transfer`, and `actionCards.js` builds answers straight from `it.suggestions`, so whatever produces suggestions is still emitting it.
5. **A ₦0.75 question.** The Home own-transfer card asks about ₦0.75 moving to ₦0.09, with the note that the ₦0.66 difference is a bank charge. Own-move cards are priority 2 and therefore exempt from the ₦2,000 ask floor, so sub-naira questions reach the queue. They should not.
6. **A name is duplicated in a card title:** "3 payments to Chidumebi Vincent Onukogu Chidumebi Vincent Onukogu". Also, those are payments to the account holder's own name, which the self-transfer rule should have caught.
7. **A refund card offers two options that are visually identical**, both truncated to "Via Gtworld Onukogu, Chidumebi Vincent Onukogu Uzodimma Rober...". Nobody can answer that question.
8. **Raw narration used as a title:** "POS PUR 11 PLC FESTAC 23RD Lagos LANG 38", which the standing rules forbid.

## The sequencing problem, stated plainly

The 14-day closed test cannot start until a build is uploaded, and the UI direction the owner wants is weeks of work that depends on mockups that do not exist yet. Those two cannot both go first.

Recommended split:
- **Before the first closed-test upload:** items 1 to 8 above, plus the splash theme (4). They are correctness and trust problems, and 12 testers will hit them in the first hour.
- **During the 14 days:** the UI direction. New builds can be pushed to a closed track at any time without restarting the clock, so testers can receive the redesign as it lands.
- **Not before launch:** the categorisation rebuild (item 5 in the owner's list). It is accepted as a slow improvement.

## UI direction: what is needed before anyone writes code

The owner will bring mockups. To make them implementable rather than another round of drift, the direction needs, in one document: the type scale, the colour tokens and how they change in light, dark and teal, the card and list shapes, the motion rules, the icon set, and what the five tabs look like at rest. PiggyVest and Chowdeck are the references the owner named. Without that, each build changes a few screens and the whole still looks unrelated, which is exactly the complaint in item 2.
