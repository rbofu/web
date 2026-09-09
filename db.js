const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const db = new Database(path.join(dataDir, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','officer')) DEFAULT 'officer',
    can_upload INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS activity_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    participant_name TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_activities_dates ON activities(start_date, end_date);
  CREATE INDEX IF NOT EXISTS idx_participants_activity ON activity_participants(activity_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_activity ON attachments(activity_id);
  CREATE TABLE IF NOT EXISTS activity_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    report_text TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS activity_report_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL REFERENCES activity_reports(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

 
// Lightweight migration: add "location" to activities if this DB predates it.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so check first.
const activityColumns = db.prepare('PRAGMA table_info(activities)').all().map((c) => c.name);
if (!activityColumns.includes('location')) {
  db.exec('ALTER TABLE activities ADD COLUMN location TEXT');
}

// Lightweight migration: add "can_upload" to users so admins can enable/disable uploads per account.
const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns.includes('can_upload')) {
  db.exec('ALTER TABLE users ADD COLUMN can_upload INTEGER NOT NULL DEFAULT 1');
}
if (!userColumns.includes('can_download_reports')) {
  db.exec('ALTER TABLE users ADD COLUMN can_download_reports INTEGER NOT NULL DEFAULT 0');
}

if (!activityColumns.includes('unit')) {
  db.exec('ALTER TABLE activities ADD COLUMN unit TEXT');
}

const reportColumns = db.prepare('PRAGMA table_info(activity_reports)').all().map((c) => c.name);
if (!reportColumns.includes('unit')) {
  db.exec('ALTER TABLE activity_reports ADD COLUMN unit TEXT');
}

const summaryColumns = db.prepare('PRAGMA table_info(summaries)').all().map((c) => c.name);
if (!summaryColumns.includes('unit')) {
  db.exec('ALTER TABLE summaries ADD COLUMN unit TEXT');
}

// --- Privilege levels, profile fields, and login/activity tracking ---
// 'privilege' is separate from 'role': role gates access to the Admin panel
// (account management); privilege controls how much report/activity data a
// signed-in user can see. See middleware/auth.js for how the two combine.
const userColumns2 = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userColumns2.includes('privilege')) {
  db.exec("ALTER TABLE users ADD COLUMN privilege TEXT NOT NULL DEFAULT 'normal'");
}
if (!userColumns2.includes('unit')) {
  db.exec('ALTER TABLE users ADD COLUMN unit TEXT');
}
if (!userColumns2.includes('mobile_number')) {
  db.exec('ALTER TABLE users ADD COLUMN mobile_number TEXT');
}
if (!userColumns2.includes('education_level')) {
  db.exec('ALTER TABLE users ADD COLUMN education_level TEXT');
}
if (!userColumns2.includes('email')) {
  db.exec('ALTER TABLE users ADD COLUMN email TEXT');
}
if (!userColumns2.includes('last_login_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
}
if (!userColumns2.includes('last_seen_at')) {
  db.exec('ALTER TABLE users ADD COLUMN last_seen_at TEXT');
}

// One row per successful login - powers the admin "login frequency" view.
db.exec(`
  CREATE TABLE IF NOT EXISTS login_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(user_id, logged_in_at);
`);

// --- Fuel & Fleet (car) monitoring ---
// "vehicles" is the fleet register (car monitoring): one row per vehicle,
// with the documents/servicing dates the admin panel flags as due/overdue.
// "fuel_logs" is one row per day of travel; entries sharing the same "task"
// text are grouped and totalled together in the UI.
db.exec(`
  CREATE TABLE IF NOT EXISTS vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plate_number TEXT NOT NULL,
    make_model TEXT NOT NULL,
    unit TEXT,
    assigned_driver TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive')),
    last_odometer_km REAL,
    insurance_expiry TEXT,
    inspection_expiry TEXT,
    service_due_km REAL,
    notes TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fuel_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task TEXT NOT NULL,
    section_name TEXT,
    vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
    driver_name TEXT NOT NULL,
    date TEXT NOT NULL,
    places_visited TEXT,
    start_km REAL NOT NULL,
    start_place TEXT,
    end_km REAL NOT NULL,
    end_place TEXT,
    distance_km REAL NOT NULL,
    fuel_liters REAL NOT NULL,
    unit TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_fuel_logs_task ON fuel_logs(task);
  CREATE INDEX IF NOT EXISTS idx_fuel_logs_vehicle ON fuel_logs(vehicle_id);
`);

module.exports = db;
