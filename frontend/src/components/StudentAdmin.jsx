import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Admin: Student plan verification. The review queue (student IDs and NYSC call-up
// letters; the image is deleted once decided), campaign codes for campus and CDS
// talks, and the school email domains that count.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

function ReviewImage({ id }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let revoke = '';
    axios.get(`${API_URL}/api/admin/student-reviews/${id}/image`, { ...auth(), responseType: 'blob' })
      .then((r) => { revoke = URL.createObjectURL(r.data); setUrl(revoke); }).catch(() => {});
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [id]);
  if (!url) return <p className="sa-muted">Loading the upload…</p>;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Uploaded document" className="sa-img" /></a>;
}

export default function StudentAdmin() {
  const [reviews, setReviews] = useState([]);
  const [codes, setCodes] = useState([]);
  const [domains, setDomains] = useState([]);
  const [reasons, setReasons] = useState({});
  const [newCode, setNewCode] = useState({ code: '', label: '', maxUses: 100 });
  const [newDomain, setNewDomain] = useState({ domain: '', institution: '' });
  const [msg, setMsg] = useState(null);
  const flash = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  const load = useCallback(async () => {
    const [r, c, d] = await Promise.all([
      axios.get(`${API_URL}/api/admin/student-reviews`, auth()).catch(() => null),
      axios.get(`${API_URL}/api/admin/campaign-codes`, auth()).catch(() => null),
      axios.get(`${API_URL}/api/admin/student-domains`, auth()).catch(() => null),
    ]);
    if (r) setReviews(r.data.items || []);
    if (c) setCodes(c.data.items || []);
    if (d) setDomains(d.data.items || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, approve) => {
    try {
      await axios.post(`${API_URL}/api/admin/student-reviews/${id}/decision`, { approve, reason: reasons[id] || '' }, auth());
      flash(approve ? 'Approved. The image is deleted.' : 'Rejected. The image is deleted.');
      load();
    } catch (e) { flash(e.response?.data?.message || 'Could not save that.', 'error'); }
  };
  const addCode = async (e) => {
    e.preventDefault();
    try { await axios.post(`${API_URL}/api/admin/campaign-codes`, newCode, auth()); setNewCode({ code: '', label: '', maxUses: 100 }); flash('Code created.'); load(); }
    catch (err) { flash(err.response?.data?.message || 'Could not create the code.', 'error'); }
  };
  const toggleCode = async (c) => { await axios.patch(`${API_URL}/api/admin/campaign-codes/${c._id}`, { active: !c.active }, auth()).catch(() => {}); load(); };
  const addDomain = async (e) => {
    e.preventDefault();
    try { await axios.post(`${API_URL}/api/admin/student-domains`, newDomain, auth()); setNewDomain({ domain: '', institution: '' }); flash('Domain added.'); load(); }
    catch (err) { flash(err.response?.data?.message || 'Could not add that domain.', 'error'); }
  };
  const removeDomain = async (d) => { if (!window.confirm(`Remove ${d.domain}?`)) return; await axios.delete(`${API_URL}/api/admin/student-domains/${d._id}`, auth()).catch(() => {}); load(); };

  return (
    <div className="sa">
      {msg && <div className={`message ${msg.type}`}>{msg.text}</div>}

      <section>
        <h3>Waiting for review <span className="sa-muted">({reviews.length})</span></h3>
        {!reviews.length && <p className="sa-muted">Nothing to check.</p>}
        {reviews.map((r) => (
          <div key={r.id} className="sa-card">
            <div className="sa-meta">
              <strong>{r.user?.name || 'Unknown'}</strong> <span className="sa-muted">{r.user?.email}</span>
              <div>{r.kind === 'nysc' ? `NYSC state code ${r.stateCode}` : `${r.institution} · matric ${r.matric}`}</div>
              <div className="sa-muted">Sent {new Date(r.createdAt).toLocaleString('en-NG')}</div>
            </div>
            <ReviewImage id={r.id} />
            <div className="sa-actions">
              <input aria-label="Reason (needed to reject)" placeholder="Reason, if rejecting" value={reasons[r.id] || ''} onChange={(e) => setReasons({ ...reasons, [r.id]: e.target.value })} />
              <button className="btn-danger" onClick={() => decide(r.id, false)}>Reject</button>
              <button className="btn-primary" onClick={() => decide(r.id, true)}>Approve</button>
            </div>
          </div>
        ))}
      </section>

      <section>
        <h3>Campaign codes</h3>
        <form className="sa-row" onSubmit={addCode}>
          <input aria-label="Code" placeholder="CDS-IKEJA" value={newCode.code} onChange={(e) => setNewCode({ ...newCode, code: e.target.value })} />
          <input aria-label="Label" placeholder="CDS Ikeja, Oct 2026" value={newCode.label} onChange={(e) => setNewCode({ ...newCode, label: e.target.value })} />
          <input aria-label="Max uses" type="number" min="1" value={newCode.maxUses} onChange={(e) => setNewCode({ ...newCode, maxUses: e.target.value })} />
          <button className="btn-primary" type="submit">Create</button>
        </form>
        <table className="sa-table">
          <thead><tr><th>Code</th><th>Label</th><th>Used</th><th></th></tr></thead>
          <tbody>{codes.map((c) => (
            <tr key={c._id} className={c.active ? '' : 'sa-off'}>
              <td>{c.code}</td><td>{c.label}</td><td>{c.uses} / {c.maxUses}</td>
              <td><button className="btn-secondary" onClick={() => toggleCode(c)}>{c.active ? 'Switch off' : 'Switch on'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section>
        <h3>School email domains <span className="sa-muted">({domains.length})</span></h3>
        <p className="sa-muted">A subdomain also counts: stu.cu.edu.ng matches cu.edu.ng.</p>
        <form className="sa-row" onSubmit={addDomain}>
          <input aria-label="Domain" placeholder="unilag.edu.ng" value={newDomain.domain} onChange={(e) => setNewDomain({ ...newDomain, domain: e.target.value })} />
          <input aria-label="Institution" placeholder="University of Lagos" value={newDomain.institution} onChange={(e) => setNewDomain({ ...newDomain, institution: e.target.value })} />
          <button className="btn-primary" type="submit">Add</button>
        </form>
        <div className="sa-chips">{domains.map((d) => (
          <span key={d._id} className="sa-chip">{d.domain}{d.institution ? ` · ${d.institution}` : ''} <button aria-label={`Remove ${d.domain}`} onClick={() => removeDomain(d)}>×</button></span>
        ))}</div>
      </section>

      <style>{`
        .sa { display: grid; gap: 24px; }
        .sa h3 { margin: 0 0 8px; color: var(--text-primary); }
        .sa-muted { color: var(--text-secondary); font-size: 0.85rem; font-weight: 500; }
        .sa-card { display: grid; grid-template-columns: 1fr 220px; gap: 12px; padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 10px; color: var(--text-primary); }
        .sa-img { width: 220px; max-height: 220px; object-fit: contain; border-radius: var(--radius-sm); background: var(--glass-bg); }
        .sa-actions { grid-column: 1 / -1; display: flex; gap: 8px; flex-wrap: wrap; }
        .sa-actions input, .sa-row input { flex: 1 1 180px; min-height: 40px; padding: 6px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); background: var(--bg-input, var(--bg-card)); color: var(--text-primary); font: inherit; }
        .sa-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
        .sa-table { width: 100%; border-collapse: collapse; color: var(--text-primary); }
        .sa-table th, .sa-table td { text-align: left; padding: 8px; border-bottom: 1px solid var(--border-color); font-size: 0.9rem; }
        .sa-off td { opacity: 0.55; }
        .sa-chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .sa-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 4px 4px 10px; border-radius: 999px; border: 1px solid var(--border-color); color: var(--text-primary); font-size: 0.82rem; }
        .sa-chip button { width: 28px; height: 28px; border: none; background: none; color: var(--text-secondary); cursor: pointer; font-size: 1rem; }
        @media (max-width: 640px) { .sa-card { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
