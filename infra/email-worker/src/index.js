// Cloudflare Email Worker for Automonie inbound bank-alert mail (round 6 part F).
// Bound as a catch-all route on in.automonie.com. Cloudflare hands us the raw MIME
// for every message addressed to <token>@in.automonie.com; we parse it ourselves
// (postal-mime), drop what we shouldn't ingest, and POST a small JSON body to the
// backend, which runs the exact same ingest path as the old Postmark webhook
// (backend/server.js: ingestInboundEmail, via inboundEmail.mapCloudflarePayload).
//
// Never forwards the raw email anywhere — only the parsed fields the backend needs.

import PostalMime from 'postal-mime';

// Above this we don't even try to parse: a bank alert is a few KB of text. Anything
// bigger is someone attaching a statement/PDF/photo to the forward, which isn't what
// this address is for. Dropped quietly (no bounce — the sender did nothing wrong).
const MAX_RAW_BYTES = 5 * 1024 * 1024;

// Pulls the token out of the local part of an address, the same rule as
// backend/lib/inboundEmail.js's extractToken: lowercase, plus-addressing stripped,
// must be plain alphanumeric (our genToken() never produces anything else).
function extractLocalToken(address) {
  const addr = (address || '').toLowerCase().trim();
  const at = addr.lastIndexOf('@');
  if (at === -1) return '';
  const local = addr.slice(0, at).split('+')[0];
  return /^[a-z0-9]+$/.test(local) ? local : '';
}

export default {
  async email(message, env, ctx) {
    const token = extractLocalToken(message.to);
    if (!token) {
      // No recognisable <token>@in.automonie.com address: a real bounce, not a silent
      // drop, so a mistyped address tells the sender instead of vanishing.
      message.setReject('Unknown recipient');
      return;
    }

    if (message.rawSize > MAX_RAW_BYTES) return;

    let parsed;
    try {
      parsed = await PostalMime.parse(message.raw);
    } catch (err) {
      console.error('[email-worker] postal-mime parse failed', err);
      return; // malformed mail: drop, don't bounce (could be a transient MIME quirk)
    }

    const body = {
      to: message.to,
      from: (parsed.from && parsed.from.address) || message.from || '',
      subject: parsed.subject || '',
      text: parsed.text || '',
      html: parsed.html || '',
      date: parsed.date || null,
    };

    const backendUrl = env.BACKEND_URL || 'https://api.automonie.com/api/inbound-email/cloudflare';
    try {
      const res = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-inbound-cf-secret': env.INBOUND_CF_SECRET || '',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        console.error('[email-worker] backend rejected mail', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      // Backend unreachable: nothing more we can do with this message. Cloudflare
      // doesn't retry Email Workers, so the alert is lost rather than re-ingested
      // twice — acceptable, since the user can still forward it a second time.
      console.error('[email-worker] failed to reach backend', err);
    }
  },
};
