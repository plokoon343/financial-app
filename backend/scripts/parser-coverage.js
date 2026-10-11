/*
 * Alert parser coverage against the anonymised test set (corpus/alerts/<bank>.jsonl).
 *
 * For each bank: how many alerts the rules read correctly without AI (amount,
 * direction, date), how many non-transactions were correctly dropped, and whether the
 * bank has its own parser entry (data/alertRules.json) or uses the shared patterns.
 * Amount, direction and "dropped correctly" are gated at 100%: lib/alertParser.test.js
 * runs the same check in `npm test`, so no parser change can ship that breaks a bank.
 *
 *   node backend/scripts/parser-coverage.js           # table
 *   node backend/scripts/parser-coverage.js --json    # machine-readable
 *   node backend/scripts/parser-coverage.js --md      # markdown table (for reports)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { parseAlert } = require('../lib/alertParser');
const { bankRule } = require('../lib/alertClassify');
const { BANKS } = require('../lib/bankRegistry');

const DIR = path.join(__dirname, '..', 'corpus', 'alerts');

function coverage() {
  const rows = [];
  const failures = [];
  for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.jsonl')).sort()) {
    const bank = path.basename(f, '.jsonl');
    const cases = fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const t = { bank, n: 0, txn: 0, ruled: 0, amount: 0, direction: 0, date: 0, ign: 0, ignOk: 0, fee: 0, feeOk: 0 };
    for (const c of cases) {
      t.n++;
      const e = c.expected || {};
      const got = parseAlert(c.raw, { today: new Date('2026-10-11T12:00:00Z') });
      if (e.ignore) {
        t.ign++;
        if (!got) t.ignOk++; else failures.push({ bank, field: 'ignore', expected: 'dropped', got: got.kind, raw: c.raw });
        continue;
      }
      t.txn++;
      if (!got) { failures.push({ bank, field: 'parsed', expected: 'a row', got: 'dropped', raw: c.raw }); continue; }
      const okAmount = Math.abs(got.amount - Number(e.amount)) < 0.005;
      const okDir = (got.type === 'income' ? 'credit' : 'debit') === e.direction;
      const okDate = !e.date || got.date === e.date;
      if (okAmount) t.amount++; else failures.push({ bank, field: 'amount', expected: e.amount, got: got.amount, raw: c.raw });
      if (okDir) t.direction++; else failures.push({ bank, field: 'direction', expected: e.direction, got: got.type, raw: c.raw });
      if (okDate) t.date++; else failures.push({ bank, field: 'date', expected: e.date, got: got.date, raw: c.raw });
      if (okAmount && okDir && okDate && got.kind !== 'unsure') t.ruled++;
      if (e.category === 'Bank Charges') { t.fee++; if (got.category === 'Bank Charges') t.feeOk++; }
    }
    const code = (BANKS.find((b) => b.code === bank || b.name.toLowerCase() === bank) || {}).code || bank;
    rows.push({ ...t, entry: bankRule(code) ? 'own' : 'shared' });
  }
  return { rows, failures };
}

const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

if (require.main === module) {
  const { rows, failures } = coverage();
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ rows, failures }, null, 2)); process.exit(failures.some((f) => f.field !== 'date') ? 1 : 0); }
  const md = process.argv.includes('--md');
  const head = ['bank', 'alerts', 'rules only', 'amount', 'direction', 'date', 'non-txn dropped', 'fees found', 'parser entry'];
  const line = (r) => [r.bank, r.n, pct(r.ruled, r.txn), pct(r.amount, r.txn), pct(r.direction, r.txn), pct(r.date, r.txn), r.ign ? `${r.ignOk}/${r.ign}` : '-', r.fee ? `${r.feeOk}/${r.fee}` : '-', r.entry];
  const all = rows.reduce((a, r) => { for (const k of ['n', 'txn', 'ruled', 'amount', 'direction', 'date', 'ign', 'ignOk', 'fee', 'feeOk']) a[k] = (a[k] || 0) + r[k]; return a; }, { bank: 'ALL', entry: '' });
  if (md) {
    console.log(`| ${head.join(' | ')} |\n|${head.map(() => '---').join('|')}|`);
    for (const r of [...rows, all]) console.log(`| ${line(r).join(' | ')} |`);
  } else {
    console.log(head.map((h, i) => (i ? h.padStart(12) : h.padEnd(14))).join(''));
    for (const r of [...rows, all]) console.log(line(r).map((v, i) => (i ? String(v).padStart(12) : String(v).padEnd(14))).join(''));
  }
  if (failures.length) {
    console.log(`\n${failures.length} miss(es):`);
    for (const f of failures.slice(0, 30)) console.log(`  [${f.bank}] ${f.field}: expected ${f.expected}, got ${f.got}\n      ${f.raw.replace(/\n/g, ' | ').slice(0, 140)}`);
  }
  process.exit(failures.some((f) => f.field !== 'date') ? 1 : 0);
}

module.exports = { coverage };
