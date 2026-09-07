import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Bank accounts (spec Addendum A, slices 2 & 3) — web parity with the mobile screen.
// Names the accounts we fingerprinted from imports/alerts, and lets the user tag any
// sender the parser couldn't map to a bank (the learn-unknown-senders flywheel).

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [unknown, setUnknown] = useState([]);
  const [banks, setBanks] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [picks, setPicks] = useState({});          // senderKey -> chosen bankCode
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };

  const load = useCallback(async () => {
    try {
      const [ac, un, bk] = await Promise.all([
        axios.get(`${API_URL}/api/accounts`, headers),
        axios.get(`${API_URL}/api/senders/unknown`, headers).catch(() => null),
        axios.get(`${API_URL}/api/banks`, headers).catch(() => null),
      ]);
      setAccounts(ac.data.accounts || []);
      setDrafts(Object.fromEntries((ac.data.accounts || []).map((a) => [a.id, a.label])));
      if (un) setUnknown(un.data.senders || []);
      if (bk) setBanks(bk.data.banks || []);
    } catch { setError('Could not load your accounts.'); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 1800); };

  const saveName = async (a) => {
    const label = (drafts[a.id] || '').trim();
    if (!label) { flash('Give the account a name first'); return; }
    setBusy(a.id); setError('');
    try {
      await axios.patch(`${API_URL}/api/accounts/${a.id}`, { label }, headers);
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, label, needsNaming: false } : x)));
      flash('Saved');
    } catch { setError('Could not save that name.'); }
    finally { setBusy(''); }
  };

  const dismiss = async (a) => {
    setBusy(a.id);
    try {
      await axios.post(`${API_URL}/api/accounts/${a.id}/dismiss`, {}, headers);
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, needsNaming: false } : x)));
    } catch { setError('Could not update that account.'); }
    finally { setBusy(''); }
  };

  const tagSender = async (senderKey, bankCode) => {
    if (!bankCode) { flash('Pick a bank first'); return; }
    setBusy(senderKey); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/senders/tag`, { senderKey, bankCode }, headers);
      setUnknown((prev) => prev.filter((u) => u.senderKey !== senderKey));
      flash(data.updated ? `Tagged — ${data.updated} transaction(s) updated` : 'Tagged');
      const ac = await axios.get(`${API_URL}/api/accounts`, headers).catch(() => null);
      if (ac) { setAccounts(ac.data.accounts || []); setDrafts((d) => ({ ...Object.fromEntries((ac.data.accounts || []).map((a) => [a.id, a.label])), ...d })); }
    } catch { setError('Could not tag that sender.'); }
    finally { setBusy(''); }
  };

  const unnamed = accounts.filter((a) => a.needsNaming);
  const named = accounts.filter((a) => !a.needsNaming);

  const AccountCard = ({ a, prompt }) => (
    <div className={`ac-card${prompt ? ' ac-prompt' : ''}`}>
      <div className="ac-top">
        <div className="ac-icon"><i className="fas fa-credit-card"></i></div>
        <div>
          <div className="ac-bank">{a.bankName || 'Bank account'}</div>
          <div className="ac-mask">•••• {a.accountMask} · {a.txnCount} txn{a.txnCount === 1 ? '' : 's'}</div>
        </div>
      </div>
      <input
        className="ac-input"
        placeholder={prompt ? 'Name this account (e.g. Salary, Spending)' : 'Account name'}
        value={drafts[a.id] ?? ''}
        maxLength={40}
        onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === 'Enter') saveName(a); }}
      />
      <div className="ac-actions">
        {prompt && <button className="ac-ghost" disabled={busy === a.id} onClick={() => dismiss(a)}>Not mine</button>}
        <button className="ac-save" disabled={busy === a.id} onClick={() => saveName(a)}>{prompt ? 'Save name' : 'Rename'}</button>
      </div>
    </div>
  );

  return (
    <div className="ac-page">
      <div className="ac-head">
        <h2><i className="fas fa-university"></i> Your accounts</h2>
        <p>We spot each bank account from your imported alerts and statements. Name them so you can tell your money apart at a glance.</p>
      </div>

      {toast && <div className="ac-toast">{toast}</div>}
      {loading ? <div className="ac-card">Loading…</div> : (
        <>
          {unnamed.length > 0 && (
            <>
              <h3 className="ac-section">New — name {unnamed.length === 1 ? 'this account' : 'these accounts'}</h3>
              {unnamed.map((a) => <AccountCard key={a.id} a={a} prompt />)}
            </>
          )}

          {unknown.length > 0 && (
            <>
              <h3 className="ac-section">Unknown banks — help us learn</h3>
              <p className="ac-sub">We couldn’t tell which bank these alerts came from. Tag one and every alert from it — past and future — sorts itself out.</p>
              {unknown.map((u) => (
                <div key={u.senderKey} className="ac-card ac-unknown">
                  <div className="ac-top">
                    <div className="ac-icon ac-qicon"><i className="fas fa-question"></i></div>
                    <div>
                      <div className="ac-bank">{u.senderKey}</div>
                      <div className="ac-mask">{u.count} txn{u.count === 1 ? '' : 's'}{u.sample ? ` · ${u.sample}` : ''}</div>
                    </div>
                  </div>
                  {u.suggestion && (
                    <button className="ac-suggest" disabled={busy === u.senderKey} onClick={() => tagSender(u.senderKey, u.suggestion.bankCode)}>
                      <i className="fas fa-wand-magic-sparkles"></i> Others say this is {u.suggestion.bankName} — use it
                    </button>
                  )}
                  <div className="ac-actions">
                    <select className="ac-select" value={picks[u.senderKey] || ''} onChange={(e) => setPicks((p) => ({ ...p, [u.senderKey]: e.target.value }))}>
                      <option value="">Choose bank…</option>
                      {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                    <button className="ac-save" disabled={busy === u.senderKey} onClick={() => tagSender(u.senderKey, picks[u.senderKey])}>Tag</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {named.length > 0 && (
            <>
              <h3 className="ac-section">Named accounts</h3>
              {named.map((a) => <AccountCard key={a.id} a={a} prompt={false} />)}
            </>
          )}

          {accounts.length === 0 && unknown.length === 0 && (
            <div className="ac-card ac-empty">
              <p>No accounts detected yet.</p>
              <p className="ac-sub">Import a statement or your bank alerts and the accounts they mention will show up here.</p>
            </div>
          )}

          {error && <div className="ac-card ac-err">{error}</div>}
          <p className="ac-privacy">We only ever store the last few digits of an account, never the full number.</p>
        </>
      )}

      <style jsx="true">{`
        .ac-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .ac-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .ac-head p { color: var(--text-secondary); margin: 0 0 18px; }
        .ac-section { color: var(--text-primary); margin: 22px 0 6px; font-size: 1rem; }
        .ac-sub { color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 10px; }
        .ac-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; color: var(--text-primary); }
        .ac-prompt { border: 2px solid var(--accent-primary); }
        .ac-unknown { border-color: #d97706; background: rgba(217,119,6,0.05); }
        .ac-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .ac-icon { width: 42px; height: 42px; border-radius: 12px; background: var(--glass-bg); display: flex; align-items: center; justify-content: center; color: var(--accent-primary); }
        .ac-qicon { color: #d97706; background: rgba(217,119,6,0.14); }
        .ac-bank { font-weight: 700; color: var(--text-primary); }
        .ac-mask { color: var(--text-secondary); font-size: 0.83rem; margin-top: 2px; }
        .ac-input, .ac-select { width: 100%; box-sizing: border-box; background: var(--bg-primary, var(--bg-card)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 11px 13px; color: var(--text-primary); font-size: 0.95rem; }
        .ac-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; align-items: center; }
        .ac-select { width: auto; flex: 1; }
        .ac-ghost { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: var(--radius-md); padding: 10px 16px; font-weight: 700; cursor: pointer; }
        .ac-save { background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 10px 20px; font-weight: 800; cursor: pointer; }
        .ac-save:disabled, .ac-ghost:disabled { opacity: 0.6; cursor: default; }
        .ac-suggest { display: flex; align-items: center; gap: 8px; width: 100%; background: var(--glass-bg); border: 1px solid var(--accent-primary); color: var(--accent-primary); border-radius: var(--radius-md); padding: 10px 12px; font-weight: 700; cursor: pointer; margin-bottom: 4px; }
        .ac-empty { text-align: center; }
        .ac-err { color: #e53e3e; }
        .ac-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: var(--radius-full); text-align: center; font-weight: 600; margin-bottom: 12px; }
        .ac-privacy { color: var(--text-secondary); font-size: 0.78rem; text-align: center; margin-top: 8px; }
      `}</style>
    </div>
  );
}
