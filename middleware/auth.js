// Access levels:
//  - requireLogin:         any signed-in account — used by the calendar portal.
//  - requireAdmin:         signed-in AND role === 'admin' — used by the site content-management panel.
//  - requireCalendarAdmin: signed-in AND role === 'admin' — used by the calendar portal's own Admin tab
//                          (same check as requireAdmin, but redirects back into the calendar on failure).

function requireLogin(req, res, next){
  if (req.session && req.session.user){
    return next();
  }
  if (req.originalUrl.startsWith('/api/')){
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.redirect('/calendar/login');
}

function requireAdmin(req, res, next){
  if (req.session && req.session.user && req.session.user.role === 'admin'){
    return next();
  }
  if (req.originalUrl.startsWith('/api/')){
    return res.status(401).json({ error: 'Not authenticated as an administrator' });
  }
  return res.redirect('/admin/login');
}

function requireCalendarAdmin(req, res, next){
  if (req.session && req.session.user && req.session.user.role === 'admin'){
    return next();
  }
  return res.status(403).json({ error: 'Administrator access required' });
}

module.exports = { requireLogin, requireAdmin, requireCalendarAdmin };
