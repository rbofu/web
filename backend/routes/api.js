const express = require('express');
const router = express.Router();
const db = require('../db');

function sortByDateDesc(a, b){ return new Date(b.date) - new Date(a.date); }

function applyLimit(req, list){
  const limit = parseInt(req.query.limit, 10);
  return Number.isFinite(limit) && limit > 0 ? list.slice(0, limit) : list;
}

// ---- Statistics ----
router.get('/statistics', (req, res) => {
  const data = db.read();
  res.json(data.statistics);
});

// ---- Events ----
router.get('/events', (req, res) => {
  const data = db.read();
  const list = [...data.events].sort(sortByDateDesc);
  res.json(applyLimit(req, list));
});

// ---- News ----
router.get('/news', (req, res) => {
  const data = db.read();
  const list = [...data.news].sort(sortByDateDesc);
  res.json(applyLimit(req, list));
});

// ---- Activities ----
router.get('/activities', (req, res) => {
  const data = db.read();
  const list = [...data.activities].sort(sortByDateDesc);
  res.json(applyLimit(req, list));
});

router.get('/activities/:id', (req, res) => {
  const data = db.read();
  const item = data.activities.find(a => String(a.id) === String(req.params.id));
  if (!item) return res.status(404).json({ error: 'Activity not found' });
  res.json(item);
});

// ---- Diseases ----
router.get('/diseases', (req, res) => {
  const data = db.read();
  res.json(data.diseases);
});

// ---- Partners ----
router.get('/partners', (req, res) => {
  const data = db.read();
  res.json(data.partners);
});

// ---- Resources / publications ----
router.get('/resources', (req, res) => {
  const data = db.read();
  const list = [...data.resources].sort(sortByDateDesc);
  res.json(applyLimit(req, list));
});

// ---- Contact form ----
router.post('/contact', (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !message){
    return res.status(400).json({ error: 'name, email and message are required' });
  }
  const data = db.read();
  const entry = {
    id: db.nextId(data.messages),
    name, email, subject: subject || '', message,
    date: new Date().toISOString()
  };
  data.messages.push(entry);
  db.write(data);
  res.status(201).json({ ok: true });
});

module.exports = router;
