import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';
import ReportProblem from './ReportProblem';

// Transaction detail (Round 6, brief 3.4 to 3.6).
//
// The question this panel answers is "where did this come from, and what did the
// app decide for me?". It shows every source the transaction was built from, every
// link it is part of, who made each decision and by which rule, and it gives the
// user a way to undo any of it. Nothing here is a confirm dialog: the brief's rule 7
// is undo instead of confirm, so an undo happens and says so.

const auth = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
const money = (n) => `₦${Math.abs(Number(n) || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '');

// The icon for each kind of link, so the eye can tell them apart before reading.
const LINK_ICON = {
  ownMove: 'fa-right-left',
  reversal: 'fa-rotate-left',
  refund: 'fa-arrow-turn-down',
  fee: 'fa-receipt',
  cash: 'fa-money-bill-wave',
};
const SOURCE_ICON = {
  sms: 'fa-comment-sms', notification: 'fa-bell', email: 'fa-envelope',
  share: 'fa-share-nodes', statement: 'fa-file-invoice', import: 'fa-file-invoice',
  manual: 'fa-pen', mono: 'fa-building-columns', receipt: 'fa-receipt',
};

export default function TxnDetail({ txn, onClose, onChanged, flash }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    if (!txn) return;
    setError('');
    try {
      const res = await axios.get(`${API_URL}/api/transactions/${txn._id}/provenance`, auth());
      setData(res.data);
    } catch {
      setError('Could not load where this came from.');
    }
  }, [txn]);

  useEffect(() => { load(); }, [load]);

  if (!txn) return null;

  const act = async (label, fn) => {
    setBusy(label);
    try {
      const res = await fn();
      await load();
      if (onChanged) await onChanged();
      flash((res && res.data && res.data.toast) || 'Undone');
    } catch (e) {
      flash((e.response && e.response.data && e.response.data.message) || 'That did not work', 'error');
    } finally { setBusy(''); }
  };

  const unlink = (u) => act(u.label, () => axios.post(
    `${API_URL}/api/transactions/${txn._id}/unlink`,
    { linkId: u.linkId, kind: u.kind }, auth(),
  ));
  const split = () => act('split', () => axios.post(
    `${API_URL}/api/transactions/${txn._id}/split-merge`, {}, auth(),
  ));

  const sources = (data && data.sources) || [];
  const links = (data && data.links) || [];
  const undo = (data && data.undo) || [];

  return (
    <div className="txn-detail-backdrop" role="dialog" aria-modal="true" aria-label="Transaction detail">
      <div className="txn-detail">
        <div className="txn-detail-head">
          <div>
            <div className="txn-detail-title">{txn.description}</div>
            <div className="txn-detail-sub">
              {txn.type === 'income' ? '+' : '−'}{money(txn.amount)}
              {' · '}{when(txn.date)}
              {txn.bank ? ` · ${txn.bank}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <i className="fas fa-xmark" aria-hidden="true"></i>
          </button>
        </div>

        {/* The brief's step 4 flag: an alert the bank's own statement does not back up. */}
        {data && data.notOnStatement && (
          <div className="txn-detail-alarm">
            <i className="fas fa-triangle-exclamation" aria-hidden="true"></i>
            <div>
              <strong>Not on your statement</strong>
              <div>This alert is not on the statement you imported. Check it with your bank before you count on it.</div>
            </div>
          </div>
        )}

        {/* The charges folded under this transaction: "N including N charges". */}
        {data && data.charges && (
          <div className="txn-detail-charges">{data.charges}</div>
        )}

        {error && <div className="txn-detail-error">{error}</div>}
        {!data && !error && <div className="txn-detail-loading">Loading…</div>}

        {data && (
          <>
            <section className="txn-detail-section">
              <h4>Where this came from</h4>
              {sources.map((s, i) => (
                <div className="txn-prov-row" key={s.id || i}>
                  <i className={`fas ${SOURCE_ICON[s.source] || 'fa-circle-info'}`} aria-hidden="true"></i>
                  <div>
                    <div className="txn-prov-main">{sourceLabel(s.source)}</div>
                    <div className="txn-prov-meta">
                      {money(s.amountKobo / 100)}
                      {s.eventTime ? ` · ${when(s.eventTime)}` : ''}
                      {s.reference ? ` · ref ${s.reference}` : ''}
                    </div>
                    {i > 0 && (
                      <div className="txn-prov-why">
                        {s.createdBy === 'user' ? 'You joined this record' : 'Joined automatically'}
                        {s.rule ? ` · ${ruleWords(s.rule)}` : ''}
                        {s.step ? ` · rule ${s.step}` : ''}
                      </div>
                    )}
                    {s.inferred && (
                      <div className="txn-prov-why">Saved before we started keeping each source separately.</div>
                    )}
                  </div>
                </div>
              ))}
            </section>

            {links.length > 0 && (
              <section className="txn-detail-section">
                <h4>Linked to</h4>
                {links.map((l) => (
                  <div className="txn-prov-row" key={l.id}>
                    <i className={`fas ${LINK_ICON[l.kind] || 'fa-link'}`} aria-hidden="true"></i>
                    <div>
                      <div className="txn-prov-main">{l.label || (l.copy && l.copy.title) || l.kind}</div>
                      {l.other && (
                        <div className="txn-prov-meta">
                          {l.other.description || 'the other side'}
                          {' · '}{money(l.other.amount)}
                          {l.other.date ? ` · ${when(l.other.date)}` : ''}
                        </div>
                      )}
                      <div className="txn-prov-why">
                        {l.createdBy === 'user' ? 'You linked these' : 'Linked automatically'}
                        {l.rule ? ` · ${ruleWords(l.rule)}` : ''}
                      </div>
                      {l.reason && <div className="txn-prov-why">{l.reason}</div>}
                    </div>
                  </div>
                ))}
              </section>
            )}

            {/* Every merge and every link is reversible from here (brief 3.6). */}
            {undo.length > 0 && (
              <section className="txn-detail-section">
                <h4>Not right?</h4>
                <div className="txn-detail-undos">
                  {undo.map((u, i) => (
                    <button
                      key={u.linkId || `${u.action}${i}`}
                      type="button"
                      className="btn-secondary-sm"
                      disabled={!!busy}
                      onClick={() => (u.action === 'split' ? split() : unlink(u))}
                    >
                      {busy === u.label ? 'Working…' : u.label}
                    </button>
                  ))}
                </div>
                <p className="txn-detail-note">
                  Undoing this tells us we got it wrong, so we do better next time.
                </p>
              </section>
            )}

            <section className="txn-detail-section">
              <ReportProblem
                screen="transaction"
                transactionId={txn._id}
                sourceLabel={txn.bank}
                rawText={txn.source === 'sms' || txn.source === 'notification' || txn.source === 'email' ? txn.description : undefined}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// The same words the server uses, so web and the phone describe a source the same way.
function sourceLabel(s) {
  const map = {
    sms: 'A bank text', notification: 'A bank app alert', email: 'A forwarded email',
    share: 'Something you shared', statement: 'Your statement', import: 'Your statement',
    manual: 'You added it', mono: 'Your linked bank', receipt: 'A receipt',
  };
  return map[s] || 'Another record';
}

function ruleWords(rule) {
  const map = {
    own_move_own_name: 'the other side is your own name',
    own_move_wallet_provider: 'the other side is your wallet',
    own_move_same_reference: 'the same bank reference',
    own_move_saved_route: 'a route you confirmed before',
    ownMove_confirmed_by_user: 'you confirmed it',
    reversal_same_reference: 'the same bank reference',
    reversal_window: 'a credit giving it back',
    refund_same_merchant: 'money back from the same place',
    fee_after_parent: 'a charge right after it',
    cash_spend_of_withdrawal: 'cash you logged',
    reference: 'the same bank reference',
    balance: 'the same balance afterwards',
    window: 'the same account, minutes apart',
    same_as_confirmed_by_user: 'you said they were the same',
    added_from_statement: 'added from your statement',
    first_source: '',
  };
  const hit = map[rule];
  return hit === undefined ? rule : hit;
}
