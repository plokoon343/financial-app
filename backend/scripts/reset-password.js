// Emergency password recovery / user lookup tool.
//
// Lists users, or resets one user's password directly in the database — useful
// when you're locked out and email isn't set up yet.
//
// Usage (run from the backend folder):
//   List all accounts:
//     MONGODB_URI="<your uri>" node scripts/reset-password.js --list
//   Reset a password:
//     MONGODB_URI="<your uri>" node scripts/reset-password.js --email you@example.com --password "NewPass123"
//
// On Windows PowerShell, set the var first:
//   $env:MONGODB_URI="<your uri>"; node scripts/reset-password.js --list
//
// Get <your uri> from your Render service's Environment tab (MONGODB_URI).
// Omit MONGODB_URI to use the one in backend/.env (your local database).

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const list = args.includes('--list');
const email = getArg('--email');
const password = getArg('--password');

const userSchema = new mongoose.Schema({}, { strict: false, collection: 'users' });
const User = mongoose.model('User', userSchema);

(async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/financial_app';
  await mongoose.connect(uri);
  console.log('Connected to', uri.replace(/\/\/[^@]*@/, '//<credentials>@'));

  if (list || (!email && !password)) {
    const users = await User.find({}, { email: 1, name: 1, role: 1, createdAt: 1 }).lean();
    console.log(`\n${users.length} account(s):`);
    users.forEach(u => console.log(`  - ${u.email}  (${u.name || 'no name'}${u.role === 'superadmin' ? ', superadmin' : ''})`));
    console.log('\nTo reset one:  node scripts/reset-password.js --email <email> --password "<newPassword>"');
    await mongoose.disconnect();
    return;
  }

  if (!email || !password) {
    console.error('Provide both --email and --password (or use --list).');
    await mongoose.disconnect();
    process.exit(1);
  }

  const user = await User.findOne({ email: email.trim() });
  if (!user) {
    console.error(`No user found with email "${email}". Run with --list to see all emails.`);
    await mongoose.disconnect();
    process.exit(1);
  }
  const hashed = await bcrypt.hash(password, await bcrypt.genSalt(10));
  // Direct update (reliable regardless of schema) — also clears any reset token.
  await User.updateOne(
    { _id: user._id },
    { $set: { password: hashed }, $unset: { resetToken: 1, resetTokenExpiry: 1 } }
  );
  console.log(`\n✅ Password updated for ${user.email}. You can now log in with the new password.`);
  await mongoose.disconnect();
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
