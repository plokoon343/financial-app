import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import './AiAssistant.css';
import RichText from './RichText';
import { StatementCard, PasswordCard, ReceiptCard, ProposalCard } from './AiChatCards';

const SUGGESTIONS = [
  'Give me a spending report for this month',
  'Where is most of my money going?',
  'Create a goal: save ₦500,000 for rent by December',
  'Set a ₦40,000 monthly budget for Food',
];

const AiAssistant = () => {
  const [messages, setMessages] = useState([]); // { role, content }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [freeTier, setFreeTier] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [uploading, setUploading] = useState('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

  useEffect(() => {
    const token = localStorage.getItem('token');
    axios
      .get(`${API_URL}/api/ai/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => { setConfigured(res.data.configured); setFreeTier(!!res.data.freeTier); })
      .catch(() => {});
    // Pick up the conversation where the user left it.
    axios
      .get(`${API_URL}/api/ai/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setMessages((m) => (m.length ? m : (res.data.messages || []).map(({ role, content, actions }) => ({ role, content, actions, fromHistory: true })))))
      .catch(() => {});
  }, []);

  const newChat = async () => {
    setMessages([]);
    try { await axios.delete(`${API_URL}/api/ai/history`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); } catch { /* the next message still works */ }
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    // Upload cards live only in this chat; the model sees the text turns.
    const history = messages.filter((m) => !m.card && m.content).slice(-10).map(({ role, content }) => ({ role, content }));
    const next = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setInput('');
    setLoading(true);

    try {
      const token = localStorage.getItem('token');
      const res = await axios.post(
        `${API_URL}/api/ai/chat`,
        { message: question, history },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.data.configured === false) setConfigured(false);
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: res.data.reply, actions: res.data.actions || [] },
      ]);
      // The assistant created something - let other screens know to refresh.
      if (res.data.changed) window.dispatchEvent(new Event('automonie:data-changed'));
    } catch (err) {
      const msg =
        err.response?.data?.message || 'Sorry, something went wrong. Please try again.';
      setMessages((m) => [...m, { role: 'assistant', content: msg, error: true }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  // ---- Uploads: statements go through the statement reader; receipt photos are read
  // on this device and only their text is sent to the receipt reader.
  const patch = (id, fn) => setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, card: fn(m.card) } : m)));
  const say = (content, extra = {}) => setMessages((ms) => [...ms, { role: 'assistant', content, ...extra }]);
  const errText = (err, fallback) => err.response?.data?.message || fallback;

  const readStatement = async (file, password, cardId) => {
    const form = new FormData();
    form.append('file', file);
    if (password) form.append('pdfPassword', password);
    try {
      const { data } = await axios.post(`${API_URL}/api/upload-statement`, form, auth());
      if (cardId) patch(cardId, (c) => ({ ...c, status: 'done' }));
      const rows = (data.transactions || []).filter((t) => !t.duplicate);
      const totalIn = rows.filter((t) => t.type === 'income').reduce((a, t) => a + Math.abs(t.amount), 0);
      const totalOut = rows.filter((t) => t.type === 'expense').reduce((a, t) => a + Math.abs(t.amount), 0);
      const meta = data.meta || {};
      say('', { id: `st-${Date.now()}`, card: {
        type: 'statement', fileName: file.name, rows, totalIn, totalOut, bank: meta.detectedBank || '',
        dupCount: meta.duplicateCount || 0, uncertainCount: meta.uncertainCount || 0, warnings: meta.warnings || [], status: 'ready',
      } });
    } catch (err) {
      const d = err.response?.data || {};
      if (d.passwordRequired || d.wrongPassword) {
        if (cardId) patch(cardId, (c) => ({ ...c, status: 'ready', wrong: true }));
        else say('', { id: `pw-${Date.now()}`, card: { type: 'password', fileName: file.name, file, status: 'ready' } });
        return;
      }
      if (cardId) patch(cardId, (c) => ({ ...c, status: 'done' }));
      say(errText(err, "I couldn't read that file. Try a digital PDF, CSV or Excel statement from your bank."), { error: true });
    }
  };

  const importStatement = async (m) => {
    patch(m.id, (c) => ({ ...c, status: 'busy', error: '' }));
    try {
      const { data } = await axios.post(`${API_URL}/api/import-transactions`, { transactions: m.card.rows, bank: m.card.bank, channel: 'statement' }, auth());
      patch(m.id, (c) => ({ ...c, status: 'done', result: data.message || `Imported ${c.rows.length} transactions.` }));
      window.dispatchEvent(new Event('automonie:data-changed'));
    } catch (err) {
      patch(m.id, (c) => ({ ...c, status: 'ready', error: errText(err, 'Import failed. Please try again.') }));
    }
  };

  const readReceipt = async (file) => {
    let text = '';
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng');
      try { text = (await worker.recognize(file)).data.text || ''; } finally { await worker.terminate(); }
    } catch {
      say("I couldn't read that photo on this device. Try a clearer photo, or add the expense yourself.", { error: true });
      return;
    }
    try {
      const { data } = await axios.post(`${API_URL}/api/receipts/parse`, { text }, auth());
      say('', { id: `rc-${Date.now()}`, card: { type: 'receipt', ...data, status: 'ready' } });
    } catch (err) {
      if (err.response?.status === 402) say('Reading receipts is part of Automonie Plus. You can see the plans in Settings, under Plans.', { error: true });
      else say(errText(err, "I couldn't read that receipt. Try a clearer photo."), { error: true });
    }
  };

  const saveReceipt = async (m, f) => {
    patch(m.id, (c) => ({ ...c, status: 'busy', error: '' }));
    try {
      await axios.post(`${API_URL}/api/transactions`, { date: f.date, description: f.merchant.trim(), amount: f.amount, category: f.category, type: 'expense', source: 'receipt' }, auth());
      patch(m.id, (c) => ({ ...c, status: 'done', result: `Saved: ₦${Math.round(f.amount).toLocaleString('en-NG')} at ${f.merchant.trim()}, ${f.category}.` }));
      window.dispatchEvent(new Event('automonie:data-changed'));
    } catch (err) {
      patch(m.id, (c) => ({ ...c, status: 'ready', error: errText(err, 'Could not save. Please try again.') }));
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || loading || uploading) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImage = /^image\/(png|jpe?g|webp)$/.test(file.type);
    if (!isImage && !['pdf', 'csv', 'xlsx', 'xls'].includes(ext)) {
      say('I can read bank statements (PDF, CSV or Excel) and receipt photos (JPG, PNG or WebP).', { error: true });
      return;
    }
    if (file.size > 10 * 1024 * 1024) { say('That file is over 10 MB. Try a smaller one.', { error: true }); return; }
    setMessages((ms) => [...ms, { role: 'user', content: `Uploaded ${file.name}` }]);
    setUploading(isImage ? 'Reading your receipt on this device. The first one can take up to 30 seconds…' : 'Reading your statement…');
    try { await (isImage ? readReceipt(file) : readStatement(file)); } finally { setUploading(''); }
  };

  // ---- Proposed edits and deletes: they run only on Confirm, through the normal routes.
  const patchAction = (mi, ai, fn) => setMessages((ms) => ms.map((m, i) => (i !== mi ? m : { ...m, actions: m.actions.map((a, j) => (j === ai ? { ...a, ...fn(a) } : a)) })));
  const confirmProposal = async (mi, ai, a) => {
    patchAction(mi, ai, () => ({ busy: true }));
    const p = a.proposal;
    try {
      if (p.kind === 'delete') await axios.delete(`${API_URL}/api/transactions/${p.id}`, auth());
      else await axios.put(`${API_URL}/api/transactions/${p.id}`, p.changes, auth());
      patchAction(mi, ai, () => ({ busy: false, resolved: p.kind === 'delete' ? 'Deleted.' : 'Changed.', resolvedOk: true }));
      window.dispatchEvent(new Event('automonie:data-changed'));
    } catch (err) {
      patchAction(mi, ai, () => ({ busy: false, resolved: err.response?.status === 404 ? 'That transaction is already gone. Nothing changed.' : "That didn't work, so nothing changed. Try again from Transactions.", resolvedOk: false }));
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="ai-page">
      <div className="ai-header">
        <div className="ai-header-icon">
          <i className="fas fa-comments" aria-hidden="true"></i>
        </div>
        <div>
          <h1>Ask Automonie</h1>
          <p>Get insights and reports, or tell me to set up goals, budgets, and bills.</p>
        </div>
        {messages.length > 0 && (
          <button type="button" className="btn-secondary ai-new" onClick={newChat} disabled={loading}>
            <i className="fas fa-plus" aria-hidden="true"></i> New chat
          </button>
        )}
      </div>

      {!configured && (
        <div className="ai-banner">
          <i className="fas fa-clock" aria-hidden="true"></i>
          Ask Automonie is being switched on for your account. It will answer using your
          own financial data once switched on.
        </div>
      )}

      <div className="ai-chat" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-icon">
              <i className="fas fa-comments" aria-hidden="true"></i>
            </div>
            <p>I answer from your own Automonie data, and only yours.</p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ai-chip" onClick={() => send(s)} disabled={loading}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg-${m.role}${m.error ? ' ai-msg-error' : ''}`}>
            {m.role === 'assistant' && (
              <i className="fas fa-comments ai-msg-avatar" aria-hidden="true"></i>
            )}
            <div className="ai-bubble">
              {m.content && (m.role === 'assistant' && !m.error ? <RichText text={m.content} /> : m.content)}
              {m.card?.type === 'statement' && <StatementCard card={m.card} onImport={() => importStatement(m)} />}
              {m.card?.type === 'password' && <PasswordCard card={m.card} onSubmit={(pw) => { patch(m.id, (c) => ({ ...c, status: 'busy', wrong: false })); readStatement(m.card.file, pw, m.id); }} />}
              {m.card?.type === 'receipt' && <ReceiptCard card={m.card} onSave={(f) => saveReceipt(m, f)} />}
              {Array.isArray(m.actions) && m.actions.map((a, j) => (a.pending && a.proposal ? (
                <ProposalCard key={`p${j}`} action={a} stale={!!m.fromHistory} onConfirm={() => confirmProposal(i, j, a)} onCancel={() => patchAction(i, j, () => ({ resolved: 'Cancelled. Nothing changed.', resolvedOk: false }))} />
              ) : null))}
              {Array.isArray(m.actions) && m.actions.some((a) => !a.pending) && (
                <div className="ai-actions">
                  {m.actions.filter((a) => !a.pending).map((a, j) => (
                    <div key={j} className={`ai-action${a.ok ? '' : ' ai-action-fail'}`}>
                      <i className={`fas ${a.ok ? 'fa-circle-check' : 'fa-circle-exclamation'}`} aria-hidden="true"></i>
                      {a.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {uploading && (
          <div className="ai-msg ai-msg-assistant">
            <i className="fas fa-comments ai-msg-avatar" aria-hidden="true"></i>
            <div className="ai-bubble">{uploading}</div>
          </div>
        )}

        {loading && (
          <div className="ai-msg ai-msg-assistant">
            <i className="fas fa-comments ai-msg-avatar" aria-hidden="true"></i>
            <div className="ai-bubble ai-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <div className="ai-input-row">
        <input ref={fileRef} type="file" hidden accept=".pdf,.csv,.xlsx,.xls,image/png,image/jpeg,image/webp" onChange={onFile} />
        <button
          type="button"
          className="ai-attach"
          onClick={() => fileRef.current?.click()}
          disabled={loading || !!uploading || !configured}
          aria-label="Upload a statement or receipt"
          title="Upload a statement or receipt"
        >
          <i className="fas fa-paperclip" aria-hidden="true"></i>
        </button>
        <textarea
          ref={inputRef}
          className="ai-input"
          rows={1}
          placeholder="Ask about your money…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={loading}
        />
        <button
          className="ai-send"
          onClick={() => send()}
          disabled={loading || !input.trim()}
          aria-label="Send"
        >
          <i className="fas fa-paper-plane" aria-hidden="true"></i>
        </button>
      </div>
      <p className="ai-safety">
        <i className="fas fa-lock" aria-hidden="true"></i>
        For your safety, never type passwords, PINs or card numbers here.
        <button type="button" className="ai-how-link" onClick={() => setHowOpen(true)}>How this works</button>
      </p>
      <p className="ai-disclaimer">
        General guidance only, not regulated investment, tax, or legal advice.
      </p>

      {howOpen && (
        <div className="ai-how-backdrop" onClick={() => setHowOpen(false)}>
          <div className="ai-how-sheet" role="dialog" aria-modal="true" aria-labelledby="ai-how-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="ai-how-title"><i className="fas fa-lock" aria-hidden="true"></i> How Ask works</h2>
            <ul>
              {freeTier ? (
                <>
                  <li>Your question and a summary of your money (totals, categories, budgets, goals and your 40 most recent transactions) go to our AI provider to write the answer.</li>
                  <li>Before anything is sent, we leave out your name and remove names and numbers from transaction descriptions.</li>
                </>
              ) : (
                <li>Your question and a summary of your money go to Google&apos;s Gemini on its paid tier, which doesn&apos;t use it to improve Google&apos;s products.</li>
              )}
              <li>What you type is sent as you wrote it, so keep passwords, PINs, card and account numbers out of it.</li>
              <li>Ask can add transactions, budgets, goals, bills and subscriptions when you tell it to. It can suggest changing or deleting a transaction, but nothing changes until you tap Confirm. It can&apos;t move money or pay anything.</li>
              <li>A statement you upload is read by our statement reader and the file is deleted after reading. A receipt photo is read on your device, and only its text is sent.</li>
              <li>Your last 60 messages are saved so you can pick up where you left off. New chat clears them, and deleting your account deletes them.</li>
            </ul>
            <p className="ai-how-more">More detail in our <a href="https://www.automonie.com/privacy#ai" target="_blank" rel="noreferrer">privacy policy</a>.</p>
            <button type="button" className="btn-primary ai-how-close" onClick={() => setHowOpen(false)}>Got it</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AiAssistant;
