require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./db');

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'rama';
const fullName = process.env.ADMIN_FULL_NAME || 'Program Administrator';

const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
if (existing) {
  console.log(`User "${username}" already exists.`);
  process.exit(0);
}

const hash = bcrypt.hashSync(password, 10);
db.prepare(
  'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)'
).run(username, fullName, hash, 'admin');

console.log(`SUCCESS! Created account: "${username}" with password: "${password}"`);
