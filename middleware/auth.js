const db = require('../db');

// A user's "online" if we've heard from their browser in the last 5 minutes.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
// Throttle last_seen_at writes so we're not hitting the DB on every request.
const SEEN_WRITE_THROTTLE_MS = 30 * 1000;

function requireLogin(req, res, next) {
  if (!req.session.user) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ error: 'Not logged in' });
    }
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.status(403).render('error', {
      title: 'Access denied',
      message: 'You need an administrator account to view this page.',
      user: req.session.user
    });
  }
  next();
}

// role='admin' always has full ('super') visibility, regardless of the
// privilege value stored on their account. Everyone else uses whatever
// privilege an admin has assigned them ('normal' by default).
function effectivePrivilege(sessionUser) {
  if (!sessionUser) return 'normal';
  if (sessionUser.role === 'admin') return 'super';
  return sessionUser.privilege || 'normal';
}

// Marks the signed-in user as "seen just now" so the admin panel's online
// indicator stays accurate. Writes are throttled per-session to keep this cheap.
const updateLastSeen = db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?');
function trackActivity(req, res, next) {
  if (req.session && req.session.user) {
    const now = Date.now();
    if (!req.session.lastSeenWriteAt || now - req.session.lastSeenWriteAt > SEEN_WRITE_THROTTLE_MS) {
      req.session.lastSeenWriteAt = now;
      try {
        updateLastSeen.run(new Date().toISOString(), req.session.user.id);
      } catch (err) {
        console.error('trackActivity: failed to update last_seen_at', err);
      }
    }
  }
  next();
}

function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

module.exports = { requireLogin, requireAdmin, effectivePrivilege, trackActivity, isOnline, ONLINE_WINDOW_MS };
