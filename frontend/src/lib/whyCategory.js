// "Why this category?" on transaction detail (round 10, A5). One line per source the
// categoriser records in `categorySource`; a guess (keyword, person, default, ai) says
// so and asks the person to check it. Mirrors finpilot-mobile/src/lib/whyCategory.ts.
const SOURCES = ['rule', 'contact', 'learned', 'consensus', 'catalogue', 'keyword', 'person', 'default', 'ai'];

export function whyCategory(t, name) {
  const s = (t && t.categorySource) || '';
  if (!SOURCES.includes(s)) return null; // rows from before this existed say nothing rather than guess
  const category = t.category || 'Other';
  const who = String(name || 'This').trim();
  switch (s) {
    case 'rule': return { line: 'Your rule', check: false };
    case 'contact': return { line: `${who} is ${category === 'Family & Friends' ? 'Family' : category}`, check: false };
    case 'learned': return { line: 'You picked this twice', check: false };
    case 'consensus':
    case 'catalogue': return { line: `${who} is always ${category}`, check: false };
    default: return { line: 'Our guess', check: true };
  }
}
