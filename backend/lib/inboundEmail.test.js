'use strict';
// Run: node backend/lib/inboundEmail.test.js
const { genToken, isAllowedSender, extractToken, htmlToText, stripQuotedReply, emailToText, senderDomain, isGmailForwardingVerification, extractGmailVerification } = require('./inboundEmail');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

// --- token ---
const tok = genToken();
check('token starts alpha + hex', /^a[0-9a-f]{18}$/.test(tok));
check('tokens differ', genToken() !== genToken());

// --- sender allowlist ---
check('gtbank allowed', isAllowedSender('GTBank Alert <alerts@gtbank.com>'));
check('subdomain allowed', isAllowedSender('noreply@e.alerts.gtbank.com'));
check('opay allowed', isAllowedSender('no-reply@opayweb.com'));
check('random blocked', isAllowedSender('scammer@totally-not-a-bank.com') === false);
check('empty blocked', isAllowedSender('') === false);
check('extra list allowed', isAllowedSender('x@mybank.test', ['mybank.test']));
check('senderDomain', senderDomain('Name <a@b.com>') === 'b.com');

// --- recipient token extraction ---
check('extract plain', extractToken('a123abc@in.automonie.com') === 'a123abc');
check('extract with name', extractToken('"Me" <a123abc@in.automonie.com>') === 'a123abc');
check('extract plus-addressing', extractToken('a123abc+gtb@in.automonie.com') === 'a123abc');
check('extract from To list', extractToken('someone@else.com, a123abc@in.automonie.com') === 'a123abc');
check('wrong domain -> empty', extractToken('a123abc@in.wrongdomain.com') === '');
check('custom domain', extractToken('tok@in.example.com', 'in.example.com') === 'tok');

// --- html -> text ---
check('html strips tags', htmlToText('<p>Debit <b>NGN5,000</b></p><div>Bal 1,000</div>').includes('Debit NGN5,000'));
check('html drops script', !htmlToText('<script>evil()</script><p>Hi</p>').toLowerCase().includes('evil'));
check('html decodes entities', htmlToText('<p>5&nbsp;000 &amp; more</p>').includes('&'));
check('html br -> newline', htmlToText('a<br>b').split('\n').length === 2);

// --- quoted reply stripping ---
const q = 'Debit NGN5,000 to SHOPRITE\nOn Mon, Jul 3 2026, Bank wrote:\n> old alert';
check('strip On..wrote', stripQuotedReply(q) === 'Debit NGN5,000 to SHOPRITE');
check('strip > quote', stripQuotedReply('new line\n> quoted') === 'new line');
check('strip original message', stripQuotedReply('new\n----- Original Message -----\nold') === 'new');

// --- emailToText (subject + body, quote stripped) ---
const combined = emailToText({ subject: 'Debit Alert', html: '<p>NGN5,000 to SHOPRITE</p>', text: '' });
check('emailToText prepends subject', combined.startsWith('Debit Alert') && combined.includes('NGN5,000'));
check('emailToText prefers text', emailToText({ subject: '', text: 'plain body', html: '<p>html</p>' }) === 'plain body');

// --- Gmail forwarding verification (spec 3.4) ---
check('gmail from detected', isGmailForwardingVerification('Gmail Team <forwarding-noreply@google.com>'));
check('gmail bare addr detected', isGmailForwardingVerification('forwarding-noreply@google.com'));
check('non-gmail not detected', isGmailForwardingVerification('alerts@gtbank.com') === false);
check('gmail is NOT an allowed bank sender', isAllowedSender('forwarding-noreply@google.com') === false);

const gmailText = [
  'automonie@gmail.com has requested to automatically forward mail to your address a123abc@in.automonie.com.',
  'Confirmation code: 123456789',
  'To allow automonie@gmail.com to automatically forward mail to your address, please click the link below:',
  'https://mail-settings.google.com/mail/vf-%5BANGjdJ_example%5D-abc123?vfe=1',
].join('\n');
const v = extractGmailVerification({ subject: '(#123456789) Gmail Forwarding Confirmation - Receive Mail', text: gmailText, html: '' });
check('gmail code extracted', v && v.code === '123456789');
check('gmail link extracted', v && v.link.startsWith('https://mail-settings.google.com/mail/vf-'));

// code only in subject, link only in an HTML href
const v2 = extractGmailVerification({
  subject: '(#987654321) Gmail Forwarding Confirmation',
  text: '',
  html: '<p>Click <a href="https://mail.google.com/mail/vf-%5Bxyz%5D?vfe=2&amp;foo=bar">here</a> to confirm.</p>',
});
check('gmail code from subject', v2 && v2.code === '987654321');
check('gmail link from href (entity decoded)', v2 && v2.link.includes('vf-') && v2.link.includes('&foo=bar') && !v2.link.includes('&amp;'));
check('gmail extractor null when absent', extractGmailVerification({ subject: 'hi', text: 'nothing here', html: '' }) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
