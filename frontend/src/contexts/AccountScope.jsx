import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { API_URL } from '../config';

// Which detected account the app is currently scoped to. 'all' shows everything;
// otherwise the value is `${bankCode}|${accountMask}` identifying one account.
// Dashboard, Insights and Transactions all read this so the whole app can be viewed
// one account at a time.
const AccountScopeContext = createContext({ scope: 'all', setScope: () => {}, accounts: [], reload: () => {} });

export const useAccountScope = () => useContext(AccountScopeContext);

export const scopeKey = (bankCode, accountMask) => `${bankCode || ''}|${accountMask || ''}`;

// Does a transaction belong to the scoped account? 'all' matches everything.
export const scopeMatches = (txn, scope) => {
  if (!scope || scope === 'all') return true;
  const [code, mask] = scope.split('|');
  return (txn.bankCode || '') === code && (txn.accountMask || '') === (mask || '');
};

const authHeader = () => ({ headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });

export function AccountScopeProvider({ children }) {
  const [accounts, setAccounts] = useState([]);
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
      const list = (data.accounts || []).filter((a) => a.accountMask && (a.txnCount || 0) > 0);
      setAccounts(list);
      // If the scoped account no longer exists, fall back to All.
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
    <AccountScopeContext.Provider value={{ scope, setScope, accounts, reload }}>
      {children}
    </AccountScopeContext.Provider>
  );
}
