import React, { useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import Select from './Select';

// Pick a bank: banks, microfinance banks and fintechs/wallets in groups, searchable,
// plus "My bank isn't listed" to add one by name. A bank added here is saved for the
// user (and counted, without their name, so common ones join the list).
const GROUPS = [['bank', 'Banks'], ['mfb', 'Microfinance banks'], ['fintech', 'Fintechs and wallets']];
const KINDS = [['bank', 'Bank'], ['mfb', 'Microfinance bank (MFB)'], ['fintech', 'Fintech or wallet']];
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export default function BankPicker({ banks, setBanks, value, onChange, id, className = '', placeholder = 'Choose the bank', 'aria-label': ariaLabel = 'Bank' }) {
  const [adding, setAdding] = useState(null); // { name, type } while the form is open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = banks.filter((b) => b.custom);

  const save = async (e) => {
    e?.preventDefault();
    if (!adding.name.trim()) { setError('Type the bank’s name.'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await axios.post(`${API_URL}/api/banks/custom`, adding, auth());
      const b = data.bank;
      if (!banks.some((x) => x.code === b.code)) setBanks?.((list) => [...list, b]);
      onChange(b.code);
      setAdding(null);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not add the bank. Try again.');
    } finally { setBusy(false); }
  };

  if (adding) {
    return (
      <div className={`bank-add ${className}`} role="group" aria-label="Add your bank">
        <input
          autoFocus
          aria-label="Bank name"
          placeholder="Bank name, e.g. Allworkers MFB"
          maxLength={40}
          value={adding.name}
          onChange={(e) => setAdding({ ...adding, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') save(e); if (e.key === 'Escape') setAdding(null); }}
        />
        <Select aria-label="Kind of bank" value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <button type="button" className="btn-primary" onClick={save} disabled={busy || !adding.name.trim()}>{busy ? 'Adding…' : 'Add bank'}</button>
        <button type="button" className="btn-secondary" onClick={() => { setAdding(null); setError(''); }}>Cancel</button>
        {error && <span className="bank-add-err" role="alert">{error}</span>}
        <style>{`
          .bank-add { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; flex: 1 1 100%; }
          .bank-add input { flex: 1 1 200px; min-height: 44px; padding: 9px 12px; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-md); font: inherit; }
          .bank-add input:focus { outline: none; border-color: var(--teal); box-shadow: 0 0 0 3px rgba(19, 157, 160, 0.28); }
          .bank-add-err { flex: 1 1 100%; color: var(--error-color); font-size: 0.85rem; }
        `}</style>
      </div>
    );
  }

  return (
    <Select
      id={id}
      className={className}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      searchable
      footer={{ label: 'My bank isn’t listed', onClick: (q) => setAdding({ name: q || '', type: 'mfb' }) }}
    >
      {GROUPS.map(([type, label]) => (
        <optgroup key={type} label={label}>
          {banks.filter((b) => !b.custom && (b.type || 'bank') === type).map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </optgroup>
      ))}
      {mine.length > 0 && (
        <optgroup label="Added by you">
          {mine.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </optgroup>
      )}
    </Select>
  );
}
