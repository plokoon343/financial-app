// Merchant / category / P2P avatars (spec Addendum C) — web mirror of the mobile
// txnDisplay avatar system. A recognisable leading visual for a transaction row
// WITHOUT fetching any third-party favicon at runtime (the addendum's hard rule):
// a bundled merchant registry (brand colour + a FontAwesome glyph we already ship),
// an initial avatar for named people (P2P), else the category's icon.

// keyword -> { name, color, icon(FA class) }. FontAwesome 6 (solid + brands) is loaded
// globally, so brand marks are used where they exist. Most specific brands first.
const MERCHANTS = [
  { name: 'MTN', keywords: ['mtn'], color: '#f5b301', icon: 'fas fa-signal' },
  { name: 'Airtel', keywords: ['airtel'], color: '#e40000', icon: 'fas fa-signal' },
  { name: 'Glo', keywords: ['glo', 'globacom'], color: '#00a651', icon: 'fas fa-signal' },
  { name: '9mobile', keywords: ['9mobile', 'etisalat'], color: '#0a7d3e', icon: 'fas fa-signal' },
  { name: 'DStv', keywords: ['dstv', 'multichoice'], color: '#0090d4', icon: 'fas fa-tv' },
  { name: 'GOtv', keywords: ['gotv'], color: '#e11b22', icon: 'fas fa-tv' },
  { name: 'StarTimes', keywords: ['startimes'], color: '#e67e22', icon: 'fas fa-tv' },
  { name: 'Showmax', keywords: ['showmax'], color: '#e50914', icon: 'fas fa-film' },
  { name: 'Netflix', keywords: ['netflix'], color: '#e50914', icon: 'fas fa-film' },
  { name: 'Spotify', keywords: ['spotify'], color: '#1db954', icon: 'fab fa-spotify' },
  { name: 'YouTube', keywords: ['youtube'], color: '#ff0000', icon: 'fab fa-youtube' },
  { name: 'Apple', keywords: ['apple', 'itunes', 'icloud'], color: '#555555', icon: 'fab fa-apple' },
  { name: 'Google', keywords: ['google'], color: '#4285f4', icon: 'fab fa-google' },
  { name: 'Microsoft', keywords: ['microsoft', 'xbox'], color: '#00a4ef', icon: 'fab fa-microsoft' },
  { name: 'Amazon', keywords: ['amazon', 'aws', 'prime video'], color: '#ff9900', icon: 'fab fa-amazon' },
  { name: 'Canva', keywords: ['canva'], color: '#00c4cc', icon: 'fas fa-palette' },
  { name: 'OpenAI', keywords: ['openai', 'chatgpt'], color: '#10a37f', icon: 'fas fa-wand-magic-sparkles' },
  { name: 'Adobe', keywords: ['adobe'], color: '#fa0f00', icon: 'fas fa-paintbrush' },
  { name: 'Uber', keywords: ['uber'], color: '#111111', icon: 'fas fa-car' },
  { name: 'Bolt', keywords: ['bolt'], color: '#34d186', icon: 'fas fa-car' },
  { name: 'inDrive', keywords: ['indrive', 'indriver'], color: '#8bbf1d', icon: 'fas fa-car' },
  { name: 'Chowdeck', keywords: ['chowdeck'], color: '#ff6b00', icon: 'fas fa-bicycle' },
  { name: 'Glovo', keywords: ['glovo'], color: '#e0a400', icon: 'fas fa-bicycle' },
  { name: 'Jumia', keywords: ['jumia'], color: '#f68b1e', icon: 'fas fa-bag-shopping' },
  { name: 'Konga', keywords: ['konga'], color: '#ed017f', icon: 'fas fa-bag-shopping' },
  { name: 'AliExpress', keywords: ['aliexpress', 'alibaba'], color: '#e62e04', icon: 'fas fa-bag-shopping' },
  { name: 'Shoprite', keywords: ['shoprite'], color: '#e4022e', icon: 'fas fa-cart-shopping' },
  { name: 'Spar', keywords: ['spar'], color: '#009639', icon: 'fas fa-cart-shopping' },
  { name: 'KFC', keywords: ['kfc'], color: '#a4132a', icon: 'fas fa-burger' },
  { name: 'Chicken Republic', keywords: ['chicken republic', 'chickenrepublic'], color: '#e4002b', icon: 'fas fa-drumstick-bite' },
  { name: "Domino's", keywords: ['domino', 'dominos'], color: '#006491', icon: 'fas fa-pizza-slice' },
  { name: 'Bet9ja', keywords: ['bet9ja'], color: '#1a8f3c', icon: 'fas fa-futbol' },
  { name: 'SportyBet', keywords: ['sportybet', 'sporty'], color: '#e30613', icon: 'fas fa-futbol' },
  { name: '1xBet', keywords: ['1xbet'], color: '#1a5cb0', icon: 'fas fa-futbol' },
  { name: 'Betking', keywords: ['betking'], color: '#e30613', icon: 'fas fa-futbol' },
  { name: 'OPay', keywords: ['opay'], color: '#1dc95c', icon: 'fas fa-credit-card' },
  { name: 'PalmPay', keywords: ['palmpay'], color: '#5b2be0', icon: 'fas fa-credit-card' },
  { name: 'Moniepoint', keywords: ['moniepoint'], color: '#0357ee', icon: 'fas fa-credit-card' },
  { name: 'Air Peace', keywords: ['air peace', 'airpeace'], color: '#0a3d91', icon: 'fas fa-plane' },
  { name: 'Booking', keywords: ['booking.com', 'booking com'], color: '#003580', icon: 'fas fa-plane' },
  { name: 'Electricity', keywords: ['ikedc', 'ekedc', 'phcn', 'aedc', 'ibedc', 'eko elect', 'ikeja elect', 'disco'], color: '#0ea5e9', icon: 'fas fa-bolt' },
];

const INDEX = MERCHANTS.flatMap((m) => m.keywords.map((kw) => ({ kw: kw.toLowerCase(), m })))
  .sort((a, b) => b.kw.length - a.kw.length);

function merchantLogo(text) {
  const hay = ` ${(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const { kw, m } of INDEX) {
    if (hay.includes(` ${kw} `)) return { name: m.name, color: m.color, icon: m.icon };
  }
  return null;
}

// Category -> colour + FA icon (mirror of the mobile CAT map).
const CAT = {
  Food: { color: '#f59e0b', icon: 'fas fa-utensils' },
  Groceries: { color: '#22c55e', icon: 'fas fa-cart-shopping' },
  Transport: { color: '#3b82f6', icon: 'fas fa-car' },
  Fuel: { color: '#f97316', icon: 'fas fa-gas-pump' },
  Housing: { color: '#a855f7', icon: 'fas fa-house' },
  'Rent & Housing': { color: '#a855f7', icon: 'fas fa-house' },
  Utilities: { color: '#06b6d4', icon: 'fas fa-lightbulb' },
  'Bills & Utilities': { color: '#06b6d4', icon: 'fas fa-lightbulb' },
  'Airtime & Data': { color: '#14b8a6', icon: 'fas fa-mobile-screen' },
  Shopping: { color: '#ec4899', icon: 'fas fa-bag-shopping' },
  Healthcare: { color: '#ef4444', icon: 'fas fa-kit-medical' },
  Entertainment: { color: '#8b5cf6', icon: 'fas fa-gamepad' },
  Subscriptions: { color: '#8b5cf6', icon: 'fas fa-repeat' },
  Education: { color: '#3b82f6', icon: 'fas fa-graduation-cap' },
  Insurance: { color: '#14b8a6', icon: 'fas fa-shield-halved' },
  'Bank Charges': { color: '#64748b', icon: 'fas fa-credit-card' },
  'ATM/POS': { color: '#64748b', icon: 'fas fa-money-bill' },
  Transfer: { color: '#f97316', icon: 'fas fa-right-left' },
  Savings: { color: '#22c55e', icon: 'fas fa-lock' },
  'Family & Friends': { color: '#ec4899', icon: 'fas fa-users' },
  Salary: { color: '#10b981', icon: 'fas fa-briefcase' },
  'Salary & Wages': { color: '#10b981', icon: 'fas fa-briefcase' },
  Business: { color: '#14b8a6', icon: 'fas fa-building' },
  'Loan Repayment': { color: '#f59e0b', icon: 'fas fa-hand-holding-dollar' },
  Freelance: { color: '#3b82f6', icon: 'fas fa-laptop' },
  Investment: { color: '#a855f7', icon: 'fas fa-arrow-trend-up' },
  Gift: { color: '#ec4899', icon: 'fas fa-gift' },
  'Gifts & Donations': { color: '#ec4899', icon: 'fas fa-gift' },
  Refund: { color: '#06b6d4', icon: 'fas fa-rotate-left' },
};
function categoryMeta(category) {
  return (category && CAT[category]) || { color: '#64748b', icon: 'fas fa-tag' };
}

const AVATAR_COLORS = ['#f97316', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
function hueFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

const P2P_CATEGORIES = new Set(['Family & Friends', 'Transfer']);
const looksLikePerson = (name) => /^[A-Za-z][A-Za-z .'-]+$/.test(name) && name.trim().split(/\s+/).length >= 2;

// Priority: bundled merchant logo -> initial avatar for a named person -> category icon.
// Returns { kind:'icon', icon, color } or { kind:'initial', letter, color }.
export function avatarFor(category, description) {
  const name = (description || '').trim();
  const brand = merchantLogo(name);
  if (brand) return { kind: 'icon', icon: brand.icon, color: brand.color };
  if (category && P2P_CATEGORIES.has(category) && looksLikePerson(name)) {
    return { kind: 'initial', letter: name[0].toUpperCase(), color: hueFor(name.toUpperCase()) };
  }
  const m = categoryMeta(category);
  return { kind: 'icon', icon: m.icon, color: m.color };
}
