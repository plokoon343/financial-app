// statementRoutes.js
// Express routes for bank statement upload and transaction import.
//
// HOW TO USE:
//   1. Drop this file into your /routes folder
//   2. In server.js add:
//        const statementRoutes = require('./routes/statementRoutes');
//        app.use('/api', statementRoutes);
//   3. npm install multer pdf-parse csv-parser xlsx
//   4. Update the Transaction import path on line ~20 to match your project
//
// ─── IMPORTANT ───────────────────────────────────────────────────────────────
// Update the two lines marked *** to match your actual file paths.
// ─────────────────────────────────────────────────────────────────────────────

const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const router   = express.Router();

// *** Update this path to wherever your auth middleware lives
const auth = require('../middleware/auth');

// *** Update this path to wherever your Transaction model lives
const Transaction = require('../models/Transaction');

const { parseStatement } = require('../utils/statementParser');

// ─── Multer configuration (temp file storage) ─────────────────────────────────
const upload = multer({
  dest: path.join(__dirname, '../uploads/temp/'),   // temp folder; files deleted after parsing
  limits: {
    fileSize: 15 * 1024 * 1024,  // 15 MB max
  },
  fileFilter: (req, file, cb) => {
    const ALLOWED_MIMES = [
      'text/csv',
      'text/plain',
      'application/pdf',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (ALLOWED_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.originalname}. Please upload CSV, Excel, or PDF.`));
    }
  },
});


// ─── POST /api/upload-statement ───────────────────────────────────────────────
//
// Accepts a bank statement file, parses it, and returns extracted transactions
// for the user to review. Does NOT save anything to the database yet.
//
// Request:  multipart/form-data with field "file"
// Response: { transactions: [...], meta: { fileType, totalFound, warnings } }

router.post('/upload-statement', auth, upload.single('file'), async (req, res) => {
  // Guard: multer fileFilter rejected the file
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded or file type not supported.' });
  }

  const tempPath = req.file.path;

  try {
    // Parse the statement (CSV / Excel / PDF)
    const transactions = await parseStatement(tempPath, req.file.mimetype);

    if (transactions.length === 0) {
      return res.status(422).json({
        message:
          'We could not find any transactions in this file. ' +
          'Please check that it is a valid bank statement. ' +
          'PDF files must have selectable text (not scanned images).',
        meta: { fileType: req.file.mimetype, totalFound: 0 },
      });
    }

    // Check for transactions already in this user's ledger (to flag duplicates)
    // We match on date + amount + description to avoid reimporting the same data.
    const existingKeys = new Set();
    const existing = await Transaction.find(
      { user: req.user.id },
      { date: 1, amount: 1, description: 1 }
    ).lean();

    for (const t of existing) {
      existingKeys.add(`${t.date}|${t.amount}|${t.description}`);
    }

    const tagged = transactions.map(t => ({
      ...t,
      duplicate: existingKeys.has(`${t.date}|${t.amount}|${t.description}`),
    }));

    const duplicateCount = tagged.filter(t => t.duplicate).length;

    return res.json({
      transactions: tagged,
      meta: {
        fileName:       req.file.originalname,
        fileType:       req.file.mimetype,
        totalFound:     tagged.length,
        duplicateCount,
        warnings:       duplicateCount > 0
          ? [`${duplicateCount} transaction(s) already exist in your account and are pre-marked.`]
          : [],
      },
    });

  } catch (err) {
    console.error('[upload-statement] Error:', err.message);
    return res.status(500).json({
      message: err.message || 'Failed to process the statement. Please try again.',
    });

  } finally {
    // Always delete the temp file, even if parsing failed
    if (fs.existsSync(tempPath)) {
      fs.unlink(tempPath, () => {});
    }
  }
});


// ─── POST /api/import-transactions ────────────────────────────────────────────
//
// Saves the user-selected transactions into the database.
// Called after the user reviews extracted transactions and clicks "Import".
//
// Request body:  { transactions: [ { date, description, amount, type, category, reference, balance } ] }
// Response:      { message, importedCount, skippedCount }

router.post('/import-transactions', auth, async (req, res) => {
  const { transactions } = req.body;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ message: 'No transactions provided.' });
  }

  // Validate each transaction has the minimum required fields
  const valid = transactions.filter(t => t.date && t.amount && t.description && t.type);
  const skippedCount = transactions.length - valid.length;

  if (valid.length === 0) {
    return res.status(400).json({ message: 'All submitted transactions are missing required fields.' });
  }

  try {
    // Build the documents to insert.
    // ─────────────────────────────────────────────────────────────────────────
    // *** IMPORTANT: check your Transaction model's field names and adjust
    // the mapping below so each key matches your schema exactly.
    //
    // Common differences:
    //   - Your model might use "userId" instead of "user"
    //   - Your model might use "title" instead of "description"
    //   - Your model might not have a "reference" or "balance" field (just delete those lines)
    // ─────────────────────────────────────────────────────────────────────────
    const docs = valid.map(t => ({
      user:        req.user.id,          // ← your schema might call this "userId"
      date:        new Date(t.date),
      description: t.description,        // ← your schema might call this "title" or "narration"
      amount:      parseFloat(t.amount),
      type:        t.type,               // 'income' | 'expense'
      category:    t.category || 'Other',
      reference:   t.reference || null,
      balance:     t.balance   || null,
      source:      'statement_import',   // useful for filtering imported vs manual transactions
      createdAt:   new Date(),
    }));

    // insertMany with ordered:false means one bad doc won't block the rest
    const result = await Transaction.insertMany(docs, { ordered: false });

    return res.json({
      message:       `Successfully imported ${result.length} transaction(s).`,
      importedCount: result.length,
      skippedCount,
    });

  } catch (err) {
    // MongoDB duplicate key error (if you have a unique index on the collection)
    if (err.code === 11000) {
      const inserted = err.result?.nInserted || 0;
      return res.json({
        message:       `Imported ${inserted} transaction(s). Some were skipped as duplicates.`,
        importedCount: inserted,
        skippedCount:  transactions.length - inserted,
      });
    }

    console.error('[import-transactions] Error:', err.message);
    return res.status(500).json({ message: 'Failed to import transactions. Please try again.' });
  }
});


module.exports = router;
