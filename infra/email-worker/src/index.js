// Cloudflare Email Worker for Automonie inbound bank-alert mail (round 6 part F).
// Bound as a catch-all route on in.automonie.com. Cloudflare hands us every message
// addressed to <token>@in.automonie.com; we check the address and pass the raw email
// straight to the backend, which parses it (backend/lib/inboundEmail.js parseRawEmail)
// and runs the same ingest path as the old Postmark webhook.
//
// Why raw: parsing MIME here can exceed the Workers free-plan CPU limit on larger
// emails; reading and forwarding the bytes costs almost no CPU.
// Why retries: Cloudflare doesn't retry an Email Worker, and the backend may be slow
// or waking up. We retry for about a minute and a half before giving up.

// A bank alert is a few KB; forwarded mail with logos can be a few hundred KB.
// Anything over this isn't an alert (statements and photos go through the app).
const MAX_RAW_BYTES = 5 * 1024 * 1024;

// Waits between attempts (ms). With a 25 s timeout per attempt, the worst case is
// about 90 s in total, long enough for a sleeping backend to start.
const BACKOFF_MS = [0, 5000, 15000];
const ATTEMPT_TIMEOUT_MS = 25000;

// Same rule as backend/lib/inboundEmail.js extractToken: lowercase, plus-addressing
// stripped, plain alphanumeric only (genToken() never produces anything else).
function extractLocalToken(address) {
  const addr = (address || '').toLowerCase().trim();
  const at = addr.lastIndexOf('@');
  if (at === -1) return '';
  const local = addr.slice(0, at).split('+')[0];
  return /^[a-z0-9]+$/.test(local) ? local : '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 5xx, 429 and network errors are worth retrying (backend busy or waking up).
// 401/403/503 mean a setup problem we can fix (secret or switch), so they are retried
// too and, if they persist, fail loudly. 400/413/422 mean this email can't be used.
const retryable = (status) => status === 0 || status === 429 || status === 401 || status === 403 || status >= 500;

export default {
  async email(message, env) {
    const token = extractLocalToken(message.to);
    if (!token) {
      // Not a <token>@in.automonie.com address: a real bounce, so a mistyped address
      // tells the sender instead of vanishing.
      message.setReject('Unknown recipient');
      return;
    }
    if (message.rawSize > MAX_RAW_BYTES) {
      message.setReject('Message too large for bank-alert forwarding');
      return;
    }

    const raw = await new Response(message.raw).arrayBuffer();
    const backendUrl = env.BACKEND_URL || 'https://api.automonie.com/api/inbound-email/cloudflare';

    let lastStatus = 0;
    for (const wait of BACKOFF_MS) {
      if (wait) await sleep(wait);
      try {
        const res = await fetch(backendUrl, {
          method: 'POST',
          headers: {
            'content-type': 'message/rfc822',
            'x-inbound-cf-secret': env.INBOUND_CF_SECRET || '',
            'x-envelope-to': message.to || '',
            'x-envelope-from': message.from || '',
          },
          body: raw,
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        });
        if (res.ok) return;
        lastStatus = res.status;
        console.error('[email-worker] backend answered', res.status);
        if (!retryable(res.status)) return; // this email can't be used; nothing to retry
      } catch (err) {
        lastStatus = 0;
        console.error('[email-worker] backend unreachable', err && err.message);
      }
    }
    // Still failing after ~90 s: throw so the failure is visible in Workers logs and
    // the sending server gets an error rather than a silent success.
    throw new Error(`Backend unavailable after retries (last status ${lastStatus})`);
  },
};
