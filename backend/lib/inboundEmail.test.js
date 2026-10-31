'use strict';
// Run: node backend/lib/inboundEmail.test.js
const { genToken, isAllowedSender, extractToken, htmlToText, stripQuotedReply, emailToText, senderDomain, isGmailForwardingVerification, extractGmailVerification, splitEmailAlerts, emailBodyText, forwardedSender, unwrapForwarded, resolveBankEmail, mapCloudflarePayload, verifyCloudflareSecret, parseRawEmail, expandBundle, rfc822FromJsonAttachments, isOutlookForwardingNotice, looksLikeForwardingNotice, classifyEmailAlertType } = require('./inboundEmail');

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

// --- digest email splitting (spec 3.6) ---
// A single alert (even with a balance line) stays one segment: never over-split.
const single = 'Debit Alert\nAmount: NGN5,000.00\nBalance: NGN12,000.00\nDate: 03/09/2026';
check('single alert -> 1 segment', splitEmailAlerts(single).length === 1);
const singleInline = 'You paid NGN5,000 to SHOPRITE on 03-Sep-2026. Bal: NGN12,000.';
check('single inline alert -> 1 segment', splitEmailAlerts(singleInline).length === 1);

// A table digest -> one segment per transaction row.
const table = [
  'Your transactions for today:',
  '03/09/2026 POS SHOPRITE NGN5,000.00 DR',
  '03/09/2026 TRANSFER FROM JOHN NGN20,000.00 CR',
  '03/09/2026 ATM WITHDRAWAL NGN10,000.00 DR',
].join('\n');
const tableSegs = splitEmailAlerts(table);
check('table digest -> 3 rows', tableSegs.length === 3);
check('table header excluded', !tableSegs.some((s) => /transactions for today/i.test(s)));
check('table row keeps its amount', tableSegs[0].includes('5,000.00'));

// A paragraph digest (blank-line blocks) -> one segment per block.
const paras = [
  'Debit: NGN5,000.00 to SHOPRITE on 03/09/2026.',
  '',
  'Credit: NGN20,000.00 from JOHN on 03/09/2026.',
].join('\n');
check('paragraph digest -> 2 blocks', splitEmailAlerts(paras).length === 2);
check('empty body -> 0 segments', splitEmailAlerts('').length === 0);

// emailBodyText excludes the subject (unlike emailToText).
check('emailBodyText no subject', emailBodyText({ text: 'plain body' }) === 'plain body');

// --- manual forwards (any provider) ---
// A hand-forwarded Gmail message: envelope From is the user; the bank is in the header.
const gmailFwd = [
  'Here you go',
  '',
  '---------- Forwarded message ----------',
  'From: GTBank <alerts@gtbank.com>',
  'Date: Wed, 3 Sep 2026 at 10:02',
  'Subject: Transaction Alert',
  'To: me <someone@yahoo.com>',
  '',
  'Debit Alert: NGN5,000.00 to SHOPRITE on 03-Sep-2026. Bal: NGN12,000.00',
].join('\n');
check('forwardedSender finds bank', forwardedSender(gmailFwd) === 'alerts@gtbank.com');
check('unwrapForwarded drops headers', !/forwarded message|Subject:|To:/i.test(unwrapForwarded(gmailFwd)));
check('unwrapForwarded keeps alert', /5,000\.00/.test(unwrapForwarded(gmailFwd)) && /SHOPRITE/.test(unwrapForwarded(gmailFwd)));

// Apple Mail style marker.
const appleFwd = [
  'Begin forwarded message:',
  'From: Access Bank <noreply@accessbankplc.com>',
  'Subject: Debit Alert',
  '',
  'Acct debited NGN2,500.00 for AIRTIME.',
].join('\n');
check('apple forwardedSender', forwardedSender(appleFwd) === 'noreply@accessbankplc.com');
check('apple unwrap keeps body', /2,500\.00/.test(unwrapForwarded(appleFwd)));

// resolveBankEmail: manual forward from a Yahoo mailbox still resolves to the bank.
const r1 = resolveBankEmail({ subject: 'Fwd: Transaction Alert', text: gmailFwd, from: 'me <someone@yahoo.com>' });
check('resolve manual-forward sender', r1 && r1.sender === 'alerts@gtbank.com');
check('resolve manual-forward body has amount', r1 && /5,000\.00/.test(r1.fullText));
// A direct/auto-forward (envelope From is the bank) resolves straight through.
const r2 = resolveBankEmail({ subject: 'Alert', text: 'Debit NGN1,000 POS', from: 'GTBank <alerts@gtbank.com>' });
check('resolve direct sender', r2 && r2.sender === 'GTBank <alerts@gtbank.com>');
// A forward of non-bank mail (no bank in headers) is dropped.
const r3 = resolveBankEmail({ text: 'just a note from a friend', from: 'me@yahoo.com' });
check('resolve non-bank -> null', r3 === null);
// No forwarded marker + non-bank From -> null (a bare signature "From:" must not pass).
const r4 = resolveBankEmail({ text: 'Regards,\nFrom: John', from: 'me@outlook.com' });
check('resolve bare From not a bank', r4 === null);

// --- Cloudflare Email Worker mapping + auth (round 6 part F) ---
const cfBody = { to: 'a123abc@in.automonie.com', from: 'GTBank <alerts@gtbank.com>', subject: 'Debit Alert', text: 'NGN5,000 debited', html: '<p>NGN5,000</p>', date: '2026-10-26T10:00:00.000Z' };
const mapped = mapCloudflarePayload(cfBody);
check('cf mapping: recipient from to', mapped.recipient === 'a123abc@in.automonie.com');
check('cf mapping: from passthrough', mapped.from === 'GTBank <alerts@gtbank.com>');
check('cf mapping: subject/text/html passthrough', mapped.subject === 'Debit Alert' && mapped.text === 'NGN5,000 debited' && mapped.html === '<p>NGN5,000</p>');
check('cf mapping: sentAt from date', mapped.sentAt === '2026-10-26T10:00:00.000Z');
check('cf mapping: token still extracts', extractToken(mapped.recipient) === 'a123abc');

const cfBodyCc = { envelopeTo: '', headerTo: 'someone@else.com', cc: 'a123abc@in.automonie.com', from: 'x@y.com' };
const mappedCc = mapCloudflarePayload(cfBodyCc);
check('cf mapping: falls back through to/envelopeTo/headerTo/cc', mappedCc.recipient.includes('a123abc@in.automonie.com'));
check('cf mapping: no date -> null sentAt', mapCloudflarePayload({ to: 'a@in.automonie.com' }).sentAt === null);
check('cf mapping: missing fields default to empty strings', mapCloudflarePayload({}).from === '' && mapCloudflarePayload({}).subject === '');

check('cf secret: matching value passes', verifyCloudflareSecret('topsecret123', 'topsecret123'));
check('cf secret: mismatched value fails', verifyCloudflareSecret('wrong', 'topsecret123') === false);
check('cf secret: empty received fails', verifyCloudflareSecret('', 'topsecret123') === false);
check('cf secret: empty expected fails (feature off)', verifyCloudflareSecret('anything', '') === false);
check('cf secret: both empty fails', verifyCloudflareSecret('', '') === false);
check('cf secret: different length fails without throwing', verifyCloudflareSecret('short', 'muchlongersecretvalue') === false);

// Raw email from the Worker (message/rfc822): parsed here, token read from the envelope.
(async () => {
  const raw = Buffer.from('From: GTBank <gens@gtbank.com>\r\nTo: Me <me@gmail.com>\r\nSubject: GeNS Debit Alert\r\nContent-Type: text/plain\r\n\r\nAmt: NGN5,000.00 Desc: POS SHOPRITE\r\n');
  const p = await parseRawEmail(raw, { to: 'abc123@in.automonie.com', from: 'me@gmail.com' });
  check('raw: sender from the From header', p.from === 'gens@gtbank.com');
  check('raw: subject and text', p.subject === 'GeNS Debit Alert' && /NGN5,000\.00/.test(p.text));
  check('raw: envelope address carries the token', extractToken(mapCloudflarePayload(p).recipient) === 'abc123');
  check('domains: new and legacy both accepted during a move', extractToken('abc123@inbox.example.com', ['inbox.example.com', 'in.automonie.com']) === 'abc123' && extractToken('abc123@in.automonie.com', ['inbox.example.com', 'in.automonie.com']) === 'abc123');
  check('domains: any other domain refused', extractToken('abc123@evil.com', ['inbox.example.com', 'in.automonie.com']) === '');
  // --- "Forward as attachment" bundle: 3 bank alerts attached to one forward ---
  const alert = (from, subj, body, date) => `From: ${from}\r\nTo: Me <me@gmail.com>\r\nSubject: ${subj}\r\nDate: ${date}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`;
  const inner = [
    alert('GTBank <gens@gtbank.com>', 'GeNS Debit Alert', 'Amt: NGN5,000.00 Desc: POS SHOPRITE', 'Mon, 05 Oct 2026 10:00:00 +0100'),
    alert('Access <alerts@accessbankplc.com>', 'Credit Alert', 'Amt: NGN20,000.00 Desc: Salary', 'Tue, 06 Oct 2026 09:00:00 +0100'),
    alert('OPay <no-reply@opayweb.com>', 'Payment', 'You paid NGN1,200.00 to Bolt', 'Wed, 07 Oct 2026 18:30:00 +0100'),
  ];
  const bnd = 'BOUNDARY42';
  const outer = [
    'From: Me <me@gmail.com>', 'To: abc123@automonie.app', 'Subject: Fwd: 3 alerts', 'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${bnd}"`, '',
    `--${bnd}`, 'Content-Type: text/plain', '', 'Here are my old alerts.',
    ...inner.flatMap((m, i) => [`--${bnd}`, 'Content-Type: message/rfc822', `Content-Disposition: attachment; filename="alert${i + 1}.eml"`, '', m]),
    `--${bnd}--`, '',
  ].join('\r\n');
  const op = await parseRawEmail(Buffer.from(outer), { to: 'abc123@automonie.app', from: 'me@gmail.com' });
  check('bundle: outer carries 3 attached emails', op.attached.length === 3);
  const parts = await expandBundle(op, { to: 'abc123@automonie.app', from: 'me@gmail.com' });
  check('bundle: 3 emails come out', parts.length === 3);
  check('bundle: each keeps its own sender', parts.map((x) => x.from).join('|') === 'gens@gtbank.com|alerts@accessbankplc.com|no-reply@opayweb.com');
  check('bundle: each keeps its own date', parts.map((x) => new Date(x.date).toISOString().slice(0, 10)).join('|') === '2026-10-05|2026-10-06|2026-10-07');
  check('bundle: each is mapped to the user token', parts.every((x) => extractToken(mapCloudflarePayload(x).recipient, ['automonie.app']) === 'abc123'));
  check('bundle: inner emails are not expanded again', parts.every((x) => x.attached.length === 0));
  check('bundle: plain email has none', (await expandBundle(p, {})).length === 0);
  const pm = rfc822FromJsonAttachments([{ ContentType: 'message/rfc822', Content: Buffer.from(inner[0]).toString('base64') }, { ContentType: 'image/png', Content: 'xx' }, null]);
  check('bundle: Postmark attachments decode, others ignored', pm.length === 1 && /GeNS Debit/.test(pm[0].toString()));
  const pmParts = await expandBundle({ attached: pm }, { to: 'abc123@automonie.app' });
  check('bundle: Postmark attachment parses', pmParts.length === 1 && pmParts[0].from === 'gens@gtbank.com');
  // --- round 9 part A3: Outlook forwarding notice ---
  check('outlook notice: microsoft.com sender detected', isOutlookForwardingNotice('Microsoft account team <account-security-noreply@microsoft.com>'));
  check('outlook notice: accountprotection.microsoft.com detected', isOutlookForwardingNotice('no-reply@accountprotection.microsoft.com'));
  check('outlook notice: a bank is not mistaken for one', isOutlookForwardingNotice('alerts@gtbank.com') === false);
  check('outlook notice: body must actually mention forwarding', looksLikeForwardingNotice({ subject: 'New sign-in to your account', text: 'We noticed a new sign-in.' }) === false);
  check('outlook notice: forwarding mention matches', looksLikeForwardingNotice({ subject: 'A forwarding rule was added to your account', text: '' }));

  // --- round 9 part A1: email alert-type classifier ---
  check('classify: a parsed transaction is debit_credit', classifyEmailAlertType({ createdCount: 1, subject: 'Debit Alert', bodyText: '' }) === 'debit_credit');
  check('classify: an OTP sender is excluded', classifyEmailAlertType({ createdCount: 0, subject: 'Your OTP', bodyText: 'Your one-time password is 123456' }) === 'otp');
  check('classify: a newsletter is excluded', classifyEmailAlertType({ createdCount: 0, subject: 'This week in savings', bodyText: 'Unsubscribe here' }) === 'promo');
  check('classify: a statement subject with nothing parsed', classifyEmailAlertType({ createdCount: 0, subject: 'Your monthly Statement', bodyText: '' }) === 'e_statement');
  check('classify: nothing recognisable is unknown, not guessed into a type', classifyEmailAlertType({ createdCount: 0, subject: 'Hi', bodyText: 'just saying hello' }) === 'unknown');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
