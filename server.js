require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const authRoutes = require('./routes/auth');
const activityRoutes = require('./routes/activities');
const adminRoutes = require('./routes/admin');
const profileRoutes = require('./routes/profile');
const fuelRoutes = require('./routes/fuel');
const { trackActivity } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// Make the logged-in user available to every view without passing it manually.
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  // Ensure 'active' is always defined so header includes that omit it won't error.
  res.locals.active = '';
  next();
});

// Keep last_seen_at fresh for the admin panel's online-users indicator.
app.use(trackActivity);

// Request logger to help debug routing and session issues.
app.use((req, res, next) => {
  try {
    const userDesc = req.session && req.session.user ? `${req.session.user.username}(${req.session.user.id})` : 'anonymous';
    console.log(`[req] ${req.method} ${req.originalUrl} user=${userDesc}`);
  } catch (err) {
    console.log(`[req] ${req.method} ${req.originalUrl} user=<err>`);
  }
  next();
});

app.use('/', authRoutes);
app.use('/', profileRoutes);
app.use('/', activityRoutes);
app.use('/', adminRoutes);
app.use('/', fuelRoutes);

// Temporary debug route - lists registered routes and session info. Remove when done.
app.get('/__debug/routes', (req, res) => {
  const routes = [];
  (app._router && app._router.stack || []).forEach((layer) => {
    // express mounted routers have .name === 'router' and a .handle.stack
    if (layer.route && layer.route.path) {
      routes.push({ path: layer.route.path, methods: Object.keys(layer.route.methods).join(',').toUpperCase() });
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      layer.handle.stack.forEach((l) => {
        if (l.route && l.route.path) {
          routes.push({ path: l.route.path, methods: Object.keys(l.route.methods).join(',').toUpperCase() });
        }
      });
    }
  });
  res.json({ routes, sessionUser: req.session.user || null });
});

app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Page not found',
    message: 'That page does not exist.',
    user: req.session.user
  });
});

const ensureInitialAdmin = () => {
  const username = (process.env.ADMIN_USERNAME || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD || 'rama';
  const fullName = process.env.ADMIN_FULL_NAME || 'Program Administrator';

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    console.log(`Admin user "${username}" already exists.`);
    return;
  }

  const hash = bcrypt.hashSync(password, 10);
  db.prepare(
    'INSERT INTO users (username, full_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, fullName, hash, 'admin');

  console.log(`Auto-created initial admin user "${username}" with password "${password}"`);
};

ensureInitialAdmin();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Program calendar running at http://localhost:${PORT}`);
});
