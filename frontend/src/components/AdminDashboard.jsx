import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { API_URL } from '../config';

const AdminDashboard = () => {
  const { user, darkMode } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [message, setMessage] = useState(null);

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
      const [statsRes, usersRes, ticketsRes] = await Promise.all([
        axios.get(`${API_URL}/api/admin/stats`, { headers }),
        axios.get(`${API_URL}/api/admin/users`, { headers }),
        axios.get(`${API_URL}/api/admin/tickets`, { headers })
      ]);
      setStats(statsRes.data);
      setUsers(usersRes.data);
      setTickets(ticketsRes.data);
    } catch (error) { showMessage('Failed to load data', 'error'); }
    finally { setLoading(false); }
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
        <button onClick={fetchData} style={{ padding: '0.75rem 1.5rem', background: 'var(--gradient-primary)', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>Refresh</button>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem', background: darkMode ? '#4a5568' : '#f1f5f9', padding: '0.25rem', borderRadius: '10px', width: 'fit-content' }}>
        {['overview', 'users', 'tickets'].map(tab => {
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

      {activeTab === 'users' && (
        <div style={cardStyle}>
          <h3 style={{ ...textPrimary, marginBottom: '1.5rem' }}>All Users ({users.length})</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{['Name', 'Email', 'Role', 'Status', 'Transactions', 'Joined', 'Actions'].map(h => <th key={h} style={{ ...textSecondary, textAlign: 'left', padding: '0.75rem', fontSize: '0.85rem', fontWeight: '600', borderBottom: `1px solid ${darkMode ? '#4a5568' : '#e2e8f0'}`, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{users.map(u => <tr key={u._id} style={{ opacity: u.isActive ? 1 : 0.6 }}><td style={{ ...textPrimary, padding: '0.75rem', fontWeight: '600' }}>{u.name}{u._id === user.id && <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', color: 'var(--accent-primary)' }}>(you)</span>}</td><td style={{ ...textSecondary, padding: '0.75rem' }}>{u.email}</td><td style={{ padding: '0.75rem' }}><span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: u.role === 'superadmin' ? '#553c9a' : '#2b6cb0', color: 'white' }}>{u.role}</span></td><td style={{ padding: '0.75rem' }}><span style={{ padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: '600', background: u.isActive ? '#276749' : '#742a2a', color: u.isActive ? '#c6f6d5' : '#fed7d7' }}>{u.isActive ? 'Active' : 'Inactive'}</span></td><td style={{ ...textSecondary, padding: '0.75rem' }}>{u.stats?.transactionCount || 0}</td><td style={{ ...textSecondary, padding: '0.75rem', whiteSpace: 'nowrap' }}>{new Date(u.createdAt).toLocaleDateString()}</td><td style={{ padding: '0.75rem' }}>{u._id !== user.id && <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}><button onClick={() => handleRoleChange(u._id, u.role === 'superadmin' ? 'user' : 'superadmin')} disabled={actionLoading === u._id + '_role'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: '#805ad5', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_role' ? '...' : (u.role === 'superadmin' ? 'Demote' : 'Promote')}</button><button onClick={() => handleToggleStatus(u._id)} disabled={actionLoading === u._id + '_status'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: u.isActive ? '#dd6b20' : '#38a169', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_status' ? '...' : (u.isActive ? 'Deactivate' : 'Activate')}</button><button onClick={() => handleDeleteUser(u._id, u.name)} disabled={actionLoading === u._id + '_delete'} style={{ padding: '0.4rem 0.75rem', border: 'none', borderRadius: '6px', cursor: 'pointer', background: '#e53e3e', color: 'white', fontSize: '0.8rem', fontWeight: '600' }}>{actionLoading === u._id + '_delete' ? '...' : 'Delete'}</button></div>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'tickets' && (
        <div style={cardStyle}>
          <h3 style={{ ...textPrimary, marginBottom: '1.5rem' }}>Support Tickets ({tickets.length})</h3>
          {tickets.length === 0 ? (
            <p style={textSecondary}>No tickets yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {tickets.map(t => (
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