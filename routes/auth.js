const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

const insertLoginEvent = db.prepare('INSERT INTO login_events (user_id) VALUES (?)');
const touchLoginTimestamps = db.prepare('UPDATE users SET last_login_at = ?, last_seen_at = ? WHERE id = ?');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).render('login', { error: 'Incorrect username or password.' });
  }

  const now = new Date().toISOString();
  insertLoginEvent.run(user.id);
  touchLoginTimestamps.run(now, now, user.id);

  req.session.user = {
    id: user.id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    privilege: user.privilege || 'normal',
    unit: user.unit || '',
    can_upload: typeof user.can_upload !== 'undefined' ? Boolean(user.can_upload) : true,
    can_download_reports: typeof user.can_download_reports !== 'undefined' ? Boolean(user.can_download_reports) : false
  };
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
