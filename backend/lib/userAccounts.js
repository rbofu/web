const bcrypt = require('bcryptjs');
const db = require('../db');

function sanitize(user){
  const { passwordHash, ...safe } = user;
  return safe;
}

function isOnline(user){
  if (!user.lastSeenAt) return false;
  return (Date.now() - new Date(user.lastSeenAt).getTime()) < 5 * 60 * 1000;
}

function listAccounts(){
  const data = db.read();
  return data.users.map(u => ({ ...sanitize(u), online: isOnline(u) }));
}

function createAccount(body){
  const data = db.read();
  const { name, username, password, role, unitId, visibilityUnitId, email, mobile, education } = body || {};
  if (!name || !username || !password || !role || !unitId){
    return { error: 'name, username, password, role and unitId are required' };
  }
  if (data.users.some(u => u.username === username)){
    return { error: 'That username is already taken' };
  }
  const user = {
    id: db.nextId(data.users),
    name, username, role,
    email: email || '', mobile: mobile || '', education: education || '',
    unitId: Number(unitId),
    visibilityUnitId: Number(visibilityUnitId || unitId),
    passwordHash: bcrypt.hashSync(password, 10),
    canUpload: true, canReport: true,
    loginCount: 0, lastLoginAt: null, lastSeenAt: null
  };
  data.users.push(user);
  db.write(data);
  return { user: sanitize(user) };
}

function updateAccount(id, body){
  const data = db.read();
  const idx = data.users.findIndex(u => String(u.id) === String(id));
  if (idx === -1) return { error: 'User not found', status: 404 };
  const { password, unitId, visibilityUnitId, ...rest } = body || {};
  const updated = { ...data.users[idx], ...rest };
  if (unitId !== undefined) updated.unitId = Number(unitId);
  if (visibilityUnitId !== undefined) updated.visibilityUnitId = Number(visibilityUnitId);
  if (password) updated.passwordHash = bcrypt.hashSync(password, 10);
  updated.id = data.users[idx].id;
  data.users[idx] = updated;
  db.write(data);
  return { user: sanitize(updated) };
}

function deleteAccount(id, actingUserId){
  const data = db.read();
  const idx = data.users.findIndex(u => String(u.id) === String(id));
  if (idx === -1) return { error: 'User not found', status: 404 };
  if (data.users[idx].id === actingUserId){
    return { error: 'You cannot remove the account you are currently logged in as' };
  }
  if (data.users[idx].role === 'admin' && data.users.filter(u => u.role === 'admin').length === 1){
    return { error: 'At least one administrator account must remain' };
  }
  data.users.splice(idx, 1);
  db.write(data);
  return { ok: true };
}

function touchLastSeen(userId){
  const data = db.read();
  const user = data.users.find(u => u.id === userId);
  if (!user) return;
  const now = Date.now();
  if (!user.lastSeenAt || now - new Date(user.lastSeenAt).getTime() > 60 * 1000){
    user.lastSeenAt = new Date().toISOString();
    db.write(data);
  }
}

function recordLogin(userId){
  const data = db.read();
  const user = data.users.find(u => u.id === userId);
  if (!user) return;
  user.loginCount = (user.loginCount || 0) + 1;
  user.lastLoginAt = new Date().toISOString();
  user.lastSeenAt = user.lastLoginAt;
  db.write(data);
}

module.exports = { sanitize, isOnline, listAccounts, createAccount, updateAccount, deleteAccount, touchLastSeen, recordLogin };
