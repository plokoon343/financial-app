// Keyword transaction categoriser (extracted from server.js so it can be corpus-
// tested against real bank alerts). Pure + dependency-free. Rules are ordered most-
// specific first; a known merchant (e.g. "shoprite") wins over a generic rail term
// (e.g. "pos"). Category names must match constants/categories on web + mobile.

'use strict';

const categorizeTransaction = (description, typeOrAmount) => {
  const lower = (description || '').toLowerCase();
  const isExpense = typeof typeOrAmount === 'string' ? typeOrAmount === 'expense' : typeOrAmount < 0;
  const rules = [
    // ── Income ──
    { for: 'income',  keywords: ['salary', 'wage', 'payroll', 'monthly pay', 'stipend'], category: 'Salary' },
    { for: 'income',  keywords: ['freelance', 'consulting', 'contract pay', 'upwork', 'fiverr'], category: 'Freelance' },
    { for: 'income',  keywords: ['sales', 'invoice', 'business income', 'customer payment'], category: 'Business' },
    { for: 'income',  keywords: ['dividend', 'interest credit', 'investment return', 'maturity', 'roi'], category: 'Investment' },
    { for: 'income',  keywords: ['gift', 'present'], category: 'Gift' },
    { for: 'income',  keywords: ['refund', 'reversal', 'returned', 'chargeback'], category: 'Refund' },

    // ── Expense (specific first) ──
    { for: 'expense', keywords: ['airtime', 'recharge', 'mobile data', 'data bundle', 'data plan', 'mtn', 'airtel', '9mobile', 'globacom', 'spectranet', ' smile', 'swift network'], category: 'Airtime & Data' },
    { for: 'expense', keywords: ['netflix', 'spotify', 'apple music', 'youtube premium', 'showmax', 'prime video', 'dstv', 'gotv', 'startimes', 'icloud', 'google one', 'canva', 'chatgpt', 'openai', 'adobe', 'subscription'], category: 'Subscriptions' },
    { for: 'expense', keywords: ['fuel', 'petrol', 'petroleum', 'filling station', 'nnpc', 'conoil', 'ardova', 'mobil', 'total energies', 'diesel', ' pms'], category: 'Fuel' },
    { for: 'expense', keywords: ['uber', 'bolt', 'taxify', 'lagride', 'rida', 'danfo', 'keke', 'transport', ' brt', 'flight', 'air peace', 'arik', 'ibom air', 'train', 'trip', 'toll'], category: 'Transport' },
    { for: 'expense', keywords: ['shoprite', 'spar', 'supermarket', 'grocery', 'groceries', 'justrite', 'ebeano', 'hubmart', 'addide', 'market'], category: 'Groceries' },
    { for: 'expense', keywords: ['restaurant', 'eatery', 'bukka', 'buka', 'kfc', 'chicken republic', 'dominos', 'pizza', 'coldstone', 'cafe', 'food', 'kitchen', 'jollof', 'the place', 'chowdeck', 'glovo', 'suya'], category: 'Food' },
    { for: 'expense', keywords: ['rent', 'landlord', 'property', 'estate', 'accommodation', 'service charge', 'lease'], category: 'Housing' },
    { for: 'expense', keywords: ['electricity', 'nepa', 'phcn', 'ikedc', 'ibedc', 'ekedc', 'aedc', 'eedc', 'kaduna electric', 'eko electric', 'ibadan electric', 'prepaid', 'water bill', 'lawma', 'waste', 'utility'], category: 'Utilities' },
    { for: 'expense', keywords: ['pharmacy', 'hospital', 'clinic', 'medplus', 'health', 'chemist', 'hmo', 'drugs', 'medical', 'dental'], category: 'Healthcare' },
    { for: 'expense', keywords: ['school fees', 'tuition', 'waec', 'jamb', 'neco', 'coursera', 'udemy', 'university', 'college', 'exam', 'lecture', 'textbook'], category: 'Education' },
    { for: 'expense', keywords: ['insurance', 'assurance', 'leadway', 'aiico', 'axa mansard', 'cornerstone'], category: 'Insurance' },
    { for: 'expense', keywords: ['amazon', 'jumia', 'konga', 'slot', 'purchase', 'boutique', 'fashion', 'clothing', 'shopping', 'mall', 'aliexpress', 'temu', 'shein'], category: 'Shopping' },
    { for: 'expense', keywords: ['cinema', 'bet9ja', 'nairabet', 'sportybet', '1xbet', 'betking', 'merrybet', 'gaming', 'event', 'ticket', 'lounge', 'concert', 'movie'], category: 'Entertainment' },
    { for: 'expense', keywords: ['piggyvest', 'cowrywise', 'risevest', 'target savings', ' ajo', 'esusu', 'thrift', 'vault'], category: 'Savings' },
    // POS / ATM. Nigerian banks abbreviate point-of-sale purchases aggressively —
    // GTBank writes "POS PUR", others "PURCHASE/POS", "WEB PUR", "VPOS" — so match the
    // abbreviations, not just the spelled-out "pos purchase".
    { for: 'expense', keywords: ['atm withdrawal', 'atm cash', 'cash withdrawal', ' atm ', 'atm/', 'pos pur', 'pos/', 'pos debit', 'pos withdrawal', ' pos ', 'point of sale', 'vpos', 'web pur', 'card pur', 'purchase pos'], category: 'ATM/POS' },
    { for: 'expense', keywords: ['stamp dut', 'stamp duty', 'vat', 'bank fee', 'transfer fee', 'nip fee', 'maintenance fee', 'account maintenance', 'amf', 'emtl', 'e-levy', 'electronic money transfer levy', 'sms alert', 'commission', 'cot', 'levy', 'atm charge', 'card fee', 'charge'], category: 'Bank Charges' },

    // ── Catch-all transfer (either direction) ──
    { for: 'both',    keywords: ['transfer', 'nip', 'neft', ' trf', 'send money', 'pos transfer', 'opay', 'palmpay', 'moniepoint', ' kuda', 'paystack'], category: 'Transfer' },
  ];
  for (const rule of rules) {
    if (rule.for !== 'both' && ((rule.for === 'expense') !== isExpense)) continue;
    if (rule.keywords.some((kw) => lower.includes(kw))) return rule.category;
  }
  return isExpense ? 'Other' : 'Other Income';
};

module.exports = { categorizeTransaction };
