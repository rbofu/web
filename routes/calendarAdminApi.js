const express = require('express');
const router = express.Router();
const db = require('../db');
const fs = require('fs');
const path = require('path');
const { requireLogin, requireCalendarAdmin } = require('../middleware/auth');
const accounts = require('../lib/userAccounts');
const { withDepthLabels } = require('../lib/orgTree');

router.use(requireLogin, requireCalendarAdmin);

// ---- Accounts ----
router.get('/accounts', (req, res) => {
  res.json(accounts.listAccounts());
});

router.post('/accounts', (req, res) => {
  const result = accounts.createAccount(req.body);
  if (result.error) return res.status(result.error.includes('taken') ? 409 : 400).json({ error: result.error });
  res.status(201).json(result.user);
});

router.put('/accounts/:id', (req, res) => {
  const result = accounts.updateAccount(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.user);
});

router.delete('/accounts/:id', (req, res) => {
  const result = accounts.deleteAccount(req.params.id, req.session.user.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(204).end();
});

// ---- Units (full list, for the account form's unit picker) ----
router.get('/units', (req, res) => {
  const data = db.read();
  res.json(withDepthLabels(data.units));
});

// ---- Danger zone: wipe every activity in the system ----
router.delete('/activities', (req, res) => {
  const data = db.read();
  const attachDir = path.join(__dirname, '..', 'data', 'calendar-uploads');
  data.calendarEvents.forEach(e => {
    (e.attachments || []).forEach(a => fs.unlink(path.join(attachDir, a.filename), () => {}));
  });
  const count = data.calendarEvents.length;
  data.calendarEvents = [];
  db.write(data);
  res.json({ ok: true, deleted: count });
});

module.exports = router;
