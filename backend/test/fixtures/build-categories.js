'use strict';
// Builds categories.json from the labelled groups below. The labels are written by
// hand (what a person would say the row is), NOT produced by running the categoriser,
// so the accuracy test measures the code against an independent answer.
// Names, account numbers and amounts are redacted or invented. Run: node build-categories.js
const fs = require('fs');
const path = require('path');

const G = (category, type, rows) => rows.map((n) => ({ narration: n, type, expected: category }));
const ROWS = [
  ...G('Groceries', 'expense', [
    'POS PURCHASE SHOPRITE IKEJA CITY MALL', 'POS PUR SPAR LEKKI PHASE 1 LANG', 'WEB PUR JUSTRITE ABUJA', 'PURCHASE/POS EBEANO SUPERMARKET LAGOS',
    'POS PUR HUBMART STORES GWARINPA', 'Debit Alert: Addide Supermarket Lagos', 'VPOS SHOPRITE SURULERE', 'POS/Mile 12 MARKET FRESH PRODUCE',
    'Payment to Grocery store Yaba', 'POS PUR PRINCE EBEANO LEKKI', 'GAME STORE ACHIVERS MALL POS', 'FOODCO SUPERMARKET LAGOS ISLAND',
    'POS PUR MARKET SQUARE VI', 'Supermarket purchase Port Harcourt', 'POS WITHDRAWAL SHOPRITE ABUJA',
  ]),
  ...G('Food', 'expense', [
    'CHOWDECK ORDER LAGOS', 'Transfer to CHOWDECK/KOON PLO', 'GLOVO FOOD DELIVERY', 'POS PUR KFC IKEJA', 'POS CHICKEN REPUBLIC SURULERE', 'DOMINOS PIZZA LEKKI', 'Payment to Mr Biggs Yaba',
    'POS PUR THE PLACE VI', 'COLDSTONE CREAMERY LEKKI', 'Jumia Food order', 'WEB PUR BOLT FOOD', 'Sweet Sensation Ikeja', 'Tantalizers Surulere', 'POS PUR KILIMANJARO RESTAURANT',
    'Bukka lunch payment', 'Buka payment Mushin', 'Payment to restaurant Ikoyi', 'Suya spot Lekki', 'Shawarma Ibadan POS', 'POS PUR JOLLOF HUB', 'Local kitchen payment', 'Cafe Neo POS PURCHASE', 'Eatery payment Abuja',
    'Burger King Lekki POS', 'POS PUR FOOD COURT MALL',
  ]),
  ...G('Transport', 'expense', [
    'UBER TRIP LEKKI', 'Uber *TRIP Lagos', 'BOLT RIDE LAGOS', 'Bolt Ride Abuja', 'INDRIVE RIDE', 'LAGRIDE RIDE VI', 'Danfo fare', 'KEKE payment Ikorodu', 'Okada ride Surulere',
    'Air Peace flight booking', 'ARIK AIR TICKET', 'IBOM AIR booking', 'DANA AIR TICKET', 'Green Africa flight', 'BRT card top up', 'Cowry card reload', 'Transport to Ibadan', 'Toll payment Lekki', 'Flight to Abuja',
    'Train ticket Lagos Ibadan', 'Trip to Abuja bus', 'Taxify ride', 'WEB PUR UBER TRIP', 'Rida Lagos ride', 'Airway ticket purchase',
  ]),
  ...G('Fuel', 'expense', [
    'NNPC FILLING STATION PMS', 'POS PUR CONOIL LEKKI', 'ARDOVA PETROL STATION', 'TOTAL ENERGIES FILLING STATION', 'TotalEnergies Ikeja', 'MOBIL STATION LEKKI POS', 'Oando filling station Abuja', 'Matrix Energy fuel',
    'RAINOIL PETROL', 'Petrol purchase Ikorodu', 'Diesel for generator', 'Fuel for car', 'Forte Oil station', 'POS PUR FILLING STATION OSHODI', 'NNPC retail Abuja',
  ]),
  ...G('Airtime & Data', 'expense', [
    'MTN VTU RECHARGE', 'Airtime purchase MTN', 'AIRTEL AIRTIME TOP UP', 'GLO AIRTIME COLLECTION', 'VIA AIRTIME VIA GTWORLD AIRTIME TO GLO AIRTIME COLLECTION', '9MOBILE RECHARGE', 'Data bundle MTN 5GB', 'Data plan Airtel monthly',
    'Mobile data purchase', 'Spectranet internet subscription renewal', 'Smile 4G data', 'Swift Network data', 'Starlink internet payment', 'IPNX broadband', 'Airtime to self', 'Airtime VTU PalmPay', 'Recharge card purchase',
    'Airtime top up Opay', 'Mobile recharge top up', 'Tizeti WiFi payment',
  ]),
  ...G('Utilities', 'expense', [
    'IKEDC PREPAID ELECTRICITY', 'IBEDC prepaid token', 'EKEDC electricity payment', 'AEDC Abuja electricity', 'Eko electricity bill payment', 'PHED prepaid meter', 'Kaduna Electric payment', 'Electricity token purchase',
    'NEPA bill', 'Prepaid meter recharge', 'LAWMA waste payment', 'Waste collection Lagos', 'Water bill Lagos', 'Water corporation payment', 'EEDC electricity', 'BEDC prepaid', 'Utility bill payment', 'Capricorn digital power', 'JED prepaid token',
  ]),
  ...G('Subscriptions', 'expense', [
    'NETFLIX.COM LAGOS NG', 'POS PUR NETFLIX.COM', 'SPOTIFY P1234 STOCKHOLM', 'WEB PUR APPLE.COM/BILL', 'Web Pur @ -APPLE.COM/BILL 866-712-7753 CAUS', 'Web Pur @ -ITUNES.COM', 'GOOGLE *YouTube Premium', 'GOOGLE ONE storage', 'Google Play subscription',
    'DSTV renewal', 'DSTV SUBSCRIPTION RENEWAL', 'GOTV payment', 'GOTV Jolli', 'Startimes subscription', 'Showmax monthly', 'Amazon Prime Video', 'CANVA subscription', 'OPENAI CHATGPT PLUS', 'ADOBE creative cloud', 'iCloud storage',
    'Microsoft 365 subscription', 'Apple Music', 'Grammarly premium', 'Notion plan',
  ]),
  ...G('Housing', 'expense', [
    'House rent for November', 'Rent payment Lekki', 'Rent for the flat', 'Landlord payment', 'Payment to landlord Surulere', 'Annual rent', 'Service charge estate', 'Estate service charge', 'Lease payment apartment',
    'Property agent fee', 'Accommodation payment Abuja', 'Rent Ikeja', 'Shop rent', 'Rent for December', 'Landlord rent top up',
  ]),
  ...G('Healthcare', 'expense', [
    'MEDPLUS PHARMACY IKEJA', 'POS PUR HEALTHPLUS LEKKI', 'Pharmacy payment', 'Hospital bill Reddington', 'Lagoon Hospital payment', 'Clinic consultation', 'Dental clinic Lekki', 'HMO premium payment', 'Chemist purchase',
    'Synlab lab test', 'Clinix healthcare', 'Medical bills', 'Drugs purchase', 'Health check payment', 'POS PUR GRACE PHARMACY',
  ]),
  ...G('Education', 'expense', [
    'School fees payment', 'Tuition fee Covenant University', 'WAEC registration', 'JAMB UTME registration', 'NECO payment', 'Coursera subscription', 'UDEMY course', 'AltSchool payment', 'University portal fee',
    'Polytechnic school fees', 'College fees Abuja', 'Exam registration fee', 'Lecture notes handout', 'Textbook purchase', 'Andela learning',
  ]),
  ...G('Insurance', 'expense', [
    'Leadway Assurance premium', 'AIICO insurance premium', 'AXA Mansard policy', 'Cornerstone insurance renewal', 'Custodian insurance', 'Allianz premium', 'Car insurance renewal', 'Insurance premium payment', 'NSIA insurance',
    'Mutual Benefits policy', 'Assurance premium debit',
  ]),
  ...G('Shopping', 'expense', [
    'JUMIA ORDER', 'Jumia Nigeria purchase', 'KONGA ONLINE', 'AMAZON.COM order', 'ALIEXPRESS purchase', 'TEMU order', 'SHEIN order', 'SLOT SYSTEMS Ikeja', 'POS PUR SLOT LEKKI', 'Pointek electronics',
    'Fashion boutique Lekki', 'Clothing store payment', 'Shopping mall Ikeja', 'Boutique payment', 'Jiji purchase', 'Fashion Nova order',
  ]),
  ...G('Entertainment', 'expense', [
    'Filmhouse cinema ticket', 'SILVERBIRD CINEMA', 'Genesis cinema', 'Concert ticket', 'Event ticket purchase', 'Movie night', 'Gaming top up', 'Lounge payment VI', 'Ebonylife Cinemas', 'Cinema Lekki',
  ]),
  ...G('Betting', 'expense', [
    'BET9JA deposit', 'NAIRABET funding', 'SPORTYBET deposit', 'Sporty Bet wallet', '1XBET payment', 'BETKING deposit', 'MERRYBET', 'Betway deposit', 'MSport funding', 'BetNaija deposit',
  ]),
  ...G('Savings', 'expense', [
    'PiggyVest savings', 'COWRYWISE investment', 'RISEVEST purchase', 'Target savings top up', 'Ajo contribution', 'Esusu contribution', 'Thrift contribution', 'Vault deposit', 'Bamboo investment', 'Trove stock purchase',
  ]),
  ...G('Bank Charges', 'expense', [
    'Commission on NIP Transfer', 'VAT', 'E-LEVY ON TRANSFER', 'ACCOUNT MAINTENANCE FEE', 'STAMP DUTY', 'Stamp duty charge', 'SMS ALERT CHARGE', 'Card maintenance fee', 'COT charge', 'NIP FEE', 'Transfer fee', 'EMTL charge',
    'Electronic Money Transfer Levy', 'AMF charge', 'ATM charge', 'Bank fee', 'Commission on turnover', 'Card fee', 'SMS charge', 'Maintenance fee',
  ]),
  ...G('Sent to people', 'expense', [
    'TRANSFER TO ADA OBI', 'NIP TRANSFER TO CHIDERA OKAFOR', 'Transfer to Emeka Nwosu 0123456789', 'MOBILE TRF TO FUNKE ADEBAYO', 'Sent to Ngozi Eze', 'OUTWARD TRANSFER TO OPAY - TUNDE BELLO', 'Transfer to Ibrahim Musa GTBank',
    'NIP/TO KEMI ADEYEMI/PALMPAY', 'Transfer to Blessing Okoro Moniepoint', 'Transfer to Segun Ojo', 'TRANSFER TO CHINWE UDEH', 'Trf to Farida Bello', 'FT TO YUSUF ABDULLAHI', 'Transfer to Amaka Obi Kuda',
  ]),
  ...G('Other', 'expense', [
    'POS PUR UNKNOWN SHOP LAGOS', 'POS/WEB PURCHASE LAGOS NG', 'VPOS 1234 SOME SHOP', 'SOME RANDOM NARRATION XYZ', 'ATM WITHDRAWAL GTB LAGOS', 'Cash withdrawal Ikeja', 'Payment on current account', 'Private tutoring session',
    'Salvation Army donation', 'Scott and Sons hardware', 'Training workshop materials', 'WEB PUR UNKNOWNSHOP.COM', 'POS PUR T ABUBAKAR ISA DvJMSD 2214TMTR LANG 803456', 'Payment for services', 'Mobile phone repair', 'PURCHASE/POS 0912',
  ]),
  ...G('Salary', 'income', ['SALARY PAYMENT SEPTEMBER', 'Salary for November', 'SALARY OCT 2026 ACME LTD', 'Payroll credit', 'Monthly pay credit', 'Wages for the week', 'NIP/SALARY/ACME TECHNOLOGIES', 'Stipend payment', 'Salary advance repayment received', 'Staff salary credit']),
  ...G('Allowance', 'income', ['NYSC ALLOWANCE OCTOBER', 'NYSC allawee payment', 'Allowance for November', 'Monthly allowance from parents', 'Allawee credit', 'NYSC payment September', 'Corper allowance', 'Allowance October']),
  ...G('Freelance', 'income', ['Freelance payment design', 'Consulting fee received', 'UPWORK withdrawal', 'FIVERR payout', 'Contract pay milestone', 'DATA SUBSCRIPTION FROM WYZE CONSULTING SERVICES LTD', 'Consulting retainer']),
  ...G('Business', 'income', ['Sales proceeds', 'Invoice 0042 payment', 'Business income', 'Customer payment for order', 'Sales for the day', 'Invoice payment received']),
  ...G('OWealth Interest', 'income', ['OWealth interest earned', 'OWealth Interest Earned', 'OWealth interest credit']),
  ...G('Investment', 'income', ['Dividend payment', 'Interest earned', 'You earned interest today', 'Investment return payout', 'Maturity of fixed deposit', 'ROI payout']),
  ...G('Gift', 'income', ['MOBILE TRF GIFT FROM UCHE', 'Gift from dad', 'Birthday present', 'Gift money received', 'Present from aunt']),
  ...G('Refund', 'income', ['Refund for order', 'Reversal of failed transfer', 'Returned payment', 'Chargeback credit', 'Refund from Jumia', 'Reversal credit']),
  ...G('Money from People', 'income', ['TRANSFER FROM ADA OBI', 'NIP TRANSFER FROM CHIDERA OKAFOR', 'Transfer from Emeka Nwosu', 'Received from Funke Adebayo', 'MOBILE TRF FROM TUNDE BELLO', 'Transfer from Ibrahim Musa', 'NIP/FROM KEMI ADEYEMI/PALMPAY', 'Transfer from Blessing Okoro']),
  ...G('Other Income', 'income', ['UNKNOWN CREDIT SOURCE', 'Credit alert', 'Inward payment', 'Deposit 0912']),
];

// drop exact duplicates (case-insensitive) so every row is distinct
const seen = new Set();
const out = ROWS.filter((r) => { const k = `${r.type}|${r.narration.toLowerCase()}`; if (seen.has(k)) return false; seen.add(k); return true; });
fs.writeFileSync(path.join(__dirname, 'categories.json'), JSON.stringify({
  note: 'Round 10, A6. Labelled, redacted narrations (no real names, account numbers or amounts). expected is what a person would say the category is, written by hand, not produced by the categoriser. CI fails below 90% correct (lib/categoryAccuracy.test.js).',
  rows: out,
}, null, 1));
console.log(out.length, 'rows');
