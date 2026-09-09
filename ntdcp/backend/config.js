// Server-wide configuration. Admin/staff credentials now live in the Users
// collection (data/db.json), managed via the admin panel's Users tab —
// this file only holds process-level settings.
module.exports = {
  SESSION_SECRET: process.env.SESSION_SECRET || 'ntdcp-dev-secret-change-in-production',
  PORT: process.env.PORT || 4000
};
