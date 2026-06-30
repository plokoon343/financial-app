import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import './AiAssistant.css';

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
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    axios
      .get(`${API_URL}/api/ai/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setConfigured(res.data.configured))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async (text) => {
    const question = (text ?? input).trim();
    if (!question || loading) return;

    const history = messages.slice(-10);
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
      // The assistant created something — let other screens know to refresh.
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
          <span className="material-symbols-outlined">smart_toy</span>
        </div>
        <div>
          <h1>AI Assistant</h1>
          <p>Get insights and reports, or tell me to set up goals, budgets, and bills.</p>
        </div>
      </div>

      {!configured && (
        <div className="ai-banner">
          <span className="material-symbols-outlined">schedule</span>
          The AI assistant is being activated for your account. It will answer using your
          own financial data once switched on.
        </div>
      )}

      <div className="ai-chat" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="ai-empty">
            <div className="ai-empty-icon">
              <span className="material-symbols-outlined">forum</span>
            </div>
            <p>Your data stays private — I only see your own accounts.</p>
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
              <span className="material-symbols-outlined ai-msg-avatar">smart_toy</span>
            )}
            <div className="ai-bubble">
              {m.content}
              {Array.isArray(m.actions) && m.actions.length > 0 && (
                <div className="ai-actions">
                  {m.actions.map((a, j) => (
                    <div key={j} className={`ai-action${a.ok ? '' : ' ai-action-fail'}`}>
                      <span className="material-symbols-outlined">
                        {a.ok ? 'check_circle' : 'error'}
                      </span>
                      {a.summary}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-msg ai-msg-assistant">
            <span className="material-symbols-outlined ai-msg-avatar">smart_toy</span>
            <div className="ai-bubble ai-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
      </div>

      <div className="ai-input-row">
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
          <span className="material-symbols-outlined">send</span>
        </button>
      </div>
      <p className="ai-disclaimer">
        General guidance only — not regulated investment, tax, or legal advice.
      </p>
    </div>
  );
};

export default AiAssistant;
