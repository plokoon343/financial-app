/*
 * Correction-log → golden-corpus exporter (spec A2: "every correction logged in the
 * preview gate is a labelled example — that's exactly what a corpus entry is").
 *
 * Reads ParseCorrection rows (real SMS/email alerts the user reviewed, with the
 * fields they finalised) and appends them as new cases to the mobile corpus at
 * finpilot-mobile/corpus/sms/<bank>.jsonl. Deduplicates against what's already there
 * by exact raw text, so it's safe to re-run — it only ever adds genuinely new cases.
 * After running, `npm run parser:accuracy` in the mobile repo validates the parser
 * against the grown corpus, and you commit the corpus changes.
 *
 *   node backend/scripts/export-corpus.mjs                 # append to ../finpilot-mobile/corpus/sms
 *   node backend/scripts/export-corpus.mjs --dir <path>    # write elsewhere
 *   node backend/scripts/export-corpus.mjs --dry           # preview counts, write nothing
 *   node backend/scripts/export-corpus.mjs --only-corrected # skip rows the parser already got right
 *
 * Requires MONGODB_URI in the environment (same as the server). The corpus contains
 * real alert text, so it must stay in the private repo (it already is).
 */
import mongoose from 'mongoose';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, def) => { const i = args.indexOf(name); return i !== -1 && args[i + 1] ? args[i + 1] : def; };

const DRY = flag('--dry');
const ONLY_CORRECTED = flag('--only-corrected');
const OUT_DIR = opt('--dir', join(HERE, '..', '..', '..', 'finpilot-mobile', 'corpus', 'sms'));
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app';

// Minimal read-only view of the collection (avoids importing the whole server).
const ParseCorrection = mongoose.model('ParseCorrection', new mongoose.Schema({}, { strict: false }), 'parsecorrections');

const slug = (s) => (s || '').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
const iso = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch { return null; } };

// One ParseCorrection → one corpus case (or null if it isn't usable).
function toCase(row) {
  const raw = (row.rawText || '').toString().trim();
  if (!raw) return null;                                   // need the source text
  if (!(row.source === 'sms' || row.source === 'email')) return null; // SMS corpus only
  if (row.userAction === 'rejected') return null;          // not a real transaction
  if (ONLY_CORRECTED && !row.wasCorrected) return null;
  const amount = Math.abs(Number(row.finalAmount));
  const direction = row.finalDirection;
  const date = iso(row.finalDate);
  if (!amount || !(direction === 'debit' || direction === 'credit') || !date) return null;
  const expected = { amount, direction, date };
  if (row.finalCounterparty) expected.counterparty = String(row.finalCounterparty);
  if (row.finalCategory && row.finalCategory !== 'Other' && row.finalCategory !== 'Other Income') expected.category = String(row.finalCategory);
  if (row.bankCode) expected.bank = String(row.bankCode);
  return { bank: slug(row.bankCode), line: JSON.stringify({ raw, expected }) };
}

async function main() {
  await mongoose.connect(URI);
  const rows = await ParseCorrection.find({ source: { $in: ['sms', 'email'] } }).lean();
  console.log(`Loaded ${rows.length} SMS/email correction row(s) from Mongo.`);

  // Group new candidate lines by bank.
  const byBank = new Map();
  for (const row of rows) {
    const c = toCase(row);
    if (!c) continue;
    if (!byBank.has(c.bank)) byBank.set(c.bank, []);
    byBank.get(c.bank).push(c.line);
  }

  if (!DRY && !existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let totalNew = 0, totalDup = 0;
  const known = new Set(existsSync(OUT_DIR) ? readdirSync(OUT_DIR).filter((f) => f.endsWith('.jsonl')) : []);

  for (const [bank, lines] of byBank) {
    const file = join(OUT_DIR, `${bank}.jsonl`);
    // Existing cases keyed by their exact raw text, so we never duplicate a case.
    const existing = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const seen = new Set();
    for (const l of existing) { try { seen.add(JSON.parse(l).raw); } catch { /* skip */ } }

    const fresh = [];
    for (const line of lines) {
      const raw = JSON.parse(line).raw;
      if (seen.has(raw)) { totalDup++; continue; }
      seen.add(raw); fresh.push(line); totalNew++;
    }
    const note = known.has(`${bank}.jsonl`) ? '' : ' (new file)';
    console.log(`  ${bank.padEnd(14)} +${fresh.length} new, ${lines.length - fresh.length} already present${note}`);
    if (fresh.length && !DRY) {
      const out = existing.concat(fresh).join('\n') + '\n';
      writeFileSync(file, out, 'utf8');
    }
  }

  console.log(`\n${DRY ? '[dry run] ' : ''}${totalNew} new case(s), ${totalDup} duplicate(s) skipped.`);
  if (totalNew && !DRY) console.log(`Wrote to ${OUT_DIR}\nNext: cd finpilot-mobile && npm run parser:accuracy, then commit the corpus.`);
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
