import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { fmtNaira } from '../utils/format';
import { startProCheckout } from '../lib/pro';

// Plans: what you're on (and how long the Plus trial has left), the plans, and the
// Student plan's verification: a code to your school email, a student ID or NYSC
// call-up letter for us to check, or a code from a campus or CDS talk.
const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const STUDENT_STATUS = {
  none: 'Not verified yet',
  pending: 'We’re checking your upload. This usually takes a day.',
  verified: 'Verified',
  rejected: 'We couldn’t verify you',
  expired: 'Your verification has lapsed. Verify again to keep the Student plan.',
};

export default function Plans() {
  const [s, setS] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [method, setMethod] = useState('email');
  const [form, setForm] = useState({ email: '', code: '', institution: '', matric: '', stateCode: '', campaign: '' });
  const [file, setFile] = useState(null);
  const [codeSent, setCodeSent] = useState('');

  const load = useCallback(() => axios.get(`${API_URL}/api/billing/status`, auth()).then((r) => { setS(r.data); window.dispatchEvent(new Event('automonie:plan-changed')); }).catch(() => setError('Could not load your plan. Try again.')), []);
  useEffect(() => { load(); }, [load]);

  const run = async (key, fn) => {
    setBusy(key); setError(''); setNote('');
    try { await fn(); } catch (e) { setError(e.response?.data?.message || 'That didn’t work. Try again.'); }
    finally { setBusy(''); }
  };
  const buy = (plan) => run(`buy:${plan}`, async () => {
    if (!s.checkoutAvailable) { setNote('Payments open soon. We’ll let you know the moment you can upgrade.'); return; }
    await startProCheckout(1, plan);
  });
  const sendCode = () => run('send', async () => {
    const { data } = await axios.post(`${API_URL}/api/student/email`, { email: form.email }, auth());
    setCodeSent(data.sentTo);
  });
  const checkCode = () => run('check', async () => { await axios.post(`${API_URL}/api/student/email/verify`, { code: form.code }, auth()); await load(); });
  const useCampaign = () => run('campaign', async () => { await axios.post(`${API_URL}/api/student/code`, { code: form.campaign }, auth()); await load(); });
  const upload = (kind) => run('upload', async () => {
    if (!file) throw Object.assign(new Error(), { response: { data: { message: kind === 'nysc' ? 'Add a photo of your call-up letter.' : 'Add a photo of your student ID.' } } });
    const fd = new FormData();
    fd.append('image', file);
    if (kind === 'nysc') fd.append('stateCode', form.stateCode);
    else { fd.append('institution', form.institution); fd.append('matric', form.matric); }
    await axios.post(`${API_URL}/api/student/${kind === 'nysc' ? 'nysc' : 'id'}`, fd, auth());
    setFile(null); await load();
  });
  const startStudent = () => run('start', async () => {
    const { data } = await axios.post(`${API_URL}/api/student/start`, {}, auth());
    if (data.checkout) { await buy('student'); return; }
    setNote('Your Student plan has started.'); await load();
  });

  if (!s) return <div className="plans-page">{error ? <div className="message error">{error}</div> : <div className="loading-container"><div className="loading-spinner"></div></div>}</div>;
  const st = s.student || {};
  const verified = st.status === 'verified';
  const field = (k) => ({ value: form[k], onChange: (e) => setForm({ ...form, [k]: e.target.value }) });

  return (
    <div className="plans-page">
      <h2>Plans</h2>
      <div className="plans-now">
        <strong>You’re on {s.tierName}</strong>
        {s.source === 'trial' && <span> · Plus trial, {s.trialDaysLeft} day{s.trialDaysLeft === 1 ? '' : 's'} left. No card needed; you move to Free when it ends, and nothing you added is lost.</span>}
        {s.trialEnded && <span> · Your Plus trial has ended. Everything you added stays; upgrade any time for the Plus features.</span>}
        {s.source === 'paid' && s.planExpiry && <span> · until {new Date(s.planExpiry).toLocaleDateString('en-NG', { dateStyle: 'medium' })}</span>}
      </div>
      {error && <div className="message error" role="alert">{error}</div>}
      {note && <div className="message success" role="status">{note}</div>}

      <div className="plans-grid">
        {s.plans.map((p) => (
          <div key={p.code} className={`plan-card ${s.tier === p.code ? 'on' : ''}`}>
            <h3>{p.name}</h3>
            <div className="plan-price">
              {p.code === 'free' ? 'Free' : p.priceNaira ? `${fmtNaira(p.priceNaira)}/month` : 'Coming soon'}
              {p.freeDays ? <span className="plan-small">after {Math.round(p.freeDays / 30)} free months</span> : null}
            </div>
            {p.code === 'free'
              ? <p className="plan-small">Your money in one place: imports, budgets, goals, insights.</p>
              : <ul>{s.features.map((f) => <li key={f}>{f}</li>)}</ul>}
            {p.code === 'pro' && s.tier !== 'pro' && <button className="btn-primary" onClick={() => buy('pro')} disabled={busy === 'buy:pro'}>Get Plus</button>}
            {p.code === 'pro' && s.source === 'trial' && <button className="btn-primary" onClick={() => buy('pro')} disabled={busy === 'buy:pro'}>Keep Plus after the trial</button>}
            {p.code === 'student' && (verified
              ? (s.tier !== 'student' && <button className="btn-primary" onClick={startStudent} disabled={busy === 'start'}>{st.freeUsed ? 'Continue on Student' : 'Start 3 free months'}</button>)
              : <p className="plan-small">For students and corps members. Verify below first.</p>)}
            {p.code === 'power' && !p.onSale && <p className="plan-small">More for heavy users. Coming soon.</p>}
          </div>
        ))}
      </div>

      <section className="plans-student" id="student">
        <h3>Student verification</h3>
        <p className="plan-small">{STUDENT_STATUS[st.status] || STUDENT_STATUS.none}{st.status === 'rejected' && st.rejectReason ? `: ${st.rejectReason}` : ''}{verified && st.expiresAt ? ` until ${new Date(st.expiresAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}${st.institution ? ` (${st.institution})` : ''}` : ''}</p>
        {(!verified || (st.expiresAt && new Date(st.expiresAt) - Date.now() < 14 * 86400000)) && st.status !== 'pending' && (
          <>
            <div className="plans-tabs" role="tablist">
              {[['email', 'School email'], ['id', 'Student ID'], ['nysc', 'NYSC'], ['code', 'I have a code']].map(([k, label]) => (
                <button key={k} role="tab" aria-selected={method === k} className={method === k ? 'on' : ''} onClick={() => { setMethod(k); setError(''); }}>{label}</button>
              ))}
            </div>
            {method === 'email' && (codeSent ? (
              <div className="plans-form">
                <label>Code sent to {codeSent}<input inputMode="numeric" maxLength={6} {...field('code')} /></label>
                <button className="btn-primary" onClick={checkCode} disabled={busy === 'check' || form.code.length !== 6}>Verify</button>
                <button className="btn-secondary" onClick={() => setCodeSent('')}>Use another email</button>
              </div>
            ) : (
              <div className="plans-form">
                <label>Your school email<input type="email" autoComplete="email" placeholder="you@unilag.edu.ng" {...field('email')} /></label>
                <button className="btn-primary" onClick={sendCode} disabled={busy === 'send' || !form.email}>Send me a code</button>
              </div>
            ))}
            {method === 'id' && (
              <div className="plans-form">
                <label>Institution<input {...field('institution')} /></label>
                <label>Matric number<input {...field('matric')} /></label>
                <label>Photo of your student ID<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
                <button className="btn-primary" onClick={() => upload('id')} disabled={busy === 'upload'}>Send for checking</button>
                <p className="plan-small">We delete the photo as soon as it’s checked.</p>
              </div>
            )}
            {method === 'nysc' && (
              <div className="plans-form">
                <label>State code<input placeholder="LA/25A/1234" {...field('stateCode')} /></label>
                <label>Photo of your call-up letter<input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
                <button className="btn-primary" onClick={() => upload('nysc')} disabled={busy === 'upload'}>Send for checking</button>
                <p className="plan-small">We delete the photo as soon as it’s checked.</p>
              </div>
            )}
            {method === 'code' && (
              <div className="plans-form">
                <label>Code from a campus or CDS talk<input {...field('campaign')} /></label>
                <button className="btn-primary" onClick={useCampaign} disabled={busy === 'campaign' || !form.campaign}>Use code</button>
              </div>
            )}
          </>
        )}
        <p className="plan-small">Verification lasts a year; we remind you two weeks before it ends.</p>
      </section>

      <style>{`
        .plans-page { max-width: 900px; margin: 0 auto; padding: 20px; display: grid; gap: 16px; }
        .plans-page h2 { margin: 0; color: var(--text-primary); }
        .plans-now { color: var(--text-secondary); }
        .plans-now strong { color: var(--text-primary); }
        .plans-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
        .plan-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; display: grid; gap: 10px; align-content: start; }
        .plan-card.on { border-color: var(--accent-primary); box-shadow: 0 0 0 1px var(--accent-primary); }
        .plan-card h3 { margin: 0; color: var(--text-primary); }
        .plan-card ul { margin: 0; padding-left: 18px; color: var(--text-primary); font-size: 0.86rem; line-height: 1.5; }
        .plan-price { color: var(--text-primary); font-weight: 700; display: grid; }
        .plan-small { color: var(--text-secondary); font-size: 0.82rem; font-weight: 500; margin: 0; }
        .plans-student { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 16px; display: grid; gap: 12px; scroll-margin-top: 16px; }
        .plans-student h3 { margin: 0; color: var(--text-primary); }
        .plans-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
        .plans-tabs button { min-height: 44px; padding: 0 14px; border-radius: 999px; border: 1px solid var(--border-color); background: none; color: var(--text-secondary); font: inherit; font-weight: 600; cursor: pointer; }
        .plans-tabs button.on { border-color: var(--accent-primary); color: var(--accent-primary); }
        .plans-form { display: grid; gap: 10px; max-width: 420px; }
        .plans-form label { display: grid; gap: 6px; color: var(--text-secondary); font-size: 0.85rem; font-weight: 600; }
        .plans-form input { min-height: 44px; padding: 8px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-color); background: var(--bg-input, var(--bg-card)); color: var(--text-primary); font: inherit; }
      `}</style>
    </div>
  );
}
