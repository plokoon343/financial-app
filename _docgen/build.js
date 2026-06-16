const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, HeadingLevel, BorderStyle, WidthType, ShadingType,
  TableOfContents, PageBreak, Header, Footer, PageNumber,
} = require('docx');

const ACCENT = '4F46E5';
const GREY = '6B7280';

// ── helpers ──
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const P = (t, opts = {}) => new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: t, ...opts })] });
const RUNS = (runs) => new Paragraph({ spacing: { after: 120 }, children: runs });
const bullet = (t, level = 0) => new Paragraph({ numbering: { reference: 'bullets', level }, spacing: { after: 40 }, children: typeof t === 'string' ? [new TextRun(t)] : t });
const num = (t) => new Paragraph({ numbering: { reference: 'nums', level: 0 }, spacing: { after: 40 }, children: typeof t === 'string' ? [new TextRun(t)] : t });
const labeled = (label, rest) => new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 40 }, children: [new TextRun({ text: label + ': ', bold: true }), new TextRun(rest)] });
const spacer = () => new Paragraph({ spacing: { after: 80 }, children: [] });

const border = { style: BorderStyle.SINGLE, size: 1, color: 'D1D5DB' };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
const cellMargins = { top: 60, bottom: 60, left: 110, right: 110 };

function table(headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA }, margins: cellMargins,
      shading: { fill: ACCENT, type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: 'FFFFFF', size: 18 })] })],
    })),
  });
  const bodyRows = rows.map((r, ri) => new TableRow({
    children: r.map((c, i) => new TableCell({
      borders, width: { size: widths[i], type: WidthType.DXA }, margins: cellMargins,
      shading: { fill: ri % 2 ? 'F3F4F6' : 'FFFFFF', type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: c, size: 18 })] })],
    })),
  }));
  return new Table({ width: { size: total, type: WidthType.DXA }, columnWidths: widths, rows: [headerRow, ...bodyRows] });
}

const CW = 9360; // content width (US Letter, 1" margins)

const children = [];

// ── Cover ──
children.push(
  new Paragraph({ spacing: { before: 2400, after: 0 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'FinPilot', bold: true, size: 72, color: ACCENT })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: 'Personal Finance Web Application', size: 32, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 120 }, children: [new TextRun({ text: 'Product & Technical Documentation', size: 26, bold: true })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: 'Features, Functions, Architecture & API', size: 22, color: GREY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Generated ' + new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), size: 20, color: GREY })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// ── TOC ──
children.push(H1('Table of Contents'));
children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
children.push(new Paragraph({ children: [new PageBreak()] }));

// ── 1. Overview ──
children.push(H1('1. Overview'));
children.push(P('FinPilot is a personal finance web application that helps users understand and control their money. Users record income and expenses (manually or by importing bank statements), categorise transactions automatically, set budgets, automate savings, track goals, debts, subscriptions and bills, and view their overall financial health.'));
children.push(P('The product is built as a single-page React application backed by a Node/Express REST API and a MongoDB database. It targets Nigerian users in particular: amounts are in Naira (₦), the statement parser understands common Nigerian bank formats, and bank verification uses Paystack.'));
children.push(H2('1.1 Highlights'));
children.push(labeled('Statement import', 'Upload CSV, Excel or PDF statements — including password-protected PDFs — and have transactions extracted and categorised automatically.'));
children.push(labeled('Smart categorisation', 'A keyword engine plus a "learn-from-correction" system that remembers how you categorise each merchant.'));
children.push(labeled('Budgeting', 'Month-scoped budgets per category with progress tracking and alerts.'));
children.push(labeled('Automation', 'Auto-savings rules, scheduled payments for debts/subscriptions/bills, and recurring-bill processing.'));
children.push(labeled('Guidance', 'A first-run onboarding wizard, a replayable tour, and contextual first-time tips.'));
children.push(labeled('Administration', 'A superadmin dashboard for users, platform stats and support tickets, plus an in-app notification system.'));

// ── 2. Architecture ──
children.push(H1('2. Architecture & Technology'));
children.push(H2('2.1 Stack'));
children.push(labeled('Frontend', 'React 19 (Create React App), React Router v7, Axios, Chart.js / Recharts for charts, Framer Motion for animation. Styling via CSS variables with a light/dark theme.'));
children.push(labeled('Backend', 'Node.js + Express REST API. Authentication with JSON Web Tokens (JWT). Passwords hashed with bcrypt.'));
children.push(labeled('Database', 'MongoDB with Mongoose schemas/models.'));
children.push(labeled('File parsing', 'pdf-parse (with bundled pdf.js) for PDFs, xlsx for Excel, csv-parser for CSV, multer for uploads.'));
children.push(labeled('Email', 'Nodemailer (SMTP) for password-reset and notification emails.'));
children.push(labeled('Third-party', 'Paystack API for the Nigerian bank list and account-name resolution.'));
children.push(labeled('Hardening', 'helmet (security headers), express-rate-limit (throttling), compression (gzip).'));
children.push(labeled('Hosting', 'Frontend on Vercel; backend on Render; database on MongoDB Atlas.'));
children.push(H2('2.2 Request flow'));
children.push(P('The React app calls the Express API over HTTPS with a Bearer JWT in the Authorization header. The API authenticates the token, loads the user, runs the route handler against MongoDB, and returns JSON. Cross-origin requests are restricted to the deployed frontend origin.'));

// ── 3. Auth ──
children.push(H1('3. Authentication & Account Management'));
children.push(H2('3.1 Registration & login'));
children.push(bullet('Users register with name, email and password. Passwords are hashed with bcrypt; emails are unique.'));
children.push(bullet('Login returns a signed JWT that expires after 30 days. The token is stored client-side and sent on every API call.'));
children.push(bullet('Auth endpoints are rate-limited (20 attempts / 15 minutes) to resist brute-force and credential-stuffing.'));
children.push(H2('3.2 Password reset (forgot password)'));
children.push(bullet('"Forgot password?" emails a reset link containing a single-use token (a SHA-256 hash is stored server-side; the raw token is only in the email link).'));
children.push(bullet('The link is valid for 1 hour. The reset page sets a new password and invalidates the token.'));
children.push(bullet('Email sending is non-blocking, so a slow or misconfigured mail server never delays or fails the request; the response is always generic (no account enumeration).'));
children.push(H2('3.3 In-session account actions (Settings)'));
children.push(labeled('Change password', 'Verifies the current password, then updates it.'));
children.push(labeled('Change email', 'Verifies the password, then updates the account email.'));
children.push(labeled('Sign out of all devices', 'Invalidates existing sessions so the user must log in again everywhere.'));
children.push(labeled('Export my data', 'Downloads the user’s data as a JSON file.'));
children.push(labeled('Delete account', 'Permanently deletes the account and all associated data after password confirmation.'));
children.push(labeled('Session expiry handling', 'If a token expires or is invalid, the app detects the flagged 401 response and redirects to the login screen automatically.'));

// ── 4. Onboarding ──
children.push(H1('4. Onboarding & In-App Guidance'));
children.push(H2('4.1 First-run onboarding wizard'));
children.push(P('New users are guided through a short wizard the first time they sign in: confirm profile details (name, phone, monthly income), choose a primary financial goal, then a 3-slide introduction to the app. Completion is recorded so it only appears once.'));
children.push(H2('4.2 Replayable tour & feature tips'));
children.push(bullet('A "Take a tour" action (in the sidebar and Settings) replays a quick guided overview at any time.'));
children.push(bullet('First-time feature tips appear the first time a page or feature is used, explaining what it does, with a "Don’t show again" option.'));
children.push(bullet('Inline info tooltips (a "?" icon) explain advanced controls. Tips can be re-enabled from Settings.'));

// ── 5. Dashboard ──
children.push(H1('5. Dashboard'));
children.push(P('The Dashboard is the landing screen and shows an at-a-glance financial summary plus quick actions.'));
children.push(bullet('Summary cards: total income, total expenses and net balance.'));
children.push(bullet('Financial overview and a recent-transactions list.'));
children.push(bullet('"Add / Import Transactions": add a transaction manually, or import a bank statement (see Section 6).'));
children.push(bullet('A "waking up the server" indicator covers the brief cold-start delay on first load.'));

// ── 6. Statement import ──
children.push(H1('6. Bank Statement Import & Parsing'));
children.push(P('Users can upload a statement and have transactions extracted, categorised and reviewed before import. Supported formats: CSV, Excel (.xls/.xlsx) and PDF. Uploads are capped at 15 MB and restricted to those file types.'));
children.push(H2('6.1 Password-protected PDFs'));
children.push(bullet('Encrypted PDFs are detected. If a password is required the user is prompted for it; the PDF is then decrypted and parsed.'));
children.push(bullet('A wrong password is reported clearly and the user can retry.'));
children.push(H2('6.2 Balance-aware parser'));
children.push(P('Nigerian bank statements often have no clear column delimiters, so debit/credit columns are unreliable. FinPilot instead reads the running balance at the end of each record and derives the transaction amount and direction (income vs expense) from the change in balance. The result reconciles exactly against the statement’s opening and closing balances.'));
children.push(bullet('Recognises multiple date formats (DD-Mon-YYYY, DD/MM/YY[YY], YYYY-MM-DD) and tab/space-separated layouts.'));
children.push(bullet('Verified against Union Bank, GTBank and Kuda statement formats.'));
children.push(H2('6.3 Bank detection & review'));
children.push(bullet('The issuing bank is auto-detected from the statement text and shown for confirmation; the user can override it from the Paystack bank list.'));
children.push(bullet('Each upload becomes one "statement" group (an import batch) tagged with its bank, enabling later grouping and one-click deletion.'));
children.push(bullet('On the review screen, users select which transactions to import and can correct categories inline; duplicates already in the account are pre-flagged.'));
children.push(H2('6.4 Learn-from-correction categorisation'));
children.push(P('When a user corrects or confirms a transaction’s category, FinPilot stores a per-user mapping from a distilled "merchant signature" (the description with dates, numbers and bank noise-words removed) to that category. Future imports apply learned categories automatically, so categorisation improves with use — at no extra cost and with no machine-learning service.'));

// ── 7. Transactions ──
children.push(H1('7. Transactions'));
children.push(P('A dedicated Transactions page gives full control over the ledger across all statements.'));
children.push(labeled('Filters', 'By month, bank, category, type (income/expense) and free-text search.'));
children.push(labeled('Sorting', 'Click any column header (date, description, amount, type, category, bank) to sort; click again to reverse.'));
children.push(labeled('Pagination', '25 / 50 / 100 rows per page with first/previous/next/last controls.'));
children.push(labeled('Inline category edit', 'Change a transaction’s category from a dropdown; the change is saved and teaches the categoriser.'));
children.push(labeled('Full edit', 'Edit date, description, amount and type in place.'));
children.push(labeled('Delete', 'Delete a single row, multi-select and batch-delete, or delete an entire imported statement in one click.'));
children.push(labeled('Statement grouping', 'An "Imported statements" panel lists each upload (bank · month · count · total) for quick removal.'));

// ── 8. Budget ──
children.push(H1('8. Budgeting'));
children.push(bullet('Budgets are set per category for a specific month, chosen from a month picker.'));
children.push(bullet('Categories are picked from the shared canonical list, so budgets line up exactly with how transactions are categorised.'));
children.push(bullet('Each budget shows spent vs. limit for that month only, a progress bar, percentage used and remaining amount.'));
children.push(bullet('A pie chart visualises spending by category, with totals for budgeted, spent and remaining.'));
children.push(bullet('Alerts fire at 80% (warning) and 100% (overrun) of a category budget; these surface on the Dashboard.'));

// ── 9. Categories ──
children.push(H1('9. Categories & Smart Categorisation'));
children.push(P('A single canonical category list is shared across manual entry, the statement parser and budgets, which is what makes budget cross-checking reliable.'));
children.push(labeled('Expense categories', 'Food, Groceries, Transport, Fuel, Housing, Utilities, Airtime & Data, Shopping, Healthcare, Entertainment, Subscriptions, Education, Insurance, Bank Charges, ATM, Transfer, Savings, Family & Friends, Other.'));
children.push(labeled('Income categories', 'Salary, Business, Freelance, Investment, Gift, Refund, Other Income.'));
children.push(P('The backend categoriser maps Nigeria-aware keywords (e.g. Shoprite → Groceries, NNPC → Fuel, MTN → Airtile & Data, DSTV → Subscriptions, Piggyvest → Savings) to these categories, then learned per-user corrections take priority.'));

// ── 10. Auto-savings ──
children.push(H1('10. Auto-Savings'));
children.push(bullet('Fixed-amount rule: move a set Naira amount to savings from each income.'));
children.push(bullet('Round-up rule: round each expense up to the nearest step and save the difference.'));
children.push(bullet('Rules can be linked to a savings goal so saved money is applied to that goal.'));
children.push(bullet('One active rule at a time; money moves from the main wallet to the savings balance automatically.'));

// ── 11-14 planning tools ──
children.push(H1('11. Goals'));
children.push(bullet('Create savings goals with a target amount, deadline and category.'));
children.push(bullet('Contribute to a goal and track progress; auto-savings can feed a linked goal.'));
children.push(bullet('Optional scheduled contributions on a chosen day of the month.'));

children.push(H1('12. Debt Manager'));
children.push(bullet('Track debts with balance, interest rate and minimum payment.'));
children.push(bullet('Optional scheduled payments (amount and day of month) with payout recipient details.'));
children.push(bullet('Supports payoff planning and editing/removing debts.'));

children.push(H1('13. Subscriptions'));
children.push(bullet('Track recurring subscriptions with cost, frequency (monthly/yearly), category and next-payment date.'));
children.push(bullet('Optional scheduled payments and recipient bank details; cancel or edit subscriptions.'));

children.push(H1('14. Bills (Recurring)'));
children.push(bullet('Manage recurring bills with amount, due day, frequency, category and auto-pay flag.'));
children.push(bullet('Due bills can be processed/paid from the wallet; auto-pay deducts automatically when balance allows.'));

children.push(H1('15. Net Worth'));
children.push(bullet('A net-worth calculator that nets assets against liabilities for a single view of overall position.'));

// ── 16. Wallet ──
children.push(H1('16. Wallet'));
children.push(bullet('Maintains a main balance and a separate savings balance (in Naira).'));
children.push(bullet('Deposit and withdraw funds; every movement is recorded as a wallet transaction (deposit, withdrawal or savings transfer).'));
children.push(bullet('Auto-savings and scheduled payments move money through the wallet automatically.'));

// ── 17. Financial Health ──
children.push(H1('17. Financial Health & Insights'));
children.push(bullet('A health overview: total income, total expenses, net income and a savings-rate gauge with tailored advice.'));
children.push(bullet('Trends: charts of income/expense and spending behaviour over time.'));
children.push(bullet('Spending alerts highlight budget overruns and upcoming bills.'));

// ── 18. Payout ──
children.push(H1('18. Payout Methods'));
children.push(P('Users choose how withdrawals leave the wallet, configured in Settings. One method is active at a time.'));
children.push(labeled('Card', 'Card number, expiry and cardholder name. For security only the last four digits are stored — never the full card number or CVV.'));
children.push(labeled('Paystack-Titan account', 'A 10-digit account number whose name is verified automatically via Paystack.'));

// ── 19. Profile & Settings ──
children.push(H1('19. Profile & Settings'));
children.push(H2('19.1 Profile'));
children.push(P('Personal details: name, email, phone, monthly income and primary financial goal.'));
children.push(H2('19.2 Settings'));
children.push(labeled('Account & security', 'Change password, change email, sign out of all devices.'));
children.push(labeled('Payout method', 'Card or Paystack-Titan account (Section 18).'));
children.push(labeled('Appearance', 'Light/dark theme toggle.'));
children.push(labeled('Notifications', 'Email-alert preference; in-app alerts are always on.'));
children.push(labeled('Help', 'Show/hide feature tips and replay the tour.'));
children.push(labeled('Data & danger zone', 'Export data as JSON; permanently delete the account.'));

// ── 20. Notifications ──
children.push(H1('20. Notifications'));
children.push(bullet('A bell icon shows an unread count and a dropdown of recent in-app notifications.'));
children.push(bullet('Users are notified when a support ticket they raised is resolved.'));
children.push(bullet('Superadmins are notified when a new support ticket is submitted.'));
children.push(bullet('Notifications can be opened (marking them read and navigating to the relevant page), marked all-read, or deleted. The bell polls for new items periodically.'));

// ── 21. Support ──
children.push(H1('21. Support & FAQ');
children.push(P('A Support page combines self-service help with a contact channel.'));
children.push(bullet('An FAQ accordion answers common questions (importing statements, password-protected PDFs, budgeting, deleting by bank, categorisation, auto-savings, cold starts, password reset).'));
children.push(bullet('A contact form files a support ticket; users can see their own tickets and current status (open/resolved).'));
children.push(bullet('Ticket submission is rate-limited to prevent spam.'));

// ── 22. Admin ──
children.push(H1('22. Administration (Superadmin)'));
children.push(P('Superadmins have a dedicated, role-protected dashboard.'));
children.push(labeled('Overview', 'Platform stats: total/active/inactive users, total transactions, platform income and expenses, and recent sign-ups.'));
children.push(labeled('Users', 'Promote/demote between user and superadmin, activate/deactivate accounts, and delete a user with all their data.'));
children.push(labeled('Tickets', 'View all support tickets with an open-count badge and the full message, and mark each resolved or reopened.'));
children.push(labeled('Setup', 'A key-gated, disabled-by-default endpoint can create or promote a superadmin.'));

// ── 23. Security ──
children.push(H1('23. Security');
children.push(labeled('Authentication', 'JWT with a 30-day expiry; the server refuses to start without a configured secret (no insecure fallback).'));
children.push(labeled('Password storage', 'bcrypt-hashed passwords; reset tokens stored only as SHA-256 hashes with a 1-hour expiry.'));
children.push(labeled('CORS', 'Cross-origin requests restricted to the known frontend origin(s).'));
children.push(labeled('HTTP headers', 'helmet applies standard security headers.'));
children.push(labeled('Rate limiting', 'Auth endpoints (20/15 min) and sensitive writes such as change-password and ticket creation (30/15 min).'));
children.push(labeled('Input safety', 'Search input is escaped before use in database queries to prevent regex injection; profile/ticket text is escaped by React on display.'));
children.push(labeled('Sensitive data minimisation', 'Card payout stores only the last four digits; CVV and full PAN are never stored.'));
children.push(labeled('Admin setup', 'Disabled by default and gated behind a server-only key, so it cannot be abused.'));

// ── 24. Performance ──
children.push(H1('24. Performance');
children.push(labeled('Compression', 'Responses are gzip-compressed.'));
children.push(labeled('Database indexes', 'Indexes on common per-user queries (transactions by date and by import batch, budgets by month, learned categories).'));
children.push(labeled('Caching', 'The Paystack bank list is cached in memory for 24 hours.'));
children.push(labeled('Large imports', 'The request body limit is raised so large statements (hundreds of transactions) import without error.'));
children.push(labeled('Cold-start handling', 'On the free hosting tier the server sleeps when idle; the app shows a "waking up" indicator and retries automatically on first load.'));

// ── 25. API reference ──
children.push(new Paragraph({ children: [new PageBreak()] }));
children.push(H1('25. API Reference');
children.push(P('All endpoints are prefixed with /api and (except where noted) require a Bearer JWT. Selected routes:'));
const apiRows = [
  ['POST', '/register', 'Create an account; returns a JWT', 'No'],
  ['POST', '/login', 'Authenticate; returns a JWT', 'No'],
  ['POST', '/forgot-password', 'Email a password-reset link', 'No'],
  ['POST', '/reset-password', 'Set a new password from a reset token', 'No'],
  ['GET', '/me', 'Current user profile', 'Yes'],
  ['PUT', '/me', 'Update profile / onboarding fields', 'Yes'],
  ['DELETE', '/me', 'Delete account and all data', 'Yes'],
  ['GET', '/me/export', 'Export the user’s data as JSON', 'Yes'],
  ['POST', '/change-password', 'Change password (verifies current)', 'Yes'],
  ['POST', '/change-email', 'Change email (verifies password)', 'Yes'],
  ['POST', '/logout-all', 'Invalidate all sessions', 'Yes'],
  ['GET', '/transactions', 'List transactions (filters/sort)', 'Yes'],
  ['POST', '/transactions', 'Add a transaction', 'Yes'],
  ['PUT', '/transactions/:id', 'Edit a transaction (learns category)', 'Yes'],
  ['DELETE', '/transactions/:id', 'Delete a transaction', 'Yes'],
  ['POST', '/transactions/batch-delete', 'Delete selected transactions', 'Yes'],
  ['DELETE', '/transactions/batch/:batchId', 'Delete a whole imported statement', 'Yes'],
  ['POST', '/upload-statement', 'Parse an uploaded statement', 'Yes'],
  ['POST', '/import-transactions', 'Import reviewed transactions', 'Yes'],
  ['GET/POST', '/budgets', 'List (by month) / create budgets', 'Yes'],
  ['GET/POST/DELETE', '/savings/rules', 'Manage the auto-savings rule', 'Yes'],
  ['GET/POST', '/goals', 'List / create goals', 'Yes'],
  ['POST', '/goals/:id/contribute', 'Contribute to a goal', 'Yes'],
  ['GET/POST', '/debts', 'List / create debts', 'Yes'],
  ['GET/POST', '/subscriptions', 'List / create subscriptions', 'Yes'],
  ['GET/POST', '/bills', 'List / create recurring bills', 'Yes'],
  ['GET', '/wallet', 'Wallet balances & transactions', 'Yes'],
  ['POST', '/wallet/deposit', 'Deposit to wallet', 'Yes'],
  ['POST', '/wallet/withdraw', 'Withdraw from wallet', 'Yes'],
  ['GET', '/financial-health', 'Income/expense/savings summary', 'Yes'],
  ['GET', '/alerts', 'Budget & bill alerts', 'Yes'],
  ['GET', '/banks', 'Paystack bank list (cached)', 'Yes'],
  ['GET', '/bank/resolve', 'Resolve an account name', 'Yes'],
  ['GET/POST', '/user/bank-details', 'Get / set payout method', 'Yes'],
  ['GET', '/notifications', 'List notifications + unread count', 'Yes'],
  ['POST', '/support/tickets', 'Submit a support ticket', 'Yes'],
  ['GET', '/admin/stats', 'Platform statistics', 'Admin'],
  ['GET', '/admin/users', 'List all users', 'Admin'],
  ['GET', '/admin/tickets', 'List all support tickets', 'Admin'],
];
children.push(table(['Method', 'Path (/api…)', 'Purpose', 'Auth'], apiRows, [1400, 2700, 4060, 1200]));

// ── 26. Data models ──
children.push(H1('26. Data Models');
const modelRows = [
  ['User', 'Account, role, profile (phone, income, goal), payout method, onboarding/reset fields'],
  ['Transaction', 'Date, description, amount, category, type, source, bank, importBatch'],
  ['Budget', 'Per-user category budget for a given month'],
  ['Goal', 'Savings goal with target, current, deadline, scheduled payment'],
  ['Wallet', 'Main balance, savings balance, currency'],
  ['WalletTransaction', 'Deposit / withdrawal / savings-transfer records'],
  ['SavingsRule', 'Auto-savings rule (fixed amount or round-up)'],
  ['LearnedCategory', 'Per-user merchant-signature → category mapping'],
  ['Debt', 'Debt balance, interest, min payment, scheduled payment'],
  ['Subscription', 'Recurring subscription with cost and schedule'],
  ['RecurringBill', 'Recurring bill with due date and auto-pay'],
  ['SupportTicket', 'User-submitted support ticket with status'],
  ['Notification', 'In-app notification (type, title, message, read)'],
];
children.push(table(['Model', 'Stores'], modelRows, [2400, 6960]));

// ── 27. Roadmap ──
children.push(H1('27. Known Limitations & Roadmap');
children.push(labeled('Mobile / PWA', 'A mobile-optimised layout and installable PWA were prototyped and rolled back; a careful, incremental mobile redesign is planned.'));
children.push(labeled('Client data layer', 'A legacy localStorage cache for some lists remains and is slated for removal in favour of pure API-backed state.'));
children.push(labeled('Real bank connections', 'Today data comes from statement uploads; live bank-feed integration (e.g. via an aggregator) is a future option that would slot into the same pipeline.'));
children.push(labeled('Email delivery', 'Password-reset/notification emails require SMTP credentials to be configured in the hosting environment.'));

const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, color: ACCENT, font: 'Calibri' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 25, bold: true, color: '111827', font: 'Calibri' },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, color: '374151', font: 'Calibri' },
        paragraph: { spacing: { before: 140, after: 80 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [
        { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
        { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 280 } } } },
      ] },
      { reference: 'nums', levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 280 } } } },
      ] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ text: 'FinPilot Documentation  ·  Page ', size: 16, color: GREY }),
        new TextRun({ children: [PageNumber.CURRENT], size: 16, color: GREY }),
      ] })] }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  const out = process.argv[2] || 'FinPilot-Documentation.docx';
  fs.writeFileSync(out, buf);
  console.log('Wrote', out, '(' + (buf.length / 1024).toFixed(1) + ' KB)');
});
