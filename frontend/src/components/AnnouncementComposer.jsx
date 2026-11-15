import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import { useAuth } from '../contexts/AuthContext';

// Announcements composer (Round 10 Part D). Admin only: superadmins and newsletter
// editors. One card at a time reaches the app Home, never a push, never covers the
// numbers, and every card has an end date. Rules are enforced on the server too.
const KINDS = [
  { id: 'update', label: 'Update' }, { id: 'feature', label: 'Feature' }, { id: 'event', label: 'Event' },
  { id: 'maintenance', label: 'Maintenance' }, { id: 'outage', label: 'Outage' },
  { id: 'security', label: 'Security' }, { id: 'must_update', label: 'Must update' },
];
const FULLSCREEN_KINDS = ['outage', 'security', 'must_update'];
const PRODUCT_KINDS = ['update', 'feature', 'event'];
const PLANS = [['free', 'Free'], ['pro', 'Plus'], ['student', 'Student'], ['sync', 'Pro'], ['power', 'Power']];
const AUDIENCES = [['student', 'Students'], ['corper', 'Corpers'], ['none', 'Neither']];
const PLATFORMS = [['android', 'Android'], ['ios', 'iPhone'], ['web', 'Web']];

// The three in-app themes as the phone draws them. Preview only: these are the phone's
// own palettes (finpilot-mobile constants/colors.ts), not web styling.
const PREVIEW = {
  dark: { ground: '#000000', card: '#121214', border: '#26272c', text: '#f1f5f9', sub: '#9aa3b2', accent: '#1DD3A8', onAccent: '#04211c' },
  light: { ground: '#f4f6fa', card: '#ffffff', border: '#dbe2ec', text: '#0B0E11', sub: '#4b5563', accent: '#0e8e91', onAccent: '#ffffff' },
  teal: { ground: '#052825', card: '#0e211f', border: '#204a42', text: '#f1f5f9', sub: '#a7c4bd', accent: '#1DD3A8', onAccent: '#04211c' },
};

const EMPTY = {
  title: '', body: '', emailBody: '', buttonLabel: '', buttonLink: '', kind: 'feature', channels: ['card'],
  audience: { plans: [], audiences: [], platforms: [], minVersion: '', maxVersion: '', banks: [], signedUpFrom: '', signedUpTo: '', activity: null, betaOnly: false },
  startsAt: '', endsAt: '',
};
const toLocal = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const toIso = (local) => (local ? new Date(local).toISOString() : null);
const dateOnly = (v) => (v ? String(v).slice(0, 10) : '');
const fromServer = (a) => ({
  ...EMPTY, ...a,
  audience: { ...EMPTY.audience, ...(a.audience || {}), signedUpFrom: dateOnly(a.audience?.signedUpFrom), signedUpTo: dateOnly(a.audience?.signedUpTo) },
  startsAt: toLocal(a.startsAt), endsAt: toLocal(a.endsAt),
});
const toPayload = (f) => ({
  title: f.title, body: f.body, emailBody: f.emailBody, buttonLabel: f.buttonLabel, buttonLink: f.buttonLink,
  kind: f.kind, channels: f.channels, audience: f.audience, startsAt: toIso(f.startsAt), endsAt: toIso(f.endsAt),
});

export default function AnnouncementComposer({ embedded = false }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [id, setId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [server, setServer] = useState(null); // the saved copy: status, testedAt, approvedBy, stats
  const [stats, setStats] = useState(null);
  const [count, setCount] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const dirty = useRef(false);

  const headers = { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } };
  const flash = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 4500); };
  const set = (patch) => { dirty.current = true; setForm((f) => ({ ...f, ...patch })); };
  const setAud = (patch) => set({ audience: { ...form.audience, ...patch } });
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const loadList = useCallback(async () => {
    try {
      const [l, t] = await Promise.all([
        axios.get(`${API_URL}/api/admin/announcements`, headers),
        axios.get(`${API_URL}/api/admin/announcements/templates`, headers),
      ]);
      setItems(l.data.items || []); setTemplates(t.data.templates || []);
    } catch { flash('Could not load announcements.', 'error'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadList(); }, [loadList]);

  const open = async (aid) => {
    try {
      const { data } = await axios.get(`${API_URL}/api/admin/announcements/${aid}`, headers);
      setId(aid); setForm(fromServer(data)); setServer(data); setStats(data.stats || null); dirty.current = false;
    } catch { flash('Could not open that announcement.', 'error'); }
  };
  const fresh = (tpl) => {
    setId(null); setServer(null); setStats(null); dirty.current = false;
    setForm(tpl ? { ...EMPTY, kind: tpl.kind, channels: tpl.channels, title: tpl.title, body: tpl.body, buttonLabel: tpl.buttonLabel, buttonLink: tpl.buttonLink } : EMPTY);
  };

  // Live audience count: the server runs the same resolver the send path uses.
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const { data } = await axios.get(`${API_URL}/api/admin/announcements/audience-count`, {
          ...headers, params: { audience: JSON.stringify(form.audience), kind: form.kind },
        });
        setCount(data);
      } catch { setCount(null); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.audience, form.kind]);

  const status = server?.effectiveStatus || 'draft';
  const locked = status === 'live' || status === 'ended';
  const allowsFullscreen = FULLSCREEN_KINDS.includes(form.kind);
  const wantsApproval = form.kind === 'security' || form.channels.includes('fullscreen');
  const hasCard = form.channels.includes('card') || form.channels.includes('fullscreen');
  const needsTest = form.channels.includes('email') || form.channels.includes('fullscreen');
  const tested = !!server?.testedAt && !dirty.current;
  const approved = !!server?.approvedBy && !dirty.current;
  const isCreator = server && String(server.createdBy) === String(user?.id || user?._id);

  const setKind = (kind) => {
    const channels = FULLSCREEN_KINDS.includes(kind) ? form.channels : form.channels.filter((c) => c !== 'fullscreen');
    set({ kind, channels });
  };
  const toggleChannel = (c) => {
    if (c === 'fullscreen' && !allowsFullscreen) return;
    set({ channels: toggle(form.channels, c) });
  };

  const save = async () => {
    setBusy('save');
    try {
      const { data } = id
        ? await axios.patch(`${API_URL}/api/admin/announcements/${id}`, toPayload(form), headers)
        : await axios.post(`${API_URL}/api/admin/announcements`, toPayload(form), headers);
      setId(data.id); setServer(data); dirty.current = false; flash('Saved as a draft.'); loadList();
      return data.id;
    } catch (e) { flash(e.response?.data?.message || 'Could not save.', 'error'); return null; }
    finally { setBusy(''); }
  };
  const sendTest = async () => {
    const aid = (dirty.current || !id) ? await save() : id;
    if (!aid) return;
    setBusy('test');
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/announcements/${aid}/test`, {}, headers);
      setServer((s) => ({ ...(s || {}), testedAt: data.testedAt }));
      flash(data.sentEmail ? 'Test sent: check your inbox and your bell.' : 'Test sent to your bell.');
    } catch (e) { flash(e.response?.data?.message || 'Test failed.', 'error'); }
    finally { setBusy(''); }
  };
  const approve = async () => {
    setBusy('approve');
    try { const { data } = await axios.post(`${API_URL}/api/admin/announcements/${id}/approve`, {}, headers); setServer(data); flash('Approved.'); loadList(); }
    catch (e) { flash(e.response?.data?.message || 'Could not approve.', 'error'); }
    finally { setBusy(''); }
  };
  const schedule = async () => {
    setBusy('schedule');
    try {
      const body = { ...toPayload(form), status: 'scheduled' };
      if (!body.startsAt) body.startsAt = new Date().toISOString();
      const { data } = await axios.patch(`${API_URL}/api/admin/announcements/${id}`, body, headers);
      setServer(data); setForm(fromServer(data)); dirty.current = false; flash(data.effectiveStatus === 'live' ? 'It is live.' : 'Scheduled.'); loadList();
    } catch (e) { flash(e.response?.data?.message || 'Could not schedule.', 'error'); }
    finally { setBusy(''); }
  };
  const endNow = async () => {
    setBusy('end');
    try { const { data } = await axios.post(`${API_URL}/api/admin/announcements/${id}/end`, {}, headers); setServer(data); flash('Ended. It is gone on the next fetch.'); loadList(); }
    catch (e) { flash(e.response?.data?.message || 'Could not end it.', 'error'); }
    finally { setBusy(''); }
  };
  const remove = async () => {
    setBusy('delete');
    try { await axios.delete(`${API_URL}/api/admin/announcements/${id}`, headers); fresh(); flash('Draft deleted.'); loadList(); }
    catch (e) { flash(e.response?.data?.message || 'Could not delete.', 'error'); }
    finally { setBusy(''); }
  };
  const importLegacy = async () => {
    try {
      const { data } = await axios.post(`${API_URL}/api/admin/announcements/import-legacy`, {}, headers);
      flash(data.imported ? `Imported ${data.imported} legacy notice${data.imported === 1 ? '' : 's'}.` : 'Nothing to import.'); loadList();
    } catch (e) { flash(e.response?.data?.message || 'Could not import.', 'error'); }
  };

  // Why scheduling is not available yet, in plain words.
  const blockers = useMemo(() => {
    const b = [];
    if (!id) b.push('Save the draft first.');
    if (hasCard && !form.endsAt) b.push('Every card needs an end date.');
    if (needsTest && !tested) b.push('Send yourself a test first.');
    if (wantsApproval && !approved) b.push('A second superadmin has to approve it.');
    if (dirty.current && id) b.push('Save your changes.');
    return b;
  }, [id, hasCard, form.endsAt, needsTest, tested, wantsApproval, approved]); // eslint-disable-line react-hooks/exhaustive-deps

  const p = PREVIEW[theme];
  const link = form.buttonLink;
  const emailText = form.emailBody || form.body;

  return (
    <div className={`an-wrap ${embedded ? 'an-embedded' : ''}`}>
      <div className="an-head">
        <h2><i className="fas fa-bullhorn"></i> Announcements</h2>
        <p>One card at a time under the Home hero, in the bell, never a push. Email goes only to people who allowed product emails, except service messages.</p>
      </div>
      {msg && <div className={`an-msg ${msg.type}`}>{msg.text}</div>}

      <div className="an-grid">
        <aside className="an-list">
          <button className="an-new" onClick={() => fresh()}>New announcement</button>
          <div className="an-tpls">
            {templates.map((t) => <button key={t.id} className="an-chip" onClick={() => fresh(t)}>{t.label}</button>)}
          </div>
          {items.map((a) => (
            <button key={a.id} className={`an-row ${a.id === id ? 'on' : ''}`} onClick={() => open(a.id)}>
              <span className="an-row-t">{a.title}</span>
              <span className={`an-st ${a.effectiveStatus}`}>{a.effectiveStatus}</span>
            </button>
          ))}
          {user?.role === 'superadmin' && <button className="an-link" onClick={importLegacy}>Import old PIXLCO card and banner</button>}
        </aside>

        <main className="an-form">
          <label className="an-label">Kind</label>
          <div className="an-chips">
            {KINDS.map((k) => <button key={k.id} type="button" className={`an-chip ${form.kind === k.id ? 'on' : ''}`} onClick={() => setKind(k.id)} disabled={locked}>{k.label}</button>)}
          </div>

          <label className="an-label">Title <span className="an-count">{form.title.length}/60</span></label>
          <input className="an-input" value={form.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} disabled={locked} />

          <label className="an-label">Message <span className="an-count">{form.body.length}/240</span></label>
          <textarea className="an-input" rows={3} value={form.body} maxLength={240} onChange={(e) => set({ body: e.target.value })} disabled={locked} />

          {form.channels.includes('email') && (
            <>
              <label className="an-label">Email body (optional, longer than the card)</label>
              <textarea className="an-input" rows={6} value={form.emailBody} onChange={(e) => set({ emailBody: e.target.value })} disabled={locked} />
            </>
          )}

          <div className="an-two">
            <div><label className="an-label">Button label</label><input className="an-input" maxLength={30} value={form.buttonLabel} onChange={(e) => set({ buttonLabel: e.target.value })} disabled={locked} /></div>
            <div><label className="an-label">Button link</label><input className="an-input" placeholder="https:// or /goals" value={form.buttonLink} onChange={(e) => set({ buttonLink: e.target.value })} disabled={locked} /></div>
          </div>

          <label className="an-label">Channels</label>
          <div className="an-chips">
            <label className="an-check"><input type="checkbox" checked={form.channels.includes('card')} onChange={() => toggleChannel('card')} disabled={locked} /> Card on Home and bell</label>
            <label className="an-check"><input type="checkbox" checked={form.channels.includes('email')} onChange={() => toggleChannel('email')} disabled={locked} /> Email</label>
            <label className={`an-check ${allowsFullscreen ? '' : 'off'}`} title={allowsFullscreen ? '' : 'Full-screen is only for outage, security and must update'}>
              <input type="checkbox" checked={form.channels.includes('fullscreen')} onChange={() => toggleChannel('fullscreen')} disabled={locked || !allowsFullscreen} /> Full-screen
            </label>
          </div>
          {!allowsFullscreen && <div className="an-hint">Full-screen is only for outage, security and must update.</div>}
          {form.channels.includes('email') && (
            <div className="an-hint">{PRODUCT_KINDS.includes(form.kind)
              ? 'Product email: only people who allowed product emails, and at most one announcement email a week each.'
              : 'Service email: goes to everyone in the audience, whatever their email setting.'}</div>
          )}

          <label className="an-label">Audience</label>
          <div className="an-box">
            <div className="an-chips"><span className="an-sub">Plan</span>{PLANS.map(([v, l]) => <button key={v} type="button" className={`an-chip ${form.audience.plans.includes(v) ? 'on' : ''}`} onClick={() => setAud({ plans: toggle(form.audience.plans, v) })} disabled={locked}>{l}</button>)}</div>
            <div className="an-chips"><span className="an-sub">Who</span>{AUDIENCES.map(([v, l]) => <button key={v} type="button" className={`an-chip ${form.audience.audiences.includes(v) ? 'on' : ''}`} onClick={() => setAud({ audiences: toggle(form.audience.audiences, v) })} disabled={locked}>{l}</button>)}</div>
            <div className="an-chips"><span className="an-sub">Platform</span>{PLATFORMS.map(([v, l]) => <button key={v} type="button" className={`an-chip ${form.audience.platforms.includes(v) ? 'on' : ''}`} onClick={() => setAud({ platforms: toggle(form.audience.platforms, v) })} disabled={locked}>{l}</button>)}</div>
            <div className="an-two">
              <div><label className="an-label">App version from</label><input className="an-input" placeholder="1.4.0" value={form.audience.minVersion} onChange={(e) => setAud({ minVersion: e.target.value })} disabled={locked} /></div>
              <div><label className="an-label">App version up to</label><input className="an-input" placeholder="1.9.9" value={form.audience.maxVersion} onChange={(e) => setAud({ maxVersion: e.target.value })} disabled={locked} /></div>
            </div>
            <label className="an-label">Banks (codes, comma separated)</label>
            <input className="an-input" placeholder="gtbank, opay" value={(form.audience.banks || []).join(', ')} onChange={(e) => setAud({ banks: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} disabled={locked} />
            <div className="an-two">
              <div><label className="an-label">Signed up from</label><input type="date" className="an-input" value={form.audience.signedUpFrom} onChange={(e) => setAud({ signedUpFrom: e.target.value })} disabled={locked} /></div>
              <div><label className="an-label">Signed up to</label><input type="date" className="an-input" value={form.audience.signedUpTo} onChange={(e) => setAud({ signedUpTo: e.target.value })} disabled={locked} /></div>
            </div>
            <div className="an-two">
              <div>
                <label className="an-label">Activity</label>
                <select className="an-input" value={form.audience.activity?.mode || ''} onChange={(e) => setAud({ activity: e.target.value ? { mode: e.target.value, days: form.audience.activity?.days || 30 } : null })} disabled={locked}>
                  <option value="">Anyone</option><option value="active">Active in the last N days</option><option value="inactive">Not active for N days</option>
                </select>
              </div>
              <div>
                <label className="an-label">N days</label>
                <input type="number" min="1" className="an-input" value={form.audience.activity?.days || ''} disabled={locked || !form.audience.activity} onChange={(e) => setAud({ activity: { mode: form.audience.activity.mode, days: Number(e.target.value) || 1 } })} />
              </div>
            </div>
            <label className="an-check"><input type="checkbox" checked={!!form.audience.betaOnly} onChange={(e) => setAud({ betaOnly: e.target.checked })} disabled={locked} /> Beta testers only</label>
            <div className="an-reach"><i className="fas fa-users"></i> {count ? <>Reaches <b>{count.count}</b> {count.count === 1 ? 'person' : 'people'}{form.channels.includes('email') ? <>, <b>{count.email}</b> by email</> : null}</> : 'Counting...'}</div>
          </div>

          <div className="an-two">
            <div><label className="an-label">Starts (blank means now)</label><input type="datetime-local" className="an-input" value={form.startsAt} onChange={(e) => set({ startsAt: e.target.value })} disabled={locked} /></div>
            <div><label className="an-label">Ends {hasCard ? '(required)' : ''}</label><input type="datetime-local" className="an-input" value={form.endsAt} onChange={(e) => set({ endsAt: e.target.value })} disabled={locked} /></div>
          </div>

          {blockers.length > 0 && !locked && <ul className="an-blockers">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}

          <div className="an-actions">
            {!locked && <button className="an-btn" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving...' : 'Save draft'}</button>}
            {!locked && <button className="an-btn" onClick={sendTest} disabled={!!busy || !form.title}>{busy === 'test' ? 'Sending...' : 'Send me a test'}</button>}
            {!locked && wantsApproval && id && user?.role === 'superadmin' && !isCreator && !approved && <button className="an-btn" onClick={approve} disabled={!!busy}>Approve</button>}
            {!locked && <button className="an-btn primary" onClick={schedule} disabled={!!busy || blockers.length > 0}>{status === 'scheduled' ? 'Update schedule' : 'Schedule'}</button>}
            {(status === 'live' || status === 'scheduled') && id && <button className="an-btn danger" onClick={endNow} disabled={!!busy}>End now</button>}
            {status === 'draft' && id && <button className="an-btn" onClick={remove} disabled={!!busy}>Delete draft</button>}
          </div>
          {wantsApproval && server && <div className="an-hint">{approved ? 'Approved by a second superadmin.' : isCreator ? 'You created this, so another superadmin has to approve it.' : 'Waiting for approval.'}</div>}

          {stats && (status === 'live' || status === 'ended') && (
            <div className="an-stats">
              {[['Delivered', stats.delivered], ['Seen', stats.seen], ['Tapped', stats.tapped], ['Dismissed', stats.dismissed], ['Emailed', stats.emailed], ['Email opened', stats.emailOpened == null ? 'not tracked' : stats.emailOpened]].map(([l, v]) => (
                <div key={l} className="an-stat"><b>{v}</b><span>{l}</span></div>
              ))}
            </div>
          )}
        </main>

        <aside className="an-preview">
          <div className="an-chips">
            {[['dark', 'Dark'], ['light', 'Light'], ['teal', 'Teal'], ['email', 'Email']].map(([v, l]) => <button key={v} type="button" className={`an-chip ${theme === v ? 'on' : ''}`} onClick={() => setTheme(v)}>{l}</button>)}
          </div>
          {theme !== 'email' ? (
            <div className="an-phone" style={{ background: p.ground }}>
              <div className="an-hero">your numbers stay here</div>
              <div className="an-card" style={{ background: p.card, border: `1px solid ${p.border}`, color: p.text }}>
                <div className="an-card-t">{form.title || 'Title'}</div>
                <div className="an-card-b" style={{ color: p.sub }}>{form.body || 'Your message shows here.'}</div>
                {form.buttonLabel && <span className="an-card-btn" style={{ background: p.accent, color: p.onAccent }}>{form.buttonLabel}</span>}
              </div>
              <div className="an-fake" style={{ background: p.card, border: `1px solid ${p.border}` }} />
              {form.channels.includes('fullscreen') && <div className="an-hint" style={{ color: p.sub }}>Also shown once as a full-screen notice.</div>}
            </div>
          ) : (
            <div className="an-mail">
              <div className="an-mail-brand">automonie</div>
              <h3>{form.title || 'Title'}</h3>
              {(emailText || 'Your message shows here.').split(/\n{2,}/).map((t, i) => <p key={i}>{t}</p>)}
              {form.buttonLabel && link && <span className="an-mail-btn">{form.buttonLabel}</span>}
              <div className="an-mail-foot">{PRODUCT_KINDS.includes(form.kind) ? 'You are getting this because you allowed product emails from automonie. Unsubscribe.' : 'This is a service message about your automonie account or the app.'}</div>
            </div>
          )}
        </aside>
      </div>

      <style>{`
        .an-wrap { max-width: 1180px; margin: 0 auto; padding: 20px; }
        .an-embedded { padding: 0; max-width: none; }
        .an-head h2 { display: flex; align-items: center; gap: 10px; color: var(--text-primary); margin: 0 0 6px; }
        .an-head p { color: var(--text-secondary); margin: 0 0 16px; line-height: 1.5; }
        .an-msg { padding: 10px 14px; border-radius: var(--radius-md); margin-bottom: 14px; }
        .an-msg.success { background: var(--glass-bg); color: var(--success-color); border: 1px solid var(--border-color); }
        .an-msg.error { background: var(--glass-bg); color: var(--error-color); border: 1px solid var(--border-color); }
        .an-grid { display: grid; grid-template-columns: 220px minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
        @media (max-width: 1000px) { .an-grid { grid-template-columns: 1fr; } }
        .an-list, .an-preview { display: flex; flex-direction: column; gap: 8px; }
        .an-new { background: var(--accent-primary); color: var(--text-light); border: none; border-radius: var(--radius-md); padding: 10px 14px; font-weight: 800; cursor: pointer; }
        .an-tpls, .an-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .an-chip { background: var(--bg-card); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: var(--radius-full); padding: 6px 12px; font-size: 0.8rem; font-weight: 700; cursor: pointer; }
        .an-chip.on { background: var(--accent-primary); color: var(--text-light); border-color: var(--accent-primary); }
        .an-chip:disabled { opacity: 0.5; cursor: default; }
        .an-row { display: flex; justify-content: space-between; gap: 8px; text-align: left; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; cursor: pointer; color: var(--text-primary); }
        .an-row.on { border-color: var(--accent-primary); }
        .an-row-t { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; font-size: 0.85rem; }
        .an-st { font-size: 0.72rem; font-weight: 800; text-transform: uppercase; color: var(--text-secondary); }
        .an-st.live { color: var(--success-color); } .an-st.ended { color: var(--text-faint); }
        .an-link { background: transparent; border: none; color: var(--accent-primary); font-weight: 700; cursor: pointer; text-align: left; padding: 4px 0; }
        .an-label { display: block; color: var(--text-secondary); font-size: 0.8rem; font-weight: 700; margin: 12px 0 6px; }
        .an-count { float: right; font-weight: 600; color: var(--text-faint); }
        .an-input { width: 100%; box-sizing: border-box; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px 12px; color: var(--text-primary); font-size: 0.95rem; font-family: inherit; }
        .an-two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .an-check { display: inline-flex; align-items: center; gap: 7px; color: var(--text-primary); font-size: 0.88rem; }
        .an-check.off { opacity: 0.5; }
        .an-hint { color: var(--text-secondary); font-size: 0.8rem; margin: 6px 0 0; line-height: 1.5; }
        .an-box { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px; display: flex; flex-direction: column; gap: 8px; }
        .an-sub { color: var(--text-secondary); font-size: 0.78rem; font-weight: 700; min-width: 64px; }
        .an-reach { color: var(--text-primary); font-size: 0.9rem; padding-top: 6px; border-top: 1px solid var(--border-color); }
        .an-reach i { color: var(--accent-primary); margin-right: 6px; }
        .an-blockers { color: var(--warning-color); font-size: 0.82rem; margin: 12px 0 0; padding-left: 18px; }
        .an-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
        .an-btn { background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-md); padding: 10px 18px; font-weight: 700; cursor: pointer; }
        .an-btn.primary { background: var(--accent-primary); color: var(--text-light); border-color: var(--accent-primary); }
        .an-btn.danger { color: var(--error-color); border-color: var(--error-color); }
        .an-btn:disabled { opacity: 0.5; cursor: default; }
        .an-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 18px; }
        .an-stat { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 10px; display: flex; flex-direction: column; color: var(--text-primary); }
        .an-stat span { color: var(--text-secondary); font-size: 0.75rem; }
        .an-phone { border-radius: 22px; padding: 14px; display: flex; flex-direction: column; gap: 10px; border: 1px solid var(--border-color); }
        .an-hero { background: #0b6b66; color: #fff; border-radius: 16px; padding: 22px 14px; font-weight: 700; font-size: 0.85rem; }
        .an-card { border-radius: 16px; padding: 14px; }
        .an-card-t { font-weight: 800; font-size: 0.95rem; }
        .an-card-b { font-size: 0.85rem; margin-top: 4px; line-height: 1.45; }
        .an-card-btn { display: inline-block; margin-top: 10px; padding: 7px 14px; border-radius: 999px; font-weight: 800; font-size: 0.8rem; }
        .an-fake { height: 54px; border-radius: 16px; opacity: 0.6; }
        .an-mail { background: #f6f8fa; border-radius: 14px; padding: 16px; color: #0b1326; }
        .an-mail-brand { font-weight: 800; font-size: 18px; color: #0f6e56; margin-bottom: 8px; }
        .an-mail h3 { margin: 0 0 8px; } .an-mail p { line-height: 1.55; margin: 0 0 8px; font-size: 0.9rem; }
        .an-mail-btn { display: inline-block; background: #0f6e56; color: #fff; font-weight: 700; padding: 9px 18px; border-radius: 12px; margin: 8px 0; }
        .an-mail-foot { color: #8a97a8; font-size: 11px; margin-top: 14px; }
      `}</style>
    </div>
  );
}
