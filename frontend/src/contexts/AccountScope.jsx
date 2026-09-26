import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Which detected account the app is currently scoped to. 'all' shows everything;
// otherwise the value is `${bankCode}|${accountMask}` identifying one account.
// Dashboard, Insights and Transactions all read this so the whole app can be viewed
// one account at a time.
const AccountScopeContext = createContext({ scope: 'all', setScope: () => {}, accounts: [], inactiveKeys: new Set(), reload: () => {} });

export const useAccountScope = () => useContext(AccountScopeContext);

export const scopeKey = (bankCode, accountMask) => `${bankCode || ''}|${accountMask || ''}`;

// Does a transaction belong to the current view? 'all' matches everything except
// deactivated accounts (passed as a Set of scopeKeys); a specific scope matches only
// that account. Deactivated accounts are never in the switcher, so scope is never one.
export const scopeMatches = (txn, scope, inactiveKeys) => {
  if (!scope || scope === 'all') {
    if (inactiveKeys && inactiveKeys.has(scopeKey(txn.bankCode, txn.accountMask))) return false;
    return true;
  }
  const [code, mask] = scope.split('|');
  return (txn.bankCode || '') === code && (txn.accountMask || '') === (mask || '');
};

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export function AccountScopeProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
  const [inactiveKeys, setInactiveKeys] = useState(() => new Set());
  const [scope, setScopeState] = useState(() => {
    try { return localStorage.getItem('acct_scope') || 'all'; } catch { return 'all'; }
  });

  const setScope = useCallback((s) => {
    setScopeState(s);
    try { localStorage.setItem('acct_scope', s); } catch { /* ignore */ }
  }, []);

  const reload = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API_URL}/api/accounts`, authHeader());
      const all = (data.accounts || []).filter((a) => a.accountMask && (a.txnCount || 0) > 0);
      // The switcher only offers ACTIVE accounts; deactivated ones are hidden from it
      // and their rows are excluded from "All accounts" via inactiveKeys.
      const list = all.filter((a) => a.active !== false);
      setAccounts(list);
      setInactiveKeys(new Set(all.filter((a) => a.active === false).map((a) => scopeKey(a.bankCode, a.accountMask))));
      // If the scoped account is gone or deactivated, fall back to All.
      setScopeState((cur) => {
        if (cur === 'all') return cur;
        const ok = list.some((a) => scopeKey(a.bankCode, a.accountMask) === cur);
        if (!ok) { try { localStorage.setItem('acct_scope', 'all'); } catch { /* ignore */ } return 'all'; }
        return cur;
      });
    } catch { /* offline / not ready */ }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <AccountScopeContext.Provider value={{ scope, setScope, accounts, inactiveKeys, reload }}>
      {children}
    </AccountScopeContext.Provider>
  );
}
