// Create (or update) the two welcome-email templates in Brevo from lib/welcomeEmails,
// so the copy can then be edited in Brevo's editor without a deploy.
//
//   BREVO_API_KEY=xkeysib-... node scripts/brevo-welcome-templates.js
//
// Prints the template ids; set them on Render as BREVO_TEMPLATE_WAITLIST_WELCOME and
// BREVO_TEMPLATE_NEWSLETTER_WELCOME. Run again with those set to push code changes
// to the same templates (this overwrites edits made in Brevo).
// Optional: WELCOME_HEADER_URL to check the header GIF is reachable and under 1 MB.
'use strict';
require('dotenv').config();
const axios = require('axios');
const { waitlistWelcome, newsletterWelcome } = require('../lib/welcomeEmails');

const KEY = process.env.BREVO_API_KEY;
if (!KEY) { console.error('Set BREVO_API_KEY first.'); process.exit(1); }
const api = axios.create({ baseURL: 'https://api.brevo.com/v3', headers: { 'api-key': KEY, 'content-type': 'application/json' }, timeout: 20000 });
const sender = { name: process.env.EMAIL_FROM_NAME || 'Automonie', email: process.env.EMAIL_FROM_ADDRESS || 'hello@automonie.com' };
const newsletterSender = { name: process.env.NEWSLETTER_FROM_NAME || 'Automonie', email: process.env.NEWSLETTER_FROM_ADDRESS || sender.email };

const TEMPLATES = [
  { env: 'BREVO_TEMPLATE_WAITLIST_WELCOME', name: 'Automonie: waitlist welcome', build: () => waitlistWelcome({ template: true }), sender, tag: 'welcome-waitlist' },
  { env: 'BREVO_TEMPLATE_NEWSLETTER_WELCOME', name: 'Automonie: newsletter welcome', build: () => newsletterWelcome({ template: true }), sender: newsletterSender, replyTo: process.env.NEWSLETTER_REPLY_TO || 'noreply@automonie.com', tag: 'welcome-newsletter' },
];

async function checkHeader() {
  const url = process.env.WELCOME_HEADER_URL;
  if (!url) { console.log('No WELCOME_HEADER_URL: the logo header is used until the GIF is set.'); return; }
  const r = await axios.head(url, { timeout: 15000 });
  const size = Number(r.headers['content-length'] || 0);
  console.log(`Header ${url}: ${r.headers['content-type']}, ${(size / 1024).toFixed(0)} KB`);
  if (size > 1024 * 1024) console.warn('  Over 1 MB: some inboxes will be slow to show it. Aim for under 1 MB.');
}

(async () => {
  await checkHeader();
  for (const t of TEMPLATES) {
    const e = t.build();
    const body = { templateName: t.name, subject: e.subject, htmlContent: e.html, sender: t.sender, isActive: true, tag: t.tag, ...(t.replyTo ? { replyTo: t.replyTo } : {}) };
    const id = Number(process.env[t.env]) || 0;
    if (id) {
      await api.put(`/smtp/templates/${id}`, body);
      console.log(`Updated ${t.name}: ${t.env}=${id}`);
    } else {
      const { data } = await api.post('/smtp/templates', body);
      console.log(`Created ${t.name}: set ${t.env}=${data.id} on Render`);
    }
  }
})().catch((e) => { console.error(e.response?.data || e.message); process.exit(1); });
