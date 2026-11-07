import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useSearchParams, Link } from 'react-router-dom';
import { API_URL } from '../config';
import { fmtNairaFull } from '../utils/format';
import { undoable } from '../lib/undo';
import { fillTemplate, ruleLabel, positionLabel, initials } from '../lib/actionCards';
import { EXPENSE_CATEGORIES } from '../constants/categories';
import Select from './Select';

// The Action Center (round 6, Block 4; brief section 4), web half of 13.11 parity.
//
// WHAT CHANGED AND WHY
// This page used to be a long list of sections - "Alerts to check", "To sort",
// "Possible duplicates" - each with its own buttons, and the worst of it was raw bank
// text in editable fields: the user was handed the parser's job (research section 14).
// It is now ONE CARD AT A TIME: one question, one click, the likely answer first and
// highlighted, nothing else on the page. Raw text sits behind "See the original
// alert" and is never editable.
//
// The server decides what to ask, in what order, and what the copy is; this page
// renders it and sends the answer back. Grouping (six payments to one shop are one
// card), the ₦2,000 ask floor and the 14-day skip rule all live in
// backend/lib/actionCards.js, so the phone and the web app ask exactly the same
// questions in the same order.

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const money = (n) => fmtNairaFull(n);

export default function ActionCenter() {
  // Money's "N need a category / Sort them" links here with ?kinds=... (brief 4.1).
  const [params] = useSearchParams();
  const kinds = params.get('kinds') || '';

  const [cards, setCards] = useState(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState('');
  const [tally, setTally] = useState({ answered: 0, rules: 0 });
  const [ruleOn, setRuleOn] = useState({});
  const [cashParts, setCashParts] = useState({});
  const [showRaw, setShowRaw] = useState(false);
  const [pickerValue, setPickerValue] = useState('');
  // Alerts the parser could not read. Not cards (there is no one-click question for
  // text we could not read), but not lost either: offered at the end of the queue.
  const [heldAlerts, setHeldAlerts] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/action-center/cards${kinds ? `?kinds=${encodeURIComponent(kinds)}` : ''}`, auth());
      const list = data.cards || [];
      setCards(list);
      setHeldAlerts(data.heldAlerts || 0);
      setRuleOn((prev) => {
        const next = { ...prev };
        for (const c of list) if (c.rule && next[c.key] === undefined) next[c.key] = c.rule.checked;
        return next;
      });
      setIndex(0);
      setError('');
    } catch {
      setError('Could not load your quick look.');
      setCards([]);
    }
  }, [kinds]);

  // Loaded once per visit, deliberately: a refetch while the user is three cards deep
  // would move the card under their cursor.
  useEffect(() => { load(); }, [load]);

  const card = cards?.[index];
  const total = cards?.length ?? 0;
  const done = cards !== null && index >= total;

  // Put a card back exactly where it was: that is what Undo means here.
  const putBack = useCallback((c, at) => {
    setCards((prev) => {
      if (!prev) return prev;
      const next = prev.slice();
      next.splice(Math.min(at, next.length), 0, c);
      return next;
    });
    setIndex(at);
    setTally((t) => ({ ...t, answered: Math.max(0, t.answered - 1) }));
  }, []);

  // The answer leaves the page at once and is sent behind an Undo. The request is
  // never awaited before the next card shows: that is what makes this one click.
  const answerCard = useCallback((c, a, extra = {}) => {
    const at = cards ? Math.max(0, cards.indexOf(c)) : index;
    const applyRule = !!(c.rule && ruleOn[c.key]);
    const payload = {
      key: c.key,
      kind: c.kind,
      answerId: a.id,
      applyRule,
      category: extra.category,
      amount: c.item.amount ?? undefined,
      amounts: extra.amounts,
      targets: c.targets,
    };
    setCards((prev) => (prev ? prev.filter((x) => x.key !== c.key) : prev));
    setTally((t) => ({ ...t, answered: t.answered + 1, rules: applyRule ? t.rules + 1 : t.rules }));
    undoable('Saved', async () => {
      const { data } = await axios.post(`${API_URL}/api/action-center/answer`, payload, auth());
      // The server makes a rule on its own the second time the same answer is given
      // for a name. The user never asked for it, so they are told it happened.
      if (data?.rule?.made && !applyRule) setTally((t) => ({ ...t, rules: t.rules + 1 }));
    }, () => putBack(c, at));
  }, [cards, index, ruleOn, putBack]);

  // Skipping moves the card down the queue. It does not answer it and it is never
  // counted against the user.
  const skipCard = useCallback((c) => {
    setCards((prev) => {
      if (!prev) return prev;
      const rest = prev.filter((x) => x.key !== c.key);
      rest.push({ ...c, skipped: true });
      return rest;
    });
    axios.post(`${API_URL}/api/action-center/skip`, { key: c.key }, auth()).catch(() => {});
  }, []);

  const isCash = card?.kind === 'cash';
  const cashTiles = useMemo(() => (isCash ? (card.answers[0].tiles || []) : []), [isCash, card]);
  const cashSum = cashTiles.reduce((n, t) => n + (Number(cashParts[`${card?.key}:${t}`]) || 0), 0);

  const onAnswer = (a) => {
    if (!card) return;
    if (a.opensPicker) {
      if (!pickerValue) return;
      answerCard(card, a, { category: pickerValue });
      setPickerValue('');
      return;
    }
    if (a.isSkip) { skipCard(card); return; }
    if (isCash && a.id === 'save') {
      const amounts = cashTiles
        .map((t) => ({ category: t, amount: Number(cashParts[`${card.key}:${t}`]) || 0 }))
        .filter((x) => x.amount > 0);
      answerCard(card, a, { amounts });
      return;
    }
    answerCard(card, a);
  };

  return (
    <div className="acx-page">
      <header className="acx-head">
        <h2>Quick look</h2>
        <span className="acx-position">{total && !done ? positionLabel(index, total) : ''}</span>
      </header>

      {cards === null && !error && <div className="loading-container"><div className="loading-spinner"></div></div>}
      {error && <p className="acx-error" role="alert">{error}</p>}

      {cards !== null && (done || !card) && (
        <div className="acx-done">
          <div className="acx-burst"><i className="fas fa-check" aria-hidden="true"></i></div>
          <h3>All sorted.</h3>
          <p>Your numbers are up to date.</p>
          {(tally.answered > 0 || tally.rules > 0) && (
            <ul className="acx-summary">
              {tally.answered > 0 && <li>Answered {tally.answered}</li>}
              {tally.rules > 0 && <li>New rules made {tally.rules}</li>}
            </ul>
          )}
          <a className="btn-primary acx-home" href="/dashboard">Back to Home</a>
          {heldAlerts > 0 && (
            <p className="acx-held">
              <Link to="/alerts-to-check">
                {heldAlerts === 1 ? '1 alert we could not read' : `${heldAlerts} alerts we could not read`}
              </Link>
            </p>
          )}
        </div>
      )}

      {card && !done && (
        <>
          {/* One segment per card, filled for the ones already answered. Past eight
              cards it is a single bar, because nine slivers say nothing. */}
          {total > 8 ? (
            <div className="acx-bar" aria-label={`${index} of ${total} answered`}>
              <span style={{ width: `${Math.min(100, Math.round((index / total) * 100))}%` }} />
            </div>
          ) : (
            <div className="acx-segments" aria-label={`${index} of ${total} answered`}>
              {Array.from({ length: total }, (_, i) => <span key={i} className={i < index ? 'on' : ''} />)}
            </div>
          )}

          <section className="acx-card" aria-live="polite">
            <div className="acx-item">
              {card.item.pair ? (
                <div className="acx-pair-circles" aria-label={`${card.item.pair.from} to ${card.item.pair.to}`}>
                  <span className="acx-circle">{initials(card.item.pair.from)}</span>
                  <i className="fas fa-arrow-right" aria-hidden="true"></i>
                  <span className="acx-circle">{initials(card.item.pair.to)}</span>
                </div>
              ) : (
                <span className="acx-circle">{card.item.initials}</span>
              )}
              <div className="acx-item-text">
                <strong>{card.item.title}</strong>
                {card.item.count > 1 && <span className="acx-meta">{card.item.count} payments</span>}
              </div>
            </div>

            {card.item.amount != null && <p className="acx-amount">{money(card.item.amount)}</p>}
            {card.item.meta && <p className="acx-meta">{card.item.meta}</p>}

            <hr className="acx-divider" />

            <h3 className="acx-question">{fillTemplate(card.question, card.vars, money)}</h3>
            {card.helper && <p className="acx-helper">{fillTemplate(card.helper, card.vars, money)}</p>}

            {/* The cash card is the one that is not a single click: a withdrawal
                usually became three or four things, so it takes amounts, and
                "Leave the rest" is a complete answer. */}
            {isCash && (
              <div className="acx-tiles">
                {cashTiles.map((t) => (
                  <label key={t} className="acx-tile">
                    <span>{t}</span>
                    <input
                      type="number" min="0" step="0.01" placeholder="0"
                      value={cashParts[`${card.key}:${t}`] || ''}
                      onChange={(e) => setCashParts((p) => ({ ...p, [`${card.key}:${t}`]: e.target.value }))}
                      aria-label={`Amount spent on ${t}`}
                    />
                  </label>
                ))}
              </div>
            )}

            <div className="acx-answers">
              {card.answers.map((a) => {
                const label = isCash && a.id === 'save'
                  ? fillTemplate(a.label, { sum: cashSum }, money)
                  : fillTemplate(a.label, a.money != null ? { ...card.vars, [a.id]: a.money } : card.vars, money);
                const disabled = (isCash && a.id === 'save' && cashSum <= 0) || (a.opensPicker && !pickerValue);
                return (
                  <React.Fragment key={a.id}>
                    {a.opensPicker && (
                      <Select
                        aria-label="Pick a category"
                        value={pickerValue}
                        onChange={(e) => setPickerValue(e.target.value)}
                        className="acx-picker"
                      >
                        <option value="">Something else…</option>
                        {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    )}
                    <button
                      type="button"
                      className={`acx-answer${a.primary ? ' primary' : ''}`}
                      onClick={() => onAnswer(a)}
                      disabled={disabled}
                    >
                      <span>{a.opensPicker && pickerValue ? `Save as ${pickerValue}` : label}</span>
                      {a.pill && <em className="acx-pill">{a.pill}</em>}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Rule 4, offered rather than assumed: ticked by default on a grouped
                card, because someone answering for six at once means it for the
                seventh. */}
            {card.rule && (
              <label className="acx-rule">
                <input
                  type="checkbox"
                  checked={!!ruleOn[card.key]}
                  onChange={() => setRuleOn((r) => ({ ...r, [card.key]: !r[card.key] }))}
                />
                <span>{ruleLabel(card)}</span>
              </label>
            )}

            {/* Raw bank text is readable, and nothing more. It is never a form. */}
            {card.raw && (
              <details className="acx-rawbox" open={showRaw} onToggle={(e) => setShowRaw(e.target.open)}>
                <summary>See the original alert</summary>
                <pre className="acx-raw">{card.raw}</pre>
              </details>
            )}
          </section>

          <button type="button" className="acx-skip" onClick={() => skipCard(card)}>Skip for now</button>
          <p className="acx-footer">You can change any answer later from the transaction.</p>
        </>
      )}

      <style>{`
        .acx-page { max-width: 640px; margin: 0 auto; padding: 16px; display: grid; gap: 14px; }
        .acx-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
        .acx-head h2 { color: var(--text-primary); margin: 0; }
        .acx-position { color: var(--text-secondary); font-size: 0.85rem; font-weight: 700; }
        .acx-error { color: var(--expense-color); }
        .acx-segments { display: flex; gap: 6px; }
        .acx-segments span { flex: 1; height: 4px; border-radius: 2px; background: var(--bg-secondary); }
        .acx-segments span.on { background: var(--accent-primary); }
        .acx-bar { height: 4px; border-radius: 2px; background: var(--bg-secondary); overflow: hidden; }
        .acx-bar span { display: block; height: 4px; background: var(--accent-primary); }

        .acx-card { background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 22px; padding: 22px; }
        .acx-item { display: flex; align-items: center; gap: 12px; }
        .acx-item-text { display: grid; gap: 2px; min-width: 0; }
        .acx-item-text strong { color: var(--text-primary); overflow-wrap: anywhere; }
        .acx-circle { width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; background: var(--bg-secondary); color: var(--text-secondary); font-weight: 800; display: grid; place-items: center; }
        .acx-pair-circles { display: flex; align-items: center; gap: 4px; color: var(--text-secondary); }
        .acx-amount { font-size: 2.3rem; font-weight: 600; color: var(--text-primary); margin: 10px 0 0; font-variant-numeric: tabular-nums; }
        .acx-meta { color: var(--text-secondary); font-size: 0.82rem; margin: 2px 0 0; }
        .acx-divider { border: 0; border-top: 1px solid var(--border-color); margin: 16px 0; }
        .acx-question { font-size: 1.18rem; font-weight: 500; line-height: 1.45; color: var(--text-primary); margin: 0; }
        .acx-helper { color: var(--text-secondary); font-size: 0.82rem; margin: 6px 0 0; }

        .acx-answers { display: grid; gap: 10px; margin-top: 18px; }
        .acx-answer { min-height: 56px; border-radius: 16px; border: 1px solid var(--border-strong, var(--border-color)); background: transparent; color: var(--text-primary); font: inherit; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 16px; }
        .acx-answer.primary { background: var(--accent-primary); border-color: var(--accent-primary); color: var(--on-primary, #0B0E11); }
        .acx-answer:disabled { opacity: 0.45; cursor: not-allowed; }
        .acx-pill { font-size: 0.68rem; font-style: normal; font-weight: 700; background: var(--bg-card); color: var(--text-secondary); border-radius: var(--radius-full); padding: 2px 8px; }
        .acx-picker { width: 100%; background: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 9px 11px; font: inherit; }

        .acx-tiles { display: grid; gap: 8px; margin-top: 16px; }
        .acx-tile { display: flex; align-items: center; gap: 10px; border: 1px solid var(--border-color); border-radius: 14px; padding: 8px 14px; min-height: 52px; }
        .acx-tile span { flex: 1; color: var(--text-primary); font-weight: 600; }
        .acx-tile input { width: 120px; text-align: right; background: transparent; border: 0; color: var(--text-primary); font: inherit; font-weight: 700; }

        .acx-rule { display: flex; align-items: center; gap: 10px; margin-top: 16px; color: var(--text-secondary); font-size: 0.88rem; cursor: pointer; }
        .acx-rawbox { margin-top: 14px; }
        .acx-rawbox summary { color: var(--text-secondary); font-size: 0.88rem; font-weight: 600; cursor: pointer; }
        .acx-raw { margin: 10px 0 0; padding: 12px; border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font: 0.82rem/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; max-height: 220px; overflow: auto; }

        .acx-skip { background: none; border: 0; color: var(--text-secondary); font: inherit; font-weight: 700; min-height: 48px; cursor: pointer; }
        .acx-footer { color: var(--text-faint, var(--text-secondary)); font-size: 0.76rem; text-align: center; margin: 0; }

        .acx-done { text-align: center; padding: 40px 20px; }
        .acx-burst { width: 76px; height: 76px; margin: 0 auto 18px; border-radius: 50%; background: var(--accent-primary); color: var(--on-primary, #0B0E11); display: grid; place-items: center; font-size: 1.8rem; }
        .acx-done h3 { color: var(--text-primary); margin: 0; font-size: 1.6rem; }
        .acx-done p { color: var(--text-secondary); margin: 6px 0 0; }
        .acx-summary { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 6px; color: var(--text-secondary); font-weight: 600; font-size: 0.88rem; }
        .acx-home { display: inline-block; margin-top: 26px; text-decoration: none; }
        .acx-held { margin: 16px 0 0; font-size: 0.85rem; }
        .acx-held a { color: var(--text-secondary); }
      `}</style>
    </div>
  );
}
