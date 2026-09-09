const express = require('express');
const path = require('path');
const router = express.Router();
const { verifyCredentials } = require('../lib/credentials');

router.get('/login', (req, res) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html'));
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = verifyCredentials(username, password);
  if (!user){
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (user.role !== 'admin'){
    return res.status(403).json({ error: 'This account does not have site administrator access. Use the Programme Calendar login instead.' });
  }
  req.session.user = user;
  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

module.exports = router;
