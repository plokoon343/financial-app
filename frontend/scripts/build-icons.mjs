/*
 * Font Awesome, only the icons the app uses (Round 3, 5).
 *
 * The web app used to load the whole Font Awesome set from a CDN: about 100 KB of CSS
 * plus three icon fonts (the solid one alone is ~150 KB). This script scans src/ for
 * every `fa-*` icon name, subsets the solid, regular and brands fonts down to those
 * glyphs and writes src/assets/icons/fa-icons.css with the base Font Awesome rules and
 * one rule per icon. Markup stays the same (<i className="fas fa-chart-pie" />).
 *
 *   npm run icons          # rebuild after adding an icon
 *   npm run icons:check    # fail if any icon in src/ isn't in the subset (runs before build)
 *
 * Needs Python with fontTools and brotli (pip install fonttools brotli) for `icons`;
 * `icons:check` needs neither.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(SRC, 'assets', 'icons');
const FA = join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free');
const CHECK = process.argv.includes('--check');

// Icons built from parts at runtime (`fa-${up ? 'arrow-up' : 'arrow-down'}`).
const DYNAMIC = ['arrow-up', 'arrow-down', 'chevron-up', 'chevron-down'];
// Matches that aren't icons: the stylesheet's own file name and the `fa-chevron-${...}` stem.
const NOT_ICONS = new Set(['icons', 'chevron']);
// Utility classes, not icons.
const UTIL = /^(fw|xs|sm|lg|xl|2xs|2xl|[1-9]x|10x|spin|spin-pulse|spin-reverse|pulse|beat|beat-fade|bounce|fade|flip|flip-horizontal|flip-vertical|flip-both|shake|rotate-90|rotate-180|rotate-270|rotate-by|stack|stack-1x|stack-2x|inverse|border|pull-left|pull-right|li|ul|solid|regular|brands|classic|sharp|layers|sr-only|sr-only-focusable|swap-opacity)$/;

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return f === 'assets' ? [] : walk(p);
  return /\.(jsx?|tsx?|html)$/.test(f) ? [p] : [];
});

function usedIcons() {
  const names = new Set(DYNAMIC);
  for (const file of [...walk(SRC), join(ROOT, 'index.html')]) {
    for (const m of readFileSync(file, 'utf8').matchAll(/\bfa-([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) {
      if (!UTIL.test(m[1]) && !NOT_ICONS.has(m[1])) names.add(m[1]);
    }
  }
  return names;
}

const css = readFileSync(join(FA, 'css', 'fontawesome.css'), 'utf8');
const brandsCss = readFileSync(join(FA, 'css', 'brands.css'), 'utf8'); // brand icon rules live here
const ICON_RULE = /\.fa-([a-z0-9-]+)::?before\s*\{\s*content:\s*"\\([0-9a-f]+)";\s*\}\s*/g;
const glyphs = new Map([...css.matchAll(ICON_RULE), ...brandsCss.matchAll(ICON_RULE)].map((m) => [m[1], m[2]]));

const used = usedIcons();
const missing = [...used].filter((n) => !glyphs.has(n)).sort();
const known = [...used].filter((n) => glyphs.has(n)).sort();

if (CHECK) {
  const built = existsSync(join(OUT, 'fa-icons.css')) ? readFileSync(join(OUT, 'fa-icons.css'), 'utf8') : '';
  const notBuilt = known.filter((n) => !built.includes(`.fa-${n}::before`));
  if (missing.length) console.log(`Not Font Awesome 6 icons (typo or removed): ${missing.join(', ')}`);
  if (notBuilt.length) { console.error(`Icons used but not in the subset, run \`npm run icons\`: ${notBuilt.join(', ')}`); process.exit(1); }
  console.log(`icons ok: ${known.length} icons in the subset`);
  process.exit(0);
}

// Subset each font to the codepoints it actually has.
mkdirSync(OUT, { recursive: true });
const py = process.env.PYTHON || 'python';
const fonts = [['fa-solid-900', 'solid'], ['fa-regular-400', 'regular'], ['fa-brands-400', 'brands']];
const sizes = {};
for (const [font] of fonts) {
  const codes = known.map((n) => glyphs.get(n));
  const unicodes = codes.map((c) => `U+${c}`).join(',');
  const out = join(OUT, `${font}.woff2`);
  execFileSync(py, ['-m', 'fontTools.subset', join(FA, 'webfonts', `${font}.ttf`), `--unicodes=${unicodes}`, '--flavor=woff2', `--output-file=${out}`, '--no-hinting', '--desubroutinize', '--ignore-missing-unicodes'], { stdio: 'pipe' });
  sizes[font] = statSync(out).size;
}

// Base rules (everything in fontawesome.css except the per-icon rules) + font faces.
const base = css.replace(ICON_RULE, '');
const face = (file) => readFileSync(join(FA, 'css', file), 'utf8')
  .replace(/\/\*![\s\S]*?\*\//, '')
  .replace(ICON_RULE, '')
  .replace(/src:[^;]+;/g, (m) => {
    const font = (m.match(/fa-[a-z]+-\d+/) || [])[0];
    return `src: url("./${font}.woff2") format("woff2");`;
  })
  .replace(/font-display:\s*block;/g, 'font-display: swap;');
const header = `/*! Font Awesome Free 6.4.0 by @fontawesome - https://fontawesome.com
 * License - https://fontawesome.com/license/free (Icons: CC BY 4.0, Fonts: SIL OFL 1.1, Code: MIT License)
 * Copyright 2023 Fonticons, Inc.
 * Subset to the ${known.length} icons this app uses by scripts/build-icons.mjs. Do not edit by hand. */\n`;
const rules = known.map((n) => `.fa-${n}::before { content: "\\${glyphs.get(n)}"; }`).join('\n');
writeFileSync(join(OUT, 'fa-icons.css'), `${header}${base.replace(/\/\*![\s\S]*?\*\//, '')}\n${face('solid.css')}\n${face('regular.css')}\n${face('brands.css')}\n${rules}\n`);
console.log(`${known.length} icons; fonts: ${Object.entries(sizes).map(([f, s]) => `${f} ${(s / 1024).toFixed(1)} KB`).join(', ')}`);
if (missing.length) console.log(`Ignored (not Font Awesome 6 icons): ${missing.join(', ')}`);
