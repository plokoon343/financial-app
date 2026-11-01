'use strict';
// Run: node backend/lib/helpContent.test.js
const helpContent = require('./helpContent');
let pass = 0, fail = 0;
const check = (label, cond, extra = '') => { if (cond) pass++; else { fail++; console.log(`FAIL  ${label} ${extra}`); } };

(async () => {
  const articles = await helpContent.getArticles();
  check('loads articles from the local JSON (no Sanity keys set in tests)', articles.length > 0);
  check('every article has a known category', articles.every((a) => helpContent.CATEGORY_IDS.has(a.category)));
  check('every category id in CATEGORIES is unique', new Set(helpContent.CATEGORIES.map((c) => c.id)).size === helpContent.CATEGORIES.length);

  const bySlug = await helpContent.getArticleBySlug('budgets');
  check('getArticleBySlug finds a known article', !!bySlug && bySlug.title.toLowerCase().includes('budget'));
  check('getArticleBySlug returns null for an unknown slug', await helpContent.getArticleBySlug('nope-not-real') === null);

  check('a how-to question is recognised', helpContent.isHowToQuestion('How do I forward my bank alerts?'));
  check('a plain statement is not treated as how-to', !helpContent.isHowToQuestion('My balance looks wrong today.'));

  const gmailMatch = await helpContent.bestMatch('how do I forward alerts from gmail');
  check('best match for a Gmail forwarding question is the Gmail article', gmailMatch && gmailMatch.slug === 'email-gmail', gmailMatch && gmailMatch.slug);

  const budgetMatch = await helpContent.bestMatch('how do budgets work');
  check('best match for a budgets question is the budgets article', budgetMatch && budgetMatch.slug === 'budgets', budgetMatch && budgetMatch.slug);

  check('a nonsense query has no confident match', await helpContent.bestMatch('zzqxw nonword gibberish') === null);

  const results = await helpContent.searchArticles('money no dey enter');
  check('Nigerian-phrasing search returns at least one result', results.length > 0);
  const noResults = await helpContent.searchArticles('zzqxw nonword gibberish');
  check('a nonsense search returns no results (triggers help_search_no_result)', noResults.length === 0);

  const condensed = helpContent.condensed(bySlug, 2);
  check('condensed() keeps it to a summary plus a few steps', condensed.split('\n').length <= 3, condensed);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
