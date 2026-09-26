import React from 'react';
import { useAccountScope, scopeKey } from '../contexts/AccountScope';

const label = (a) => a.label || a.bankName || a.bankCode || 'Account';

// A compact account selector. Scopes the whole app (Dashboard, Insights,
// Transactions) to one detected account, or All. Hidden until there are at least two
// accounts to choose between.
export default function AccountSwitcher({ style }) {
  const { scope, setScope, accounts } = useAccountScope();
  if (!accounts || accounts.length < 2) return null;

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, ...style }}>
      <i className="fas fa-wallet" style={{ color: 'var(--accent-primary, #008751)' }} />
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value)}
        title="View one account at a time"
        style={{
          padding: '0.45rem 0.7rem', borderRadius: 10, fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
          border: '1px solid var(--glass-border, #e2e8f0)', background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #1a365d)',
          maxWidth: 220,
        }}>
        <option value="all">All accounts</option>
        {accounts.map((a) => (
          <option key={scopeKey(a.bankCode, a.accountMask)} value={scopeKey(a.bankCode, a.accountMask)}>
            {label(a)} ••{a.accountMask}
          </option>
        ))}
      </select>
    </label>
  );
}
