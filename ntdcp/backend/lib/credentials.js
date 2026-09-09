const bcrypt = require('bcryptjs');
const db = require('../db');

// Verifies username/password against the Users collection.
// Returns a sanitized user object (no password hash) on success, or null.
function verifyCredentials(username, password){
  const data = db.read();
  const user = (data.users || []).find(u => u.username === username);
  if (!user) return null;
  if (!bcrypt.compareSync(password || '', user.passwordHash)) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function sanitizeUser(user){
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

module.exports = { verifyCredentials, sanitizeUser };
