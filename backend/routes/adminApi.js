const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { readOutbox } = require('../lib/mailer');
const { checkAndSendReminders } = require('../lib/reminders');
const accounts = require('../lib/userAccounts');

router.use(requireAdmin);

const COLLECTIONS = ['news', 'events', 'activities', 'diseases', 'partners', 'resources', 'units'];

function assertCollection(req, res, next){
  if (!COLLECTIONS.includes(req.params.collection)){
    return res.status(404).json({ error: 'Unknown collection' });
  }
  next();
}

// List everything in a collection
router.get('/collections/:collection', assertCollection, (req, res) => {
  const data = db.read();
  res.json(data[req.params.collection]);
});

// Create
router.post('/collections/:collection', assertCollection, (req, res) => {
  const data = db.read();
  const list = data[req.params.collection];
  const item = { id: db.nextId(list), ...req.body };
  list.push(item);
  db.write(data);
  res.status(201).json(item);
});

// Update
router.put('/collections/:collection/:id', assertCollection, (req, res) => {
  const data = db.read();
  const list = data[req.params.collection];
  const idx = list.findIndex(i => String(i.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  list[idx] = { ...list[idx], ...req.body, id: list[idx].id };
  db.write(data);
  res.json(list[idx]);
});

// Delete
router.delete('/collections/:collection/:id', assertCollection, (req, res) => {
  const data = db.read();
  const list = data[req.params.collection];
  const idx = list.findIndex(i => String(i.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Item not found' });
  // Guard: don't allow deleting an org unit that still has child units or events.
  if (req.params.collection === 'units'){
    const hasChildren = data.units.some(u => String(u.parentId) === String(req.params.id));
    const hasEvents = (data.calendarEvents || []).some(e => String(e.unitId) === String(req.params.id));
    const hasUsers = (data.users || []).some(u => String(u.unitId) === String(req.params.id) || String(u.visibilityUnitId) === String(req.params.id));
    if (hasChildren || hasEvents || hasUsers){
      return res.status(409).json({ error: 'This unit still has sub-units, users, or calendar events assigned to it. Reassign or remove those first.' });
    }
  }
  list.splice(idx, 1);
  db.write(data);
  res.status(204).end();
});

// ---- Users — delegates to the shared accounts library (also used by the calendar's Admin tab) ----
router.get('/users', (req, res) => {
  res.json(accounts.listAccounts());
});

router.post('/users', (req, res) => {
  const result = accounts.createAccount(req.body);
  if (result.error) return res.status(result.error.includes('taken') ? 409 : 400).json({ error: result.error });
  res.status(201).json(result.user);
});

router.put('/users/:id', (req, res) => {
  const result = accounts.updateAccount(req.params.id, req.body);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.json(result.user);
});

router.delete('/users/:id', (req, res) => {
  const result = accounts.deleteAccount(req.params.id, req.session.user.id);
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(204).end();
});

// Statistics — single object, not a list
router.get('/statistics', (req, res) => {
  const data = db.read();
  res.json(data.statistics);
});
router.put('/statistics', (req, res) => {
  const data = db.read();
  data.statistics = { ...data.statistics, ...req.body };
  db.write(data);
  res.json(data.statistics);
});

// Contact messages — read + delete only
router.get('/messages', (req, res) => {
  const data = db.read();
  res.json([...data.messages].reverse());
});
router.delete('/messages/:id', (req, res) => {
  const data = db.read();
  const idx = data.messages.findIndex(m => String(m.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Message not found' });
  data.messages.splice(idx, 1);
  db.write(data);
  res.status(204).end();
});

// Mail outbox — shows reminder emails sent (or simulated, if no SMTP configured)
router.get('/mail-outbox', (req, res) => {
  res.json(readOutbox());
});

// Manually trigger a reminder sweep (handy for testing without waiting 15 minutes)
router.post('/run-reminders', async (req, res) => {
  await checkAndSendReminders();
  res.json({ ok: true });
});

module.exports = router;
