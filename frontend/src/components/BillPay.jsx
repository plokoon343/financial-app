import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import Select from './Select';

// Buy airtime or data, or pay for TV or electricity (shown only when the server has
// the feature on). Card pass-through: you pay the exact amount by card on Paystack and
// we buy it the moment the payment is confirmed. If the provider declines, the card
// payment is refunded. Nothing is stored in Automonie.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const PENDING = 'billpay_pending_ref';
const TYPES = [['airtime', 'Airtime'], ['data', 'Data'], ['tv', 'TV'], ['electricity', 'Electricity']];
const STATUS = {
  completed: 'Done',
  pending: 'Waiting for the provider to confirm. We’ll keep checking.',
  refunded: 'It didn’t go through, so your card payment is being refunded.',
  refund_pending: 'It didn’t go through. We’re refunding your card payment.',
  awaiting_payment: 'Your card payment hasn’t come through yet.',
  paying: 'Buying it now…',
};

export default function BillPay() {
  const [cfg, setCfg] = useState(null);
  const [type, setType] = useState('airtime');
  const [form, setForm] = useState({ serviceID: '', phone: '', amount: '', variationCode: '', billersCode: '', meterType: 'prepaid' });
  const [plans, setPlans] = useState([]);
  const [customer, setCustomer] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = () => axios.get(`${API_URL}/api/billpay/history`, auth()).then((r) => setHistory(r.data.items || [])).catch(() => {});
  useEffect(() => {
    axios.get(`${API_URL}/api/billpay/config`, auth()).then((r) => setCfg(r.data)).catch(() => {});
    loadHistory();
    // Back from Paystack: confirm the card payment, then show what happened.
    const ref = new URLSearchParams(window.location.search).get('reference') || sessionStorage.getItem(PENDING);
    if (ref) {
      sessionStorage.removeItem(PENDING);
      window.history.replaceState(null, '', window.location.pathname);
      setBusy('confirm');
      axios.post(`${API_URL}/api/billpay/confirm`, { reference: ref }, auth())
        .then((r) => { setResult(r.data.bill); loadHistory(); })
        .catch((e) => setError(e.response?.data?.message || 'We couldn’t confirm the payment yet. We’ll keep checking.'))
        .finally(() => setBusy(''));
    }
  }, []);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); if (k === 'billersCode' || k === 'serviceID') setCustomer(''); };
  const pickType = (t) => { setType(t); setForm((f) => ({ ...f, serviceID: '', variationCode: '', amount: '', billersCode: '' })); setPlans([]); setCustomer(''); setError(''); };

  useEffect(() => {
    if (!form.serviceID || !['data', 'tv'].includes(type)) return;
    axios.get(`${API_URL}/api/billpay/variations`, { ...auth(), params: { serviceID: form.serviceID } })
      .then((r) => setPlans(r.data.variations || [])).catch(() => setError('Could not load the plans. Try again.'));
  }, [form.serviceID, type]);

  if (!cfg?.enabled) return null;
  const plan = plans.find((p) => p.code === form.variationCode);
  const amount = ['data', 'tv'].includes(type) ? (plan?.amount || 0) : Number(form.amount) || 0;
  const charge = amount ? amount + (cfg.feeNaira || 0) : 0;
  const needsCode = type === 'tv' || type === 'electricity';

  const check = async () => {
    setBusy('verify'); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/billpay/verify`, { billType: type, ...form }, auth());
      setCustomer(data.customerName || 'Number confirmed');
    } catch (e) { setError(e.response?.data?.message || 'Could not check that number.'); } finally { setBusy(''); }
  };
  const pay = async () => {
    setBusy('pay'); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/billpay/checkout`, { billType: type, ...form, amount: Number(form.amount) || undefined }, auth());
      sessionStorage.setItem(PENDING, data.reference);
      window.location.href = data.authorization_url;
    } catch (e) { setError(e.response?.data?.message || 'Could not start the payment.'); setBusy(''); }
  };

  return (
    <section className="bp">
      <h3>Buy airtime or pay a bill</h3>
      <p className="bp-sub">You pay by card on Paystack and we buy it straight away. If the provider declines, your payment is refunded.</p>

      {result && (
        <div className={`bp-result ${result.status === 'completed' ? 'ok' : ''}`} role="status">
          <strong>{result.description}</strong>
          <span>{STATUS[result.status] || result.status}</span>
          {result.token && <span className="bp-token">Token: {result.token}</span>}
        </div>
      )}
      {error && <div className="message error" role="alert">{error}</div>}

      <div className="bp-tabs" role="tablist">
        {TYPES.map(([k, l]) => <button key={k} role="tab" aria-selected={type === k} className={type === k ? 'on' : ''} onClick={() => pickType(k)}>{l}</button>)}
      </div>

      <div className="bp-form">
        <label>Provider
          <Select value={form.serviceID} onChange={set('serviceID')}>
            <option value="">Choose…</option>
            {cfg.providers[type].map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </label>
        {needsCode && (
          <label>{type === 'tv' ? 'Smartcard number' : 'Meter number'}
            <span className="bp-row">
              <input inputMode="numeric" value={form.billersCode} onChange={set('billersCode')} />
              <button className="btn-secondary" type="button" onClick={check} disabled={!form.serviceID || !form.billersCode || busy === 'verify'}>Check</button>
            </span>
            {customer && <span className="bp-customer">{customer}</span>}
          </label>
        )}
        {type === 'electricity' && (
          <label>Meter type
            <Select value={form.meterType} onChange={set('meterType')}><option value="prepaid">Prepaid</option><option value="postpaid">Postpaid</option></Select>
          </label>
        )}
        {['data', 'tv'].includes(type) ? (
          <label>{type === 'tv' ? 'Bouquet' : 'Plan'}
            <Select value={form.variationCode} onChange={set('variationCode')} disabled={!plans.length}>
              <option value="">Choose…</option>
              {plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {fmtNaira(p.amount)}</option>)}
            </Select>
          </label>
        ) : (
          <label>Amount (₦)
            <input inputMode="numeric" value={form.amount} onChange={set('amount')} placeholder={`From ${fmtNaira(cfg.minNaira[type])}`} />
          </label>
        )}
        <label>Phone number{type === 'airtime' || type === 'data' ? ' to top up' : ' for the receipt'}
          <input type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="08031234567" />
        </label>
        {charge > 0 && <p className="bp-sub">You’ll pay {fmtNaira(charge)} by card{cfg.feeNaira ? ` (including a ${fmtNaira(cfg.feeNaira)} fee)` : ''}.</p>}
        <button className="btn-primary" onClick={pay} disabled={!charge || !form.serviceID || !form.phone || (needsCode && !form.billersCode) || busy === 'pay' || busy === 'confirm'}>
          {busy === 'pay' ? 'Opening Paystack…' : busy === 'confirm' ? 'Confirming…' : charge ? `Pay ${fmtNaira(charge)}` : 'Pay'}
        </button>
      </div>

      {history.length > 0 && (
        <div className="bp-history">
          <h4>Recent purchases</h4>
          {history.slice(0, 6).map((h) => (
            <div key={h.id} className="bp-h"><span>{h.description}</span><span className="bp-sub">{fmtNaira(h.chargeNaira)} · {STATUS[h.status]?.split('.')[0] || h.status}</span></div>
          ))}
        </div>
      )}

      <style>{`
        .bp { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; display: grid; gap: 12px; margin-bottom: 18px; color: var(--text-primary); }
        .bp h3 { margin: 0; } .bp h4 { margin: 0 0 6px; font-size: 0.9rem; }
        .bp-sub { color: var(--text-secondary); font-size: 0.85rem; margin: 0; }
        .bp-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .bp-tabs button { min-height: 40px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border-color); background: none; color: var(--text-secondary); font: inherit; font-weight: 600; cursor: pointer; }
        .bp-tabs button.on { border-color: var(--accent-primary); color: var(--accent-primary); }
        .bp-form { display: grid; gap: 10px; max-width: 440px; }
        .bp-form label { display: grid; gap: 6px; color: var(--text-secondary); font-size: 0.85rem; font-weight: 600; }
        .bp-form input, .bp-form select { min-height: 44px; padding: 8px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-input, var(--bg-card)); color: var(--text-primary); font: inherit; }
        .bp-row { display: flex; gap: 8px; } .bp-row input { flex: 1; }
        .bp-customer { color: var(--accent-primary); font-weight: 700; }
        .bp-result { display: grid; gap: 4px; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); }
        .bp-result.ok { border-color: var(--accent-primary); }
        .bp-token { font-family: monospace; font-size: 1rem; color: var(--text-primary); }
        .bp-h { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--border-color); font-size: 0.88rem; }
      `}</style>
    </section>
  );
}
