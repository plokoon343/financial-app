// Subscription cancellation playbooks + verification (spec C1). Detecting a forgotten
// subscription is passive; CANCELLING it is the action people pay for. Full API
// cancellation barely exists in Nigeria, so we deliver an ASSISTED flow: exact steps
// per provider, then we VERIFY the charge actually stops by watching the ledger.
// Pure + dependency-free so it can be unit-tested; server.js supplies the data.

// method: how the user cancels — online (self-serve web), in_app (app store), phone,
// bank (card/mandate side). steps: concrete, ordered actions. Each entry matches by
// any keyword appearing in the subscription's name/description (lowercased).
const GUIDES = [
  { keys: ['netflix'], name: 'Netflix', method: 'online', url: 'https://www.netflix.com/cancelplan',
    steps: ['Sign in at netflix.com', 'Open Account → Membership', 'Tap “Cancel Membership” and confirm', 'You keep access until the current period ends'] },
  { keys: ['spotify'], name: 'Spotify', method: 'online', url: 'https://www.spotify.com/account/subscription/',
    steps: ['Sign in at spotify.com/account', 'Under “Your plan”, choose “Change plan”', 'Select Spotify Free → Cancel Premium', 'Confirm — you drop to Free at the next billing date'] },
  { keys: ['youtube', 'yt premium'], name: 'YouTube Premium', method: 'online', url: 'https://www.youtube.com/paid_memberships',
    steps: ['Go to youtube.com/paid_memberships (signed in)', 'Click Manage membership → Deactivate', 'Confirm cancellation'] },
  { keys: ['apple', 'itunes', 'icloud', 'app store'], name: 'Apple / App Store', method: 'in_app', url: 'https://apps.apple.com/account/subscriptions',
    steps: ['On iPhone: Settings → tap your name → Subscriptions', 'Pick the subscription', 'Tap “Cancel Subscription” and confirm', 'Charges through Apple can ONLY be cancelled here, not in the app itself'] },
  { keys: ['google play', 'google one', 'play store'], name: 'Google Play', method: 'in_app', url: 'https://play.google.com/store/account/subscriptions',
    steps: ['Open the Play Store app → profile → Payments & subscriptions → Subscriptions', 'Pick the subscription', 'Tap Cancel subscription and confirm'] },
  { keys: ['dstv', 'multichoice'], name: 'DStv', method: 'online', url: 'https://www.dstv.com',
    steps: ['Simplest: just don’t renew — DStv stops when you don’t pay for the next month', 'To stop auto-renew: log in to the DStv app/website → Account', 'Or dial the MultiChoice line / use the DStv app “Manage” option', 'Turn off any auto-pay / card mandate so it can’t recharge'] },
  { keys: ['gotv'], name: 'GOtv', method: 'online', url: 'https://www.gotvafrica.com',
    steps: ['GOtv only runs while paid — skip the next payment to stop it', 'Turn off any saved-card auto-renew in the GOtv/MyGOtv app', 'Confirm no card mandate remains (see the bank step below)'] },
  { keys: ['showmax'], name: 'Showmax', method: 'online', url: 'https://www.showmax.com/account',
    steps: ['Sign in at showmax.com → Account', 'Choose Cancel subscription', 'Confirm — access lasts until the paid period ends'] },
  { keys: ['prime video', 'amazon prime', 'amazon'], name: 'Amazon Prime', method: 'online', url: 'https://www.amazon.com/gp/primecentral',
    steps: ['Go to Amazon → Account → Prime Membership', 'Choose “End membership” / “Do not continue”', 'Confirm'] },
  { keys: ['canva'], name: 'Canva', method: 'online', url: 'https://www.canva.com/settings/billing-and-plans',
    steps: ['Sign in → Account settings → Billing & plans', 'Click “Cancel subscription”', 'Confirm'] },
  { keys: ['chatgpt', 'openai'], name: 'ChatGPT / OpenAI', method: 'in_app', url: 'https://chatgpt.com',
    steps: ['Open ChatGPT → your name → “My plan” / Settings → Subscription', 'Choose Cancel plan', 'Confirm — Plus stays active until the period ends'] },
  { keys: ['adobe'], name: 'Adobe', method: 'online', url: 'https://account.adobe.com/plans',
    steps: ['Sign in at account.adobe.com → Plans', 'Click Manage plan → Cancel plan', 'Note: Adobe may charge an early-termination fee on annual plans'] },
  { keys: ['microsoft', 'office 365', 'microsoft 365'], name: 'Microsoft 365', method: 'online', url: 'https://account.microsoft.com/services',
    steps: ['Sign in at account.microsoft.com → Services & subscriptions', 'Find the subscription → Manage → Turn off recurring billing / Cancel'] },
  { keys: ['linkedin'], name: 'LinkedIn Premium', method: 'online', url: 'https://www.linkedin.com/premium/manage',
    steps: ['Go to Me → Settings → Subscriptions, or linkedin.com/premium/manage', 'Click Cancel subscription', 'Confirm'] },
  { keys: ['audiomack'], name: 'Audiomack', method: 'in_app', url: '',
    steps: ['Cancel where you subscribed — Apple Subscriptions or Google Play Subscriptions (see those steps)', 'If billed directly, cancel in the Audiomack app → Account'] },
  { keys: ['boomplay'], name: 'Boomplay', method: 'in_app', url: '',
    steps: ['Open Boomplay → Me → VIP/Subscription', 'Turn off auto-renew', 'If billed via Apple/Google, cancel there too'] },
  { keys: ['gym', 'fitness', 'i-fitness', 'fitness club'], name: 'Gym membership', method: 'phone', url: '',
    steps: ['Gyms usually need written/in-person notice — call or email your branch', 'Ask them to stop the recurring card charge and confirm in writing', 'Then remove the card mandate with your bank (below) as a backstop'] },
];

// A generic, Nigeria-aware fallback — most stray subs are card mandates, so the key
// move is stopping the card from being charged.
const GENERIC = {
  name: '', method: 'bank',
  steps: [
    'Open the provider’s app or website and look for Account → Subscription → Cancel / Turn off auto-renew',
    'If you can’t find it, search “cancel <name>” for their exact steps',
    'As a backstop, stop the card charge: in your bank app freeze/replace the card or set its online limit to ₦0',
    'Ask your bank to cancel any recurring card mandate to this merchant',
  ],
};

const lc = (s) => (s || '').toString().toLowerCase();

// Find the cancellation guide for a subscription name/description.
function guideFor(name) {
  const n = lc(name);
  for (const g of GUIDES) {
    if (g.keys.some((k) => n.includes(k))) {
      const { keys, ...guide } = g;
      return { ...guide, matched: true };
    }
  }
  return { ...GENERIC, name: (name || '').toString().slice(0, 40), matched: false };
}

// Days to wait before we can say a cancellation stuck (one billing cycle + grace).
function cancelWindowDays(frequency) { return frequency === 'yearly' ? 375 : 40; }

// Did the cancellation take? chargedAfter = was there a matching charge dated AFTER
// the cancellation was requested. Pure so it can be unit-tested.
function verifyCancellation({ requestedAt, frequency = 'monthly', chargedAfter = false, now = new Date() } = {}) {
  if (!requestedAt) return { state: 'none', message: '' };
  if (chargedAfter) {
    return { state: 'still_charging', message: 'It charged again after you started cancelling — the cancellation may not have gone through. Try the steps again, then stop the card mandate.' };
  }
  const days = (new Date(now).getTime() - new Date(requestedAt).getTime()) / 86400000;
  const need = cancelWindowDays(frequency);
  if (days >= need) {
    return { state: 'confirmed', message: 'No charge since you cancelled — it looks like it stopped. 🎉' };
  }
  return { state: 'pending', message: `Watching for the next charge — we’ll confirm it stopped in about ${Math.max(1, Math.ceil(need - days))} more day(s).` };
}

module.exports = { guideFor, verifyCancellation, cancelWindowDays, GUIDES, GENERIC };
