import React, { useState } from 'react';
import { Link } from 'react-router-dom';

// Cards shown inside Ask Automonie messages. Each one ends in an explicit button:
// nothing is saved, changed or deleted until the user taps it.

const naira = (n) => '₦' + Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-NG');

// A statement read by the existing statement reader, ready to import.
export function StatementCard({ card, onImport }) {
  const n = card.rows.length;
  if (card.status === 'done') return <div className="ai-card ai-card-done"><i className="fas fa-circle-check" aria-hidden="true"></i> {card.result}</div>;
  return (
    <div className="ai-card">
      <div className="ai-card-title"><i className="fas fa-file-invoice" aria-hidden="true"></i> {card.fileName}</div>
      <p className="ai-card-line">
        {n ? <><strong>{n}</strong> new transaction{n === 1 ? '' : 's'}{card.bank ? ` from ${card.bank}` : ''}: {naira(card.totalIn)} in, {naira(card.totalOut)} out.</> : 'No new transactions in this file.'}
        {card.dupCount > 0 && <> {card.dupCount} already in your records will be skipped.</>}
      </p>
      {card.warnings.filter((w) => !/already exist/.test(w)).map((w) => <p key={w} className="ai-card-note">{w}</p>)}
      {card.uncertainCount > 0 && <p className="ai-card-note">{card.uncertainCount} row{card.uncertainCount === 1 ? '' : 's'} could use a check. You can review them one by one in <Link to="/import-statement">Import</Link>.</p>}
      {n > 0 && (
        <div className="ai-card-actions">
          <button type="button" className="btn-primary" disabled={card.status === 'busy'} onClick={onImport}>
            {card.status === 'busy' ? 'Importing…' : `Import ${n}`}
          </button>
          <Link className="btn-secondary" to="/import-statement">Review in Import</Link>
        </div>
      )}
      {card.error && <p className="ai-card-err">{card.error}</p>}
    </div>
  );
}

// A password-protected PDF: ask for the password, then read it again.
export function PasswordCard({ card, onSubmit }) {
  const [pw, setPw] = useState('');
  if (card.status === 'done') return null;
  return (
    <form className="ai-card" onSubmit={(e) => { e.preventDefault(); if (pw.trim()) onSubmit(pw.trim()); }}>
      <div className="ai-card-title"><i className="fas fa-lock" aria-hidden="true"></i> {card.fileName} is password protected</div>
      {card.wrong && <p className="ai-card-err">That password didn&apos;t open it. Try again.</p>}
      <input className="ai-card-input" type="password" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Statement password" aria-label="Statement password" />
      <p className="ai-card-note">Used once to open the file. We don&apos;t save it.</p>
      <div className="ai-card-actions">
        <button type="submit" className="btn-primary" disabled={!pw.trim() || card.status === 'busy'}>{card.status === 'busy' ? 'Reading…' : 'Open and read'}</button>
      </div>
    </form>
  );
}

// A receipt read on this device: the user checks the fields, then saves.
export function ReceiptCard({ card, onSave }) {
  const [f, setF] = useState({ merchant: card.merchant || '', amount: card.total ? String(card.total) : '', date: card.date || new Date().toISOString().slice(0, 10), category: card.category || '' });
  if (card.status === 'done') return <div className="ai-card ai-card-done"><i className="fas fa-circle-check" aria-hidden="true"></i> {card.result}</div>;
  const ok = f.merchant.trim() && Number(f.amount) > 0 && f.date && f.category;
  return (
    <div className="ai-card">
      <div className="ai-card-title"><i className="fas fa-receipt" aria-hidden="true"></i> Receipt</div>
      <div className="ai-card-grid">
        <label>Shop<input className="ai-card-input" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} /></label>
        <label>Amount (₦)<input className="ai-card-input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/[^\d.]/g, '') })} /></label>
        <label>Date<input className="ai-card-input" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
        <label>Category
          <select className="ai-card-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Choose…</option>
            {card.categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <p className="ai-card-note">Read on this device: the photo never left it. Check the amount before saving.</p>
      <div className="ai-card-actions">
        <button type="button" className="btn-primary" disabled={!ok || card.status === 'busy'} onClick={() => onSave({ ...f, amount: Number(f.amount) })}>
          {card.status === 'busy' ? 'Saving…' : 'Save expense'}
        </button>
      </div>
      {card.error && <p className="ai-card-err">{card.error}</p>}
    </div>
  );
}

// An edit or delete the assistant proposed. It runs only when the user confirms.
export function ProposalCard({ action, onConfirm, onCancel, stale }) {
  const p = action.proposal;
  const isDelete = p.kind === 'delete';
  if (action.resolved) return <div className="ai-card ai-card-done"><i className={`fas ${action.resolvedOk ? 'fa-circle-check' : 'fa-circle-xmark'}`} aria-hidden="true"></i> {action.resolved}</div>;
  const changes = Object.entries(p.changes || {}).map(([k, v]) => `${k === 'amount' ? 'amount' : k} to ${k === 'amount' ? naira(v) : v}`).join(', ');
  return (
    <div className="ai-card">
      <div className="ai-card-title"><i className={`fas ${isDelete ? 'fa-trash' : 'fa-pen'}`} aria-hidden="true"></i> {isDelete ? 'Delete this transaction?' : 'Change this transaction?'}</div>
      <p className="ai-card-line">{p.label}</p>
      {!isDelete && <p className="ai-card-line">Change {changes}.</p>}
      {stale
        ? <p className="ai-card-note">This was proposed in an earlier chat and wasn&apos;t confirmed. Ask again to make the change.</p>
        : (
          <div className="ai-card-actions">
            <button type="button" className={isDelete ? 'btn-danger' : 'btn-primary'} disabled={action.busy} onClick={onConfirm}>{action.busy ? 'Working…' : isDelete ? 'Confirm delete' : 'Confirm change'}</button>
            <button type="button" className="btn-secondary" disabled={action.busy} onClick={onCancel}>Cancel</button>
          </div>
        )}
    </div>
  );
}
