import React, { useEffect, useMemo, useState } from 'react';
import { fmtNaira } from '../utils/format';
import { loadShared, saveShared, balances, settleWith } from '../lib/shared';

// Shared expenses (web parity with the mobile /shared screen). Split a cost with
// roommates/family/friends and keep a running tally of who owes whom. No money moves —
// it's a personal ledger stored in localStorage. "Settle up" squares a balance.

export default function SharedExpenses() {
  const [state, setState] = useState({ people: [], entries: [] });
  const [toast, setToast] = useState('');

  const [newPerson, setNewPerson] = useState('');
  const [desc, setDesc] = useState('');
  const [amountText, setAmountText] = useState('');
  const [paidBy, setPaidBy] = useState('me');
  const [parts, setParts] = useState(['me']);

  useEffect(() => { setState(loadShared()); }, []);
  const persist = (next) => { setState(next); saveShared(next); };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2000); };

  const everyone = ['me', ...state.people];
  const bal = useMemo(() => balances(state), [state]);

  const addPerson = () => {
    const name = newPerson.trim();
    if (!name || state.people.includes(name) || name.toLowerCase() === 'me') { setNewPerson(''); return; }
    persist({ ...state, people: [...state.people, name] });
    setParts((p) => [...p, name]);
    setNewPerson('');
  };

  const toggle = (name) => setParts((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));

  const addEntry = () => {
    const amount = parseFloat((amountText || '').replace(/[^0-9.]/g, ''));
    if (!(amount > 0)) { flash('Enter an amount'); return; }
    if (parts.length < 2) { flash('Split between at least two people'); return; }
    persist({ ...state, entries: [{ id: `s-${Date.now()}`, description: desc.trim() || 'Shared expense', amount, paidBy, participants: parts, date: new Date().toISOString().slice(0, 10) }, ...state.entries] });
    setDesc(''); setAmountText('');
    flash('Added');
  };

  const settle = (person) => { persist(settleWith(state, person)); flash(`Settled with ${person}`); };
  const name = (p) => (p === 'me' ? 'You' : p);

  return (
    <div className="sh-page">
      <div className="sh-head">
        <h2><i className="fas fa-people-arrows"></i> Shared expenses</h2>
        <p>Splitting a cost with someone? Log who paid and who shares it, and we keep a running tally of who owes whom. It only tracks — no money moves here.</p>
      </div>

      {toast && <div className="sh-toast">{toast}</div>}

      {/* Add a shared expense */}
      <div className="sh-card">
        <h3>Add a shared expense</h3>
        <input className="sh-input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="What for? e.g. groceries, data" />
        <div className="sh-amount">
          <span>₦</span>
          <input inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />
        </div>

        <div className="sh-label">Paid by <span>· who fronted the money</span></div>
        <div className="sh-chips">
          {everyone.map((p) => (
            <button key={p} className={`sh-chip ${paidBy === p ? 'on' : ''}`} onClick={() => setPaidBy(p)}>{name(p)}</button>
          ))}
        </div>

        <div className="sh-label">Split between <span>· tap everyone who shares it</span></div>
        <div className="sh-chips">
          {everyone.map((p) => (
            <button key={p} className={`sh-chip ${parts.includes(p) ? 'on' : ''}`} onClick={() => toggle(p)}>{name(p)}</button>
          ))}
        </div>

        <button className="sh-add" onClick={addEntry}>Add expense</button>
      </div>

      {/* Add a person */}
      <div className="sh-person">
        <input className="sh-input" value={newPerson} onChange={(e) => setNewPerson(e.target.value)} placeholder="Add a person…" onKeyDown={(e) => e.key === 'Enter' && addPerson()} />
        <button className="sh-person-btn" onClick={addPerson}><i className="fas fa-user-plus"></i></button>
      </div>

      {/* Balances */}
      {state.people.length === 0 ? (
        <div className="sh-card sh-empty">
          <i className="fas fa-users" style={{ fontSize: '1.8rem', opacity: 0.6 }}></i>
          <p>No one to split with yet</p>
          <p className="sh-empty-sub">Add a person above, then log a shared expense to see who owes what.</p>
        </div>
      ) : (
        <div className="sh-balances">
          <div className="sh-section">WHO OWES WHAT</div>
          {state.people.map((p) => {
            const v = bal[p] || 0;
            const owesMe = v > 0.5, iOwe = v < -0.5;
            return (
              <div key={p} className="sh-bal-row">
                <div className="sh-bal-main">
                  <span className="sh-bal-name">{p}</span>
                  <span className={`sh-bal-amt ${owesMe ? 'pos' : iOwe ? 'neg' : 'zero'}`}>
                    {owesMe ? `owes you ${fmtNaira(v)}` : iOwe ? `you owe ${fmtNaira(-v)}` : 'all square'}
                  </span>
                </div>
                {(owesMe || iOwe) && <button className="sh-settle" onClick={() => settle(p)}>Settle up</button>}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent entries */}
      {state.entries.length > 0 && (
        <div className="sh-balances">
          <div className="sh-section">RECENT SPLITS</div>
          {state.entries.slice(0, 12).map((e) => (
            <div key={e.id} className="sh-entry">
              <div className="sh-bal-main">
                <span className="sh-bal-name">{e.description}</span>
                <span className="sh-entry-meta">{name(e.paidBy)} paid · split {e.participants.length} ways · {new Date(e.date).toLocaleDateString()}</span>
              </div>
              <span className="sh-entry-amt">{fmtNaira(e.amount)}</span>
            </div>
          ))}
        </div>
      )}

      <style jsx="true">{`
        .sh-page { max-width: 640px; margin: 0 auto; padding: 20px; }
        .sh-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .sh-head p { color: var(--text-secondary); margin: 0 0 18px; line-height: 1.5; }
        .sh-toast { position: sticky; top: 8px; background: #111827; color: #fff; padding: 9px 14px; border-radius: 999px; text-align: center; font-weight: 600; margin-bottom: 12px; z-index: 5; }
        .sh-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; }
        .sh-card h3 { margin: 0 0 12px; color: var(--text-primary); font-size: 1.05rem; }
        .sh-input { width: 100%; background: var(--bg-primary, var(--glass-bg)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 11px 13px; color: var(--text-primary); font-size: 0.95rem; box-sizing: border-box; margin-bottom: 10px; }
        .sh-amount { display: flex; align-items: center; gap: 8px; background: var(--bg-primary, var(--glass-bg)); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 4px 13px; margin-bottom: 12px; }
        .sh-amount span { color: var(--text-secondary); font-size: 1.2rem; font-weight: 800; }
        .sh-amount input { flex: 1; background: transparent; border: none; color: var(--text-primary); font-size: 1.3rem; font-weight: 800; outline: none; padding: 8px 0; }
        .sh-label { color: var(--text-secondary); font-size: 0.82rem; font-weight: 700; margin: 6px 0 8px; }
        .sh-label span { font-weight: 400; }
        .sh-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 6px; }
        .sh-chip { background: var(--glass-bg); border: 1px solid var(--border-color); color: var(--text-secondary); border-radius: var(--radius-full); padding: 7px 14px; font-weight: 600; font-size: 0.85rem; cursor: pointer; }
        .sh-chip.on { background: var(--accent-primary); border-color: var(--accent-primary); color: #fff; }
        .sh-add { width: 100%; background: var(--gradient-primary, var(--accent-primary)); color: #fff; border: none; border-radius: var(--radius-md); padding: 12px; font-weight: 800; cursor: pointer; margin-top: 8px; }
        .sh-person { display: flex; gap: 8px; margin-bottom: 16px; }
        .sh-person .sh-input { margin-bottom: 0; }
        .sh-person-btn { background: var(--accent-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 0 16px; cursor: pointer; }
        .sh-empty { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
        .sh-empty-sub { color: var(--text-secondary); font-size: 0.85rem; max-width: 340px; }
        .sh-balances { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; margin-bottom: 14px; }
        .sh-section { color: var(--text-secondary); font-size: 0.72rem; font-weight: 800; letter-spacing: 1px; margin-bottom: 12px; }
        .sh-bal-row, .sh-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-color); }
        .sh-bal-row:last-child, .sh-entry:last-child { border-bottom: none; }
        .sh-bal-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .sh-bal-name { color: var(--text-primary); font-weight: 700; }
        .sh-bal-amt { font-size: 0.85rem; font-weight: 700; }
        .sh-bal-amt.pos { color: #22c55e; }
        .sh-bal-amt.neg { color: #ef4444; }
        .sh-bal-amt.zero { color: var(--text-secondary); font-weight: 500; }
        .sh-settle { background: transparent; border: 1px solid var(--accent-primary); color: var(--accent-primary); border-radius: var(--radius-md); padding: 7px 14px; font-weight: 700; font-size: 0.82rem; cursor: pointer; white-space: nowrap; }
        .sh-entry-meta { color: var(--text-secondary); font-size: 0.78rem; }
        .sh-entry-amt { color: var(--text-primary); font-weight: 800; white-space: nowrap; }
      `}</style>
    </div>
  );
}
