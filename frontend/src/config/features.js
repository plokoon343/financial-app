// Feature flags for the V1 launch. Hidden features are BUILT but dormant — no
// nav entry, no copy that promises the behaviour. Flip a flag to true to
// re-enable it (web reads this at build time; a redeploy is enough, no rewrite).
// Kept in sync with the mobile flags in finpilot-mobile/src/lib/features.ts.
export const FEATURES = {
  wallet: false,        // real-money wallet
  autoSavings: false,   // auto-save execution, round-ups, locked savings
  autopay: false,       // bill/debt payment execution
  debt: false,          // debt manager (payment execution)
  netWorth: true,       // net worth — kept as a launch feature (user request)
  ajo: false,           // rotating savings / circles
  marketplace: false,
};

// Nav paths hidden from the sidebar while their feature is off.
export const HIDDEN_PATHS = new Set([
  ...(FEATURES.wallet ? [] : ['/wallet']),
  ...(FEATURES.autoSavings ? [] : ['/auto-savings']),
  ...(FEATURES.debt ? [] : ['/debt']),
  ...(FEATURES.netWorth ? [] : ['/networth']),
]);
