// Keeps the chat assistant honest. Free models sometimes print a tool call as text
// ("[create_budget(category=Food, amount=0)]") and then claim they did something,
// like "I deleted your Food budget", when nothing happened. The assistant can only
// CREATE things, so:
//   - text that looks like a tool call is removed from the reply;
//   - a reply that claims an action no tool actually completed is replaced with the
//     truth and where in the app to do it.
'use strict';

const FAKE_CALL = /\[?\s*`?\b[a-z]+_[a-z_]+\s*\([^)]*\)`?\s*\]?/gi;
const CLAIM = /\bI(?:'ve|’ve| have)?\s+(?:just\s+|now\s+|successfully\s+)?(deleted|removed|cancel(?:l)?ed|updated|changed|edited|renamed|created|set up|added|logged|saved|made|recorded)\b/i;
const CHANGE = /\b(delete|remove|cancel|clear|erase|edit|change|update|rename|undo|reduce|increase)\b/i;

const SCREENS = [
  [/\bbudgets?\b/i, 'budget', 'Budgets'],
  [/\bgoals?\b/i, 'goal', 'Goals'],
  [/\bsubscriptions?\b/i, 'subscription', 'Subscriptions'],
  [/\bbills?\b/i, 'bill', 'Bills'],
  [/\btransactions?\b|\bentry\b|\bpayment\b/i, 'transaction', 'Transactions'],
];

const stripFakeCalls = (s) => String(s || '').replace(FAKE_CALL, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();

function whereToChange(message) {
  for (const [re, what, screen] of SCREENS) if (re.test(message)) return { what, screen };
  return null;
}

// The reply to show. `actions` are the tool results ({ ok }) from this turn.
function guardReply(reply, message, actions = []) {
  const done = actions.some((a) => a && a.ok);
  let text = stripFakeCalls(reply);
  const asksChange = CHANGE.test(message || '');
  if (!done && (CLAIM.test(text) || (asksChange && /\b(deleted|removed|updated|changed)\b/i.test(text)))) {
    const w = whereToChange(message || '');
    text = asksChange
      ? `I can't delete or change things for you yet, only set new things up. ${w ? `To change your ${w.what}, open ${w.screen} and edit it there.` : 'You can edit or delete anything from its own screen.'}`
      : "I wasn't able to do that just now, so nothing was changed. Try again, or set it up from its own screen.";
  }
  return text || "Sorry, I couldn't generate a response. Please try rephrasing.";
}

module.exports = { guardReply, stripFakeCalls };
