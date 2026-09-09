const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const { requireAdmin, requireLogin } = require('./middleware/auth');
const { checkAndSendReminders } = require('./lib/reminders');

const app = express();

app.use(express.json());
app.use(session({
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// ---- Public REST API (consumed by the public frontend) ----
app.use('/api', require('./routes/api'));

// ---- Site content-management admin (role: admin only) ----
app.use('/admin', require('./routes/adminAuth'));
app.use('/api/admin', require('./routes/adminApi'));
app.use('/api/admin', require('./routes/upload'));
app.use('/admin', requireAdmin, express.static(path.join(__dirname, 'public', 'admin')));
app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ---- Programme Calendar portal (any signed-in account, scoped by unit) ----
app.use('/calendar', require('./routes/calendarAuth'));
app.use('/api/calendar', require('./routes/calendarApi'));
app.use('/api/calendar/fuel', require('./routes/calendarFuelApi'));
app.use('/api/calendar/admin', require('./routes/calendarAdminApi'));
app.use('/calendar-images', requireLogin, express.static(path.join(__dirname, 'public', 'calendar-images')));
app.use('/calendar', requireLogin, express.static(path.join(__dirname, 'public', 'calendar')));
app.get('/calendar', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'calendar', 'index.html'));
});

// ---- Public frontend (static site) ----
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.sendFile(path.join(frontendDir, 'index.html')));

app.listen(config.PORT, () => {
  console.log(`NTDCP server running at http://localhost:${config.PORT}`);
  console.log(`Site admin:        http://localhost:${config.PORT}/admin (admin / ChangeMe123!)`);
  console.log(`Programme calendar: http://localhost:${config.PORT}/calendar (see README for demo logins)`);
});

// Activity reminder emails: check on startup, then every 15 minutes.
checkAndSendReminders().catch(err => console.error('Reminder check failed:', err.message));
setInterval(() => {
  checkAndSendReminders().catch(err => console.error('Reminder check failed:', err.message));
}, 15 * 60 * 1000);
