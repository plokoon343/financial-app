'use strict';

// Airtime, data, TV and electricity purchases (behind FEATURE_BILL_PAYMENTS, off by
// default). Card pass-through only: the user pays the exact amount by card through
// Paystack, and only once the server has confirmed that payment with Paystack does it
// buy from VTpass. Nothing is held in a wallet. If VTpass declines, the card payment is
// refunded through Paystack; if the outcome is unclear it is re-checked, never refunded
// blind (a refund after delivery would give the airtime away).
// Pure: the server does the HTTP calls; these decide what they mean.

const PROVIDERS = {
  airtime: [
    { id: 'mtn', name: 'MTN' }, { id: 'glo', name: 'Glo' },
    { id: 'airtel', name: 'Airtel' }, { id: 'etisalat', name: '9mobile' },
  ],
  data: [
    { id: 'mtn-data', name: 'MTN Data' }, { id: 'glo-data', name: 'Glo Data' },
    { id: 'airtel-data', name: 'Airtel Data' }, { id: 'etisalat-data', name: '9mobile Data' },
  ],
  tv: [
    { id: 'dstv', name: 'DStv' }, { id: 'gotv', name: 'GOtv' }, { id: 'startimes', name: 'StarTimes' },
  ],
  electricity: [
    { id: 'ikeja-electric', name: 'Ikeja Electric (IKEDC)' }, { id: 'eko-electric', name: 'Eko Electric (EKEDC)' },
    { id: 'abuja-electric', name: 'Abuja Electric (AEDC)' }, { id: 'kano-electric', name: 'Kano Electric (KEDCO)' },
    { id: 'portharcourt-electric', name: 'Port Harcourt Electric (PHED)' }, { id: 'ibadan-electric', name: 'Ibadan Electric (IBEDC)' },
    { id: 'enugu-electric', name: 'Enugu Electric (EEDC)' }, { id: 'benin-electric', name: 'Benin Electric (BEDC)' },
    { id: 'jos-electric', name: 'Jos Electric (JED)' }, { id: 'kaduna-electric', name: 'Kaduna Electric (KAEDCO)' },
  ],
};
// The spending category the purchase is recorded under.
const CATEGORY = { airtime: 'Airtime & Data', data: 'Airtime & Data', tv: 'Subscriptions', electricity: 'Utilities' };

function config(env = process.env) {
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
  return {
    enabled: env.FEATURE_BILL_PAYMENTS === 'true' && !!(env.VTPASS_API_KEY && env.VTPASS_SECRET_KEY && env.VTPASS_PUBLIC_KEY) && !!env.PAYSTACK_SECRET_KEY,
    sandbox: env.VTPASS_SANDBOX === 'true' || env.VTPASS_SANDBOX === '1',
    feeNaira: Math.max(0, Number(env.BILLS_FEE_NAIRA) || 0),
    maxNaira: num(env.BILLS_MAX_NAIRA, 50000),
    minNaira: { airtime: 50, data: 50, tv: 500, electricity: num(env.BILLS_MIN_ELECTRICITY_NAIRA, 1000) },
  };
}

const PHONE = /^0[789][01]\d{8}$/;
const normalizePhone = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  return d.startsWith('234') && d.length === 13 ? `0${d.slice(3)}` : d;
};

// Check an order from the client. Data and TV prices come from VTpass (the server
// looks them up), so `amount` only counts for airtime and electricity.
// Returns { ok: true, order } or { ok: false, message }.
function validateOrder(body, cfg = config()) {
  const b = body || {};
  const billType = String(b.billType || '');
  if (!PROVIDERS[billType]) return { ok: false, message: 'Choose what to pay for.' };
  const provider = PROVIDERS[billType].find((p) => p.id === b.serviceID);
  if (!provider) return { ok: false, message: 'Choose a provider.' };
  const phone = normalizePhone(b.phone);
  if (!PHONE.test(phone)) return { ok: false, message: 'Enter a valid Nigerian phone number, like 08031234567.' };
  const order = { billType, serviceID: provider.id, provider: provider.name, phone, billersCode: '', variationCode: '', amount: 0, meterType: '' };
  if (billType === 'tv' || billType === 'electricity') {
    order.billersCode = String(b.billersCode || '').replace(/\s/g, '');
    if (!/^\d{6,20}$/.test(order.billersCode)) return { ok: false, message: billType === 'tv' ? 'Enter the smartcard number.' : 'Enter the meter number.' };
  }
  if (billType === 'electricity') {
    order.meterType = b.meterType === 'postpaid' ? 'postpaid' : 'prepaid';
  }
  if (billType === 'data' || billType === 'tv') {
    order.variationCode = String(b.variationCode || '').trim();
    if (!order.variationCode) return { ok: false, message: billType === 'tv' ? 'Choose a bouquet.' : 'Choose a data plan.' };
  } else {
    const amt = Number(b.amount);
    if (!Number.isInteger(amt)) return { ok: false, message: 'Enter the amount in whole naira.' };
    if (amt < cfg.minNaira[billType]) return { ok: false, message: `The smallest amount is ₦${cfg.minNaira[billType].toLocaleString('en-NG')}.` };
    order.amount = amt;
  }
  return { ok: true, order };
}

// Set the price of a data plan or bouquet from VTpass's own list. Returns the order
// with its amount, or { ok: false, message } when the plan isn't offered.
function priceOrder(order, variations, cfg = config()) {
  if (order.billType === 'data' || order.billType === 'tv') {
    const v = (variations || []).find((x) => x.code === order.variationCode);
    if (!v || !(v.amount > 0)) return { ok: false, message: 'That plan isn’t available right now. Choose another.' };
    order = { ...order, amount: Math.round(v.amount), planName: v.name };
  }
  if (order.amount > cfg.maxNaira) return { ok: false, message: `The most you can pay at once is ₦${cfg.maxNaira.toLocaleString('en-NG')}.` };
  return { ok: true, order, chargeNaira: order.amount + cfg.feeNaira };
}

const label = (o) => (o.billType === 'airtime' ? `${o.provider} airtime for ${o.phone}`
  : o.billType === 'data' ? `${o.provider} ${o.planName || 'data'} for ${o.phone}`
  : o.billType === 'tv' ? `${o.provider} ${o.planName || 'subscription'} (${o.billersCode})`
  : `${o.provider} ${o.meterType} meter ${o.billersCode}`);

// VTpass needs request_id to start with the date and time in Lagos (YYYYMMDDHHmm).
function requestId(now = new Date(), rand = Math.random) {
  const d = new Date(now.getTime() + 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}AM${rand().toString(36).slice(2, 10)}`;
}

function vtpassPayload(order, reqId) {
  const p = { request_id: reqId, serviceID: order.serviceID, amount: order.amount, phone: order.phone };
  if (order.billType === 'data') p.billersCode = order.phone;
  if (order.billType === 'tv' || order.billType === 'electricity') p.billersCode = order.billersCode;
  if (order.variationCode) p.variation_code = order.variationCode;
  if (order.billType === 'tv') p.subscription_type = 'change';
  if (order.billType === 'electricity') p.variation_code = order.meterType;
  return p;
}

// What a VTpass /pay or /requery reply means: 'delivered', 'pending' or 'failed'.
// Anything unrecognised counts as pending (re-checked later), never as failed.
function readVtpass(data) {
  if (!data || typeof data !== 'object') return 'pending';
  const t = data.content?.transactions || {};
  if (data.code === '000' && t.status === 'delivered') return 'delivered';
  if (t.status === 'delivered') return 'delivered';
  if (data.code === '099' || ['pending', 'initiated'].includes(t.status)) return 'pending';
  if (t.status === 'failed' || t.status === 'reversed') return 'failed';
  if (data.code && data.code !== '000') return 'failed'; // a clear error code, nothing bought
  return 'pending';
}

// Is this Paystack transaction the card payment for this purchase, in full?
// Returns '' when it is, else the reason it isn't.
function checkCharge(tx, record) {
  if (!tx || tx.status !== 'success') return 'not paid';
  if (tx.currency && tx.currency !== 'NGN') return 'wrong currency';
  if (Number(tx.amount) !== Math.round(record.chargeNaira * 100)) return 'wrong amount';
  const m = tx.metadata || {};
  if (m.purpose !== 'bill' || String(m.billPaymentId || '') !== String(record._id)) return 'not this purchase';
  return '';
}

module.exports = { PROVIDERS, CATEGORY, config, validateOrder, priceOrder, label, requestId, vtpassPayload, readVtpass, checkCharge, normalizePhone };
