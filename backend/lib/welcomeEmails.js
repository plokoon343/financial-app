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

// Waitlist: thanks, what happens next, and something to do while they wait (Launch
// Ops Pack, Part 3.1).
function waitlistWelcome({ name, whatsappUrl, headerImageUrl, template = false } = {}) {
  if (template) whatsappUrl = '{{ params.whatsappUrl }}';
  const headerAlt = 'You’re on the Automonie list';
  const html = shell({
    preheader: 'Here’s what happens next, and something to do while you wait.',
    headerImageUrl, headerAlt, template,
    bodyHtml: `<p style="margin:0 0 14px">${greeting(name, template)}</p>
<p style="margin:0 0 14px">You’re in. Thanks for joining the Automonie waitlist.</p>
<p style="margin:0 0 14px">Automonie reads your bank alerts and statements and shows you where your money actually goes, across every bank, in naira. No more “where did my money go?” at the end of the month.</p>
<p style="margin:0 0 6px;font-weight:600">What happens next</p>
<ul style="margin:0 0 16px;padding-left:20px">
<li style="margin-bottom:6px">We’ll email you the moment Automonie is live on the Play Store.</li>
<li>Early members get first access to new features.</li>
</ul>
<p style="margin:0 0 6px;font-weight:600">While you wait</p>
<p style="margin:0 0 12px">Find your money personality in 2 minutes.</p>
<p style="margin:0 0 18px">${button(`${SITE}/quiz`, 'Take the quiz')}</p>
${whatsappUrl ? `<p style="margin:0 0 12px">Join our WhatsApp community for money tips and early updates.</p>
<p style="margin:0 0 20px">${button(whatsappUrl, 'Join the community')}</p>` : ''}
<p style="margin:0">Talk soon,<br>The Automonie team</p>`,
    footerHtml: `You’re receiving this because you joined the Automonie waitlist at automonie.com.<br>${POSTAL}`,
  });
  const hiText = template ? greeting(null, true) : (firstName(name) ? `Hi ${firstName(name)},` : 'Hi there,');
  const text = `${hiText}

You're in. Thanks for joining the Automonie waitlist.

Automonie reads your bank alerts and statements and shows you where your money actually goes, across every bank, in naira. No more "where did my money go?" at the end of the month.

What happens next
- We'll email you the moment Automonie is live on the Play Store.
- Early members get first access to new features.

While you wait
- Find your money personality in 2 minutes: ${SITE}/quiz
${whatsappUrl ? `- Join our WhatsApp community for money tips and early updates: ${whatsappUrl}\n` : ''}
Talk soon,
The Automonie team

You're receiving this because you joined the Automonie waitlist at automonie.com.
${POSTAL}`;
  return { subject: 'You’re on the Automonie list', preheader: 'Here’s what happens next, and something to do while you wait.', text, html };
}

// Newsletter: what they'll get, a first tip, and a one-click way out (Launch Ops
// Pack, Part 3.2).
function newsletterWelcome({ name, unsubscribeUrl, headerImageUrl, template = false } = {}) {
  if (template) unsubscribeUrl = '{{ params.unsubscribeUrl }}';
  if (!unsubscribeUrl) throw new Error('The newsletter welcome needs an unsubscribe link.');
  const headerAlt = 'Welcome to Automonie money tips';
  const html = shell({
    preheader: 'Twice a month, short and useful. Here’s your first one.',
    headerImageUrl, headerAlt, template,
    bodyHtml: `<p style="margin:0 0 14px">${greeting(name, template)}</p>
<p style="margin:0 0 14px">Thanks for subscribing. About twice a month we’ll send you short, practical money tips for real Nigerian life: salary, allawee, side hustles, rent, Detty December, all of it.</p>
<p style="margin:0 0 6px;font-weight:600">Your first tip: decide before you spend</p>
<p style="margin:0 0 12px">When money lands, give every naira a job before you touch it: needs first, then savings, then fun. Even a rough split beats none. Our free budget calculator does the maths for you.</p>
<p style="margin:0 0 18px">${button(`${SITE}/budget-calculator`, 'Try the budget calculator')}</p>
<p style="margin:0 0 12px">Want to see where your money actually goes? Automonie reads your bank alerts and statements and sorts it all for you.</p>
<p style="margin:0 0 20px">${button('https://app.automonie.com', 'Open the web app')}</p>
<p style="margin:0">See you in your inbox,<br>The Automonie team</p>`,
    footerHtml: `You’re getting this because you subscribed at automonie.com. <a href="${esc(unsubscribeUrl)}" style="color:${BRAND.teal}">Unsubscribe</a> in one click, no hard feelings.<br>${POSTAL}`,
  });
  const hiText = template ? greeting(null, true) : (firstName(name) ? `Hi ${firstName(name)},` : 'Hi there,');
  const text = `${hiText}

Thanks for subscribing. About twice a month we'll send you short, practical money tips for real Nigerian life: salary, allawee, side hustles, rent, Detty December, all of it.

Your first tip: decide before you spend
When money lands, give every naira a job before you touch it: needs first, then savings, then fun. Even a rough split beats none. Our free budget calculator does the maths for you: ${SITE}/budget-calculator

Want to see where your money actually goes? Automonie reads your bank alerts and statements and sorts it all for you: https://app.automonie.com

See you in your inbox,
The Automonie team

Unsubscribe in one click, no hard feelings: ${unsubscribeUrl}
${POSTAL}`;
  return { subject: 'Welcome to Automonie money tips', preheader: 'Twice a month, short and useful. Here’s your first one.', text, html };
}

module.exports = { waitlistWelcome, newsletterWelcome, BRAND };
