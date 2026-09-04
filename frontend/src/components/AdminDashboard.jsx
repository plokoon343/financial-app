import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';

const AdminDashboard = () => {
  const { user, darkMode } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [recapCfg, setRecapCfg] = useState(null);
  const [accuracy, setAccuracy] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);
  const [search, setSearch] = useState('');

  const cardStyle = {
    background: darkMode ? '#2d3748' : 'white',
    border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`,
    borderRadius: '12px', padding: '1.5rem',
    boxShadow: darkMode ? '0 4px 12px rgba(0,0,0,0.2)' : '0 4px 12px rgba(0,0,0,0.05)'
  };
  const textPrimary = { color: darkMode ? '#f7fafc' : '#1a365d' };
  const textSecondary = { color: darkMode ? '#a0aec0' : '#718096' };

  // Compact currency for big platform totals so they never overflow the card
  // (e.g. ₦50.5B). Full value shown on hover.
  const compactNaira = (n) => {
    const v = Number(n) || 0;
    const abs = Math.abs(v);
    const fmt = (x, s) => `₦${x.toFixed(x >= 100 ? 0 : x >= 10 ? 1 : 2)}${s}`;
    if (abs >= 1e12) return fmt(v / 1e12, 'T');
    if (abs >= 1e9) return fmt(v / 1e9, 'B');
    if (abs >= 1e6) return fmt(v / 1e6, 'M');
    if (abs >= 1e3) return fmt(v / 1e3, 'K');
    return `₦${v.toLocaleString()}`;
  };
  const fullNaira = (n) => `₦${(Number(n) || 0).toLocaleString()}`;
// eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };
      const [statsRes, usersRes, ticketsRes, waitlistRes, recapRes, accRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/stats`, { headers }),
        axios.get(`${API_URL}/api/admin/users`, { headers }),
        axios.get(`${API_URL}/api/admin/tickets`, { headers }),
        axios.get(`${API_URL}/api/admin/waitlist`, { headers }),
        axios.get(`${API_URL}/api/recaps/config`, { headers }),
        axios.get(`${API_URL}/api/admin/ingestion/accuracy`, { headers }).catch(() => ({ data: null })),
      ]);
      setStats(statsRes.data);
      setUsers(usersRes.data);
      setTickets(ticketsRes.data);
      setWaitlist(waitlistRes.data.items || []);
      setRecapCfg(recapRes.data);
      setAccuracy(accRes.data);
    } catch (error) { showMessage('Failed to load data', 'error'); }
    finally { setLoading(false); }
  };

  const setRecapRule = async (window, rule) => {
    try {
      const token = localStorage.getItem('token');
      const res = await axios.patch(`${API_URL}/api/admin/recaps`, { [window]: rule }, { headers: { Authorization: `Bearer ${token}` } });
      setRecapCfg(res.data);
      showMessage(`${window} recaps → ${rule}`);
    } catch { showMessage('Could not update recap release', 'error'); }
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleRoleChange = async (userId, newRole) => {
    setActionLoading(userId + '_role');
    try {
      const token = localStorage.getItem('token');
      await axios.patch(`${API_URL}/api/admin/users/${userId}/role`, { role: newRole }, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, role: newRole } : u));
      showMessage('Role updated');
    } catch (error) { showMessage(error.response?.data?.message || 'Failed', 'error'); }
    finally { setActionLoading(null); }
  };

  const handleToggleStatus = async (userId) => {
    setActionLoading(userId + '_status');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.patch(`${API_URL}/api/admin/users/${userId}/status`, {}, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(prev => prev.map(u => u._id === userId ? { ...u, isActive: res.data.user.isActive } : u));
      showMessage(res.data.message);
    } catch (error) { showMessage(error.response?.data?.message || 'Failed', 'error'); }
    finally { setActionLoading(null); }
  };

  const handleDeleteUser = async (userId, userName) => {
    if (!window.confirm(`Delete ${userName} and all their data? This cannot be undone.`)) return;
    setActionLoading(userId + '_delete');
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`${API_URL}/api/admin/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
      setUsers(prev => prev.filter(u => u._id !== userId));
      showMessage('User deleted');
    } catch (error) { showMessage(error.response?.data?.message || 'Failed', 'error'); }
    finally { setActionLoading(null); }
  };

  const testEmail = async () => {
    setActionLoading('email');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.get(`${API_URL}/api/admin/test-email`, { headers: { Authorization: `Bearer ${token}` } });
      showMessage(res.data.message || 'Test email sent - check inbox & spam');
    } catch (error) {
      const d = error.response?.data;
      showMessage(`Email failed: ${d?.message || 'error'}${d?.code ? ' (' + d.code + ')' : ''}`, 'error');
      console.log('Email diagnostic:', d);
    } finally { setActionLoading(null); }
  };

  const handleTicketStatus = async (id, status) => {
    setActionLoading(id + '_ticket');
    try {
      const token = localStorage.getItem('token');
      const res = await axios.patch(`${API_URL}/api/admin/tickets/${id}`, { status }, { headers: { Authorization: `Bearer ${token}` } });
      setTickets(prev => prev.map(t => t._id === id ? res.data : t));
      showMessage(`Ticket marked ${status}`);
    } catch (error) { showMessage(error.response?.data?.message || 'Failed', 'error'); }
    finally { setActionLoading(null); }
  };

  const q = search.trim().toLowerCase();
  const filteredUsers = users.filter(u => !q || [u.name, u.email, u.role].some(v => (v || '').toLowerCase().includes(q)));
  const filteredTickets = tickets.filter(t => !q || [t.subject, t.message, t.name, t.email, t.status].some(v => (v || '').toLowerCase().includes(q)));
  const searchInput = (placeholder) => (
    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder}
      style={{ padding: '0.55rem 0.9rem', borderRadius: '8px', border: `1px solid ${darkMode ? '#4a5568' : '#cbd5e1'}`, background: darkMode ? '#1a202c' : '#fff', color: darkMode ? '#f7fafc' : '#1a365d', fontSize: '0.9rem', minWidth: '240px', outline: 'none' }} />
  );

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: 'var(--accent-primary)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>;
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {message && <div style={{ position: 'fixed', top: '1rem', right: '1rem', padding: '1rem 1.5rem', background: message.type === 'error' ? '#e53e3e' : '#38a169', color: 'white', borderRadius: '8px', zIndex: 9999, fontWeight: '600' }}>{message.text}</div>}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div><h1 style={{ ...textPrimary, fontSize: '2rem', fontWeight: '700', margin: 0 }}>Admin Dashboard</h1><p style={{ ...textSecondary, marginTop: '0.25rem' }}>Welcome back, {user?.name}</p></div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={testEmail} disabled={actionLoading === 'email'} style={{ padding: '0.75rem 1.25rem', background: 'transparent', color: 'var(--accent-primary)', border: '1px solid var(--accent-primary)', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>{actionLoading === 'email' ? 'Sending…' : 'Test email'}</button>
          <button onClick={fetchData} style={{ padding: '0.75rem 1.5rem', background: 'var(--gradient-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>Refresh</button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', background: darkMode ? '#4a5568' : '#f1f5f9', padding: '0.25rem', borderRadius: '10px', width: 'fit-content' }}>
        {['overview', 'accuracy', 'users', 'tickets', 'waitlist', 'recaps'].map(tab => {
          const openCount = tab === 'tickets' ? tickets.filter(t => t.status === 'open').length : 0;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{ padding: '0.6rem 1.5rem', border: 'none', borderRadius: '8px', background: activeTab === tab ? 'var(--gradient-primary)' : 'transparent', color: activeTab === tab ? 'white' : (darkMode ? '#cbd5e0' : '#4a5568'), fontWeight: '600', cursor: 'pointer', textTransform: 'capitalize' }}>
              {tab}{openCount > 0 && <span style={{ marginLeft: '0.4rem', background: '#e53e3e', color: 'white', borderRadius: '10px', padding: '0 0.45rem', fontSize: '0.72rem' }}>{openCount}</span>}
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && stats && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
            {[
              { label: 'Total Users', value: stats.totalUsers, color: 'var(--accent-primary)' },
              { label: 'Active Users', value: stats.activeUsers, color: '#38a169' },
              { label: 'Inactive Users', value: stats.inactiveUsers, color: '#e53e3e' },
              { label: 'Total Transactions', value: stats.totalTransactions, color: '#805ad5' },
              { label: 'Waitlist Signups', value: stats.waitlistCount ?? 0, color: '#00a862' },
              { label: 'Platform Income', value: compactNaira(stats.platformIncome), title: fullNaira(stats.platformIncome), color: '#38a169' },
              { label: 'Platform Expenses', value: compactNaira(stats.platformExpenses), title: fullNaira(stats.platformExpenses), color: '#e53e3e' }
            ].map(stat => <div key={stat.label} style={{ ...cardStyle, minWidth: 0 }}><p style={{ ...textSecondary, fontSize: '0.85rem', fontWeight: '600', margin: '0 0 0.5rem' }}>{stat.label}</p><p title={stat.title || undefined} style={{ color: stat.color, fontSize: '1.6rem', fontWeight: '700', margin: 0, overflowWrap: 'anywhere' }}>{stat.value}</p></div>)}
          </div>
          <div style={cardStyle}>
            <h3 style={{ ...textPrimary, marginBottom: '1rem' }}>Recently Registered Users</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Name', 'Email', 'Role', 'Joined'].map(h => <th key={h} style={{ ...textSecondary, textAlign: 'left', padding: '0.75rem', fontSize: '0.85rem', fontWeight: '600', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}` }}>{h}</th>)}</tr></thead>
              <tbody>{stats.recentUsers.map(u => <tr key={u._id}><td style={{ ...textPrimary, padding: '0.75rem' }}>{u.name}</td><td style={{ ...textSecondary, padding: '0.75rem' }}>{u.email}</td><td style={{ padding: '0.75rem' }}><span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: u.role === 'superadmin' ? '#553c9a' : '#2b6cb0', color: 'white' }}>{u.role}</span></td><td style={{ ...textSecondary, padding: '0.75rem' }}>{new Date(u.createdAt).toLocaleDateString()}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'accuracy' && (
        <>
          {!accuracy ? (
            <div style={cardStyle}><p style={{ ...textSecondary, margin: 0 }}>No ingestion data yet. Accuracy fills in as users import statements and correct parsed rows.</p></div>
          ) : (() => {
            const c = accuracy.corrections, r = accuracy.reconciliation;
            const rateColor = (rate, good) => (good ? (rate >= 95 ? '#38a169' : rate >= 85 ? '#dd6b20' : '#e53e3e') : (rate <= 5 ? '#38a169' : rate <= 15 ? '#dd6b20' : '#e53e3e'));
            const kpi = (label, value, color, title) => <div key={label} style={{ ...cardStyle, minWidth: 0 }}><p style={{ ...textSecondary, fontSize: '0.85rem', fontWeight: 600, margin: '0 0 0.5rem' }}>{label}</p><p title={title} style={{ color, fontSize: '1.6rem', fontWeight: 700, margin: 0 }}>{value}</p></div>;
            const th = (h) => <th key={h} style={{ ...textSecondary, textAlign: 'left', padding: '0.6rem 0.75rem', fontSize: '0.8rem', fontWeight: 600, borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, whiteSpace: 'nowrap' }}>{h}</th>;
            const td = (child, extra) => <td style={{ padding: '0.6rem 0.75rem', ...textPrimary, ...extra }}>{child}</td>;
            return (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '1.25rem', marginBottom: '1.5rem' }}>
                  {kpi('Correction rate', `${c.overallRate}%`, rateColor(c.overallRate, false), `${c.corrected} of ${c.total} parsed rows were edited`)}
                  {kpi('Amount fixes ⚠', `${c.amountFixRate}%`, rateColor(c.amountFixRate, false), `${c.amountFix} amount corrections — the emergency metric`)}
                  {kpi('Statements reconciled', r.checked ? `${r.reconcileRate}%` : '—', rateColor(r.reconcileRate, true), `${r.balanced} of ${r.checked} verifiable imports balanced`)}
                  {kpi('Imports', `${r.imports}`, 'var(--accent-primary)', `${r.checkedRate}% had balances to verify`)}
                  {kpi('Labelled samples', `${c.total}`, '#805ad5', 'From the preview-gate correction log')}
                </div>

                <div style={cardStyle}>
                  <h3 style={{ ...textPrimary, marginTop: 0, marginBottom: '0.5rem' }}>Which bank is failing users?</h3>
                  <p style={{ ...textSecondary, fontSize: '0.85rem', marginTop: 0 }}>Ranked worst-first. Amount fixes and low reconcile rates are the red flags.</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead><tr>{['Bank', 'Samples', 'Correction %', 'Amount fixes', 'Imports', 'Reconciled %'].map(th)}</tr></thead>
                      <tbody>
                        {accuracy.banks.length === 0 && <tr><td colSpan={6} style={{ ...textSecondary, padding: '1rem', textAlign: 'center' }}>No bank data yet.</td></tr>}
                        {accuracy.banks.map((b) => (
                          <tr key={b.bank}>
                            {td(<strong>{b.bank}</strong>)}
                            {td(b.samples)}
                            {td(<span style={{ color: rateColor(b.correctionRate, false), fontWeight: 700 }}>{b.correctionRate}%</span>)}
                            {td(<span style={{ color: b.amountFix > 0 ? '#e53e3e' : (textSecondary.color), fontWeight: b.amountFix > 0 ? 700 : 400 }}>{b.amountFix}{b.samples ? ` (${b.amountFixRate}%)` : ''}</span>)}
                            {td(b.imports)}
                            {td(b.reconcileChecked ? <span style={{ color: rateColor(b.reconcileRate, true), fontWeight: 700 }}>{b.reconcileRate}%</span> : <span style={textSecondary}>—</span>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginTop: '1.5rem' }}>
                  <div style={cardStyle}>
                    <h3 style={{ ...textPrimary, marginTop: 0 }}>Corrections by field</h3>
                    {c.byField.length === 0 ? <p style={textSecondary}>None yet.</p> : c.byField.map((f) => (
                      <div key={f.field} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: `1px solid ${darkMode ? '#2d3748' : '#edf2f7'}` }}>
                        <span style={{ ...textPrimary, textTransform: 'capitalize', fontWeight: (f.field === 'amount' || f.field === 'direction') ? 700 : 400, color: (f.field === 'amount' || f.field === 'direction') ? '#e53e3e' : textPrimary.color }}>{f.field}{(f.field === 'amount' || f.field === 'direction') ? ' ⚠' : ''}</span>
                        <span style={textSecondary}>{f.count}</span>
                      </div>
                    ))}
                  </div>
                  <div style={cardStyle}>
                    <h3 style={{ ...textPrimary, marginTop: 0 }}>By source</h3>
                    {c.bySource.map((s) => (
                      <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: `1px solid ${darkMode ? '#2d3748' : '#edf2f7'}` }}>
                        <span style={{ ...textPrimary, textTransform: 'capitalize' }}>{s.key}</span>
                        <span style={textSecondary}>{s.total} rows · {s.rate}% edited</span>
                      </div>
                    ))}
                    <h3 style={{ ...textPrimary, marginBottom: '0.5rem' }}>Parser path</h3>
                    {c.byParserPath.map((p) => (
                      <div key={p.path} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.3rem 0' }}>
                        <span style={{ ...textPrimary, textTransform: 'capitalize' }}>{p.path.replace('_', ' ')}</span>
                        <span style={textSecondary}>{p.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            );
          })()}
        </>
      )}

      {activeTab === 'users' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <h3 style={{ ...textPrimary, margin: 0 }}>All Users ({filteredUsers.length}{q ? ` of ${users.length}` : ''})</h3>
            {searchInput('Search name, email or role')}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Name', 'Email', 'Role', 'Status', 'Transactions', 'Joined', 'Actions'].map(h => <th key={h} style={{ ...textSecondary, textAlign: 'left', padding: '0.75rem', fontSize: '0.85rem', fontWeight: '600', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{filteredUsers.map(u => <tr key={u._id} style={{ opacity: u.isActive ? 1 : 0.6 }}><td style={{ ...textPrimary, padding: '0.75rem', fontWeight: '600' }}>{u.name}{u._id === user.id && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent-primary)' }}>(you)</span>}</td><td style={{ ...textSecondary, padding: '0.75rem' }}>{u.email}</td><td style={{ padding: '0.75rem' }}><span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: u.role === 'superadmin' ? '#553c9a' : '#2b6cb0', color: 'white' }}>{u.role}</span></td><td style={{ padding: '0.75rem' }}><span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: u.isActive ? '#276749' : '#742a2a', color: u.isActive ? '#c6f6d5' : '#fed7d7' }}>{u.isActive ? 'Active' : 'Inactive'}</span></td><td style={{ ...textSecondary, padding: '0.75rem' }}>{u.stats?.transactionCount || 0}</td><td style={{ ...textSecondary, padding: '0.75rem', whiteSpace: 'nowrap' }}>{new Date(u.createdAt).toLocaleDateString()}</td><td style={{ padding: '0.75rem' }}>{u._id !== user.id && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}><button onClick={() => handleRoleChange(u._id, u.role === 'superadmin' ? 'user' : 'superadmin')} disabled={actionLoading === u._id + '_role'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: '#805ad5', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_role' ? '...' : (u.role === 'superadmin' ? 'Demote' : 'Promote')}</button><button onClick={() => handleToggleStatus(u._id)} disabled={actionLoading === u._id + '_status'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: u.isActive ? '#dd6b20' : '#38a169', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_status' ? '...' : (u.isActive ? 'Deactivate' : 'Activate')}</button><button onClick={() => handleDeleteUser(u._id, u.name)} disabled={actionLoading === u._id + '_delete'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: '#e53e3e', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_delete' ? '...' : 'Delete'}</button></div>}</td></tr>)}</tbody>
            </table>
            {filteredUsers.length === 0 && <p style={{ ...textSecondary, textAlign: 'center', padding: '1.25rem' }}>No users match &ldquo;{search}&rdquo;.</p>}
          </div>
        </div>
      )}

      {activeTab === 'waitlist' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <h3 style={{ ...textPrimary, margin: 0 }}>Waitlist ({waitlist.length})</h3>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                onClick={() => { if (navigator.clipboard) { navigator.clipboard.writeText(waitlist.map(w => w.email).join(', ')); showMessage('All emails copied to clipboard'); } }}
                disabled={waitlist.length === 0}
                style={{ padding: '0.6rem 1.2rem', background: 'var(--gradient-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: waitlist.length === 0 ? 'default' : 'pointer', opacity: waitlist.length === 0 ? 0.5 : 1 }}
              >Copy all emails</button>
              <button
                onClick={() => { const nums = waitlist.map(w => w.phone).filter(Boolean); if (navigator.clipboard && nums.length) { navigator.clipboard.writeText(nums.join(', ')); showMessage(`${nums.length} WhatsApp number(s) copied`); } }}
                disabled={!waitlist.some(w => w.phone)}
                style={{ padding: '0.6rem 1.2rem', background: '#25D366', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: waitlist.some(w => w.phone) ? 'pointer' : 'default', opacity: waitlist.some(w => w.phone) ? 1 : 0.5 }}
              >Copy WhatsApp numbers</button>
            </div>
          </div>
          {waitlist.length === 0 ? (
            <p style={textSecondary}>No signups yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>{['#', 'Email', 'Name', 'WhatsApp', 'Source', 'Joined'].map(h => <th key={h} style={{ ...textSecondary, textAlign: 'left', padding: '0.75rem', fontSize: '0.85rem', fontWeight: '600', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
                <tbody>{waitlist.map((w, i) => <tr key={w._id}><td style={{ ...textSecondary, padding: '0.75rem' }}>{i + 1}</td><td style={{ ...textPrimary, padding: '0.75rem', fontWeight: 600 }}>{w.email}</td><td style={{ ...textSecondary, padding: '0.75rem' }}>{w.name || '-'}</td><td style={{ ...textSecondary, padding: '0.75rem', whiteSpace: 'nowrap' }}>{w.phone || '-'}</td><td style={{ ...textSecondary, padding: '0.75rem' }}>{w.source || '-'}</td><td style={{ ...textSecondary, padding: '0.75rem', whiteSpace: 'nowrap' }}>{new Date(w.createdAt).toLocaleDateString()}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'recaps' && (
        <div style={cardStyle}>
          <h3 style={{ ...textPrimary, marginBottom: '0.5rem' }}>Recap releases</h3>
          <p style={{ ...textSecondary, marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
            Control when each recap "drops" to everyone. <b>auto</b> = follows the schedule (daily & weekly always, monthly early in the month, yearly in December). <b>on</b> = force-drop now. <b>off</b> = hold.
          </p>
          {recapCfg ? ['day', 'week', 'month', 'year'].map(w => (
            <div key={w} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', padding: '0.9rem 0', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}` }}>
              <span style={{ ...textPrimary, fontWeight: 600, textTransform: 'capitalize' }}>{w}{w === 'year' ? ' - Wrapped' : ''}</span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {['auto', 'on', 'off'].map(r => (
                  <button key={r} onClick={() => setRecapRule(w, r)}
                    style={{ padding: '0.4rem 0.9rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', textTransform: 'capitalize',
                      background: recapCfg[w] === r ? (r === 'on' ? '#38a169' : r === 'off' ? '#e53e3e' : 'var(--accent-primary)') : (darkMode ? '#2d3748' : '#edf2f7'),
                      color: recapCfg[w] === r ? '#fff' : (darkMode ? '#cbd5e0' : '#4a5568') }}>{r}</button>
                ))}
              </div>
            </div>
          )) : <p style={textSecondary}>Loading…</p>}
        </div>
      )}

      {activeTab === 'tickets' && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            <h3 style={{ ...textPrimary, margin: 0 }}>Support Tickets ({filteredTickets.length}{q ? ` of ${tickets.length}` : ''})</h3>
            {searchInput('Search subject, message or email')}
          </div>
          {filteredTickets.length === 0 ? (
            <p style={textSecondary}>{q ? `No tickets match "${search}".` : 'No tickets yet.'}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {filteredTickets.map(t => (
                <div key={t._id} style={{ border: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, borderRadius: '10px', padding: '1rem', opacity: t.status === 'resolved' ? 0.7 : 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '200px' }}>
                      <div style={{ ...textPrimary, fontWeight: 700 }}>{t.subject}</div>
                      <div style={{ ...textSecondary, fontSize: '0.8rem', margin: '0.15rem 0 0.6rem' }}>
                        {t.name || 'Unknown'} · {t.email} · {new Date(t.createdAt).toLocaleString()}
                      </div>
                      <div style={{ ...textPrimary, fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{t.message}</div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                      <span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.78rem', fontWeight: 700, textTransform: 'capitalize', background: t.status === 'open' ? '#744210' : '#22543d', color: t.status === 'open' ? '#faf089' : '#c6f6d5' }}>{t.status}</span>
                      <button
                        onClick={() => handleTicketStatus(t._id, t.status === 'open' ? 'resolved' : 'open')}
                        disabled={actionLoading === t._id + '_ticket'}
                        style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: t.status === 'open' ? '#38a169' : '#dd6b20', color: 'white', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                      >
                        {actionLoading === t._id + '_ticket' ? '...' : (t.status === 'open' ? 'Mark resolved' : 'Reopen')}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;