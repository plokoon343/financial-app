import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';

// In-app bill payments (Airtime, Data, TV, Electricity) paid from the wallet via
// the backend's VTpass integration. Inert (read-only notice) until the backend
// has VTPASS_* keys set.
const TYPES = [
  { id: 'airtime', label: 'Airtime', icon: 'fa-mobile-screen-button' },
  { id: 'data', label: 'Data', icon: 'fa-wifi' },
  { id: 'tv', label: 'TV', icon: 'fa-tv' },
  { id: 'electricity', label: 'Electricity', icon: 'fa-bolt' },
];

const authHeaders = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const PayBill = ({ onPaid }) => {
  const [enabled, setEnabled] = useState(true);
  const [sandbox, setSandbox] = useState(false);
  const [providers, setProviders] = useState({ airtime: [], data: [], tv: [], electricity: [] });

  const [billType, setBillType] = useState('airtime');
  const [serviceID, setServiceID] = useState('');
  const [variations, setVariations] = useState([]);
  const [loadingVars, setLoadingVars] = useState(false);
  const [variationCode, setVariationCode] = useState('');
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const [billersCode, setBillersCode] = useState('');     // smartcard / meter number
  const [meterType, setMeterType] = useState('prepaid');

  const [customerName, setCustomerName] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [paying, setPaying] = useState(false);
  const [message, setMessage] = useState(null);
  const [token, setToken] = useState('');

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 6000); };

  useEffect(() => {
    axios.get(`${API_URL}/api/bills/providers`, authHeaders())
      .then((r) => { setEnabled(r.data.enabled); setSandbox(r.data.sandbox); setProviders(r.data.providers || {}); })
      .catch(() => {});
  }, []);

  // Reset dependent fields whenever the bill type changes.
  const pickType = (t) => {
    setBillType(t); setServiceID(''); setVariations([]); setVariationCode('');
    setAmount(''); setBillersCode(''); setCustomerName(''); setToken(''); setMeterType('prepaid');
  };

  const loadVariations = useCallback(async (svc) => {
    if (!svc) return;
    setLoadingVars(true); setVariations([]); setVariationCode('');
    try {
      const r = await axios.get(`${API_URL}/api/bills/variations`, { ...authHeaders(), params: { serviceID: svc } });
      setVariations(r.data.variations || []);
    } catch {
      flash('Could not load plans for that provider.', 'error');
    } finally { setLoadingVars(false); }
  }, []);

  const pickService = (svc) => {
    setServiceID(svc); setVariationCode(''); setAmount(''); setCustomerName(''); setToken('');
    if (svc && (billType === 'data' || billType === 'tv')) loadVariations(svc);
  };

  const pickVariation = (code) => {
    setVariationCode(code);
    const v = variations.find((x) => x.code === code);
    if (v && v.amount) setAmount(String(v.amount));
  };

  const needsBillersCode = billType === 'tv' || billType === 'electricity';
  const needsVariation = billType === 'data' || billType === 'tv';

  const verify = async () => {
    if (!serviceID || !billersCode) { flash('Enter the number to verify.', 'error'); return; }
    setVerifying(true); setCustomerName('');
    try {
      const body = { serviceID, billersCode };
      if (billType === 'electricity') body.type = meterType;
      const r = await axios.post(`${API_URL}/api/bills/verify`, body, authHeaders());
      if (r.data.customerName) { setCustomerName(r.data.customerName); flash(`Verified: ${r.data.customerName}`); }
      else flash('Number found, but no name returned.', 'error');
    } catch (err) {
      flash(err.response?.data?.message || 'Could not verify.', 'error');
    } finally { setVerifying(false); }
  };

  const pay = async () => {
    if (!enabled) return;
    if (!serviceID) { flash('Select a provider.', 'error'); return; }
    const amt = Math.round(Number(amount));
    if (!amt || amt <= 0) { flash('Enter a valid amount.', 'error'); return; }
    if (!phone.trim()) { flash('Phone number is required.', 'error'); return; }
    if (needsVariation && !variationCode) { flash('Select a plan/bouquet.', 'error'); return; }
    if (needsBillersCode && !billersCode.trim()) { flash(billType === 'tv' ? 'Smartcard number is required.' : 'Meter number is required.', 'error'); return; }

    const provName = (providers[billType] || []).find((p) => p.id === serviceID)?.name || serviceID;
    if (!window.confirm(`Pay ${fmtNaira(amt)} for ${provName} from your wallet?`)) return;

    setPaying(true); setToken('');
    try {
      const body = { billType, serviceID, amount: amt, phone: phone.trim() };
      if (needsVariation) body.variationCode = variationCode;
      if (needsBillersCode) body.billersCode = billersCode.trim();
      if (billType === 'electricity') body.meterType = meterType;
      const r = await axios.post(`${API_URL}/api/bills/pay`, body, authHeaders());
      const pendingNote = r.data.status === 'pending' ? ' (pending confirmation)' : '';
      flash(`${r.data.description || 'Bill paid'} — ${fmtNaira(r.data.amount)}${pendingNote}.`);
      if (r.data.token) setToken(r.data.token);
      window.dispatchEvent(new CustomEvent('wallet-updated', { detail: { balance: r.data.balance } }));
      if (typeof onPaid === 'function') onPaid();
      // Reset the amount/recipient but keep the provider selected for repeat top-ups.
      if (billType === 'airtime' || billType === 'electricity') setAmount('');
    } catch (err) {
      flash(err.response?.data?.message || 'Payment failed.', 'error');
    } finally { setPaying(false); }
  };

  const provs = providers[billType] || [];

  return (
    <section className="paybill">
      <div className="pb-head">
        <h3><i className="fas fa-bolt"></i> Pay a bill</h3>
        {sandbox && <span className="pb-tag">Test mode</span>}
      </div>
      <p className="pb-sub">Top up airtime &amp; data, renew TV, or buy electricity — straight from your wallet.</p>

      {!enabled && (
        <div className="pb-notice">
          <i className="fas fa-circle-info"></i> Bill payments aren’t activated yet. You can preview the options; paying turns on once the provider keys are set.
        </div>
      )}
      {message && <div className={`pb-msg ${message.type}`}>{message.text}</div>}

      {/* Type tabs */}
      <div className="pb-tabs">
        {TYPES.map((t) => (
          <button key={t.id} className={`pb-tab ${billType === t.id ? 'on' : ''}`} onClick={() => pickType(t.id)}>
            <i className={`fas ${t.icon}`}></i> {t.label}
          </button>
        ))}
      </div>

      <div className="pb-grid">
        {/* Provider */}
        <div className="pb-field">
          <label>Provider</label>
          <select value={serviceID} onChange={(e) => pickService(e.target.value)}>
            <option value="">Select…</option>
            {provs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Plan / bouquet for data & TV */}
        {needsVariation && (
          <div className="pb-field">
            <label>{billType === 'tv' ? 'Bouquet' : 'Data plan'}</label>
            <select value={variationCode} onChange={(e) => pickVariation(e.target.value)} disabled={!serviceID || loadingVars}>
              <option value="">{loadingVars ? 'Loading…' : 'Select…'}</option>
              {variations.map((v) => <option key={v.code} value={v.code}>{v.name}{v.amount ? ` — ${fmtNaira(v.amount)}` : ''}</option>)}
            </select>
          </div>
        )}

        {/* Meter type for electricity */}
        {billType === 'electricity' && (
          <div className="pb-field">
            <label>Meter type</label>
            <select value={meterType} onChange={(e) => { setMeterType(e.target.value); setCustomerName(''); }}>
              <option value="prepaid">Prepaid</option>
              <option value="postpaid">Postpaid</option>
            </select>
          </div>
        )}

        {/* Smartcard / meter number + verify */}
        {needsBillersCode && (
          <div className="pb-field pb-verify">
            <label>{billType === 'tv' ? 'Smartcard / IUC number' : 'Meter number'}</label>
            <div className="pb-verify-row">
              <input value={billersCode} onChange={(e) => { setBillersCode(e.target.value); setCustomerName(''); }} placeholder={billType === 'tv' ? 'e.g. 1234567890' : 'e.g. 04210000000'} inputMode="numeric" />
              <button type="button" className="pb-verify-btn" onClick={verify} disabled={!enabled || verifying || !serviceID || !billersCode}>
                {verifying ? 'Verifying…' : 'Verify'}
              </button>
            </div>
            {customerName && <span className="pb-customer"><i className="fas fa-circle-check"></i> {customerName}</span>}
          </div>
        )}

        {/* Recipient phone */}
        <div className="pb-field">
          <label>{billType === 'airtime' || billType === 'data' ? 'Recipient phone' : 'Contact phone'}</label>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08012345678" inputMode="tel" />
        </div>

        {/* Amount — free for airtime & electricity, fixed for data & TV */}
        <div className="pb-field">
          <label>Amount {needsVariation && <span className="pb-hint">(set by plan)</span>}</label>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder={needsVariation ? 'Select a plan' : 'e.g. 1000'}
            inputMode="numeric"
            readOnly={needsVariation}
          />
        </div>
      </div>

      {token && (
        <div className="pb-token">
          <span>Token</span>
          <strong>{token}</strong>
        </div>
      )}

      <button className="pb-pay" onClick={pay} disabled={!enabled || paying}>
        <i className="fas fa-bolt"></i> {paying ? 'Processing…' : amount ? `Pay ${fmtNaira(Math.round(Number(amount)) || 0)}` : 'Pay'}
      </button>

      <style jsx="true">{`
        .paybill { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 18px; margin-bottom: 22px; }
        .pb-head { display: flex; align-items: center; gap: 10px; }
        .pb-head h3 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); font-size: 1.15rem; }
        .pb-tag { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.5px; background: rgba(245,158,11,0.15); color: #f59e0b; padding: 3px 8px; border-radius: var(--radius-full); font-weight: 700; }
        .pb-sub { color: var(--text-secondary); font-size: 0.88rem; margin: 4px 0 14px; }
        .pb-notice { display: flex; align-items: center; gap: 8px; background: var(--glass-bg); border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: var(--radius-md); padding: 10px 12px; font-size: 0.85rem; margin-bottom: 12px; }
        .pb-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 12px; font-size: 0.9rem; }
        .pb-msg.success { background: rgba(34,197,94,0.12); color: #22c55e; }
        .pb-msg.error { background: rgba(239,68,68,0.12); color: #ef4444; }
        .pb-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
        .pb-tab { display: flex; align-items: center; gap: 7px; background: var(--bg-input); color: var(--text-secondary); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 9px 16px; cursor: pointer; font-weight: 600; font-size: 0.9rem; }
        .pb-tab.on { background: var(--gradient-primary); color: #fff; border-color: transparent; }
        .pb-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .pb-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
        .pb-field.pb-verify { grid-column: 1 / -1; }
        .pb-field label { font-size: 0.8rem; color: var(--text-secondary); font-weight: 600; }
        .pb-hint { color: var(--text-faint); font-weight: 500; }
        .pb-field select, .pb-field input { background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 13px; width: 100%; font-size: 0.95rem; }
        .pb-field input[readonly] { opacity: 0.75; }
        .pb-verify-row { display: flex; gap: 8px; }
        .pb-verify-row input { flex: 1; }
        .pb-verify-btn { background: var(--glass-bg); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 0 18px; font-weight: 600; cursor: pointer; white-space: nowrap; }
        .pb-verify-btn:disabled { opacity: 0.5; cursor: default; }
        .pb-customer { display: inline-flex; align-items: center; gap: 6px; color: #22c55e; font-size: 0.85rem; font-weight: 600; margin-top: 2px; }
        .pb-token { display: flex; align-items: center; gap: 12px; background: var(--glass-bg); border: 1px dashed var(--border-color); border-radius: var(--radius-md); padding: 12px 14px; margin-top: 14px; }
        .pb-token span { color: var(--text-secondary); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.5px; }
        .pb-token strong { color: var(--text-primary); font-size: 1.15rem; letter-spacing: 1px; word-break: break-all; }
        .pb-pay { margin-top: 16px; width: 100%; background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 13px; font-weight: 700; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 9px; }
        .pb-pay:disabled { opacity: 0.5; cursor: default; }
        @media (max-width: 600px) { .pb-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  );
};

export default PayBill;
