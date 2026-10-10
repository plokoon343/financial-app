import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config';
import { useAccountScope, scopeKey } from '../contexts/AccountScope';
import { undoable } from '../lib/undo';
import ChoiceDialog from './ChoiceDialog';

// Bank accounts: the ones we fingerprinted from alerts and statements, plus any the
// user adds by hand. Name, type, merge, deactivate and delete each one; tag senders
// the parser couldn't map to a bank. Deletes wait 5 seconds behind Undo.

const TYPES = [
  { value: '', label: 'Type not set' },
  { value: 'current', label: 'Current' },
  { value: 'savings', label: 'Savings' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];
const EMPTY_FORM = { bankCode: '', bankName: '', accountMask: '', type: '', label: '' };

export default function Accounts() {
  const navigate = useNavigate();
  const { setScope, reload: reloadScope } = useAccountScope();
  const viewAccount = (a) => { setScope(scopeKey(a.bankCode, a.accountMask)); navigate('/'); };
  const [accounts, setAccounts] = useState([]);
  const [unknown, setUnknown] = useState([]);
  const [banks, setBanks] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [picks, setPicks] = useState({});          // senderKey -> chosen bankCode
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [deleting, setDeleting] = useState(null); // the account the delete dialog is about
  const [merging, setMerging] = useState(null);   // the account the merge dialog is about
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
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
  const changed = () => { reloadScope(); window.dispatchEvent(new Event('automonie:actions-changed')); };

  const saveName = async (a) => {
    const label = (drafts[a.id] || '').trim();
    if (!label) { flash('Give the account a name first'); return; }
    setBusy(a.id); setError('');
    try {
      await axios.patch(`${API_URL}/api/accounts/${a.id}`, { label }, headers);
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, label, needsNaming: false } : x)));
      flash('Saved');
      changed();
    } catch { setError('Could not save that name.'); }
    finally { setBusy(''); }
  };

  const saveType = async (a, type) => {
    setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, type } : x)));
    try { await axios.patch(`${API_URL}/api/accounts/${a.id}`, { type }, headers); }
    catch { setError('Could not change the type.'); load(); }
  };

  const addAccount = async (e) => {
    e.preventDefault();
    const custom = form.bankCode === 'other';
    if (!form.bankCode || (custom && !form.bankName.trim())) { flash('Pick the bank first'); return; }
    setBusy('add'); setError('');
    try {
      await axios.post(`${API_URL}/api/accounts`, {
        ...(custom ? { bankName: form.bankName.trim() } : { bankCode: form.bankCode }),
        accountMask: form.accountMask, type: form.type, label: form.label.trim(),
      }, headers);
      setForm(EMPTY_FORM); setAdding(false);
      flash('Account added');
      await load();
      changed();
    } catch (err) { setError(err.response?.data?.message || 'Could not add that account.'); }
    finally { setBusy(''); }
  };

  const tagSender = async (senderKey, bankCode) => {
    if (!bankCode) { flash('Pick a bank first'); return; }
    setBusy(senderKey); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/senders/tag`, { senderKey, bankCode }, headers);
      setUnknown((prev) => prev.filter((u) => u.senderKey !== senderKey));
      flash(data.updated ? `Tagged: ${data.updated} transaction(s) updated` : 'Tagged');
      const ac = await axios.get(`${API_URL}/api/accounts`, headers).catch(() => null);
      if (ac) { setAccounts(ac.data.accounts || []); setDrafts((d) => ({ ...Object.fromEntries((ac.data.accounts || []).map((a) => [a.id, a.label])), ...d })); }
    } catch { setError('Could not tag that sender.'); }
    finally { setBusy(''); }
  };

  // Deactivate / reactivate: hides the account from the switcher and 'All' views but
  // keeps the data. Reversible.
  const setActive = async (a, active) => {
    setBusy(a.id); setError('');
    try {
      await axios.post(`${API_URL}/api/accounts/${a.id}/active`, { active }, headers);
      setAccounts((prev) => prev.map((x) => (x.id === a.id ? { ...x, active } : x)));
      flash(active ? 'Reactivated' : 'Deactivated');
      reloadScope();
    } catch { setError('Could not update that account.'); }
    finally { setBusy(''); }
  };

  // Delete: the dialog asks what happens to the account's transactions. Kept ones
  // stay in All accounts, unassigned; deleting them is for clearing a bad import.
  const remove = (choice) => {
    const a = deleting;
    setDeleting(null);
    if (!a || !choice) return;
    const withTxns = choice === 'delete';
    setAccounts((prev) => prev.filter((x) => x.id !== a.id));
    undoable(
      withTxns ? `Account and ${a.txnCount} transaction${a.txnCount === 1 ? '' : 's'} deleted` : 'Account deleted',
      async () => { await axios.delete(`${API_URL}/api/accounts/${a.id}${withTxns ? '?withTransactions=1' : ''}`, headers); changed(); },
      load,
    );
  };

  // Merge: the same account detected twice; its transactions move to the other one.
  const merge = async (intoId) => {
    const a = merging;
    setMerging(null);
    if (!a || !intoId) return;
    setBusy(a.id); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/accounts/${a.id}/merge`, { into: intoId }, headers);
      flash(`Merged, ${data.moved} transaction${data.moved === 1 ? '' : 's'} moved`);
      await load();
      changed();
    } catch { setError('Could not merge those accounts.'); }
    finally { setBusy(''); }
  };

  // 'Not a bank': stop asking about a sender that isn't one of the user's banks.
  const dismissSender = (senderKey) => {
    setUnknown((prev) => prev.filter((u) => u.senderKey !== senderKey));
    undoable('We won’t ask about it again', async () => { await axios.post(`${API_URL}/api/senders/dismiss`, { senderKey }, headers); changed(); }, load);
  };

  const unnamed = accounts.filter((a) => a.needsNaming);
  const named = accounts.filter((a) => !a.needsNaming);
  const sameBank = (a) => accounts.filter((x) => x.id !== a.id && x.bankCode === a.bankCode);
  const nameOf = (a) => a.label || `${a.bankName || 'Bank account'}${a.accountMask ? ` ••••${a.accountMask}` : ''}`;

  // A plain render function, not a component: a component declared in here would be a
  // new type on every render and the name box would lose focus on each keystroke.
  const accountCard = (a, prompt) => {
    const inactive = a.active === false;
    return (
      <div key={a.id} className={`ac-card${prompt ? ' ac-prompt' : ''}${inactive ? ' ac-inactive' : ''}`}>
        <div className="ac-top">
          <div className="ac-icon"><i className="fas fa-credit-card" aria-hidden="true"></i></div>
          <div className="ac-grow">
            <div className="ac-bank">{a.bankName || 'Bank account'}{inactive && <span className="ac-badge">Deactivated</span>}</div>
            <div className="ac-mask">{a.accountMask ? `•••• ${a.accountMask}` : 'No account digits'} · {a.txnCount} txn{a.txnCount === 1 ? '' : 's'}</div>
          </div>
          {!prompt && (
            <select className="ac-type" aria-label="Account type" value={a.type || ''} onChange={(e) => saveType(a, e.target.value)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          )}
        </div>
        <input
          className="ac-input"
          aria-label="Account name"
          placeholder={prompt ? 'Name this account (e.g. Salary, Spending)' : 'Account name'}
          value={drafts[a.id] ?? ''}
          maxLength={40}
          onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter') saveName(a); }}
        />
        <div className="ac-actions">
          <button className="ac-danger" disabled={busy === a.id} onClick={() => setDeleting(a)}>{prompt ? 'Not mine' : 'Delete'}</button>
          {!prompt && sameBank(a).length > 0 && (
            <button className="ac-ghost" disabled={busy === a.id} onClick={() => setMerging(a)}>Merge</button>
          )}
          {!prompt && (
            inactive
              ? <button className="ac-ghost" disabled={busy === a.id} onClick={() => setActive(a, true)}>Reactivate</button>
              : <button className="ac-ghost" disabled={busy === a.id} onClick={() => setActive(a, false)} title="Hide this account from your views without deleting it">Deactivate</button>
          )}
          {!prompt && !inactive && a.accountMask && a.bankCode && (
            <button className="ac-ghost" onClick={() => viewAccount(a)} title="See just this account's dashboard and insights">View</button>
          )}
          <button className="ac-save" disabled={busy === a.id} onClick={() => saveName(a)}>{prompt ? 'Save name' : 'Rename'}</button>
        </div>
      </div>
    );
  };

  return (
    <div className="ac-page">
      <div className="ac-head">
        <div className="ac-head-row">
          <h2><i className="fas fa-university" aria-hidden="true"></i> Your accounts</h2>
          {!adding && <button className="ac-save" onClick={() => setAdding(true)}>Add account</button>}
        </div>
        <p>We spot each bank account from your alerts and statements, and you can add any we haven’t seen. Name them so you can tell your money apart at a glance.</p>
      </div>

      {toast && <div className="ac-toast" role="status">{toast}</div>}
      <ChoiceDialog
        open={!!deleting}
        title={deleting?.needsNaming ? 'Not your account?' : `Delete ${deleting ? nameOf(deleting) : 'this account'}?`}
        message={deleting?.txnCount && deleting?.accountMask
          ? `It has ${deleting.txnCount} transaction${deleting.txnCount === 1 ? '' : 's'}. Keep them and they stay in All accounts, just not tied to this account. Delete them and they're gone for good.`
          : 'It will stop showing in your accounts, and new alerts won’t bring it back.'}
        choices={[
          { value: 'keep', label: deleting?.txnCount && deleting?.accountMask ? 'Delete account, keep transactions' : 'Delete account', tone: 'primary' },
          ...(deleting?.txnCount && deleting?.accountMask ? [{ value: 'delete', label: `Delete account and ${deleting.txnCount} transaction${deleting.txnCount === 1 ? '' : 's'}`, tone: 'danger' }] : []),
          { value: '', label: 'Cancel' },
        ]}
        onChoose={remove}
      />
      <ChoiceDialog
        open={!!merging}
        title={`Merge ${merging ? nameOf(merging) : ''} into…`}
        message="Use this when the same account shows up twice. Its transactions move over, and new alerts for it go to the account you pick."
        choices={[
          ...(merging ? sameBank(merging).map((x) => ({ value: x.id, label: nameOf(x), tone: 'primary' })) : []),
          { value: '', label: 'Cancel' },
        ]}
        onChoose={merge}
      />

      {adding && (
        <form className="ac-card ac-form" onSubmit={addAccount}>
          <h3 className="ac-form-title">Add an account</h3>
          <label htmlFor="ac-bank">Bank</label>
          <select id="ac-bank" className="ac-select" value={form.bankCode} onChange={(e) => setForm({ ...form, bankCode: e.target.value })}>
            <option value="">Choose bank…</option>
            {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
            <option value="other">Another bank…</option>
          </select>
          {form.bankCode === 'other' && (
            <>
              <label htmlFor="ac-bankname">Bank name</label>
              <input id="ac-bankname" className="ac-input" maxLength={40} value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </>
          )}
          <div className="ac-form-row">
            <div>
              <label htmlFor="ac-mask">Last 4 digits (optional)</label>
              <input id="ac-mask" className="ac-input" inputMode="numeric" maxLength={4} value={form.accountMask} onChange={(e) => setForm({ ...form, accountMask: e.target.value.replace(/\D/g, '') })} />
            </div>
            <div>
              <label htmlFor="ac-typenew">Type</label>
              <select id="ac-typenew" className="ac-select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.value ? t.label : 'Choose…'}</option>)}
              </select>
            </div>
          </div>
          <label htmlFor="ac-label">Name (optional)</label>
          <input id="ac-label" className="ac-input" maxLength={40} placeholder="e.g. Salary, Spending" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <p className="ac-sub">With the last 4 digits, alerts for this account land on it automatically.</p>
          <div className="ac-actions">
            <button type="button" className="ac-ghost" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}>Cancel</button>
            <button type="submit" className="ac-save" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add account'}</button>
          </div>
        </form>
      )}

      {loading ? <div className="ac-card">Loading…</div> : (
        <>
          {unnamed.length > 0 && (
            <>
              <h3 className="ac-section">New: name {unnamed.length === 1 ? 'this account' : 'these accounts'}</h3>
              {unnamed.map((a) => accountCard(a, true))}
            </>
          )}

          {unknown.length > 0 && (
            <>
              <h3 className="ac-section">Unknown banks: help us learn</h3>
              <p className="ac-sub">We couldn’t tell which bank these alerts came from. Tag one and every alert from it, past and future, sorts itself out.</p>
              {unknown.map((u) => (
                <div key={u.senderKey} className="ac-card ac-unknown">
                  <div className="ac-top">
                    <div className="ac-icon ac-qicon"><i className="fas fa-question" aria-hidden="true"></i></div>
                    <div>
                      <div className="ac-bank">{u.senderKey}</div>
                      <div className="ac-mask">{u.count} txn{u.count === 1 ? '' : 's'}{u.sample ? ` · ${u.sample}` : ''}</div>
                    </div>
                  </div>
                  {u.suggestion && (
                    <button className="ac-suggest" disabled={busy === u.senderKey} onClick={() => tagSender(u.senderKey, u.suggestion.bankCode)}>
                      <i className="fas fa-users" aria-hidden="true"></i> Others say this is {u.suggestion.bankName}: use it
                    </button>
                  )}
                  <div className="ac-actions">
                    <select className="ac-select" aria-label="Bank" value={picks[u.senderKey] || ''} onChange={(e) => setPicks((p) => ({ ...p, [u.senderKey]: e.target.value }))}>
                      <option value="">Choose bank…</option>
                      {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
                    </select>
                    <button className="ac-save" disabled={busy === u.senderKey} onClick={() => tagSender(u.senderKey, picks[u.senderKey])}>Tag</button>
                    <button className="ac-ghost" onClick={() => dismissSender(u.senderKey)}>Not a bank</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {named.length > 0 && (
            <>
              <h3 className="ac-section">Named accounts</h3>
              {named.map((a) => accountCard(a, false))}
            </>
          )}

          {accounts.length === 0 && unknown.length === 0 && !adding && (
            <div className="ac-card ac-empty">
              <p>No accounts yet.</p>
              <p className="ac-sub">Import a statement or forward your bank alerts and the accounts they mention show up here. You can also add one yourself.</p>
              <button className="ac-save" onClick={() => setAdding(true)}>Add account</button>
            </div>
          )}

          {error && <div className="ac-card ac-err" role="alert">{error}</div>}
          <p className="ac-privacy">We only ever store the last few digits of an account, never the full number.</p>
        </>
      )}

      <style>{`
        .ac-page { max-width: 720px; margin: 0 auto; padding: 20px; }
        .ac-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        .ac-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .ac-head p { color: var(--text-secondary); margin: 0 0 18px; }
        .ac-section { color: var(--text-primary); margin: 22px 0 6px; font-size: 1rem; }
        .ac-sub { color: var(--text-secondary); font-size: 0.85rem; margin: 0 0 10px; }
        .ac-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; color: var(--text-primary); }
        .ac-prompt { border: 2px solid var(--accent-primary); }
        .ac-unknown { border-color: #d97706; background: rgba(217,119,6,0.05); }
        .ac-top { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
        .ac-grow { flex: 1; min-width: 0; }
        .ac-icon { width: 42px; height: 42px; flex-shrink: 0; border-radius: 12px; background: var(--glass-bg); display: flex; align-items: center; justify-content: center; color: var(--accent-primary); }
        .ac-qicon { color: #d97706; background: rgba(217,119,6,0.14); }
        .ac-bank { font-weight: 700; color: var(--text-primary); }
        .ac-mask { color: var(--text-secondary); font-size: 0.83rem; margin-top: 2px; }
        .ac-input, .ac-select, .ac-type { width: 100%; box-sizing: border-box; min-height: 44px; background: var(--bg-primary, var(--bg-card)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 13px; color: var(--text-primary); font-size: 0.95rem; }
        .ac-type { width: auto; }
        .ac-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; margin-top: 12px; align-items: center; }
        .ac-actions .ac-select { width: auto; flex: 1 1 160px; }
        .ac-ghost, .ac-save, .ac-danger { min-height: 44px; border-radius: var(--radius-md); padding: 10px 16px; font-weight: 700; cursor: pointer; }
        .ac-ghost { background: transparent; border: 1px solid var(--border-color); color: var(--text-secondary); }
        .ac-save { background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; font-weight: 800; }
        .ac-danger { background: transparent; border: 1px solid rgba(229,62,62,0.5); color: #e53e3e; }
        .ac-save:disabled, .ac-ghost:disabled, .ac-danger:disabled { opacity: 0.6; cursor: default; }
        .ac-inactive { opacity: 0.72; }
        .ac-badge { display: inline-block; margin-left: 8px; font-size: 0.66rem; font-weight: 800; letter-spacing: 0.3px; text-transform: uppercase; color: var(--text-secondary); background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: 999px; padding: 2px 8px; vertical-align: middle; }
        .ac-suggest { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 44px; background: var(--glass-bg); border: 1px solid var(--accent-primary); color: var(--accent-primary); border-radius: var(--radius-md); padding: 10px 12px; font-weight: 700; cursor: pointer; margin-bottom: 4px; }
        .ac-form { display: grid; gap: 6px; }
        .ac-form label { color: var(--text-secondary); font-size: 0.82rem; font-weight: 600; margin-top: 6px; }
        .ac-form-title { margin: 0 0 4px; font-size: 1rem; }
        .ac-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .ac-form-row > div { display: grid; gap: 6px; }
        @media (max-width: 480px) { .ac-form-row { grid-template-columns: 1fr; } .ac-top { flex-wrap: wrap; } }
        .ac-empty { text-align: center; }
        .ac-err { color: #e53e3e; }
        .ac-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: var(--radius-full); text-align: center; font-weight: 600; margin-bottom: 12px; }
        .ac-privacy { color: var(--text-secondary); font-size: 0.78rem; text-align: center; margin-top: 8px; }
      `}</style>
    </div>
  );
}
