# Moving inbound bank-alert email from Postmark to Cloudflare (round 6, part F)

**Why:** Postmark's free tier (100 inbound+outbound messages/month) runs out
within hours once a handful of beta testers forward bank alerts. Cloudflare
Email Routing + an Email Worker does the same job for free, with no message
cap that matters at our scale. The trade-off: Cloudflare only routes mail for
zones it hosts, so automonie.com's DNS has to move from the registrar
(nameservers `ns1/ns2/ns3.systemdns.com`) to Cloudflare's nameservers.

**What's already built (this session):** the Worker (`infra/email-worker/`)
and the backend route (`POST /api/inbound-email/cloudflare` in
`backend/server.js`) that it posts to. Both are inert until you do the
account steps below — the old Postmark webhook (`/api/inbound-email/webhook`)
keeps working exactly as before until you flip the `in` MX record in step 4,
so nothing breaks while you work through this.

**Before you start:** read `docs/ops/dns-records.md` — the reference copy of
every DNS record automonie.com has today. You'll check Cloudflare's imported
zone against it in step 2.

---

## Step 1 — Create a free Cloudflare account

1. Go to <https://dash.cloudflare.com/sign-up> and sign up (free plan is
   fine — Email Routing doesn't need a paid plan).
2. Verify your email if asked.

## Step 2 — Add automonie.com to Cloudflare

1. In the Cloudflare dashboard: **Add a domain** → type `automonie.com` →
   choose the **Free** plan.
2. Cloudflare scans the current zone and shows you every record it found.
   **Compare that list to `docs/ops/dns-records.md` line by line.** Cloudflare's
   scanner sometimes misses records (it can't see what it can't guess, same
   limitation as the nslookup inventory). For anything missing — especially
   `zoho._domainkey`, `brevo1._domainkey`, `brevo2._domainkey`, `_dmarc`, the
   Zoho MX records, or the SPF/brevo-code TXT records — **add it manually**
   using the exact value from `dns-records.md` before moving on.
3. Also double check the CAA situation noted in `dns-records.md` (nslookup
   couldn't confirm there isn't one) — if Cloudflare's scan shows a CAA
   record, keep it; if your registrar's dashboard screenshot shows one that
   Cloudflare's scan missed, add it too.

## Step 3 — Set proxy status correctly (the step that protects TLS)

For **every** record Cloudflare imported, check the little cloud icon next
to it:

- `www` (CNAME to Vercel) → **grey cloud ("DNS only")**
- `api` (CNAME to Render) → **grey cloud ("DNS only")**
- Everything else (MX, TXT, the apex A record) → proxy status doesn't apply
  to these record types the same way, but leave them as Cloudflare defaults
  unless you specifically mean to proxy the apex too (don't — same TLS risk
  as `www`/`api`).

**If `www` or `api` end up "Proxied" (orange cloud)**, Vercel's and Render's
own TLS certificates stop matching what visitors see (they'd be hitting
Cloudflare's certificate instead, for a domain Cloudflare's not configured to
terminate TLS for in the way those platforms expect) and both the site and
the API can show certificate errors or stop responding. This is the single
most likely way this migration breaks something, so check it twice.

## Step 4 — Change nameservers at the registrar

1. Cloudflare's "Add a domain" flow gives you two nameservers (something like
   `xxx.ns.cloudflare.com` / `yyy.ns.cloudflare.com` — Cloudflare picks the
   exact names).
2. Log in to the registrar where automonie.com is registered (wherever
   `ns1.systemdns.com` etc. are managed from) and replace the three
   `systemdns.com` nameservers with Cloudflare's two.
3. **Do this at a quiet hour** (see risk notes below) — once saved, don't
   touch it again; propagation is out of your hands from here.
4. Wait for Cloudflare's dashboard to show the zone as **"Active"**. This can
   take anywhere from a few minutes to a few hours (DNS propagation; rarely
   up to 24-48h in the worst case, usually much faster for a registrar this
   size).

## Step 5 — Turn on Email Routing for the inbound subdomain

1. In the Cloudflare dashboard for automonie.com: **Email** → **Email
   Routing** → **Get started**. Cloudflare will offer to manage MX records
   for the *whole* domain — **don't let it touch the apex** (Zoho's
   `mx.zoho.com` / `mx2` / `mx3` must keep serving `hello@automonie.com`).
   Cloudflare's Email Routing setup lets you scope routing rules per address;
   when it asks which addresses to route, you're routing to a **Worker**, not
   creating a Zoho-style mailbox, and the rule you create next is what
   actually binds it to `in.automonie.com` — the apex MX records stay
   pointed at Zoho throughout.
2. Under **Email** → **Email Routing** → **Routing rules**: create a
   **catch-all / custom address rule** for `*@in.automonie.com` (or, if
   Cloudflare's UI wants a specific address pattern rather than a wildcard,
   use a **Catch-all address** rule scoped so it only applies to the
   `in.automonie.com` subdomain — check the rule's "match" column after saving
   to confirm it reads `in.automonie.com`, not `automonie.com`).
3. Set the rule's action to **Send to a Worker**, and pick the Worker you
   deploy in step 6 (`automonie-email-worker`).
4. Cloudflare will now manage the MX record for `in.automonie.com` itself —
   you'll see it switch from `inbound.postmarkapp.com` to Cloudflare's own
   MX target the moment the rule is active. This is the **only** MX change
   in the whole migration; `mx.zoho.com` / `mx2` / `mx3` on the apex are
   untouched.

## Step 6 — Deploy the Worker

From `infra/email-worker/`:

```bash
npm install
npx wrangler login              # one-time, opens a browser to authorize
npx wrangler secret put INBOUND_CF_SECRET
# paste a long random value when prompted — anything from `openssl rand -hex 32` works
npx wrangler deploy
```

Then set the **same** value on the backend: in Render's dashboard, add an
environment variable `INBOUND_CF_SECRET` on the backend service with the
identical value you just pasted into Wrangler, and redeploy (or let Render's
auto-redeploy-on-env-change do it).

Back in the Cloudflare dashboard, under the Email Routing rule from step 5,
make sure it's pointed at the Worker you just deployed (it may have asked you
to pick it during the rule setup in step 5 — if the Worker didn't exist yet
at that point, go back and attach it now).

## Step 7 — Test before relying on it

1. From any email account, send (or forward) one real bank alert to your own
   `<token>@in.automonie.com` address (find it in-app: You → Email
   forwarding).
2. Check `wrangler tail` (`npx wrangler tail` from `infra/email-worker/`) to
   watch the Worker's live logs while the mail arrives.
3. Confirm the transaction shows up in the app within a minute or two, the
   same way it would have via Postmark.
4. If it doesn't: check the Worker log first (did it receive the mail? did it
   reject for "Unknown recipient"? did the fetch to the backend fail?), then
   check Render's backend logs for `[inbound-email/cloudflare]` — a 401 there
   means `INBOUND_CF_SECRET` doesn't match between the Worker and Render.

## Step 8 — Retire Postmark

Once step 7 is confirmed working for real mail (not just a test), you can
stop paying attention to Postmark. The code keeps `/api/inbound-email/webhook`
around as a dormant fallback (nothing will reach it once the `in` MX no
longer points at Postmark), so there's no code change needed to "turn it
off" — just let the Postmark account's free tier quota stop mattering, or
cancel/downgrade it if you'd rather not keep the account at all.

---

## Risk notes

- **The nameserver switch (step 4) is the only moment something can break** —
  the site (Vercel), the API (Render), and all mail (Zoho + Brevo + the
  inbound address) all depend on the DNS that Cloudflare now serves instead
  of the registrar. Everything before step 4 is reversible with zero risk
  (Cloudflare just has a copy of the zone; nothing points at it yet).
  Everything from step 4 onward is why step 2 and step 3's double-checks
  matter — get the zone right *before* the nameservers move, not after.
- **Do the nameserver switch at a quiet hour** (fewest people likely to be
  actively using the app or sending you an email right then) in case
  something is missed despite the checks above and needs a quick fix.
- **DNS propagation can take a few hours.** Resolvers around the world cache
  the old nameservers for a while; some users may hit stale DNS briefly even
  after Cloudflare shows "Active" for you. This generally self-resolves
  without action.
- **Nothing about user accounts or data changes.** This migration only moves
  where inbound alert mail is routed and how it's parsed before reaching the
  same backend ingest path (`ingestInboundEmail` in `server.js`) that
  Postmark's mail already went through — no change to what happens to a
  parsed alert once it arrives.
- **If something does break after step 4**, the fastest fix for the site/API
  specifically is almost always step 3 (a proxied `www`/`api` record) — check
  that first.

## Why Postmark's quota ran out in hours (item 6)

Checked the code, not Postmark's own activity log (no Postmark API key in
this session to pull it) — two candidate causes, and how to tell them apart:

1. **Volume from testers, not a loose filter.** The web setup guide
   (`frontend/src/components/EmailForwarding.jsx`) already has testers create
   a Gmail filter scoped to **`From: alerts@<their-bank>`** — it does *not*
   tell anyone to forward their whole inbox. That's already as tight as a
   Gmail filter gets. A handful of beta testers each generating a few bank
   alerts a day, plus every one of those counting against the *same* 100/month
   Postmark allowance (Postmark's free tier is shared across inbound +
   outbound, and outbound already includes password-reset and other
   transactional mail — though that's on Brevo now per
   `email-brevo-render-smtp`, so it may not stack with inbound), is enough on
   its own to exhaust 100 messages within hours of a few testers setting up
   forwarding at once.
2. **The mobile app's own setup guide** lives in `../finpilot-mobile`, a
   separate repository not open in this session — I couldn't check whether
   its wording matches the web guide's bank-specific filter instructions or
   is looser (e.g. "forward everything"). Worth a quick check in a mobile
   session if the Cloudflare numbers (no cap to worry about) still look
   unexpectedly high after the cutover — at that point `wrangler tail` plus
   the backend's `inbound-email/status` count per user will show it clearly,
   where Postmark's dashboard doesn't break it down by user.

Given Cloudflare Email Routing has no message cap that matters here, this
is moot for the immediate "it ran out" problem — but if volume still looks
unusually high per tester after the move, that's the thread to pull on.
