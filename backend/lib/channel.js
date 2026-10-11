// How a transaction reached us (its channel) is metadata, never a bank. Older imports
// were saved with bank "SMS" (the mobile SMS scan sent that as the batch label), so a
// channel showed up in bank lists as if it were a bank. These helpers keep the two
// apart: cleanBank() drops a channel word used as a bank name, channelFor() works out
// the channel from the source and the old label.

const CHANNELS = ['statement', 'sms', 'email', 'share', 'notification', 'receipt', 'manual', 'bank_sync'];

const WORDS = {
  sms: 'sms', text: 'sms', texts: 'sms', 'text message': 'sms', 'text messages': 'sms', alert: 'sms', alerts: 'sms', 'bank alert': 'sms', 'bank alerts': 'sms', paste: 'sms', pasted: 'sms',
  email: 'email', 'e-mail': 'email', emails: 'email', mail: 'email',
  share: 'share', shared: 'share',
  notification: 'notification', notifications: 'notification', push: 'notification',
  receipt: 'receipt', receipts: 'receipt',
  manual: 'manual',
};

// The channel a word names, or '' when it is not a channel word.
function channelWord(name) {
  const k = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return WORDS[k] || '';
}
const isChannelName = (name) => !!channelWord(name);

// A bank name that is safe to store: '' when it is really a channel word.
function cleanBank(name) {
  const s = String(name || '').trim();
  return isChannelName(s) ? '' : s;
}

const SOURCE_CHANNEL = { import: 'statement', sms: 'sms', email: 'email', share: 'share', notification: 'notification', receipt: 'receipt', manual: 'manual' };

// The channel for a row: an explicit one wins, then an old channel-word bank label
// ("SMS"), then the source.
function channelFor({ channel, source, bank } = {}) {
  if (CHANNELS.includes(channel)) return channel;
  return channelWord(bank) || SOURCE_CHANNEL[source] || '';
}

const ALERT_CHANNELS = new Set(['sms', 'email', 'share', 'notification']);
const isAlertChannel = (c) => ALERT_CHANNELS.has(c);

module.exports = { CHANNELS, channelWord, isChannelName, cleanBank, channelFor, isAlertChannel };
