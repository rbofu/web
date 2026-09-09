const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { getSubtreeIds, withDepthLabels } = require('../lib/orgTree');
const { touchLastSeen, sanitize } = require('../lib/userAccounts');
const { computeStatus } = require('../lib/activityStatus');

router.use(requireLogin);
router.use((req, res, next) => { touchLastSeen(req.session.user.id); next(); });

// ---- Self-service profile ----
router.get('/me', (req, res) => {
  const data = db.read();
  const user = data.users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(404).json({ error: 'Account not found' });
  const unit = data.units.find(u => String(u.id) === String(user.unitId));
  const root = data.units.find(u => u.parentId === null);
  let privilege = 'Normal (own unit)';
  if (user.role === 'admin' || String(user.visibilityUnitId) === String(root && root.id)){
    privilege = 'Administration (all units)';
  } else if (String(user.visibilityUnitId) !== String(user.unitId)){
    const scopeUnit = data.units.find(u => String(u.id) === String(user.visibilityUnitId));
    privilege = `Programme-wide (${scopeUnit ? scopeUnit.name : 'multiple units'})`;
  }
  res.json({ ...sanitize(user), unitName: unit ? unit.name : '—', privilegeLabel: privilege });
});

router.put('/me', (req, res) => {
  const data = db.read();
  const idx = data.users.findIndex(u => u.id === req.session.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Account not found' });
  // A user may update their own contact details and password, but not their
  // own role, unit, or visibility — those are set by an administrator.
  const { name, email, mobile, education, password } = req.body || {};
  const updated = { ...data.users[idx] };
  if (name !== undefined) updated.name = name;
  if (email !== undefined) updated.email = email;
  if (mobile !== undefined) updated.mobile = mobile;
  if (education !== undefined) updated.education = education;
  if (password) updated.passwordHash = bcrypt.hashSync(password, 10);
  data.users[idx] = updated;
  db.write(data);
  req.session.user = sanitize(updated);
  res.json(req.session.user);
});

// ---- Officers directory (for assigning participants) — limited to the caller's view scope ----
router.get('/officers', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const vScope = viewScopeIds(data.units, user);
  const unitsById = Object.fromEntries(data.units.map(u => [String(u.id), u.name]));
  const officers = data.users
    .filter(u => inScope(vScope, u.unitId))
    .map(u => ({ id: u.id, name: u.name, unitId: u.unitId, unitName: unitsById[String(u.unitId)] || '' }));
  res.json(officers);
});

// Attachments are stored outside the public/ tree — they're only ever served
// through the /attachments/:filename route below, which checks the
// requester's visibility scope before streaming the file.
const ATTACH_DIR = path.join(__dirname, '..', 'data', 'calendar-uploads');
fs.mkdirSync(ATTACH_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ATTACH_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Cover images (activity photos) are simple decorative images, so — unlike
// attachments — they're stored under public/ and served like any other
// static asset (still behind the /calendar-images mount's login check).
const IMAGE_DIR = path.join(__dirname, '..', 'public', 'calendar-images');
fs.mkdirSync(IMAGE_DIR, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, IMAGE_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed for the cover image'));
  },
  limits: { fileSize: 8 * 1024 * 1024 }
});

// POST /api/calendar/upload-image — any signed-in account can attach a cover photo
router.post('/upload-image', (req, res) => {
  imageUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    res.status(201).json({ url: `/calendar-images/${req.file.filename}`, name: req.file.originalname });
  });
});

// ---- Scope helpers ----
// "View scope"    — which units' events this user is allowed to see (their visibilityUnitId's subtree).
// "Manage scope"  — which units' events this user is allowed to create/edit/delete (their home unitId's subtree).
// Admins bypass both and see/manage everything.

function viewScopeIds(units, user){
  if (user.role === 'admin') return null; // null = unrestricted
  return getSubtreeIds(units, user.visibilityUnitId);
}
function manageScopeIds(units, user){
  if (user.role === 'admin') return null;
  return getSubtreeIds(units, user.unitId);
}
function inScope(scopeIds, unitId){
  return scopeIds === null || scopeIds.includes(String(unitId));
}

// GET /api/calendar/context — current user + the units they can view/manage, for building the UI
router.get('/context', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const vScope = viewScopeIds(data.units, user);
  const mScope = manageScopeIds(data.units, user);
  const allLabelled = withDepthLabels(data.units);
  const viewUnits = allLabelled.filter(u => inScope(vScope, u.id));
  const manageUnits = allLabelled.filter(u => inScope(mScope, u.id));
  res.json({ user, viewUnits, manageUnits });
});

// GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD&unitId=
router.get('/events', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const scope = viewScopeIds(data.units, user);
  let events = data.calendarEvents.filter(e => inScope(scope, e.unitId));

  if (req.query.unitId){
    if (!inScope(scope, req.query.unitId)){
      return res.status(403).json({ error: 'You do not have visibility into that unit' });
    }
    events = events.filter(e => String(e.unitId) === String(req.query.unitId));
  }
  if (req.query.start){
    events = events.filter(e => e.endDate >= req.query.start);
  }
  if (req.query.end){
    events = events.filter(e => e.startDate <= req.query.end);
  }

  const unitsById = Object.fromEntries(data.units.map(u => [String(u.id), u.name]));
  const usersById = Object.fromEntries(data.users.map(u => [String(u.id), u.name]));
  events = events
    .map(e => ({
      ...e,
      status: computeStatus(e),
      unitName: unitsById[String(e.unitId)] || 'Unknown unit',
      participants: (e.participantIds || []).map(id => ({ id, name: usersById[String(id)] || 'Unknown' }))
    }))
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  res.json(events);
});

router.get('/events/:id', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const scope = viewScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event || !inScope(scope, event.unitId)){
    return res.status(404).json({ error: 'Event not found' });
  }
  const unit = data.units.find(u => String(u.id) === String(event.unitId));
  const usersById = Object.fromEntries(data.users.map(u => [String(u.id), u.name]));
  const participants = (event.participantIds || []).map(id => ({ id, name: usersById[String(id)] || 'Unknown' }));
  res.json({ ...event, status: computeStatus(event), unitName: unit ? unit.name : 'Unknown unit', participants });
});

// POST /api/calendar/events
router.post('/events', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const { title, description, startDate, endDate, location, category, unitId, reminderDaysBefore, image, participantIds } = req.body || {};

  if (!title || !startDate || !unitId){
    return res.status(400).json({ error: 'title, startDate and unitId are required' });
  }
  if (!inScope(mScope, unitId)){
    return res.status(403).json({ error: 'You do not have permission to add events for that unit' });
  }

  const event = {
    id: db.nextId(data.calendarEvents),
    title, description: description || '',
    startDate, endDate: endDate || startDate,
    location: location || '', category: category || 'Activity',
    image: image || '',
    unitId: Number(unitId), createdBy: user.id,
    participantIds: Array.isArray(participantIds) ? participantIds.map(Number) : [],
    report: null,
    reminderDaysBefore: reminderDaysBefore !== undefined ? Number(reminderDaysBefore) : 1,
    reminderSent: false,
    comments: [], attachments: []
  };
  data.calendarEvents.push(event);
  db.write(data);
  res.status(201).json(event);
});

// PUT /api/calendar/events/:id
router.put('/events/:id', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const idx = data.calendarEvents.findIndex(e => String(e.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });
  const existing = data.calendarEvents[idx];

  if (!inScope(mScope, existing.unitId)){
    return res.status(403).json({ error: 'You do not have permission to edit this event' });
  }
  const nextUnitId = req.body.unitId !== undefined ? req.body.unitId : existing.unitId;
  if (!inScope(mScope, nextUnitId)){
    return res.status(403).json({ error: 'You do not have permission to move this event to that unit' });
  }

  const updated = { ...existing, ...req.body, unitId: Number(nextUnitId), id: existing.id };
  if (req.body.participantIds !== undefined){
    updated.participantIds = Array.isArray(req.body.participantIds) ? req.body.participantIds.map(Number) : [];
  }
  if (req.body.reminderDaysBefore !== undefined) updated.reminderDaysBefore = Number(req.body.reminderDaysBefore);
  // If the date or reminder window changed, allow the reminder to fire again.
  if (req.body.startDate !== undefined && req.body.startDate !== existing.startDate) updated.reminderSent = false;
  if (req.body.reminderDaysBefore !== undefined && Number(req.body.reminderDaysBefore) !== existing.reminderDaysBefore) updated.reminderSent = false;

  data.calendarEvents[idx] = updated;
  db.write(data);
  res.json(data.calendarEvents[idx]);
});

// DELETE /api/calendar/events/:id
router.delete('/events/:id', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const idx = data.calendarEvents.findIndex(e => String(e.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Event not found' });

  if (!inScope(mScope, data.calendarEvents[idx].unitId)){
    return res.status(403).json({ error: 'You do not have permission to delete this event' });
  }
  // Clean up any attached files on disk.
  (data.calendarEvents[idx].attachments || []).forEach(a => {
    fs.unlink(path.join(ATTACH_DIR, a.filename), () => {});
  });
  data.calendarEvents.splice(idx, 1);
  db.write(data);
  res.status(204).end();
});

// ---- Completion report ----
// Submitting a report marks the activity as completed. Requires manage rights
// (matches who can edit the activity), consistent with "Logged by" ownership.
router.post('/events/:id/report', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!inScope(mScope, event.unitId)) return res.status(403).json({ error: 'You do not have permission to report on this activity' });
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Report text is required' });

  event.report = { text, submittedBy: user.id, submittedByName: user.name, submittedAt: new Date().toISOString() };
  db.write(data);
  res.json({ ...event, status: computeStatus(event) });
});

// ---- Comments ----
// Anyone who can see an event (view scope) can discuss it.
router.post('/events/:id/comments', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const vScope = viewScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event || !inScope(vScope, event.unitId)) return res.status(404).json({ error: 'Event not found' });
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment text is required' });

  const comment = { id: db.nextId(event.comments || []), authorId: user.id, authorName: user.name, text, date: new Date().toISOString() };
  event.comments = event.comments || [];
  event.comments.push(comment);
  db.write(data);
  res.status(201).json(comment);
});

router.delete('/events/:id/comments/:commentId', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const comment = (event.comments || []).find(c => String(c.id) === String(req.params.commentId));
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  const canModerate = comment.authorId === user.id || inScope(mScope, event.unitId);
  if (!canModerate) return res.status(403).json({ error: 'You can only delete your own comments' });

  event.comments = event.comments.filter(c => String(c.id) !== String(req.params.commentId));
  db.write(data);
  res.status(204).end();
});

// ---- Attachments ----
router.post('/events/:id/attachments', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const vScope = viewScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event || !inScope(vScope, event.unitId)) return res.status(404).json({ error: 'Event not found' });

  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });
    const attachment = {
      id: db.nextId(event.attachments || []),
      name: req.file.originalname,
      filename: req.file.filename,
      uploadedBy: user.id,
      uploadedByName: user.name,
      date: new Date().toISOString()
    };
    const fresh = db.read(); // re-read in case of concurrent writes during upload
    const freshEvent = fresh.calendarEvents.find(e => String(e.id) === String(req.params.id));
    freshEvent.attachments = freshEvent.attachments || [];
    freshEvent.attachments.push(attachment);
    db.write(fresh);
    res.status(201).json(attachment);
  });
});

router.delete('/events/:id/attachments/:attachmentId', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => String(e.id) === String(req.params.id));
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const attachment = (event.attachments || []).find(a => String(a.id) === String(req.params.attachmentId));
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
  const canModerate = attachment.uploadedBy === user.id || inScope(mScope, event.unitId);
  if (!canModerate) return res.status(403).json({ error: 'You can only remove your own attachments' });

  fs.unlink(path.join(ATTACH_DIR, attachment.filename), () => {});
  event.attachments = event.attachments.filter(a => String(a.id) !== String(req.params.attachmentId));
  db.write(data);
  res.status(204).end();
});

// Serves an attachment only if the requester has visibility into its event's unit.
router.get('/attachments/:filename', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const vScope = viewScopeIds(data.units, user);
  const event = data.calendarEvents.find(e => (e.attachments || []).some(a => a.filename === req.params.filename));
  const attachment = event && event.attachments.find(a => a.filename === req.params.filename);
  if (!event || !attachment || !inScope(vScope, event.unitId)){
    return res.status(404).json({ error: 'Attachment not found' });
  }
  res.download(path.join(ATTACH_DIR, attachment.filename), attachment.name);
});

module.exports = router;
