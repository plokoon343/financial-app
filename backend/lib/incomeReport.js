// Verified income & financial report (spec C6). Turns a user's own transactions
// into a clean, professional, printable summary — the kind people need for visa,
// rent, loan and japa applications. Pure + dependency-free so it can be unit-tested;
// server.js loads the user's data and serves buildSummary() as JSON or the rendered
// HTML (which the mobile app prints to PDF and the web app prints directly).
//
// Framing note: this is a summary GENERATED FROM the user's own data — NOT a bank
// statement or a certified document. renderReportHTML() states this explicitly.

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const monthKey = (d) => { try { return new Date(d).toISOString().slice(0, 7); } catch { return ''; } };
const monthLabel = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'short', year: 'numeric' });
};

// Tidy a counterparty/description into a readable income-source label.
function prettySource(desc) {
  let s = (desc || '').toString()
    .replace(/\b(nip|neft|trf|transfer|from|to|ref|txn|via|inward|credit|payment)\b/gi, ' ')
    .replace(/[:/#*]+/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!s) s = 'Other income';
  s = s.slice(0, 40).trim();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

const sum = (a) => a.reduce((s, x) => s + x, 0);
function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
// Coefficient of variation (stddev / mean) of the monthly income series.
function coefVar(arr) {
  const mean = arr.length ? sum(arr) / arr.length : 0;
  if (mean === 0) return null;
  const variance = sum(arr.map((x) => (x - mean) ** 2)) / arr.length;
  return Math.sqrt(variance) / mean;
}
function stabilityLabel(cv, activeMonths) {
  if (activeMonths < 2 || cv == null) return 'Insufficient history';
  if (cv < 0.15) return 'Very stable';
  if (cv < 0.35) return 'Stable';
  if (cv < 0.6) return 'Moderately variable';
  return 'Irregular';
}
function topN(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([label, amount]) => ({ label, amount: round2(amount) }));
}

// buildSummary(txns, { months, userName, walletBalance, now })
// txns: [{ type, amount, date, description, category }] (amount signed or unsigned).
function buildSummary(txns = [], opts = {}) {
  const months = Math.max(1, Math.min(24, opts.months || 6));
  const now = opts.now ? new Date(opts.now) : new Date();
  // Build the month window in UTC so keys match monthKey() (which is UTC-based) and
  // don't shift a month at midnight boundaries in +01:00 zones.
  const y = now.getUTCFullYear(), mo = now.getUTCMonth();
  const monthsList = [];
  for (let i = months - 1; i >= 0; i--) monthsList.push(new Date(Date.UTC(y, mo - i, 1)).toISOString().slice(0, 7));
  const set = new Set(monthsList);

  const byMonth = new Map(monthsList.map((m) => [m, { month: m, label: monthLabel(m), income: 0, expense: 0, net: 0 }]));
  let totalIncome = 0, totalExpense = 0, incomeCount = 0, largestIncome = 0;
  const incomeBySource = new Map(), expenseByCat = new Map();

  for (const t of txns) {
    if (t.type !== 'income' && t.type !== 'expense') continue; // excludes transfers/excluded kinds
    const m = monthKey(t.date);
    if (!set.has(m)) continue;
    const amt = Math.abs(Number(t.amount)) || 0;
    const row = byMonth.get(m);
    if (t.type === 'income') {
      row.income += amt; totalIncome += amt; incomeCount++;
      if (amt > largestIncome) largestIncome = amt;
      const k = prettySource(t.description);
      incomeBySource.set(k, (incomeBySource.get(k) || 0) + amt);
    } else {
      row.expense += amt; totalExpense += amt;
      const c = t.category || 'Other';
      expenseByCat.set(c, (expenseByCat.get(c) || 0) + amt);
    }
    row.net = round2(row.income - row.expense);
  }

  const monthly = monthsList.map((m) => {
    const r = byMonth.get(m);
    return { ...r, income: round2(r.income), expense: round2(r.expense), net: round2(r.net) };
  });
  const incomeSeries = monthly.map((r) => r.income);
  const activeMonths = incomeSeries.filter((x) => x > 0).length;
  const cv = coefVar(incomeSeries);

  return {
    generatedAt: now.toISOString(),
    userName: opts.userName || '',
    period: { start: monthsList[0], end: monthsList[monthsList.length - 1], months, startLabel: monthLabel(monthsList[0]), endLabel: monthLabel(monthsList[monthsList.length - 1]) },
    monthly,
    totals: { income: round2(totalIncome), expense: round2(totalExpense), net: round2(totalIncome - totalExpense) },
    avgMonthlyIncome: round2(totalIncome / months),
    avgActiveMonthlyIncome: round2(activeMonths ? totalIncome / activeMonths : 0),
    medianMonthlyIncome: round2(median(incomeSeries)),
    largestIncome: round2(largestIncome),
    incomeCount,
    monthsWithIncome: activeMonths,
    stability: { cv: cv == null ? null : round2(cv), label: stabilityLabel(cv, activeMonths) },
    topIncomeSources: topN(incomeBySource, 5),
    expenseBreakdown: topN(expenseByCat, 8),
    walletBalance: opts.walletBalance != null ? round2(opts.walletBalance) : null,
  };
}

// ── HTML rendering ──────────────────────────────────────────────────────────────
const esc = (s) => (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = (n) => '₦' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function renderReportHTML(s, { brand = 'Automonie' } = {}) {
  const gen = new Date(s.generatedAt).toLocaleString('en-NG', { dateStyle: 'long', timeStyle: 'short' });
  const maxExp = Math.max(1, ...s.expenseBreakdown.map((e) => e.amount));
  const monthlyRows = s.monthly.map((r) => `
    <tr><td>${esc(r.label)}</td><td class="num pos">${naira(r.income)}</td><td class="num neg">${naira(r.expense)}</td><td class="num ${r.net >= 0 ? 'pos' : 'neg'}">${naira(r.net)}</td></tr>`).join('');
  const incomeRows = s.topIncomeSources.length
    ? s.topIncomeSources.map((i) => `<tr><td>${esc(i.label)}</td><td class="num">${naira(i.amount)}</td></tr>`).join('')
    : '<tr><td colspan="2" class="muted">No income recorded in this period.</td></tr>';
  const expenseBars = s.expenseBreakdown.map((e) => `
    <div class="bar-row"><span class="bar-label">${esc(e.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${Math.round((e.amount / maxExp) * 100)}%"></span></span>
      <span class="bar-val">${naira(e.amount)}</span></div>`).join('') || '<p class="muted">No expenses recorded.</p>';

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Financial Summary — ${esc(s.userName || 'Report')}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #10221c; margin: 0; padding: 32px; background: #fff; font-size: 13px; line-height: 1.5; }
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0e8a6a; padding-bottom: 14px; }
  .brand { font-size: 20px; font-weight: 800; color: #0e8a6a; letter-spacing: -0.4px; }
  .doctype { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7c76; margin-top: 2px; }
  .head .right { text-align: right; font-size: 11px; color: #6b7c76; }
  h1 { font-size: 22px; margin: 20px 0 2px; letter-spacing: -0.5px; }
  .subject { color: #4a5b55; margin-bottom: 20px; }
  .subject b { color: #10221c; }
  .kpis { display: flex; gap: 12px; margin: 18px 0 24px; }
  .kpi { flex: 1; border: 1px solid #dce6e2; border-radius: 12px; padding: 14px; }
  .kpi .l { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.6px; color: #6b7c76; }
  .kpi .v { font-size: 19px; font-weight: 800; margin-top: 4px; }
  .kpi .v.big { color: #0e8a6a; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #0e8a6a; border-bottom: 1px solid #dce6e2; padding-bottom: 6px; margin: 26px 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid #eef3f1; }
  th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7c76; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .pos { color: #0e8a6a; } .neg { color: #c0392b; }
  tr.total td { font-weight: 800; border-top: 2px solid #cdddd7; border-bottom: none; }
  .muted { color: #8a9a94; }
  .bar-row { display: flex; align-items: center; gap: 10px; margin: 7px 0; }
  .bar-label { width: 130px; font-size: 12px; }
  .bar-track { flex: 1; height: 10px; background: #eef3f1; border-radius: 6px; overflow: hidden; }
  .bar-fill { display: block; height: 10px; background: linear-gradient(90deg,#0e8a6a,#3fbf99); }
  .bar-val { width: 110px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; }
  .foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid #dce6e2; font-size: 10.5px; color: #8a9a94; }
  @media print { body { padding: 0; } .wrap { max-width: none; } }
</style></head><body><div class="wrap">
  <div class="head">
    <div><div class="brand">${esc(brand)}</div><div class="doctype">Financial Summary Report</div></div>
    <div class="right">Generated ${esc(gen)}<br>Period: ${esc(s.period.startLabel)} – ${esc(s.period.endLabel)} (${s.period.months} months)</div>
  </div>

  <h1>Income &amp; Financial Summary</h1>
  <div class="subject">Prepared for <b>${esc(s.userName || 'Account holder')}</b>, from their own recorded transactions.</div>

  <div class="kpis">
    <div class="kpi"><div class="l">Avg. monthly income</div><div class="v big">${naira(s.avgMonthlyIncome)}</div></div>
    <div class="kpi"><div class="l">Total income (period)</div><div class="v">${naira(s.totals.income)}</div></div>
    <div class="kpi"><div class="l">Income stability</div><div class="v">${esc(s.stability.label)}</div></div>
  </div>

  <h2>Monthly breakdown</h2>
  <table>
    <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead>
    <tbody>
      ${monthlyRows}
      <tr class="total"><td>Total</td><td class="num pos">${naira(s.totals.income)}</td><td class="num neg">${naira(s.totals.expense)}</td><td class="num ${s.totals.net >= 0 ? 'pos' : 'neg'}">${naira(s.totals.net)}</td></tr>
    </tbody>
  </table>

  <h2>Income at a glance</h2>
  <table>
    <tbody>
      <tr><td>Average monthly income (active months)</td><td class="num">${naira(s.avgActiveMonthlyIncome)}</td></tr>
      <tr><td>Median monthly income</td><td class="num">${naira(s.medianMonthlyIncome)}</td></tr>
      <tr><td>Largest single credit</td><td class="num">${naira(s.largestIncome)}</td></tr>
      <tr><td>Months with income</td><td class="num">${s.monthsWithIncome} of ${s.period.months}</td></tr>
      <tr><td>Income transactions</td><td class="num">${s.incomeCount}</td></tr>
      ${s.walletBalance != null ? `<tr><td>Current balance</td><td class="num">${naira(s.walletBalance)}</td></tr>` : ''}
    </tbody>
  </table>

  <h2>Top income sources</h2>
  <table><tbody>${incomeRows}</tbody></table>

  <h2>Where the money went</h2>
  ${expenseBars}

  <div class="foot">
    This report was generated by ${esc(brand)} from transaction data recorded in the account holder's own profile. It is a summary for the holder's personal use and is <b>not a bank statement, an audited account, or a certified financial document</b>. Figures reflect the transactions available at the time of generation and exclude transfers between the holder's own accounts.
  </div>
</div></body></html>`;
}

module.exports = { buildSummary, renderReportHTML, prettySource };
