'use strict';
// Run: node backend/lib/billPay.test.js
const bp = require('./billPay');

let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`, extra); } };
const ON = { FEATURE_BILL_PAYMENTS: 'true', VTPASS_API_KEY: 'a', VTPASS_SECRET_KEY: 'b', VTPASS_PUBLIC_KEY: 'c', PAYSTACK_SECRET_KEY: 'd' };
const cfg = bp.config(ON);

check('off by default', !bp.config({}).enabled);
check('the flag alone is not enough (needs VTpass and Paystack keys)', !bp.config({ FEATURE_BILL_PAYMENTS: 'true' }).enabled && !bp.config({ ...ON, PAYSTACK_SECRET_KEY: '' }).enabled);
check('on with the flag and all keys', cfg.enabled && cfg.feeNaira === 0 && cfg.maxNaira === 50000);

const air = bp.validateOrder({ billType: 'airtime', serviceID: 'mtn', phone: '+234 803 123 4567', amount: 500 }, cfg);
check('airtime order, phone normalised', air.ok && air.order.phone === '08031234567' && air.order.amount === 500 && air.order.provider === 'MTN', air);
check('unknown bill type refused', !bp.validateOrder({ billType: 'betting', serviceID: 'mtn', phone: '08031234567', amount: 500 }, cfg).ok);
check('provider must belong to the bill type', !bp.validateOrder({ billType: 'airtime', serviceID: 'dstv', phone: '08031234567', amount: 500 }, cfg).ok);
check('bad phone refused', !bp.validateOrder({ billType: 'airtime', serviceID: 'mtn', phone: '12345', amount: 500 }, cfg).ok);
check('below the minimum refused', !bp.validateOrder({ billType: 'airtime', serviceID: 'mtn', phone: '08031234567', amount: 20 }, cfg).ok);
check('kobo refused (whole naira only)', !bp.validateOrder({ billType: 'airtime', serviceID: 'mtn', phone: '08031234567', amount: 100.5 }, cfg).ok);
check('data needs a plan', !bp.validateOrder({ billType: 'data', serviceID: 'mtn-data', phone: '08031234567' }, cfg).ok);
check('TV needs a smartcard', !bp.validateOrder({ billType: 'tv', serviceID: 'dstv', phone: '08031234567', variationCode: 'dstv-padi' }, cfg).ok);
const elec = bp.validateOrder({ billType: 'electricity', serviceID: 'ikeja-electric', phone: '08031234567', billersCode: '1234 5678 901', amount: 5000 }, cfg);
check('electricity: meter number cleaned, prepaid by default', elec.ok && elec.order.billersCode === '12345678901' && elec.order.meterType === 'prepaid', elec);

const data = bp.validateOrder({ billType: 'data', serviceID: 'mtn-data', phone: '08031234567', variationCode: 'mtn-1gb', amount: 1 }, cfg).order;
const priced = bp.priceOrder(data, [{ code: 'mtn-1gb', name: '1GB 30 days', amount: 1000 }], cfg);
check('data price comes from VTpass, not the client', priced.ok && priced.order.amount === 1000 && priced.chargeNaira === 1000, priced);
check('a plan VTpass does not offer is refused', !bp.priceOrder(data, [{ code: 'other', amount: 100 }], cfg).ok);
check('the fee is added to the card charge', bp.priceOrder(air.order, [], bp.config({ ...ON, BILLS_FEE_NAIRA: '50' })).chargeNaira === 550);
check('over the per-purchase cap refused', !bp.priceOrder({ ...air.order, amount: 60000 }, [], cfg).ok);

check('labels read naturally', bp.label(air.order) === 'MTN airtime for 08031234567' && /meter 12345678901/.test(bp.label(elec.order)));
const rid = bp.requestId(new Date('2026-10-11T23:30:00Z'), () => 0.123456789);
check('request id starts with the Lagos date and time', rid.startsWith('202610120030'), rid);
check('request ids differ', bp.requestId(new Date(), Math.random) !== bp.requestId(new Date(), Math.random));

const pAir = bp.vtpassPayload(air.order, 'R1');
check('airtime payload', pAir.serviceID === 'mtn' && pAir.amount === 500 && pAir.phone === '08031234567' && !pAir.variation_code);
check('electricity payload names the meter and type', bp.vtpassPayload(elec.order, 'R2').billersCode === '12345678901' && bp.vtpassPayload(elec.order, 'R2').variation_code === 'prepaid');
check('data payload carries the plan', bp.vtpassPayload(priced.order, 'R3').variation_code === 'mtn-1gb');

check('VTpass delivered', bp.readVtpass({ code: '000', content: { transactions: { status: 'delivered' } } }) === 'delivered');
check('VTpass 000 but still pending is pending', bp.readVtpass({ code: '000', content: { transactions: { status: 'pending' } } }) === 'pending');
check('VTpass 099 is pending', bp.readVtpass({ code: '099' }) === 'pending');
check('VTpass failed', bp.readVtpass({ code: '016', content: { transactions: { status: 'failed' } } }) === 'failed');
check('a clear VTpass error code is failed', bp.readVtpass({ code: '011', response_description: 'INVALID ARGUMENTS' }) === 'failed');
check('no reply is pending, never failed (no blind refund)', bp.readVtpass(null) === 'pending' && bp.readVtpass({}) === 'pending');

const rec = { _id: 'abc', chargeNaira: 550 };
const tx = { status: 'success', currency: 'NGN', amount: 55000, metadata: { purpose: 'bill', billPaymentId: 'abc' } };
check('the matching card payment passes', bp.checkCharge(tx, rec) === '');
check('an unpaid charge fails', bp.checkCharge({ ...tx, status: 'abandoned' }, rec) === 'not paid');
check('a short payment fails', bp.checkCharge({ ...tx, amount: 50000 }, rec) === 'wrong amount');
check('another purchase\'s payment fails', bp.checkCharge({ ...tx, metadata: { purpose: 'bill', billPaymentId: 'xyz' } }, rec) === 'not this purchase');
check('a Plus payment can\'t pay a bill', bp.checkCharge({ ...tx, metadata: { purpose: 'pro_subscription', billPaymentId: 'abc' } }, rec) === 'not this purchase');
check('wrong currency fails', bp.checkCharge({ ...tx, currency: 'USD' }, rec) === 'wrong currency');

console.log(`billPay: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
