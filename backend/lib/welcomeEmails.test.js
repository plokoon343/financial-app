'use strict';
// Run: node backend/lib/welcomeEmails.test.js
const { waitlistWelcome, newsletterWelcome } = require('./welcomeEmails');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const banned = /save automatically|auto-?save|autopay|we'?ll save for you/i;
const emoji = /\p{Extended_Pictographic}/u;

const w = waitlistWelcome({ name: 'Ada Obi', whatsappUrl: 'https://chat.whatsapp.com/x' });
check('waitlist greets by first name', w.html.includes('Hi Ada,') && w.text.startsWith('Hi Ada,'));
check('waitlist says what happens next', /What happens next/.test(w.html) && /invite is ready/.test(w.text));
check('waitlist links the community', w.html.includes('https://chat.whatsapp.com/x'));
check('waitlist without a name still reads well', waitlistWelcome({}).html.includes('Hi there,'));
const wGif = waitlistWelcome({ headerImageUrl: 'https://www.automonie.com/email/welcome.gif' });
check('header image has alt text', /<img src="https:\/\/www\.automonie\.com\/email\/welcome\.gif"[^>]*alt="You’re on the Automonie waitlist"/.test(wGif.html));
check('default header has alt text too', /<img src="[^"]+logo-full-light\.png"[^>]*alt="automonie"/.test(w.html));

const n = newsletterWelcome({ name: 'Tunde', unsubscribeUrl: 'https://api.automonie.com/unsubscribe?token=abc' });
check('newsletter has one-click unsubscribe in html and text', n.html.includes('unsubscribe?token=abc') && n.text.includes('unsubscribe?token=abc'));
let threw = false;
try { newsletterWelcome({}); } catch { threw = true; }
check('newsletter refuses to build without an unsubscribe link', threw);

const all = [w, n, wGif];
check('no emoji anywhere', all.every((e) => !emoji.test(e.subject + e.text + e.html)));
check('no banned words', all.every((e) => !banned.test(e.subject + e.text + e.html)));
check('no em dash', all.every((e) => !/—/.test(e.subject + e.text + e.html)));
check('a name is escaped', waitlistWelcome({ name: '<script>' }).html.includes('Hi &lt;script&gt;,'));
check('under 100 KB so Gmail never clips it', all.every((e) => Buffer.byteLength(e.html) < 100 * 1024));

// Brevo template versions carry placeholders, not values.
const tw = waitlistWelcome({ template: true });
const tn = newsletterWelcome({ template: true });
check('template: greeting placeholder with a fallback', tw.html.includes('{% if params.firstName %}Hi {{ params.firstName }},{% else %}Hi there,{% endif %}'));
check('template: community link placeholder', tw.html.includes('href="{{ params.whatsappUrl }}"'));
check('template: header image chosen at send time', tw.html.includes('{% if params.headerImageUrl %}<tr><td style="padding:0"><img src="{{ params.headerImageUrl }}"') && tw.html.includes('{% else %}'));
check('template: unsubscribe placeholder', tn.html.includes('href="{{ params.unsubscribeUrl }}"') && tn.text.includes('{{ params.unsubscribeUrl }}'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
