// Welcome emails for the waitlist and the newsletter. Pure: returns { subject, text,
// html } so the copy is tested. With { template: true } it returns the same email
// with Brevo placeholders ({{ params.firstName }} etc.), which
// scripts/brevo-welcome-templates.js uploads as Brevo templates. When the
// BREVO_TEMPLATE_* ids are set the server sends through those templates, so the copy
// can be edited in Brevo without a deploy.
//
// Brand: teal #139DA0, mint #1DD3A8, near-black #0B0E11, Poppins. No emoji. The header
// is an image (an animated GIF once supplied): Outlook desktop shows only the first
// frame, so that frame must carry the message on its own, and it always has alt text.
'use strict';

const BRAND = { teal: '#139DA0', mint: '#1DD3A8', ink: '#0B0E11', text: '#1B2430', muted: '#5B6B7A' };
const SITE = 'https://www.automonie.com';
const DEFAULT_LOGO = `${SITE}/assets/logo-full-light.png`;
const FONT = "Poppins, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const POSTAL = 'MICADOT-NG LIMITED, Nigeria.';

// A Brevo placeholder passes through untouched; everything else is HTML-escaped.
const PLACEHOLDER = /^\{\{ params\.\w+ \}\}$/;
const esc = (s) => (PLACEHOLDER.test(String(s)) ? String(s)
  : String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const greeting = (name, template) => (template
  ? '{% if params.firstName %}Hi {{ params.firstName }},{% else %}Hi there,{% endif %}'
  : (firstName(name) ? `Hi ${esc(firstName(name))},` : 'Hi there,'));

// The header: the supplied image (GIF) full width, or the logo on the brand band. In
// a template, Brevo chooses between the two at send time.
function header({ headerImageUrl, headerAlt, template }) {
  if (template) {
    return `{% if params.headerImageUrl %}${header({ headerImageUrl: '{{ params.headerImageUrl }}', headerAlt })}{% else %}${header({ headerAlt })}{% endif %}`;
  }
  if (headerImageUrl) {
    return `<tr><td style="padding:0"><img src="${esc(headerImageUrl)}" width="560" alt="${esc(headerAlt)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:16px 16px 0 0"></td></tr>`;
  }
  return `<tr><td style="background:${BRAND.ink};padding:28px 28px 24px;border-radius:16px 16px 0 0">
    <img src="${DEFAULT_LOGO}" width="168" alt="automonie" style="display:block;width:168px;height:auto;border:0">
    <p style="margin:18px 0 0;font-family:${FONT};font-size:22px;line-height:1.3;font-weight:700;color:#ffffff">${esc(headerAlt)}</p>
  </td></tr>`;
}

const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:${BRAND.teal};color:#ffffff;text-decoration:none;font-family:${FONT};font-weight:600;font-size:15px;padding:13px 22px;border-radius:10px">${esc(label)}</a>`;

// Shared shell: a single 560px column, inline styles only (email clients ignore
// <style> blocks unevenly), preheader text, and a footer that can carry unsubscribe.
function shell({ preheader, headerImageUrl, headerAlt, bodyHtml, footerHtml, template }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(headerAlt)}</title></head>
<body style="margin:0;padding:0;background:#F3F6F8">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F6F8"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:16px">
${header({ headerImageUrl, headerAlt, template })}
<tr><td style="padding:24px 28px 8px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.text}">${bodyHtml}</td></tr>
<tr><td style="padding:8px 28px 28px;font-family:${FONT};font-size:12px;line-height:1.6;color:${BRAND.muted}">${footerHtml}</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

// Waitlist: thanks, and exactly what happens next.
function waitlistWelcome({ name, whatsappUrl, headerImageUrl, template = false } = {}) {
  if (template) whatsappUrl = '{{ params.whatsappUrl }}';
  const headerAlt = 'You’re on the Automonie waitlist';
  const html = shell({
    preheader: 'Here’s what happens next, and how to get in early.',
    headerImageUrl, headerAlt, template,
    bodyHtml: `<p style="margin:0 0 14px">${greeting(name, template)}</p>
<p style="margin:0 0 14px">Thanks for joining. Automonie shows you where every naira goes, from your bank alerts and statements, without you typing a thing.</p>
<p style="margin:0 0 6px;font-weight:600">What happens next</p>
<ol style="margin:0 0 16px;padding-left:20px">
<li style="margin-bottom:6px">We’ll email you when your invite is ready.</li>
<li style="margin-bottom:6px">You download the app (Android first, iPhone soon) and set up your first bank in a couple of minutes.</li>
<li>Your first look at where your money went arrives the same day.</li>
</ol>
${whatsappUrl ? `<p style="margin:0 0 12px">Want in sooner? Join the community: early testers get invites first and help shape what we build.</p>
<p style="margin:0 0 20px">${button(whatsappUrl, 'Join the WhatsApp community')}</p>` : ''}
<p style="margin:0">The Automonie team</p>`,
    footerHtml: `You’re getting this because you joined the waitlist at automonie.com. We’ll only email you about your invite and big updates.<br>${POSTAL}`,
  });
  const hiText = template ? greeting(null, true) : (firstName(name) ? `Hi ${firstName(name)},` : 'Hi there,');
  const text = `${hiText}

Thanks for joining. Automonie shows you where every naira goes, from your bank alerts and statements, without you typing a thing.

What happens next
1. We'll email you when your invite is ready.
2. You download the app (Android first, iPhone soon) and set up your first bank in a couple of minutes.
3. Your first look at where your money went arrives the same day.
${whatsappUrl ? `\nWant in sooner? Join the community: early testers get invites first.\n${whatsappUrl}\n` : ''}
The Automonie team

You're getting this because you joined the waitlist at automonie.com.
${POSTAL}`;
  return { subject: 'You’re on the Automonie waitlist', text, html };
}

// Newsletter: what they'll get, how often, and a one-click way out.
function newsletterWelcome({ name, unsubscribeUrl, headerImageUrl, template = false } = {}) {
  if (template) unsubscribeUrl = '{{ params.unsubscribeUrl }}';
  if (!unsubscribeUrl) throw new Error('The newsletter welcome needs an unsubscribe link.');
  const headerAlt = 'Welcome to the Automonie newsletter';
  const html = shell({
    preheader: 'Money tips that fit Nigerian life, about twice a month.',
    headerImageUrl, headerAlt, template,
    bodyHtml: `<p style="margin:0 0 14px">${greeting(name, template)}</p>
<p style="margin:0 0 14px">You’re subscribed. About twice a month you’ll get one short email with:</p>
<ul style="margin:0 0 16px;padding-left:20px">
<li style="margin-bottom:6px">a money habit worth trying, in plain words;</li>
<li style="margin-bottom:6px">what’s new in Automonie;</li>
<li>the occasional tool, like our budget calculators and quizzes.</li>
</ul>
<p style="margin:0 0 20px">${button(SITE, 'Visit automonie.com')}</p>
<p style="margin:0">The Automonie team</p>`,
    footerHtml: `You’re getting this because you subscribed at automonie.com. <a href="${esc(unsubscribeUrl)}" style="color:${BRAND.teal}">Unsubscribe</a> in one click, any time.<br>${POSTAL}`,
  });
  const hiText = template ? greeting(null, true) : (firstName(name) ? `Hi ${firstName(name)},` : 'Hi there,');
  const text = `${hiText}

You're subscribed. About twice a month you'll get one short email with:
- a money habit worth trying, in plain words;
- what's new in Automonie;
- the occasional tool, like our budget calculators and quizzes.

${SITE}

The Automonie team

Unsubscribe in one click: ${unsubscribeUrl}
${POSTAL}`;
  return { subject: 'Welcome to the Automonie newsletter', text, html };
}

module.exports = { waitlistWelcome, newsletterWelcome, BRAND };
