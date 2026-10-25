# DNS inventory for automonie.com, before the Cloudflare move (26 Oct 2026)

Taken with `nslookup` against the live zone (currently hosted at the registrar,
nameservers `ns1/ns2/ns3.systemdns.com`), before any change. This is the
**reference copy** to check Cloudflare's imported zone against once the
domain is added there (see `cloudflare-migration.md` step 2) — if a record
below is missing or different after the import, add/fix it in Cloudflare
*before* switching nameservers, not after.

**CAA**: `nslookup` on this machine doesn't support CAA queries, and none
showed up as a side effect of the other lookups. Likely there isn't one (no
CAA record is what "any CA may issue" means, so nothing breaks TLS if that's
true) — but confirm with a registrar screenshot or `https://dnschecker.org`
before relying on that. **Owner: please also grab a screenshot of the full
DNS page in the registrar's dashboard** — nslookup only resolves names you
already think to ask for, so it can't catch a record on a name you didn't
guess.

## Apex (automonie.com)

| Type | Value | Purpose |
|---|---|---|
| A | `216.198.79.1` | Vercel (the main site) |
| MX 10 | `mx.zoho.com` | Zoho Mail (hello@ mailboxes) |
| MX 20 | `mx2.zoho.com` | Zoho Mail |
| MX 50 | `mx3.zoho.com` | Zoho Mail |
| TXT | `v=spf1 include:spf.brevo.com include:zoho.com ~all` | SPF — Brevo (outbound transactional/newsletter) + Zoho (hello@ mail) |
| TXT | `brevo-code:01fcbe3ad8ba8ae8eabecf3c89fc4aa1` | Brevo domain-authentication verification |
| NS | `ns1.systemdns.com`, `ns2.systemdns.com`, `ns3.systemdns.com` | current nameservers — these are what move to Cloudflare's two |
| AAAA | none found | — |
| CAA | not confirmed — see note above | — |

## Subdomains

| Name | Type | Value | Purpose |
|---|---|---|---|
| `www` | CNAME | `ff44ad3262239f06.vercel-dns-017.com` | Vercel — must stay "DNS only" (grey cloud) in Cloudflare |
| `api` | CNAME | `financial-app-w2ai.onrender.com` | Render backend — must stay "DNS only" (grey cloud) in Cloudflare |
| `in` | MX 10 | `inbound.postmarkapp.com` | **This is the one that moves.** Postmark inbound today; becomes Cloudflare Email Routing after the cutover (part F) |
| `zoho._domainkey` | TXT | `v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDplIOSFnqRA986W8oQ3kl7M9y3Huba4j/crlS7K8ciQ1IYA0l4MeA8kCZukdsVK4EEjmAzSJm3+6e1ac6IbIilnmdls10LeNKIGQW1A/b6bH+OHOwZO52uLE615H/MMwE2OT7biEWJTeayLfGu7qnfSZXsenh/BqbypkEwc5PUXwIDAQAB` | DKIM signing for Zoho mail (hello@) |
| `brevo1._domainkey` | CNAME | `b1.automonie-com.dkim.brevo.com` | DKIM signing for Brevo |
| `brevo2._domainkey` | CNAME | `b2.automonie-com.dkim.brevo.com` | DKIM signing for Brevo |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` | DMARC policy (monitor-only) |

Checked and found **nothing** at: `mail.automonie.com`, `_vercel.automonie.com`
(no separate Vercel domain-verification TXT beyond the records above — the
apex is already verified and serving), `mail._domainkey`, `zmail._domainkey`.
A guessed name resolving to nothing doesn't rule out something real on a name
not guessed here — again, the registrar screenshot is the backstop.

## What this means for the migration

- **Everything above except the `in` MX record is unaffected by part F** — it
  all needs to exist, unchanged, in Cloudflare's zone after the nameserver
  switch, or Vercel/Render TLS, the main site, Zoho mail, and Brevo sending
  all break at once.
- Only `in.automonie.com`'s MX target changes: Postmark's inbound MX is
  replaced by Cloudflare Email Routing's own MX once Email Routing is enabled
  for that subdomain (Cloudflare manages that record itself — see
  `cloudflare-migration.md` step 4).
- `www` and `api` CNAMEs **must be set to "DNS only" (grey cloud, not
  orange/proxied)** in Cloudflare, or Vercel's and Render's own TLS
  certificates stop matching and both go down behind Cloudflare's proxy
  cert instead.
