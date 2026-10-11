'use strict';
// Run: node backend/lib/channel.test.js
const { isChannelName, cleanBank, channelFor, isAlertChannel } = require('./channel');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

check('SMS is a channel, not a bank', isChannelName('SMS') && isChannelName(' sms ') && isChannelName('Email') && isChannelName('Share'));
check('real banks are not channels', !isChannelName('GTBank') && !isChannelName('Allworkers MFB') && !isChannelName('OPay'));
check('cleanBank drops channel words', cleanBank('SMS') === '' && cleanBank('Email') === '' && cleanBank('Bank alerts') === '');
check('cleanBank keeps a bank', cleanBank(' Zenith ') === 'Zenith');
check('old SMS import becomes channel sms', channelFor({ source: 'import', bank: 'SMS' }) === 'sms');
check('statement upload is a statement', channelFor({ source: 'import', bank: 'GTBank' }) === 'statement');
check('explicit channel wins', channelFor({ channel: 'email', source: 'import', bank: 'SMS' }) === 'email');
check('unknown channel ignored', channelFor({ channel: 'fax', source: 'share' }) === 'share');
check('alert channels', isAlertChannel('sms') && isAlertChannel('email') && isAlertChannel('share') && !isAlertChannel('statement'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
