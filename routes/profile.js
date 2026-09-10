const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { UNITS } = require('../utils/units');

const router = express.Router();

router.get('/profile', requireLogin, (req, res) => {
  const dbUser = db.prepare(
    'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, created_at FROM users WHERE id = ?'
  ).get(req.session.user.id);
  res.render('profile', { user: dbUser, units: UNITS, error: null, success: null });
});

router.post('/profile', requireLogin, (req, res) => {
  const { full_name, password, mobile_number, education_level, email, unit } = req.body;
  const trimmedFullName = String(full_name || '').trim();

  const reRender = (errorMessage) => {
    const dbUser = db.prepare(
      'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, created_at FROM users WHERE id = ?'
    ).get(req.session.user.id);
    return res.status(400).render('profile', { user: dbUser, units: UNITS, error: errorMessage, success: null });
  };

  if (!trimmedFullName) return reRender('Full name is required.');

  const trimmedEmail = String(email || '').trim();
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return reRender('That email address does not look valid.');
  }

  const updates = ['full_name = ?', 'mobile_number = ?', 'education_level = ?', 'email = ?', 'unit = ?'];
  const params = [
    trimmedFullName,
    String(mobile_number || '').trim() || null,
    String(education_level || '').trim() || null,
    trimmedEmail || null,
    String(unit || '').trim() || null
  ];

  if (password && password.trim()) {
    updates.push('password_hash = ?');
    params.push(bcrypt.hashSync(password.trim(), 10));
  }

  params.push(req.session.user.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  req.session.user.full_name = trimmedFullName;
  req.session.user.unit = String(unit || '').trim();

  const dbUser = db.prepare(
    'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, created_at FROM users WHERE id = ?'
  ).get(req.session.user.id);

  res.render('profile', { user: dbUser, units: UNITS, error: null, success: 'Profile updated successfully.' });
});

module.exports = router;
