const express = require('express');
const path = require('path');
const router = express.Router();
const { verifyCredentials } = require('../lib/credentials');
const { recordLogin, sanitize } = require('../lib/userAccounts');
const db = require('../db');

router.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/calendar');
  res.sendFile(path.join(__dirname, '..', 'public', 'calendar', 'login.html'));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = verifyCredentials(username, password);
  if (!user){
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  recordLogin(user.id);
  const fresh = db.read().users.find(u => u.id === user.id);
  req.session.user = sanitize(fresh);
  res.json({ ok: true, user: req.session.user });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json(req.session.user);
});

module.exports = router;
