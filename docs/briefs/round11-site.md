# Round 11 Part K: website quick fixes (17 Nov 2026)

Repo: automonie-web, branch astro-site, one commit, not pushed (the owner pushes; a push deploys).

## 1. Phone mockups: inventory, left as they are

Every phone mockup on the site is a real screenshot of the OLD web app (PWA), taken with demo data, not the redesigned mobile app. None shows a screen that is gone from the web app, but none shows the Round 11 design either. The redesign has never been built or run and has no screenshots, so I did not draw or fake new screens. Replace them once Part A to H screenshots exist from a real Android build.

All in `src/pages/index.astro` (frame is `.dvc` > `.scrn`, CSS in `public/assets/site.css` lines 88 to 97):

| Line | File | Shows | Status |
|---|---|---|---|
| 62-64 | mobile-home.webp (hero) | Old web Home: "Financial Dashboard", Welcome back Tolu Adeyemi | Old Home, replace |
| 120 | mobile-transactions.webp | Old web Transactions list | Old Money, replace. Contains "Transfer to Mum" and a "Transfer" row, both against the brief. Highest priority |
| 154 | mobile-goals.webp | Old web Goals tracker | Old, Plan replaces it |
| 171 | mobile-bills.webp | Old web Bills | Old, Plan replaces it |
| 137, 188 | budget.webp, insights.webp | Desktop web screenshots, not phone mockups | Out of scope |

Also: `public/assets/screens/README.txt` says screens must use demo data only. `.uiphone` CSS (site.css 500 to 533) and a matching block in `site.js` are dead code, no markup uses them.

Left alone on purpose. The "Transfer to Mum" image is the one real problem; if the owner wants it gone before new screens exist, the cleanest option is removing that one figure, not redrawing it.

## 2. Stat counters

Cause of the "0": the HTML held `0` and relied on JS plus an IntersectionObserver at threshold .6. Now the HTML holds the final value; JS (only when motion is allowed and IntersectionObserver exists) resets to 0, counts up when 30% visible, and a 6 second fallback shows the final value if it never fires. No JS or reduce motion shows the real figure.

Truth check:
- "3s to import a full statement": no timing evidence anywhere (brief docs, code). Unproven, so I removed the stat.
- "2 apps, web + Android": true (iOS is not shipped).
- "100% Naira-first, free to start": kept. "Free to start" is true, there is a paid tier. "100%" is a loose brand line, not a measurement; the owner may prefer to drop it.
- "6+ money tools": the site has 5 feature pages (transactions, budgets, goals, bills, insights). Changed to "5".

## 3. Copy removed

- Hero button "Install on iPhone (web)" removed (index.astro). `site.js` still maps `data-app="ios"` and its comment; harmless, nothing uses it.
- "forward the emails" removed from How it works step 2 (index.astro) and "or forward an email" from corper.astro.

Not touched, needs an owner decision: `security.astro` line 37 ("Email forwarding" bullet) and line 67 (Postmark), `terms.astro` line 39 (forward emails, iPhone Shortcut), and `privacy.astro` sections 6.2 and iPhone automation text. These are legal and trust copy that describes what the app does today; removing them is not a "quick fix" and could make the policy wrong.

## Checks

- `npm run build` passes.
- `dist/client/learn` does not exist after build (Learn still renders on request; `prerender = false` intact on learn index, [slug] and sitemap-learn).
- sitemap-learn route is in the server bundle; robots.txt still has both Sitemap lines.
- No emoji or em dashes added.
- Not viewed in a browser.
