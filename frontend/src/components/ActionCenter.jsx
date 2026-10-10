import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import { undoable } from '../lib/undo';

// Action Center: everything that needs the user's decision, in one place. Each card
// resolves itself through the existing endpoints, then the list reloads. Removals and
// dismissals leave the list at once and wait 5 seconds behind Undo (`later`).
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const day = (d) => (d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const SOURCE = { email: 'Email alert', notification: 'Bank app notification', sms: 'Bank text', share: 'Shared receipt', import: 'Statement', manual: 'Added by you' };

const SECTIONS = [
  { type: 'review_transaction', title: 'Check these transactions', hint: 'We read these automatically but weren’t sure. Confirm, fix or remove each one.' },
  { type: 'possible_duplicate', title: 'Possible duplicates', hint: 'The same amount, a day apart or less, from different places. Remove the copy or keep both.' },
  { type: 'name_subscription', title: 'What are these subscriptions?', hint: 'Your bank printed a name we don’t recognise.' },
  { type: 'track_subscription', title: 'Recurring charges', hint: 'These repeat every month. Track them to get renewal reminders.' },
  { type: 'name_account', title: 'Name your accounts', hint: 'Give each account a name so you can tell them apart.' },
  { type: 'tag_sender', title: 'Which bank sent these?', hint: 'Tell us once and every alert from this sender is sorted.' },
];

function TxnLine({ t }) {
  return (
    <div className="acx-txn">
      <div className="acx-txn-main">
        <span className="acx-txn-desc">{t.description}</span>
        <span className="acx-meta">{day(t.date)} · {SOURCE[t.source] || t.source}{t.bank ? ` · ${t.bank}` : ''}</span>
      </div>
      <span className={`acx-amount ${t.type}`}>{t.type === 'income' ? '+' : '-'}{fmtNaira(t.amount)}</span>
    </div>
  );
}

function ReviewCard({ item, act, later }) {
  const t = item.transaction;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ description: t.description, amount: String(t.amount), type: t.type });
  const save = () => act(async () => {
    await axios.put(`${API_URL}/api/transactions/${t.id}`, { description: form.description, amount: parseFloat(form.amount), type: form.type }, auth());
    await axios.post(`${API_URL}/api/transactions/${t.id}/reviewed`, {}, auth());
  });
  return (
    <div className="acx-card">
      {editing ? (
        <div className="acx-edit">
          <input id={`d-${t.id}`} aria-label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input id={`a-${t.id}`} aria-label="Amount" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          <select id={`t-${t.id}`} aria-label="Money in or out" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="expense">Money out</option>
            <option value="income">Money in</option>
          </select>
        </div>
      ) : <TxnLine t={t} />}
      <div className="acx-actions">
        {editing ? (
          <>
            <button type="button" className="btn-primary" onClick={save}>Save</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary" onClick={() => act(() => axios.post(`${API_URL}/api/transactions/${t.id}/reviewed`, {}, auth()))}>Looks right</button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>Fix it</button>
            <button type="button" className="btn-danger" onClick={() => later('Transaction removed', () => axios.delete(`${API_URL}/api/transactions/${t.id}`, auth()))}>Remove</button>
          </>
        )}
      </div>
    </div>
  );
}

function DuplicateCard({ item, act, later }) {
  const remove = (id) => later('Copy removed', () => axios.delete(`${API_URL}/api/transactions/${id}`, auth()));
  return (
    <div className="acx-card">
      <div className="acx-pair">
        {[item.first, item.second].map((t) => (
          <div key={t.id} className="acx-pair-side">
            <TxnLine t={t} />
            <button type="button" className="btn-secondary" onClick={() => remove(t.id)}>Remove this one</button>
          </div>
        ))}
      </div>
      <div className="acx-actions">
        <button type="button" className="btn-secondary" onClick={() => act(() => axios.post(`${API_URL}/api/action-center/keep-both`, { first: item.first.id, second: item.second.id }, auth()))}>Both are real</button>
      </div>
    </div>
  );
}

function NameSubscriptionCard({ item, act, later }) {
  const [name, setName] = useState('');
  return (
    <div className="acx-card">
      <div className="acx-txn">
        <div className="acx-txn-main">
          <span className="acx-txn-desc">{item.name}</span>
          <span className="acx-meta">{fmtNaira(item.cost)} a month{item.lastCharge ? ` · last charged ${day(item.lastCharge)}` : ''}</span>
        </div>
      </div>
      <div className="acx-actions">
        <input id={`s-${item.id}`} aria-label="Subscription name" placeholder="e.g. Netflix" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="button" className="btn-primary" disabled={!name.trim()} onClick={() => act(() => axios.put(`${API_URL}/api/subscriptions/${item.id}`, { name: name.trim() }, auth()))}>Save name</button>
        <button type="button" className="btn-secondary" onClick={() => later('Removed from subscriptions', () => axios.delete(`${API_URL}/api/subscriptions/${item.id}`, auth()))}>Not a subscription</button>
      </div>
    </div>
  );
}

function TrackCard({ item, act, later }) {
  return (
    <div className="acx-card">
      <div className="acx-txn">
        <div className="acx-txn-main">
          <span className="acx-txn-desc">{item.name}</span>
          <span className="acx-meta">About {fmtNaira(item.cost)} · seen in {item.occurrences} months</span>
        </div>
      </div>
      <div className="acx-actions">
        <button type="button" className="btn-primary" onClick={() => act(() => axios.post(`${API_URL}/api/subscriptions`, { name: item.name, cost: item.cost, frequency: 'monthly', category: 'Subscriptions', lastCharge: item.lastSeen }, auth()))}>Track it</button>
        <button type="button" className="btn-secondary" onClick={() => later('We won’t suggest it again', () => axios.post(`${API_URL}/api/subscriptions/dismiss-detected`, { key: item.key, name: item.name }, auth()))}>Not a subscription</button>
      </div>
    </div>
  );
}

function AccountCard({ item, act, later }) {
  const [label, setLabel] = useState('');
  return (
    <div className="acx-card">
      <div className="acx-txn">
        <div className="acx-txn-main">
          <span className="acx-txn-desc">{item.bankName || item.bankCode} {item.accountMask ? `••••${item.accountMask}` : ''}</span>
          <span className="acx-meta">{item.txnCount} transaction{item.txnCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="acx-actions">
        <input id={`n-${item.id}`} aria-label="Account name" placeholder="e.g. Salary account" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button type="button" className="btn-primary" disabled={!label.trim()} onClick={() => act(() => axios.patch(`${API_URL}/api/accounts/${item.id}`, { label: label.trim() }, auth()))}>Save</button>
        <button type="button" className="btn-secondary" onClick={() => later('Account removed. Its transactions stay.', () => axios.delete(`${API_URL}/api/accounts/${item.id}`, auth()))}>Not mine</button>
      </div>
    </div>
  );
}

function SenderCard({ item, act, later, banks }) {
  const [code, setCode] = useState('');
  return (
    <div className="acx-card">
      <div className="acx-txn">
        <div className="acx-txn-main">
          <span className="acx-txn-desc">{item.senderKey}</span>
          <span className="acx-meta">{item.count} alert{item.count === 1 ? '' : 's'} · e.g. “{item.sample}”</span>
        </div>
      </div>
      <div className="acx-actions">
        <select id={`b-${item.id}`} aria-label="Bank" value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose the bank</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <button type="button" className="btn-primary" disabled={!code} onClick={() => act(() => axios.post(`${API_URL}/api/senders/tag`, { senderKey: item.senderKey, bankCode: code }, auth()))}>Save</button>
        <button type="button" className="btn-secondary" onClick={() => later('We won’t ask about it again', () => axios.post(`${API_URL}/api/senders/dismiss`, { senderKey: item.senderKey }, auth()))}>Not a bank</button>
      </div>
    </div>
  );
}

const CARDS = {
  review_transaction: ReviewCard,
  possible_duplicate: DuplicateCard,
  name_subscription: NameSubscriptionCard,
  track_subscription: TrackCard,
  name_account: AccountCard,
  tag_sender: SenderCard,
};

export default function ActionCenter() {
  const [data, setData] = useState(null);
  const [banks, setBanks] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const { data: d } = await axios.get(`${API_URL}/api/action-center`, auth()); setData(d); setError(''); }
    catch { setError('Could not load your Action Center. The server may be waking up; try again.'); }
  }, []);

  useEffect(() => {
    load();
    axios.get(`${API_URL}/api/banks`, auth()).then((r) => setBanks(r.data.banks || [])).catch(() => {});
  }, [load]);

  // Run an action, then refresh the list and the sidebar badge. The item leaves the
  // list straight away; a failed call brings it back with the reload.
  const act = async (fn, id) => {
    if (busy) return;
    setBusy(true);
    if (id) setData((d) => d && { ...d, items: d.items.filter((i) => i.id !== id), total: Math.max(0, d.total - 1) });
    try { await fn(); await load(); window.dispatchEvent(new Event('automonie:actions-changed')); }
    catch (e) { setError(e.response?.data?.message || 'That didn’t work. Try again.'); load(); }
    finally { setBusy(false); }
  };

  // Remove or dismiss with a 5-second Undo; undoing (or a failed request) reloads the list.
  const later = (id, message, fn) => {
    setData((d) => d && { ...d, items: d.items.filter((i) => i.id !== id), total: Math.max(0, d.total - 1) });
    undoable(message, async () => { await fn(); window.dispatchEvent(new Event('automonie:actions-changed')); }, load);
  };

  return (
    <div className="acx-page">
      <div className="acx-head">
        <h2><i className="fas fa-list-check" aria-hidden="true"></i> Action Center</h2>
        <p>Things we need you to look at, so your numbers stay right.</p>
      </div>
      {error && <div className="message error">{error}</div>}
      {!data && !error && <div className="loading-container"><div className="loading-spinner"></div></div>}
      {data && data.total === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon"><i className="fas fa-circle-check" aria-hidden="true"></i></div>
          <h3>You’re all caught up</h3>
          <p>When we aren’t sure about something, like a transaction we couldn’t read clearly, a possible duplicate or a charge that looks like a subscription, it waits here for your decision so your numbers stay right.</p>
        </div>
      )}
      {data && data.total > 0 && SECTIONS.map((sec) => {
        const items = data.items.filter((it) => it.type === sec.type);
        if (!items.length) return null;
        const Card = CARDS[sec.type];
        return (
          <section key={sec.type} className="acx-section">
            <h3>{sec.title} <span className="acx-count">{items.length}</span></h3>
            <p className="acx-hint">{sec.hint}</p>
            {items.map((it) => <Card key={it.id} item={it} act={(fn) => act(fn, it.id)} later={(message, fn) => later(it.id, message, fn)} banks={banks} />)}
          </section>
        );
      })}

      <style>{`
        .acx-page { max-width: 820px; margin: 0 auto; padding: 16px; display: grid; gap: 18px; }
        .acx-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); }
        .acx-head h2 i { color: var(--accent-primary); }
        .acx-head p, .acx-hint { color: var(--text-secondary); font-size: 0.9rem; }
        .acx-section { display: grid; gap: 10px; }
        .acx-section h3 { display: flex; align-items: center; gap: 8px; font-size: 1.05rem; color: var(--text-primary); }
        .acx-count { font-size: 0.75rem; font-weight: 700; background: var(--glass-bg); color: var(--text-secondary); border-radius: var(--radius-full); padding: 2px 9px; }
        .acx-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 14px; display: grid; gap: 12px; }
        .acx-txn { display: flex; align-items: center; gap: 12px; }
        .acx-txn-main { flex: 1; min-width: 0; display: grid; gap: 2px; }
        .acx-txn-desc { color: var(--text-primary); font-weight: 600; overflow-wrap: anywhere; }
        .acx-meta { color: var(--text-secondary); font-size: 0.8rem; }
        .acx-amount { font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .acx-amount.income { color: var(--income-color); }
        .acx-amount.expense { color: var(--expense-color); }
        .acx-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .acx-actions input, .acx-actions select, .acx-edit input, .acx-edit select { background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 9px 11px; font: inherit; min-width: 0; }
        .acx-actions input { flex: 1 1 180px; }
        .acx-edit { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 8px; }
        .acx-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .acx-pair-side { display: grid; gap: 8px; padding: 10px; border: 1px dashed var(--border-color); border-radius: var(--radius-sm); min-width: 0; }
        @media (max-width: 640px) { .acx-edit, .acx-pair { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
