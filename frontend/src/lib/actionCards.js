// The Action Center card queue, web side (round 6, Block 4).
//
// The server sends each question as a TEMPLATE plus a bag of values, never as a
// finished sentence: `What was {amount} at {name}?`. The naira sign and the grouping
// belong to the app's own money formatter, so the substitution happens here, with the
// same rules the server documents in backend/lib/actionCards.js and the phone mirrors
// in finpilot-mobile/src/lib/actionCards.ts.

const MONEY_KEYS = new Set(['amount', 'sum', 'a', 'b']);

/**
 * Fill a question or an answer label.
 * An unknown token is left visible rather than printed as "undefined": an unfilled
 * slot is a bug worth seeing in a screenshot.
 */
export function fillTemplate(template, vars = {}, money = (n) => `₦${Number(n || 0).toLocaleString('en-NG')}`) {
  return String(template || '').replace(/\{(\w+)\}/g, (whole, key) => {
    const v = vars?.[key];
    if (v == null) return whole;
    return MONEY_KEYS.has(key) ? money(Number(v)) : String(v);
  });
}

/** The checkbox line: "Do the same for future Shoprite payments". */
export const ruleLabel = (card) => (card?.rule ? fillTemplate(card.rule.label, card.vars) : '');

/** "1 of 4" in the header. 1-based, and never past the end. */
export const positionLabel = (index, total) => `${Math.min(index + 1, Math.max(total, 1))} of ${total}`;

/** Two letters for the circle when there is no logo, skipping bank narration noise. */
const INITIAL_STOP = new Set(['trf', 'transfer', 'to', 'from', 'pos', 'web', 'pur', 'the']);
export function initials(name) {
  const words = String(name || '').replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter((w) => w && !INITIAL_STOP.has(w.toLowerCase()));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
