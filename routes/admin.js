const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireLogin, requireAdmin, isOnline, ONLINE_WINDOW_MS } = require('../middleware/auth');
const { UNITS } = require('../utils/units');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'data', 'uploads');

const VALID_PRIVILEGES = new Set(['normal', 'administration', 'super']);

function loadUsers() {
  const rows = db.prepare(`
    SELECT
      u.id, u.username, u.full_name, u.role, u.privilege, u.unit,
      u.mobile_number, u.education_level, u.email,
      u.can_upload, u.can_download_reports, u.created_at,
      u.last_login_at, u.last_seen_at,
      (SELECT COUNT(*) FROM login_events le WHERE le.user_id = u.id) AS login_count
    FROM users u
    ORDER BY u.created_at ASC
  `).all();

  return rows.map((u) => ({ ...u, online: isOnline(u.last_seen_at) }));
}

router.get('/admin', requireLogin, requireAdmin, (req, res) => {
  const users = loadUsers();
  const onlineCount = users.filter((u) => u.online).length;
  res.render('admin', {
    user: req.session.user,
    users,
    units: UNITS,
    onlineCount,
    onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
    error: null,
    success: null
  });
});

router.post('/admin/users', requireLogin, requireAdmin, (req, res) => {
  const { username, full_name, password, role, privilege, unit, mobile_number, education_level, email } = req.body;
  const trimmedUsername = String(username || '').trim();
  const trimmedFullName = String(full_name || '').trim();
  const trimmedPassword = String(password || '').trim();
  const normalizedRole = role === 'admin' ? 'admin' : 'officer';
  const normalizedPrivilege = VALID_PRIVILEGES.has(privilege) ? privilege : 'normal';

  const rerender = (status, error, success) => res.status(status).render('admin', {
    user: req.session.user,
    users: loadUsers(),
    units: UNITS,
    onlineCount: loadUsers().filter((u) => u.online).length,
    onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
    error,
    success
  });

  if (!trimmedUsername || !trimmedFullName || !trimmedPassword) {
    return rerender(400, 'Username, full name, and temporary password are required.', null);
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername);
  if (existing) {
    return rerender(400, 'That username is already taken.', null);
  }

  const passwordHash = bcrypt.hashSync(trimmedPassword, 10);
  db.prepare(
    `INSERT INTO users (username, full_name, password_hash, role, privilege, unit, mobile_number, education_level, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    trimmedUsername, trimmedFullName, passwordHash, normalizedRole, normalizedPrivilege,
    String(unit || '').trim() || null,
    String(mobile_number || '').trim() || null,
    String(education_level || '').trim() || null,
    String(email || '').trim() || null
  );

  return rerender(200, null, `Account "${trimmedUsername}" created successfully.`);
});

router.get('/admin/users/:id/edit', requireLogin, requireAdmin, (req, res) => {
  const editUser = db.prepare(
    'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, can_upload FROM users WHERE id = ?'
  ).get(req.params.id);
  if (!editUser) {
    return res.status(404).render('admin', {
      user: req.session.user,
      users: loadUsers(),
      units: UNITS,
      onlineCount: loadUsers().filter((u) => u.online).length,
      onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
      error: 'User not found.',
      success: null
    });
  }

  res.render('admin-edit', {
    user: req.session.user,
    editUser,
    units: UNITS,
    error: null,
    success: null
  });
});

router.post('/admin/users/:id/update', requireLogin, requireAdmin, (req, res) => {
  const { username, full_name, role, privilege, unit, mobile_number, education_level, email, password } = req.body;
  const editUser = db.prepare(
    'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, can_upload FROM users WHERE id = ?'
  ).get(req.params.id);

  if (!editUser) {
    return res.status(404).render('admin', {
      user: req.session.user,
      users: loadUsers(),
      units: UNITS,
      onlineCount: loadUsers().filter((u) => u.online).length,
      onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
      error: 'User not found.',
      success: null
    });
  }

  const rerenderEdit = (status, error) => res.status(status).render('admin-edit', {
    user: req.session.user,
    editUser,
    units: UNITS,
    error,
    success: null
  });

  if (!username || !full_name) {
    return rerenderEdit(400, 'Username and full name are required.');
  }

  const trimmedUsername = username.trim();
  const trimmedFullName = full_name.trim();
  const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(trimmedUsername, req.params.id);
  if (existing) {
    return rerenderEdit(400, 'That username is already taken.');
  }

  const trimmedEmail = String(email || '').trim();
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return rerenderEdit(400, 'That email address does not look valid.');
  }

  const canUpload = req.body.can_upload === 'on' ? 1 : 0;
  const canDownloadReports = req.body.can_download_reports === 'on' ? 1 : 0;
  const normalizedRole = role === 'admin' ? 'admin' : 'officer';
  const normalizedPrivilege = VALID_PRIVILEGES.has(privilege) ? privilege : 'normal';

  const updateFields = [
    'username = ?', 'full_name = ?', 'role = ?', 'privilege = ?', 'unit = ?',
    'mobile_number = ?', 'education_level = ?', 'email = ?',
    'can_upload = ?', 'can_download_reports = ?'
  ];
  const params = [
    trimmedUsername, trimmedFullName, normalizedRole, normalizedPrivilege,
    String(unit || '').trim() || null,
    String(mobile_number || '').trim() || null,
    String(education_level || '').trim() || null,
    trimmedEmail || null,
    canUpload, canDownloadReports
  ];

  if (password && password.trim()) {
    updateFields.push('password_hash = ?');
    params.push(bcrypt.hashSync(password, 10));
  }
  params.push(req.params.id);

  db.prepare(`UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`).run(...params);

  if (req.session.user.id === Number(editUser.id)) {
    req.session.user.username = trimmedUsername;
    req.session.user.full_name = trimmedFullName;
    req.session.user.role = normalizedRole;
    req.session.user.privilege = normalizedPrivilege;
    req.session.user.unit = String(unit || '').trim();
    req.session.user.can_upload = Boolean(canUpload);
    req.session.user.can_download_reports = Boolean(canDownloadReports);
  }

  const refreshedUser = db.prepare(
    'SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email, can_upload FROM users WHERE id = ?'
  ).get(req.params.id);
  res.render('admin-edit', {
    user: req.session.user,
    editUser: refreshedUser,
    units: UNITS,
    error: null,
    success: `Account "${trimmedUsername}" updated successfully.`
  });
});

router.post('/admin/users/:id/reset-password', requireLogin, requireAdmin, (req, res) => {
  const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);

  const rerender = (status, error, success) => res.status(status).render('admin', {
    user: req.session.user,
    users: loadUsers(),
    units: UNITS,
    onlineCount: loadUsers().filter((u) => u.online).length,
    onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
    error,
    success
  });

  if (!targetUser) return rerender(404, 'User not found.', null);

  const trimmedPassword = String(req.body.password || '').trim();
  if (!trimmedPassword) return rerender(400, 'A new password is required.', null);

  const passwordHash = bcrypt.hashSync(trimmedPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, req.params.id);

  return rerender(200, null, `Password for "${targetUser.username}" was reset successfully.`);
});

router.all('/admin/users/:id/toggle-upload', requireLogin, requireAdmin, (req, res) => {
  const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.redirect('/admin');

  if (req.method === 'POST') {
    const canUpload = req.body.can_upload === 'on' ? 1 : 0;
    db.prepare('UPDATE users SET can_upload = ? WHERE id = ?').run(canUpload, req.params.id);
    if (req.session.user.id === targetUser.id) req.session.user.can_upload = Boolean(canUpload);
  }
  return res.redirect('/admin');
});

router.all('/admin/users/:id/toggle-download-reports', requireLogin, requireAdmin, (req, res) => {
  const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!targetUser) return res.redirect('/admin');

  if (req.method === 'POST') {
    const canDownloadReports = req.body.can_download_reports === 'on' ? 1 : 0;
    db.prepare('UPDATE users SET can_download_reports = ? WHERE id = ?').run(canDownloadReports, req.params.id);
    if (req.session.user.id === targetUser.id) req.session.user.can_download_reports = Boolean(canDownloadReports);
  }
  return res.redirect('/admin');
});

// Quick inline privilege change from the accounts table (Normal / Administration / Super).
router.post('/admin/users/:id/privilege', requireLogin, requireAdmin, (req, res) => {
  const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (targetUser) {
    const privilege = VALID_PRIVILEGES.has(req.body.privilege) ? req.body.privilege : 'normal';
    db.prepare('UPDATE users SET privilege = ? WHERE id = ?').run(privilege, req.params.id);
    if (req.session.user.id === targetUser.id) req.session.user.privilege = privilege;
  }
  return res.redirect('/admin');
});

router.post('/admin/users/:id/delete', requireLogin, requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.redirect('/admin');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/admin');
});

// Admin view of a user's profile (read-only)
router.get('/admin/users/:id/profile', requireLogin, requireAdmin, (req, res) => {
  const viewUser = db.prepare(
    `SELECT id, username, full_name, role, privilege, unit, mobile_number, education_level, email,
            can_upload, can_download_reports, created_at, last_login_at, last_seen_at,
            (SELECT COUNT(*) FROM login_events le WHERE le.user_id = users.id) AS login_count
     FROM users WHERE id = ?`
  ).get(req.params.id);
  if (!viewUser) {
    return res.status(404).render('admin', {
      user: req.session.user,
      users: loadUsers(),
      units: UNITS,
      onlineCount: loadUsers().filter((u) => u.online).length,
      onlineWindowMinutes: Math.round(ONLINE_WINDOW_MS / 60000),
      error: 'User not found.',
      success: null
    });
  }

  res.render('profile', {
    user: { ...viewUser, online: isOnline(viewUser.last_seen_at) },
    units: UNITS,
    error: null,
    success: null,
    isAdminView: true
  });
});

// Bulk-remove every activity in the system (and their attached files).
// Per-activity delete (own activity, or any activity as admin) still lives
// in routes/activities.js and is unaffected by this.
router.post('/admin/activities/clear', requireLogin, requireAdmin, (req, res) => {
  const files = db.prepare('SELECT stored_name FROM attachments').all();
  db.prepare('DELETE FROM activities').run(); // cascades activity_participants + attachments
  files.forEach((f) => fs.unlink(path.join(uploadDir, f.stored_name), () => {}));
  res.redirect('/admin');
});

module.exports = router;
