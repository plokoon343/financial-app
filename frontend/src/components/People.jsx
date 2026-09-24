import React, { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { allCategoriesFor } from '../utils/categoryStore';

// People & Family ledger — everyone you send to or receive from, built from your
// transfer counterparties. Tag a contact as family/friend/business (or set a category)
// and their transfers get categorised automatically, now and going forward.

const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
const initials = (name) => (name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const REL = [
  { id: 'family', label: 'Family', icon: 'fa-house-user' },
  { id: 'friend', label: 'Friend', icon: 'fa-user-group' },
  { id: 'business', label: 'Business', icon: 'fa-store' },
];
// A soft, consistent colour per name for the avatar.
const hue = (s) => { let h = 0; for (const ch of (s || '')) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

export default function People() {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [filter, setFilter] = useState('all'); // all | family | suggested
  const cats = allCategoriesFor('expense');
  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2200); };

  const load = useCallback(async (rebuildIfEmpty = false) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/contacts`, headers);
      let list = data.contacts || [];
      // First visit for an existing user: build the ledger from their history once.
      if (rebuildIfEmpty && list.length === 0) {
        await axios.post(`${API_URL}/api/contacts/rebuild`, {}, headers);
        const r = await axios.get(`${API_URL}/api/contacts`, headers);
        list = r.data.contacts || [];
      }
      setContacts(list);
    } catch { /* offline / cold start */ }
    finally { setLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(true); }, [load]);

  const patch = async (c, body, note) => {
    setBusy(c.id);
    try {
      const { data } = await axios.patch(`${API_URL}/api/contacts/${c.id}`, { ...body, applyToPast: true }, headers);
      flash(note + (data.recategorized ? ` · ${data.recategorized} transfer${data.recategorized !== 1 ? 's' : ''} recategorised` : ''));
      await load();
    } catch { flash('Could not save — try again'); }
    finally { setBusy(''); }
  };

  const rebuild = async () => {
    setBusy('rebuild');
    try { await axios.post(`${API_URL}/api/contacts/rebuild`, {}, headers); await load(); flash('Ledger rebuilt'); }
    catch { flash('Rebuild failed'); }
    finally { setBusy(''); }
  };

  const suggestedCount = contacts.filter((c) => c.familySuggested && c.relationship === 'unknown').length;
  const shown = contacts.filter((c) =>
    filter === 'all' ? true : filter === 'family' ? c.relationship === 'family' : (c.familySuggested && c.relationship === 'unknown'));

  if (loading) return <div className="ppl-wrap"><div className="ppl-empty">Loading your people…</div></div>;

  return (
    <div className="ppl-wrap">
      <div className="ppl-head">
        <div>
          <h1>People &amp; Family</h1>
          <p>Everyone you send to and receive from. Tag someone and their transfers categorise themselves.</p>
        </div>
        <button className="ppl-rebuild" onClick={rebuild} disabled={busy === 'rebuild'}>
          <i className="fas fa-rotate" /> {busy === 'rebuild' ? 'Rebuilding…' : 'Rebuild'}
        </button>
      </div>

      {contacts.length === 0 ? (
        <div className="ppl-empty">
          <i className="fas fa-user-group" style={{ fontSize: 30, opacity: 0.4 }} /><br /><br />
          No contacts yet. Import a statement or paste bank alerts with transfers, and the people you
          transact with will show up here.
        </div>
      ) : (
        <>
          {suggestedCount > 0 && (
            <div className="ppl-suggest">
              <i className="fas fa-wand-magic-sparkles" />
              <span><strong>{suggestedCount}</strong> {suggestedCount === 1 ? 'contact shares' : 'contacts share'} your surname — possibly family. Tap “Family” to confirm.</span>
            </div>
          )}

          <div className="ppl-tabs">
            {[['all', `All (${contacts.length})`], ['family', 'Family'], ['suggested', `Suggested${suggestedCount ? ` (${suggestedCount})` : ''}`]].map(([id, lbl]) => (
              <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{lbl}</button>
            ))}
          </div>

          <div className="ppl-list">
            {shown.map((c) => (
              <div key={c.id} className={`ppl-card ${c.familySuggested && c.relationship === 'unknown' ? 'sug' : ''}`}>
                <div className="ppl-top">
                  <div className="ppl-av" style={{ background: `hsl(${hue(c.realName)} 65% 92%)`, color: `hsl(${hue(c.realName)} 55% 32%)` }}>{initials(c.realName)}</div>
                  <div className="ppl-id">
                    <div className="ppl-name">{c.name}{c.familySuggested && c.relationship === 'unknown' && <span className="ppl-fam">family?</span>}</div>
                    <div className="ppl-sub">{[c.bank, c.account].filter(Boolean).join(' · ') || 'Unknown account'}</div>
                  </div>
                  <div className="ppl-net">
                    <div className={`ppl-netv ${c.net >= 0 ? 'pos' : 'neg'}`}>{c.net >= 0 ? '+' : '−'}{naira(Math.abs(c.net))}</div>
                    <div className="ppl-sub">net</div>
                  </div>
                </div>

                <div className="ppl-stats">
                  <span><i className="fas fa-arrow-up" style={{ color: '#e53e3e' }} /> Sent {naira(c.sentTotal)} · {c.sentCount}</span>
                  <span><i className="fas fa-arrow-down" style={{ color: '#38a169' }} /> Got {naira(c.receivedTotal)} · {c.receivedCount}</span>
                </div>

                <div className="ppl-actions">
                  {REL.map((r) => (
                    <button key={r.id} disabled={busy === c.id}
                      className={`ppl-rel ${c.relationship === r.id ? 'on' : ''}`}
                      onClick={() => patch(c, { relationship: c.relationship === r.id ? 'unknown' : r.id }, c.relationship === r.id ? 'Cleared' : `Tagged ${r.label}`)}>
                      <i className={`fas ${r.icon}`} /> {r.label}
                    </button>
                  ))}
                  <select value={c.category} disabled={busy === c.id}
                    onChange={(e) => patch(c, { category: e.target.value }, e.target.value ? `Category → ${e.target.value}` : 'Category cleared')}
                    title="Auto-category for this person's transfers">
                    <option value="">Auto-category…</option>
                    {cats.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {toast && <div className="ppl-toast">{toast}</div>}

      <style jsx="true">{`
        .ppl-wrap { max-width: 860px; margin: 0 auto; }
        .ppl-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; margin-bottom: 1.25rem; }
        .ppl-head h1 { margin: 0 0 0.25rem; font-size: 1.5rem; color: var(--text-primary, #1a365d); }
        .ppl-head p { margin: 0; color: var(--text-secondary, #718096); font-size: 0.9rem; max-width: 46ch; }
        .ppl-rebuild { flex-shrink: 0; background: var(--card-bg, #fff); border: 1px solid var(--glass-border, #e2e8f0); color: var(--text-primary, #1a365d);
          padding: 0.5rem 0.9rem; border-radius: 10px; font-weight: 600; cursor: pointer; font-size: 0.85rem; }
        .ppl-empty { text-align: center; color: var(--text-secondary, #718096); padding: 3rem 1rem; line-height: 1.6; }
        .ppl-suggest { display: flex; gap: 0.6rem; align-items: center; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3);
          color: var(--text-primary, #1a365d); padding: 0.7rem 0.9rem; border-radius: 12px; font-size: 0.88rem; margin-bottom: 1rem; }
        .ppl-suggest i { color: #6366f1; }
        .ppl-tabs { display: flex; gap: 0.4rem; margin-bottom: 1rem; }
        .ppl-tabs button { background: transparent; border: 1px solid var(--glass-border, #e2e8f0); color: var(--text-secondary, #718096);
          padding: 0.4rem 0.85rem; border-radius: 999px; font-weight: 600; cursor: pointer; font-size: 0.82rem; }
        .ppl-tabs button.on { background: var(--accent-primary, #008751); color: #fff; border-color: transparent; }
        .ppl-list { display: grid; gap: 0.75rem; }
        .ppl-card { background: var(--card-bg, #fff); border: 1px solid var(--glass-border, #e2e8f0); border-radius: 14px; padding: 0.9rem 1rem; }
        .ppl-card.sug { border-color: rgba(99,102,241,0.4); }
        .ppl-top { display: flex; align-items: center; gap: 0.75rem; }
        .ppl-av { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.9rem; flex-shrink: 0; }
        .ppl-id { flex: 1; min-width: 0; }
        .ppl-name { font-weight: 700; color: var(--text-primary, #1a365d); font-size: 0.95rem; display: flex; align-items: center; gap: 0.4rem; }
        .ppl-fam { font-size: 0.62rem; background: rgba(99,102,241,0.15); color: #6366f1; padding: 1px 6px; border-radius: 6px; font-weight: 700; text-transform: uppercase; }
        .ppl-sub { color: var(--text-secondary, #718096); font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ppl-net { text-align: right; flex-shrink: 0; }
        .ppl-netv { font-weight: 800; font-size: 0.95rem; }
        .ppl-netv.pos { color: #38a169; } .ppl-netv.neg { color: #e53e3e; }
        .ppl-stats { display: flex; gap: 1rem; flex-wrap: wrap; margin: 0.7rem 0 0.8rem; font-size: 0.8rem; color: var(--text-secondary, #718096); }
        .ppl-actions { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
        .ppl-rel { display: inline-flex; align-items: center; gap: 0.3rem; background: transparent; border: 1px solid var(--glass-border, #e2e8f0);
          color: var(--text-secondary, #718096); padding: 0.35rem 0.7rem; border-radius: 999px; font-weight: 600; cursor: pointer; font-size: 0.78rem; }
        .ppl-rel.on { background: var(--accent-primary, #008751); color: #fff; border-color: transparent; }
        .ppl-actions select { margin-left: auto; background: var(--bg-input, #f8fafc); border: 1px solid var(--glass-border, #e2e8f0);
          color: var(--text-primary, #1a365d); border-radius: 8px; padding: 0.35rem 0.5rem; font-size: 0.78rem; cursor: pointer; max-width: 160px; }
        .ppl-toast { position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%); background: #1a365d; color: #fff;
          padding: 0.6rem 1.1rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; z-index: 1200; box-shadow: 0 8px 24px rgba(0,0,0,0.2); }
        @media (max-width: 520px) { .ppl-actions select { margin-left: 0; width: 100%; max-width: none; } }
      `}</style>
    </div>
  );
}
