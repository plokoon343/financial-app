import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Connect from '@mono.co/connect.js';
import { API_URL } from '../config';

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const ConnectBank = () => {
  const [cfg, setCfg] = useState(null);        // { enabled, publicKey, connected, institution, accountName, lastSynced }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 4000); };

  const loadConfig = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/api/bank/mono-config`, authHeader());
      setCfg(res.data);
    } catch {
      flash('Could not load bank settings.', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  // Open Mono Connect, then exchange the returned code on our backend.
  const openConnect = () => {
    if (!cfg?.publicKey) { flash('Bank linking is not configured yet.', 'error'); return; }
    const connect = new Connect({
      key: cfg.publicKey,
      onSuccess: async ({ code }) => {
        setBusy(true);
        try {
          await axios.post(`${API_URL}/api/bank/connect`, { code }, authHeader());
          flash('Bank linked! Syncing your transactions…');
          await sync();           // pull transactions right away
          loadConfig();
        } catch (err) {
          flash(err.response?.data?.message || 'Could not link your bank.', 'error');
        } finally {
          setBusy(false);
        }
      },
      onClose: () => {},
    });
    connect.setup();
    connect.open();
  };

  const sync = async () => {
    setBusy(true);
    try {
      const res = await axios.post(`${API_URL}/api/bank/sync`, {}, authHeader());
      flash(res.data.imported > 0 ? `Imported ${res.data.imported} new transaction(s).` : 'You’re up to date — no new transactions.');
      loadConfig();
    } catch (err) {
      flash(err.response?.data?.message || 'Could not sync.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (accountId) => {
    if (!window.confirm('Disconnect this bank? Auto-import will stop. Imported transactions stay.')) return;
    setBusy(true);
    try {
      await axios.delete(`${API_URL}/api/bank/unlink`, { ...authHeader(), params: { accountId } });
      flash('Bank disconnected.');
      loadConfig();
    } catch {
      flash('Could not disconnect.', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="cb-loading">Loading…</div>;

  return (
    <div className="connect-bank">
      <div className="cb-head">
        <span className="cb-eyebrow">Key feature</span>
        <h2><i className="fas fa-building-columns"></i> Connect your bank</h2>
        <p>Link your bank account once and Automonie keeps your transactions up to date automatically — no more manual statement uploads.</p>
      </div>

      {message && <div className={`cb-msg ${message.type}`}>{message.text}</div>}

      {!cfg.enabled ? (
        <div className="cb-card cb-soon">
          <i className="fas fa-clock"></i>
          <h3>Coming soon</h3>
          <p>Secure bank connections are being set up. You’ll be able to link your bank here shortly. In the meantime, you can import statements from the Transactions page.</p>
        </div>
      ) : (
        <>
          {(cfg.banks || []).map((b) => (
            <div className="cb-card" key={b.accountId} style={{ marginBottom: 12 }}>
              <div className="cb-linked">
                <div className="cb-bank-ic"><i className="fas fa-check-circle"></i></div>
                <div>
                  <strong>{b.institution || 'Bank account'}</strong>
                  <span className="cb-sub">{b.accountName || 'Linked'} · {b.lastSynced ? `last synced ${new Date(b.lastSynced).toLocaleString()}` : 'not synced yet'}</span>
                </div>
              </div>
              <div className="cb-actions">
                <button className="cb-btn ghost" onClick={() => unlink(b.accountId)} disabled={busy}>
                  <i className="fas fa-unlink"></i> Disconnect
                </button>
              </div>
            </div>
          ))}
          {cfg.banks?.length > 0 && (
            <button className="cb-btn primary lg" onClick={sync} disabled={busy} style={{ marginBottom: 16 }}>
              <i className="fas fa-sync-alt"></i> {busy ? 'Working…' : 'Sync all banks'}
            </button>
          )}
          <div className="cb-card cb-connect">
            <div className="cb-bank-ic big"><i className="fas fa-link"></i></div>
            <h3>{cfg.banks?.length ? 'Add another bank' : 'No bank connected yet'}</h3>
            <p>Securely connect through Mono. We never see your bank login — only your transactions, to keep your books current.</p>
            <button className="cb-btn primary lg" onClick={openConnect} disabled={busy}>
              <i className="fas fa-building-columns"></i> {cfg.banks?.length ? 'Connect another bank' : 'Connect bank account'}
            </button>
            <p className="cb-secure"><i className="fas fa-lock"></i> Bank-grade, read-only access</p>
          </div>
        </>
      )}

      <style jsx="true">{`
        .connect-bank { padding: 20px; max-width: 760px; margin: 0 auto; }
        .cb-loading { text-align: center; padding: 60px; color: var(--text-secondary); }
        .cb-head { text-align: center; margin-bottom: 28px; }
        .cb-eyebrow { display: inline-block; font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--accent-primary); background: var(--glass-bg); padding: 5px 12px; border-radius: 999px; margin-bottom: 12px; }
        .cb-head h2 { color: var(--text-primary); display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 1.9rem; }
        .cb-head p { color: var(--text-secondary); max-width: 52ch; margin: 10px auto 0; }
        .cb-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; padding: 28px; text-align: center; }
        .cb-msg { padding: 12px 16px; border-radius: 12px; margin-bottom: 18px; text-align: center; }
        .cb-msg.success { background: rgba(34,197,94,.12); color: #22c55e; }
        .cb-msg.error { background: rgba(239,68,68,.12); color: #ef4444; }
        .cb-bank-ic { width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; background: var(--primarySoft, rgba(0,168,98,.12)); color: var(--accent-primary); font-size: 1.5rem; }
        .cb-bank-ic.big { width: 72px; height: 72px; font-size: 2rem; margin: 0 auto 12px; }
        .cb-connect h3, .cb-soon h3 { color: var(--text-primary); margin-bottom: 8px; }
        .cb-connect p, .cb-soon p { color: var(--text-secondary); max-width: 46ch; margin: 0 auto 20px; }
        .cb-soon i { font-size: 2rem; color: var(--accent-primary); margin-bottom: 12px; }
        .cb-linked { display: flex; align-items: center; gap: 14px; text-align: left; margin-bottom: 20px; }
        .cb-linked strong { color: var(--text-primary); display: block; font-size: 1.1rem; }
        .cb-sub { color: var(--text-secondary); font-size: .85rem; }
        .cb-actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
        .cb-btn { display: inline-flex; align-items: center; gap: 8px; border: none; border-radius: 12px; padding: 12px 22px; font-weight: 700; cursor: pointer; font-size: 1rem; }
        .cb-btn.lg { padding: 14px 28px; }
        .cb-btn.primary { background: var(--gradient-primary, #00a862); color: #fff; }
        .cb-btn.ghost { background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); }
        .cb-btn:disabled { opacity: .6; cursor: default; }
        .cb-secure { color: var(--text-secondary); font-size: .82rem; margin-top: 14px; display: flex; align-items: center; justify-content: center; gap: 6px; }
      `}</style>
    </div>
  );
};

export default ConnectBank;
