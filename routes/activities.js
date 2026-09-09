const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { requireLogin, effectivePrivilege } = require('../middleware/auth');
const { findConflicts } = require('../utils/conflicts');
const { getActivityStatus, todayISO } = require('../utils/status');
const { UNITS } = require('../utils/units');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Accept both the classic and modern Office formats under "DOC" / "PPT" / "PPTX".
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/msword',                                                       // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // .docx
  'application/vnd.ms-powerpoint',                                            // .ppt
  'application/vnd.openxmlformats-officedocument.presentationml.presentation' // .pptx
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, crypto.randomBytes(16).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 5 }, // 10MB per file, 5 files per activity
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, PNG, JPEG, DOC/DOCX, PPT/PPTX.'));
  }
});

function loadAllActivities() {
  const rows = db.prepare(`
    SELECT a.*, u.full_name AS created_by_name
    FROM activities a
    JOIN users u ON u.id = a.created_by
    ORDER BY a.start_date ASC
  `).all();

  const participantStmt = db.prepare(
    'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
  );
  const attachmentStmt = db.prepare(
    'SELECT id, original_name, mime_type, size FROM attachments WHERE activity_id = ? ORDER BY id'
  );
  const reportCountStmt = db.prepare(
    'SELECT COUNT(*) AS n FROM activity_reports WHERE activity_id = ?'
  );

  return rows.map((a) => ({
    ...a,
    participants: participantStmt.all(a.id).map((p) => p.participant_name),
    attachments: attachmentStmt.all(a.id),
    has_report: reportCountStmt.get(a.id).n > 0
  }));
}

// Scopes a set of *reports* (not activities) down to what a given session
// user is allowed to read, based on their privilege level. The shared
// calendar always shows every activity to everyone (see /api/activities
// below) - privilege only restricts who can read a report's contents:
//  - 'super' (or role === 'admin')  -> every report
//  - 'administration'               -> every report (all units)
//  - 'normal'                       -> only reports tagged with their own
//                                       unit, plus any report they wrote themselves
function scopeReportsForUser(reports, sessionUser) {
  const privilege = effectivePrivilege(sessionUser);
  if (privilege === 'super' || privilege === 'administration') return reports;

  const myUnit = String(sessionUser.unit || '').trim().toLowerCase();
  return reports.filter((r) => {
    if (r.created_by === sessionUser.id) return true;
    if (!myUnit) return false;
    return String(r.unit || '').trim().toLowerCase() === myUnit;
  });
}

// JSON feed used by the calendar dashboard, the timeline chart, and the reporting tab.
// The shared calendar/activity list is visible to everyone who's logged in -
// privilege only restricts who can read a given report's contents (see
// scopeReportsForUser, used wherever report text is actually rendered).
router.get('/api/activities', requireLogin, (req, res) => {
  const activities = loadAllActivities();
  res.json({ activities, conflicts: findConflicts(activities) });
});

// Every officer with an account — used to build the timeline chart's rows,
// including officers who have no activities yet this month.
router.get('/api/officers', requireLogin, (req, res) => {
  const officers = db.prepare('SELECT id, full_name FROM users ORDER BY full_name ASC').all();
  res.json({ officers });
});

router.post('/api/activities', requireLogin, (req, res, next) => {
  // If the current user is not allowed to upload, disallow file fields explicitly.
  if (!req.session.user || !req.session.user.can_upload) {
    // Use upload.none() which will error if files were sent; translate that to a clear 403 message.
    upload.none()(req, res, (err) => {
      if (err) return res.status(403).json({ error: 'Your account is not allowed to upload files.' });
      return next();
    });
    return;
  }

  upload.array('attachments', 5)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, (req, res) => {
  const { name, start_date, end_date, location, notes } = req.body;

  if (!name || !name.trim()) return res.status(400).json({ error: 'Activity name is required.' });
  if (!start_date || !end_date) return res.status(400).json({ error: 'Start and end dates are required.' });
  if (start_date > end_date) return res.status(400).json({ error: 'Start date must be on or before the end date.' });

  let participants = req.body.participants;
  if (typeof participants === 'string') {
    try { participants = JSON.parse(participants); } catch { participants = []; }
  }
  const participantList = Array.isArray(participants)
    ? participants.map((p) => String(p).trim()).filter(Boolean)
    : String(participants || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);

  const insertActivity = db.prepare(
    'INSERT INTO activities (name, start_date, end_date, location, notes, created_by, unit) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertParticipant = db.prepare(
    'INSERT INTO activity_participants (activity_id, participant_name) VALUES (?, ?)'
  );
  const insertAttachment = db.prepare(
    'INSERT INTO attachments (activity_id, original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    const info = insertActivity.run(
      name.trim(),
      start_date,
      end_date,
      (location || '').trim(),
      (notes || '').trim(),
      req.session.user.id,
      req.session.user.unit || null
    );
    participantList.forEach((p) => insertParticipant.run(info.lastInsertRowid, p));
    (req.files || []).forEach((f) => {
      insertAttachment.run(info.lastInsertRowid, f.originalname, f.filename, f.mimetype, f.size, req.session.user.id);
    });
    return info.lastInsertRowid;
  });

  const newId = run();
  res.status(201).json({ id: newId });
});

// Download a single attachment. Kept behind requireLogin (files live outside
// /public) so activity reports aren't reachable by a guessed/public URL.
router.get('/api/activities/:id/attachments/:attachmentId', requireLogin, (req, res) => {
  const att = db.prepare(
    'SELECT * FROM attachments WHERE id = ? AND activity_id = ?'
  ).get(req.params.attachmentId, req.params.id);
  if (!att) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, att.stored_name), att.original_name);
});

router.delete('/api/activities/:id', requireLogin, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) return res.status(404).json({ error: 'Not found' });

  // Only the officer who created it, or an admin, may delete it.
  if (activity.created_by !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'You can only delete activities you created.' });
  }

  const files = db.prepare('SELECT stored_name FROM attachments WHERE activity_id = ?').all(req.params.id);
  db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id); // cascades participants + attachment rows
  files.forEach((f) => fs.unlink(path.join(uploadDir, f.stored_name), () => {}));

  res.json({ ok: true });
});

function loadActivityReports(activityId) {
  const reports = db.prepare(`
    SELECT r.*, u.full_name AS created_by_name
    FROM activity_reports r
    JOIN users u ON u.id = r.created_by
    WHERE r.activity_id = ?
    ORDER BY r.created_at DESC
  `).all(activityId);

  const attachmentsStmt = db.prepare(
    'SELECT id, original_name FROM activity_report_attachments WHERE report_id = ? ORDER BY id'
  );

  return reports.map((r) => ({
    ...r,
    attachments: attachmentsStmt.all(r.id)
  }));
}

function loadSummaries(activityId) {
  return db.prepare('SELECT id, original_name, uploaded_at FROM summaries WHERE activity_id = ? ORDER BY id').all(activityId);
}

router.get('/activities/:id/edit', requireLogin, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That activity does not exist.',
      user: req.session.user
    });
  }

  if (activity.created_by !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You are not allowed to edit this activity.',
      user: req.session.user
    });
  }

  const participants = db.prepare(
    'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id).map((row) => row.participant_name);

  const attachments = db.prepare(
    'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id);

  const allReports = loadActivityReports(req.params.id);
  const reports = scopeReportsForUser(allReports, req.session.user);
  const summaries = loadSummaries(req.params.id);

  // Determine whether the activity is completed (end_date before today)
  const isCompleted = todayISO() > activity.end_date;
  const activityStatus = getActivityStatus(activity, allReports.length > 0);

  res.render('activity-edit', {
    user: req.session.user,
    activity,
    participants,
    attachments,
    reports,
    summaries,
    units: UNITS,
    activityStatus,
    activeTab: 'details',
    canEdit: true,
    isCompleted,
    error: null,
    success: null
  });
});

router.get('/activities/:id/report', requireLogin, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That activity does not exist.',
      user: req.session.user
    });
  }

  const participants = db.prepare(
    'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id).map((row) => row.participant_name);

  const attachments = db.prepare(
    'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id);

  const allReports = loadActivityReports(req.params.id);
  const reports = scopeReportsForUser(allReports, req.session.user);
  const summaries = loadSummaries(req.params.id);
  const isCompleted = todayISO() > activity.end_date;
  const activityStatus = getActivityStatus(activity, allReports.length > 0);

  res.render('activity-edit', {
    user: req.session.user,
    activity,
    participants,
    attachments,
    reports,
    summaries,
    units: UNITS,
    activityStatus,
    activeTab: 'report',
    canEdit: activity.created_by === req.session.user.id || req.session.user.role === 'admin',
    isCompleted,
    error: null,
    success: null
  });
});

router.post('/activities/:id/report', requireLogin, (req, res, next) => {
  if (!req.session.user || !req.session.user.can_upload) {
    upload.none()(req, res, (err) => {
      if (err) return res.status(403).render('error', { title: 'Upload forbidden', message: 'Your account is not allowed to upload files.', user: req.session.user });
      return next();
    });
    return;
  }

  upload.array('report_attachments', 5)(req, res, (err) => {
    if (err) return res.status(400).render('error', { title: 'Upload error', message: err.message, user: req.session.user });
    next();
  });
}, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That activity does not exist.',
      user: req.session.user
    });
  }

  const reportText = String(req.body.report_text || '').trim();
  const unit = String(req.body.unit || '').trim();
  if (!reportText) {
    const participants = db.prepare(
      'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
    ).all(req.params.id).map((row) => row.participant_name);
    const attachments = db.prepare(
      'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
    ).all(req.params.id);
    const allReports = loadActivityReports(req.params.id);
    const reports = scopeReportsForUser(allReports, req.session.user);

    const summaries = loadSummaries(req.params.id);
    const isCompleted = todayISO() > activity.end_date;
    const activityStatus = getActivityStatus(activity, allReports.length > 0);
    return res.status(400).render('activity-edit', {
      user: req.session.user,
      activity,
      participants,
      attachments,
      reports,
      summaries,
      units: UNITS,
      activityStatus,
      activeTab: 'report',
      canEdit: activity.created_by === req.session.user.id || req.session.user.role === 'admin',
      isCompleted,
      error: 'Report text is required.',
      success: null
    });
  }

  const insertReport = db.prepare(
    'INSERT INTO activity_reports (activity_id, report_text, created_by, unit) VALUES (?, ?, ?, ?)'
  );
  const insertAttachment = db.prepare(
    'INSERT INTO activity_report_attachments (report_id, original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const run = db.transaction(() => {
    const info = insertReport.run(req.params.id, reportText, req.session.user.id, unit || null);
    (req.files || []).forEach((f) => {
      insertAttachment.run(info.lastInsertRowid, f.originalname, f.filename, f.mimetype, f.size, req.session.user.id);
    });
    return info.lastInsertRowid;
  });

  run();

  const participants = db.prepare(
    'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id).map((row) => row.participant_name);
  const attachments = db.prepare(
    'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id);
  const allReports = loadActivityReports(req.params.id);
  const reports = scopeReportsForUser(allReports, req.session.user);

  const summaries = loadSummaries(req.params.id);
  const isCompleted = todayISO() > activity.end_date;
  const activityStatus = getActivityStatus(activity, allReports.length > 0);
  res.render('activity-edit', {
    user: req.session.user,
    activity,
    participants,
    attachments,
    reports,
    summaries,
    units: UNITS,
    activityStatus,
    activeTab: 'report',
    canEdit: activity.created_by === req.session.user.id || req.session.user.role === 'admin',
    isCompleted,
    error: null,
    success: 'Report submitted successfully.'
  });
});

router.get('/api/activities/:id/reports/:reportId/download', requireLogin, (req, res) => {
  const report = db.prepare(
    `SELECT r.* FROM activity_reports r
     WHERE r.id = ? AND r.activity_id = ?`
  ).get(req.params.reportId, req.params.id);
  if (!report) return res.status(404).json({ error: 'Not found' });

  if (req.session.user.role !== 'admin' && req.session.user.id !== report.created_by && !req.session.user.can_download_reports) {
    return res.status(403).render('error', { title: 'Access denied', message: 'You do not have permission to download this report.', user: req.session.user });
  }

  const attachments = db.prepare('SELECT id, original_name, stored_name FROM activity_report_attachments WHERE report_id = ? ORDER BY id').all(report.id);
  if (!attachments.length) {
    return res.status(404).render('error', { title: 'No attachments', message: 'This report has no downloadable files.', user: req.session.user });
  }

  const files = attachments.map((a) => ({
    path: path.join(uploadDir, a.stored_name),
    name: a.original_name
  }));

  if (files.length === 1) {
    return res.download(files[0].path, files[0].name);
  }

  const archivePath = path.join(uploadDir, `report-${report.id}-${Date.now()}.zip`);
  const { execFileSync } = require('child_process');
  const zipArgs = ['-r', archivePath, '.'];
  const zipCwd = uploadDir;
  const selectedFiles = files.map((f) => path.basename(f.path));
  if (selectedFiles.length) {
    execFileSync('zip', [...zipArgs, ...selectedFiles], { cwd: zipCwd });
    return res.download(archivePath, `${report.id}-report-attachments.zip`, () => {
      fs.unlinkSync(archivePath);
    });
  }
  return res.status(404).render('error', { title: 'No attachments', message: 'This report has no downloadable files.', user: req.session.user });
});

router.get('/api/activities/:id/reports/:reportId/attachments/:attachmentId', requireLogin, (req, res) => {
  const attachment = db.prepare(
    `SELECT ra.* FROM activity_report_attachments ra
     JOIN activity_reports r ON r.id = ra.report_id
     WHERE ra.id = ? AND ra.report_id = ? AND r.activity_id = ?`
  ).get(req.params.attachmentId, req.params.reportId, req.params.id);
  if (!attachment) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, attachment.stored_name), attachment.original_name);
});

router.post('/activities/:id/edit', requireLogin, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'That activity does not exist.',
      user: req.session.user
    });
  }

  if (activity.created_by !== req.session.user.id && req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'You are not allowed to edit this activity.',
      user: req.session.user
    });
  }

  const { name, start_date, end_date, location, notes, participants } = req.body;
  const trimmedName = String(name || '').trim();
  const trimmedLocation = String(location || '').trim();
  const trimmedNotes = String(notes || '').trim();
  const participantList = typeof participants === 'string'
    ? participants.split(',').map((p) => p.trim()).filter(Boolean)
    : [];

  const inlineRender = (errorMessage) => {
    const attachments = db.prepare(
      'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
    ).all(req.params.id);
    const allReports = loadActivityReports(req.params.id);
    const reports = scopeReportsForUser(allReports, req.session.user);
    const summaries = loadSummaries(req.params.id);
    const mergedActivity = { ...activity, name: trimmedName, start_date, end_date, location: trimmedLocation, notes: trimmedNotes };
    const isCompleted = todayISO() > (end_date || activity.end_date);
    const activityStatus = getActivityStatus(mergedActivity, allReports.length > 0);
    return res.status(400).render('activity-edit', {
      user: req.session.user,
      activity: mergedActivity,
      participants: participantList,
      attachments,
      reports,
      summaries,
      units: UNITS,
      activityStatus,
      activeTab: 'details',
      canEdit: true,
      isCompleted,
      error: errorMessage,
      success: null
    });
  };

  if (!trimmedName) return inlineRender('Activity name is required.');
  if (!start_date || !end_date) return inlineRender('Start and end dates are required.');
  if (start_date > end_date) return inlineRender('Start date must be on or before the end date.');

  const update = db.prepare(
    'UPDATE activities SET name = ?, start_date = ?, end_date = ?, location = ?, notes = ? WHERE id = ?'
  );
  update.run(trimmedName, start_date, end_date, trimmedLocation, trimmedNotes, req.params.id);

  const deleteParticipants = db.prepare('DELETE FROM activity_participants WHERE activity_id = ?');
  const insertParticipant = db.prepare('INSERT INTO activity_participants (activity_id, participant_name) VALUES (?, ?)');

  db.transaction(() => {
    deleteParticipants.run(req.params.id);
    participantList.forEach((participant) => insertParticipant.run(req.params.id, participant));
  })();

  const refreshedActivity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  const refreshedParticipants = db.prepare(
    'SELECT participant_name FROM activity_participants WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id).map((row) => row.participant_name);
  const refreshedAttachments = db.prepare(
    'SELECT id, original_name FROM attachments WHERE activity_id = ? ORDER BY id'
  ).all(req.params.id);
  const allRefreshedReports = loadActivityReports(req.params.id);
  const refreshedReports = scopeReportsForUser(allRefreshedReports, req.session.user);

  const summaries = loadSummaries(req.params.id);
  const isCompleted = todayISO() > refreshedActivity.end_date;
  const activityStatus = getActivityStatus(refreshedActivity, allRefreshedReports.length > 0);
  res.render('activity-edit', {
    user: req.session.user,
    activity: refreshedActivity,
    participants: refreshedParticipants,
    attachments: refreshedAttachments,
    reports: refreshedReports,
    summaries,
    units: UNITS,
    activityStatus,
    activeTab: 'details',
    canEdit: true,
    isCompleted,
    error: null,
    success: 'Activity updated successfully.'
  });
});

// Page routes
router.get('/', requireLogin, (req, res) => {
  res.render('dashboard', { user: req.session.user });
});

router.get('/activities', requireLogin, (req, res) => {
  res.render('activities', { user: req.session.user });
});

// Download a summary
router.get('/api/activities/:id/summaries/:summaryId', requireLogin, (req, res) => {
  const s = db.prepare('SELECT * FROM summaries WHERE id = ? AND activity_id = ?').get(req.params.summaryId, req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(uploadDir, s.stored_name), s.original_name);
});

// Upload a summary (allowed only after activity end_date and if user can_upload)
router.post('/activities/:id/summary', requireLogin, (req, res, next) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!activity) return res.status(404).render('error', { title: 'Not found', message: 'That activity does not exist.', user: req.session.user });

  // Only allow if activity has completed
  const isCompleted = todayISO() > activity.end_date;
  if (!isCompleted && req.session.user.role !== 'admin') {
    return res.status(403).render('error', { title: 'Not allowed', message: 'Summaries may only be uploaded after the activity is completed.', user: req.session.user });
  }

  if (!req.session.user || !req.session.user.can_upload) {
    upload.none()(req, res, (err) => {
      if (err) return res.status(403).render('error', { title: 'Upload forbidden', message: 'Your account is not allowed to upload files.', user: req.session.user });
      return res.redirect(`/activities/${req.params.id}/edit`);
    });
    return;
  }

  upload.single('summary')(req, res, (err) => {
    if (err) return res.status(400).render('error', { title: 'Upload error', message: err.message, user: req.session.user });
    next();
  });
}, (req, res) => {
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  const isCompleted = todayISO() > activity.end_date;

  const unit = String(req.body.unit || '').trim();
  const insert = db.prepare('INSERT INTO summaries (activity_id, original_name, stored_name, mime_type, size, uploaded_by, unit) VALUES (?, ?, ?, ?, ?, ?, ?)');
  insert.run(req.params.id, req.file.originalname, req.file.filename, req.file.mimetype, req.file.size, req.session.user.id, unit || null);

  res.redirect(`/activities/${req.params.id}/edit`);
});

module.exports = router;
