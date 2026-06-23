import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

const FAQS = [
  { q: 'How do I import a bank statement?', a: 'Go to the Dashboard → Import Statement, upload a CSV, Excel, or PDF statement. For password-protected PDFs, enter the password when prompted. Review the transactions (you can edit categories) and confirm the bank, then Import.' },
  { q: 'My statement is password protected — is that supported?', a: 'Yes. When you upload a protected PDF, you\'ll be asked for the password and we\'ll decrypt it to read your transactions.' },
  { q: 'How does budgeting work?', a: 'On the Budget page, pick a month and set a spending limit per category. As your transactions for that month come in (imported or added manually), each budget shows spent vs. budgeted with progress and alerts at 80% and 100%.' },
  { q: 'Can I group and delete transactions by bank?', a: 'Yes. The Transactions page tags each transaction with its bank and upload. You can filter by month/bank, edit or delete individual rows, multi-select to batch-delete, or delete a whole imported statement in one click.' },
  { q: 'How does the category learning work?', a: 'When you correct a transaction\'s category, the app remembers that merchant and applies your choice automatically on future imports.' },
  { q: 'How do auto-savings work?', a: 'On the Auto-Savings page, set a fixed amount to move to savings from each income, or a round-up rule on expenses. You can link it to a savings goal.' },
  { q: 'Why is the app slow on the first load?', a: 'The server sleeps after inactivity on the free tier, so the first request can take up to a minute to wake it. You\'ll see a "waking up" message — it resolves automatically.' },
  { q: 'I forgot my password — what do I do?', a: 'On the login page click "Forgot password?", enter your email, and use the reset link we send you (valid for 1 hour).' },
];

const Support = () => {
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ subject: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [tickets, setTickets] = useState([]);

  const flash = (text, type = 'success') => { setMessage({ text, type }); setTimeout(() => setMessage(null), 3500); };

  const fetchTickets = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/support/tickets`, auth());
      setTickets(res.data || []);
    } catch { /* non-fatal */ }
  };
  useEffect(() => { fetchTickets(); }, []);

  const submitTicket = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) return flash('Please fill in both fields', 'error');
    setSubmitting(true);
    try {
      await axios.post(`${API_URL}/api/support/tickets`, form, auth());
      setForm({ subject: '', message: '' });
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
      </div>

      {message && <div className={`sp-msg ${message.type}`}>{message.text}</div>}

      {/* Organization contact details */}
      <div className="sp-card" style={{ marginBottom: '1.25rem' }}>
        <h3>Contact us directly</h3>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.6rem' }}>
          <li><i className="fas fa-envelope" style={{ color: 'var(--accent-primary)', width: 20 }}></i> <a href="mailto:superadmin@automonie.com">superadmin@automonie.com</a></li>
          <li><i className="fas fa-phone" style={{ color: 'var(--accent-primary)', width: 20 }}></i> <a href="tel:+2348000000000">+234 800 000 0000</a></li>
          <li><i className="fab fa-whatsapp" style={{ color: 'var(--accent-primary)', width: 20 }}></i> <a href="https://wa.me/2348000000000" target="_blank" rel="noreferrer">Chat on WhatsApp</a></li>
          <li><i className="fas fa-clock" style={{ color: 'var(--accent-primary)', width: 20 }}></i> Mon–Fri, 9:00am–5:00pm WAT</li>
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
        </div>

        {/* Ticket form + history */}
        <div className="sp-card">
          <h3>Contact support</h3>
          <form onSubmit={submitTicket}>
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

      <style jsx="true">{`
        .support-page { max-width: 1000px; margin: 0 auto; padding: 16px; }
        .sp-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; text-align: center; }
        .sp-msg.success { background: rgba(56,161,105,0.12); color: #38a169; }
        .sp-msg.error { background: rgba(229,62,62,0.12); color: #e53e3e; }
        .sp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 800px) { .sp-grid { grid-template-columns: 1fr; } }
        .sp-card { background: var(--card-bg); backdrop-filter: blur(20px); border: 1px solid var(--glass-border); border-radius: var(--radius-lg); padding: 18px; }
        .sp-card h3 { margin: 0 0 14px; }
        .faq-item { border-bottom: 1px solid var(--glass-border); }
        .faq-q { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; background: none; border: none; color: var(--text-primary); font-weight: 600; font-size: 0.92rem; text-align: left; padding: 12px 2px; cursor: pointer; }
        .faq-a { padding: 0 2px 14px; color: var(--text-primary); opacity: 0.85; font-size: 0.88rem; line-height: 1.55; }
        .form-group { margin-bottom: 14px; }
        .form-group label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 0.88rem; }
        .form-group input, .form-group textarea { width: 100%; padding: 10px 12px; background: var(--glass-bg); border: 1px solid var(--border-color, var(--glass-border)); border-radius: var(--radius-md); color: var(--text-primary); font-family: inherit; resize: vertical; }
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
