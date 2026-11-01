import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { getRecentLogs } from '../lib/logBuffer';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const FAQS = [
  { q: 'How do I import a bank statement?', a: 'Go to the Dashboard → Import Statement, upload a CSV, Excel, or PDF statement. For password-protected PDFs, enter the password when prompted. Review the transactions (you can edit categories) and confirm the bank, then Import.' },
  { q: 'My statement is password protected - is that supported?', a: 'Yes. When you upload a protected PDF, you\'ll be asked for the password and we\'ll decrypt it to read your transactions.' },
  { q: 'How does budgeting work?', a: 'On the Budget page, pick a month and set a spending limit per category. As your transactions for that month come in (imported or added manually), each budget shows spent vs. budgeted with progress and alerts at 80% and 100%.' },
  { q: 'Can I group and delete transactions by bank?', a: 'Yes. The Transactions page tags each transaction with its bank and upload. You can filter by month/bank, edit or delete individual rows, multi-select to batch-delete, or delete a whole imported statement in one click.' },
  { q: 'How does the category learning work?', a: 'When you correct a transaction\'s category, the app remembers that merchant and applies your choice automatically on future imports.' },
  { q: 'Does Automonie move my money?', a: 'No. Automonie reads your alerts and statements to show where your money went. Goals and bills are records and reminders you keep yourself; nothing is ever paid or moved from here.' },
  { q: 'Why is the app slow on the first load?', a: 'The server sleeps after inactivity on the free tier, so the first request can take up to a minute to wake it. You\'ll see a "waking up" message - it resolves automatically.' },
  { q: 'I forgot my password - what do I do?', a: 'On the login page click "Forgot password?", enter your email, and use the reset link we send you (valid for 1 hour).' },
];

const TOPICS = [
  { id: 'email-forwarding', label: 'Email forwarding / alerts' },
  { id: 'statements', label: 'Statements' },
  { id: 'budgets-goals', label: 'Budgets and goals' },
  { id: 'billing', label: 'Plus and billing' },
  { id: 'other', label: 'Something else' },
];

const Support = () => {
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ subject: '', message: '', topic: '', consent: false });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [info, setInfo] = useState(null);

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const fetchTickets = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/support/tickets`, auth());
      setTickets(res.data || []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => {
    fetchTickets();
    axios.get(`${API_URL}/api/support/info`, auth()).then((r) => setInfo(r.data)).catch(() => {});
  }, []);

  const submitTicket = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return flash('Please fill in both fields', 'error');
    setSubmitting(true);
    try {
      const diagnostics = form.consent ? {
        consent: true,
        appVersion: '',
        platform: 'web',
        phoneModel: '',
        osVersion: navigator.platform || '',
        setupCheck: null,
        recentLogs: getRecentLogs(),
      } : { consent: false };
      await axios.post(`${API_URL}/api/support/tickets`, { subject: form.subject, message: form.message, topic: form.topic, diagnostics }, auth());
      setForm({ subject: '', message: '', topic: '', consent: false });
      flash('Ticket submitted! Our team will get back to you.');
      fetchTickets();
    } catch (err) {
      flash(err.response?.data?.message || 'Could not submit. Please try again.', 'error');
    } finally { setSubmitting(false); }
  };

  return (
    <div className="support-page">
      <div className="section-header">
        <h2><i className="fas fa-life-ring"></i> Support &amp; FAQ</h2>
        <p>Find quick answers, or send us a message and we'll help.</p>
        {info && (
          <p className="sp-response-time">
            We usually reply within {info.responseHours} hours, {info.hours}.
          </p>
        )}
      </div>

      {message && <div className={`sp-msg ${message.type}`}>{message.text}</div>}

      {/* Organization contact details */}
      <div className="sp-card" style={{ marginBottom: '1.25rem' }}>
        <h3>Contact us directly</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
          <li><i className="fas fa-envelope" style={{ color: 'var(--accent-primary)', width: 20 }}></i> <a href="mailto:superadmin@automonie.com">superadmin@automonie.com</a></li>
          {info?.whatsapp?.enabled && (
            <li><i className="fab fa-whatsapp" style={{ color: 'var(--accent-primary)', width: 20 }}></i> <a href={info.whatsapp.link} target="_blank" rel="noreferrer">Chat on WhatsApp</a></li>
          )}
          <li><i className="fas fa-clock" style={{ color: 'var(--accent-primary)', width: 20 }}></i> {info ? info.hours : 'Mon-Fri, 9:00am-5:00pm WAT'}</li>
          <li><i className="fas fa-location-dot" style={{ color: 'var(--accent-primary)', width: 20 }}></i> Lagos, Nigeria</li>
        </ul>
      </div>

      <div className="sp-grid">
        {/* FAQ */}
        <div className="sp-card">
          <h3>Frequently asked questions</h3>
          <div className="faq-list">
            {FAQS.map((f, i) => (
              <div className={`faq-item ${open === i ? 'open' : ''}`} key={i}>
                <button className="faq-q" onClick={() => setOpen(open === i ? null : i)}>
                  <span>{f.q}</span>
                  <i className={`fas fa-chevron-${open === i ? 'up' : 'down'}`}></i>
                </button>
                {open === i && <div className="faq-a">{f.a}</div>}
              </div>
            ))}
          </div>
          <p className="sp-faq-more">Didn't find it? See the full <a href="/help">Help Centre</a>.</p>
        </div>

        {/* Ticket form + history */}
        <div className="sp-card">
          <h3>Contact support</h3>
          <form onSubmit={submitTicket}>
            <div className="form-group">
              <label>Topic</label>
              <select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                <option value="">Choose a topic</option>
                {TOPICS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Subject</label>
              <input type="text" value={form.subject} maxLength={150}
                onChange={e => setForm({ ...form, subject: e.target.value })}
                placeholder="Brief summary of your issue" />
            </div>
            <div className="form-group">
              <label>Message</label>
              <textarea rows={5} value={form.message} maxLength={4000}
                onChange={e => setForm({ ...form, message: e.target.value })}
                placeholder="Describe what's happening, and any steps to reproduce it." />
            </div>
            <label className="sp-consent">
              <input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
              <span>Share my app version, device and setup-check results to help diagnose this faster. Never my transactions or messages.</span>
            </label>
            <button type="submit" className="sp-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit ticket'}
            </button>
          </form>

          {tickets.length > 0 && (
            <div className="my-tickets">
              <h4>Your tickets</h4>
              {tickets.map(t => (
                <div className="ticket-row" key={t._id}>
                  <div>
                    <strong>{t.subject}</strong>
                    <span className="ticket-date">{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                  <span className={`ticket-status ${t.status}`}>{t.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .support-page { max-width: 1000px; margin: 0 auto; padding: 16px; }
        .sp-response-time { color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px; }
        .sp-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; text-align: center; }
        .sp-msg.success { background: rgba(56,161,105,0.12); color: #16a34a; }
        .sp-msg.error { background: rgba(229,62,62,0.12); color: #e53e3e; }
        .sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 800px) { .sp-grid { grid-template-columns: 1fr; } }
        .sp-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 18px; }
        .sp-card h3 { margin: 0 0 14px; }
        .sp-faq-more { margin: 14px 0 0; font-size: 0.85rem; color: var(--text-secondary); }
        .faq-item { border-bottom: 1px solid var(--glass-border); }
        .faq-q { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; color: var(--text-primary); font-weight: 600; font-size: 0.92rem; text-align: left; padding: 12px 2px; cursor: pointer; }
        .faq-a { padding: 0 2px 14px; color: var(--text-primary); opacity: 0.85; font-size: 0.88rem; line-height: 1.55; }
        .sp-consent { display: flex; align-items: flex-start; gap: 8px; font-size: 0.8rem; color: var(--text-secondary); margin: 10px 0 14px; cursor: pointer; }
        .sp-consent input { margin-top: 2px; }

.sp-btn { background: var(--gradient-primary); color: #fff; border: none; border-radius: var(--radius-md); padding: 11px 18px; font-weight: 600; cursor: pointer; width: 100%; }
        .sp-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .my-tickets { margin-top: 20px; }
        .my-tickets h4 { margin: 0 0 10px; font-size: 0.9rem; }
        .ticket-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--glass-border); font-size: 0.85rem; }
        .ticket-date { color: var(--text-secondary); margin-left: 10px; font-size: 0.78rem; }
        .ticket-status { padding: 2px 10px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; text-transform: capitalize; }
        .ticket-status.open { background: rgba(214,158,46,0.18); color: #b7791f; }
        .ticket-status.resolved { background: rgba(56,161,105,0.18); color: #2f855a; }
      `}</style>
    </div>
  );
};

export default Support;
