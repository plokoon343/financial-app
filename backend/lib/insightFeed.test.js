'use strict';
// Run: node backend/lib/insightFeed.test.js
const { buildFeed, moneyLine, weeklyLine, forecastLine, contextLine } = require('./insightFeed');

let pass = 0, fail = 0;
const check = (label, cond) => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label}`); } };

const NOW = new Date('2026-10-25T17:00:00Z'); // Sunday
let id = 0;
const e = (day, amount, category, description = '', type = 'expense') =>
  ({ _id: String(++id).padStart(4, '0'), date: new Date(`${day}T10:00:00Z`), amount: type === 'expense' ? -amount : amount, type, category, description });

// Too little data: nothing is said
check('empty -> no insights', buildFeed([], NOW).length === 0);
check('7 expenses -> no insights', buildFeed(Array.from({ length: 7 }, (_, i) => e(`2026-10-0${i + 1}`, 1000, 'Food')), NOW).length === 0);

// A month with enough rows
const month = [
  e('2026-10-02', 3000, 'Food', 'Chicken Republic'), e('2026-10-05', 3000, 'Food', 'Chicken Republic'),
  e('2026-10-09', 3000, 'Food', 'Chicken Republic'), e('2026-10-12', 3000, 'Food', 'Chicken Republic'),
  e('2026-10-14', 2000, 'Transport'), e('2026-10-15', 2000, 'Transport'),
  e('2026-10-20', 4000, 'Food'), e('2026-10-21', 1000, 'Transport'),
  e('2026-10-22', 1000, 'Transport'), e('2026-10-23', 1000, 'Transport'),
  e('2026-10-24', 9000, 'Transfer', 'Transfer to Ada'), // never talked about
];
const feed = buildFeed(month, NOW);
check('feed has at most 4', feed.length > 0 && feed.length <= 4);
check('top category is Food with a percent', /^Food is \d+% of what you spent this month\.$/.test(feed[0].text));
check('Transfer never appears', !feed.some((i) => /transfer/i.test(i.text)));
check('repeat merchant line', feed.some((i) => /4 visits to Chicken Republic/.test(i.text)));
check('no naira amounts', !feed.some((i) => /₦|\bNGN\b/.test(i.text)));

// Week on week
const wk = [
  e('2026-10-12', 1000, 'Transport'), e('2026-10-13', 1000, 'Transport'), e('2026-10-14', 1000, 'Food'),
  e('2026-10-20', 1000, 'Transport'), e('2026-10-21', 1000, 'Food'), e('2026-10-23', 3000, 'Food'),
];
const line = weeklyLine(wk, NOW);
check('weekly line shape', /^Your week in money: Food took 80%, transport is down 50%\.$/.test(line || ''));
check('weekly line hidden with a thin prior week', weeklyLine(wk.slice(2), NOW) === null);

// Context
const t4 = month[3];
check('context 4th visit', contextLine(t4, month) === 'Your 4th Chicken Republic this month.');
check('context none for first visit', contextLine(month[0], month) === null);
check('context none for transfers', contextLine(month[10], month) === null);
check('ordinals', contextLine({ ...t4 }, month).includes('4th'));

// Money line and forecast
check('money line exists for a full month', !!moneyLine(month, NOW));
const prev = Array.from({ length: 8 }, (_, i) => e(`2026-09-${String(i + 1).padStart(2, '0')}`, 1000, 'Food'));
check('forecast needs a previous month', forecastLine(month, NOW) === null);
check('forecast sentence', /^At this pace you will spend about \d+% (more|less) than last month\.$/.test(forecastLine([...prev, ...month], NOW) || ''));

console.log(`insightFeed: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
