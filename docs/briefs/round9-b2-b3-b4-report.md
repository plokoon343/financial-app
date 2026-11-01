# Round 9, B2 + B3 + B4: answer in context, human only when needed, learn and shrink (1 Nov 2026, Sonnet)

Web commit: `d86bc6c`. Backend tests: 48/48 lib test files pass, including a new
`backend/lib/helpContent.test.js` (13 checks). `npm --prefix frontend run build`
clean. No mobile changes this session (web + backend only; see "What's left").

Note: this session shared the working tree with other round9 sessions working
on Part A and B1+B5 at the same time. One of their commits (`37a7459`, "Round 9
part A: finished") ended up carrying this session's in-progress edits to
`backend/server.js` and `backend/data/help.json` along with its own, because
both sessions were editing the same checkout. The content itself is intact and
correct (verified below) - only the commit message it landed under is not this
session's. Everything else here is this session's own commit.

## B2: Answer in context

**Help Centre categories, search, voting.** `backend/data/help.json`'s 17
articles now each carry a `category` field (one of the 7 from the brief:
Getting started, Automatic tracking, Statements, Budgets and goals, Plus and
billing, Privacy and security, Troubleshooting). New `backend/lib/helpContent.js`
is the one place that loads them, searches them, and decides if a question
reads as "how to". `GET /api/help` now returns `{ categories, articles }`
(plus the old flat `sections` for back-compat); `GET /api/help/search?q=`
does a small keyword search with a Nigerian-phrasing synonym map ("alert no
show", "money no dey enter" both resolve to the same tokens as "email not
arriving"); `POST /api/help/:slug/vote` records "Did this help? Yes/No".
`frontend/src/components/Help.jsx` was rebuilt around this: articles grouped
by category, a search box, and a vote footer on each open article.

**One source, with Sanity as an upgrade path, not a rebuild.** The brief asks
for Sanity as the single source for the app and automonie.com/help, since
automonie-web already runs a Sanity project for its guides/articles. Building
that out fully - a new `helpArticle` schema type in automonie-web's Studio,
and an owner re-entering all 17 articles there - is a content task, not a
code task, and risks leaving the Help Centre broken mid-migration if done
half-way. So `helpContent.js` reads from Sanity (via a plain HTTPS query, no
new dependency) **when** `SANITY_PROJECT_ID` / `SANITY_DATASET` /
`SANITY_HELP_READ_TOKEN` are set, and falls back to `backend/data/help.json`
otherwise - the same "keys-pending" pattern as Mono or Google sign-in
elsewhere in this project. Today, with no keys set, it's on the JSON file;
nothing changes in behaviour. If the owner later wants true Sanity authoring,
the hookup is already live - add the schema type in automonie-web, write the
articles, set the three env vars on Render.

**Ask answers how-to questions from Help only.** In `/api/ai/chat`, a message
that reads as "how do I...", "what is...", "how to...", etc. is checked
against the Help articles (`helpContent.bestMatch`) *before* the LLM is
called. A confident match returns the article's summary + first few steps and
a `/help#slug` link, with no model call at all (free, deterministic, and
never says anything an owner hasn't already written in Help). No confident
match falls through to the normal assistant unchanged. The system prompt also
gained one line: if the user describes an account-specific problem none of
the assistant's tools can fix (an email that never arrived, a statement that
won't import), it says so and points at Support rather than guessing.

**"?" info sheets.** New `frontend/src/components/InfoSheet.jsx`: a small "?"
button with 3-line explanations + a "Learn more" link into Help. Wired into
Safe to spend (`Cashflow.jsx`), Budgets (`Budget.jsx`), Automatic tracking
(`AutoCapture.jsx`), and Plus (`ProPaywall.jsx`). **Not wired:** Categories -
there's no single "Categories" screen in the web app (categories are picked
inline on transactions), so the content exists in `INFO_TOPICS.categories`
but has nowhere obvious to attach yet. Mobile has none of this - it would
need the same component built in React Native.

## B3: Human only when needed

`SupportTicket` now has `topic` (a short set the form offers: email
forwarding, statements, budgets/goals, billing, other), `source` (`form` /
`email` / `whatsapp`), and a `diagnostics` sub-document (`consent`,
`appVersion`, `platform`, `phoneModel`, `osVersion`, `setupCheck`,
`recentLogs`) that is only ever populated when the user ticks the new consent
checkbox on the Support form - unticked, only `{ consent: false }` is stored.
Web diagnostics today: `platform: 'web'`, `osVersion: navigator.platform`, and
the last 20 `console.error`/`console.warn` lines from the session (new
`frontend/src/lib/logBuffer.js`, a tiny ring buffer). `appVersion` and
`phoneModel` are left blank on web (not meaningful there); `setupCheck` is
`null` until B1's "Check my setup" screen exists to feed it.

New `POST /api/admin/tickets` lets an admin log a ticket that actually came in
by email or WhatsApp into the same `SupportTicket` collection with
`source: 'email'|'whatsapp'`, tagged by topic - so `GET /api/admin/tickets`
is genuinely one inbox across all three channels, as the brief asks, without
building real email/WhatsApp ingestion (which this project doesn't have).

New `GET /api/support/info` returns the response-time line
(`SUPPORT_RESPONSE_HOURS`, `SUPPORT_HOURS_TEXT` - both env, default 24h /
"9am to 9pm, every day") and, once `WHATSAPP_SUPPORT_NUMBER` is set, a
`wa.me` link - `Support.jsx` shows both and only shows the WhatsApp row when
it's configured. **What's not built:** WhatsApp's own auto-reply (top 3
articles + hours) is a setting inside WhatsApp Business's app, not this
code - the number and hours text above are what an owner would paste into
that setting once they have the business number.

## B4: Learn and shrink

New `AnalyticsEvent` model, logged only for the brief's fixed 5 events
(`help_opened`, `help_article_viewed`, `help_article_helpful`,
`help_search_no_result`, `support_contacted`) - a hard allow-list, so
`POST /api/analytics/track` can't become a free-form log sink.
`GET /api/admin/analytics/help-report?days=7` (superadmin) computes, over the
window: Help opens (and which screen's "?" opened them), article views,
no-result search queries, which articles got more "No" than "Yes", top ticket
topics, and tickets by channel.

This is computed on request, not pushed on a schedule - nothing else in this
project runs a background cron server (the same gap noted for subscription
reminders elsewhere), so a weekly *email* of this report would need the same
external-cron fix as those. The report itself is ready; an admin can open it
any time, or an external cron could `GET` it and email the result once a
trigger exists.

## What's left

- automonie.com/help (the public, logged-out site) - this session only
  touched the authenticated app (`frontend/`) and the backend. The content is
  reachable (`GET /api/help` is now auth-only to track `help_opened` by user;
  a public, unauthenticated mirror would be a small addition if the
  automonie-web site is to read it directly, or it can query Sanity itself
  once that's populated).
- Mobile (`finpilot-mobile`) has none of B2/B3/B4 yet - `help.tsx`/`support.tsx`
  still show the old flat list and plain ticket form. Needs a native build to
  ship either way.
- Categories screen has no "?" (see B2 above).
- WhatsApp auto-reply text and the business number are on the owner.
- A real weekly *push* of the B4 report needs the external-cron fix noted
  above.
