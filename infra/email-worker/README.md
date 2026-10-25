# automonie-email-worker

Cloudflare Email Worker that receives inbound bank-alert mail for
`in.automonie.com` and forwards the parsed fields to the backend's
`/api/inbound-email/cloudflare` route. See `docs/ops/cloudflare-migration.md`
for the full account setup (DNS cutover, Email Routing, secrets) and
`docs/ops/dns-records.md` for the pre-migration DNS inventory.

```bash
npm install
npx wrangler secret put INBOUND_CF_SECRET   # paste the same value set in Render
npx wrangler deploy
```

Local dev (`npm run dev`) can exercise `email()` via Wrangler's email test
binding, but there's no substitute for one real forwarded alert after deploy.
