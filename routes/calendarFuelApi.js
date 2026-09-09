// Driver Fuel Monitoring — logs one day's travel for a driver on a given task,
// computes distance (end km - start km) and fuel consumed (distance / 6 km-per-litre)
// server-side (never trusting client-computed numbers), and lets the frontend
// aggregate entries by task.
const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { getSubtreeIds } = require('../lib/orgTree');

router.use(requireLogin);

// Same view/manage scoping rules as the rest of the Programme Calendar:
// "view scope" = the caller's visibilityUnitId subtree, "manage scope" = their
// home unitId subtree. Admins are unrestricted (null = no filtering).
function viewScopeIds(units, user){
  if (user.role === 'admin') return null;
  return getSubtreeIds(units, user.visibilityUnitId);
}
function manageScopeIds(units, user){
  if (user.role === 'admin') return null;
  return getSubtreeIds(units, user.unitId);
}
function inScope(scopeIds, unitId){
  return scopeIds === null || scopeIds.includes(String(unitId));
}
function round2(n){ return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// GET /api/calendar/fuel — every fuel log entry within the caller's view scope
router.get('/', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const scope = viewScopeIds(data.units, user);
  const unitsById = Object.fromEntries(data.units.map(u => [String(u.id), u.name]));
  const logs = (data.fuelLogs || [])
    .filter(l => inScope(scope, l.unitId))
    .map(l => ({ ...l, unitName: unitsById[String(l.unitId)] || '—' }))
    .sort((a, b) => (a.task || '').localeCompare(b.task || '') || new Date(a.date) - new Date(b.date));
  res.json(logs);
});

// POST /api/calendar/fuel — add one day's travel log.
// The section is now a free-text field the officer types in (e.g. a specific
// sub-team or vehicle pool name that may not map 1:1 to the org chart) rather
// than a picker. Visibility/permission scoping still uses the org unit tree —
// every entry is automatically filed under the creator's own home unit, so a
// leader still sees fuel logs from every unit beneath theirs.
router.post('/', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const {
    task, driverName, sectionName, placesVisited, date,
    startKm, startPlace, endKm, endPlace
  } = req.body || {};

  if (!task || !String(task).trim()) return res.status(400).json({ error: 'Task / assignment name is required' });
  if (!driverName || !String(driverName).trim()) return res.status(400).json({ error: "Driver's name is required" });
  if (!sectionName || !String(sectionName).trim()) return res.status(400).json({ error: 'Name of section is required' });
  if (!date) return res.status(400).json({ error: 'Date is required' });

  const start = Number(startKm);
  const end = Number(endKm);
  if (startKm === '' || endKm === '' || !Number.isFinite(start) || !Number.isFinite(end)){
    return res.status(400).json({ error: 'Starting and ending kilometers must be numbers' });
  }
  if (start < 0 || end < 0) return res.status(400).json({ error: 'Kilometers cannot be negative' });
  if (end < start) return res.status(400).json({ error: 'Ending kilometer cannot be less than starting kilometer' });

  const distanceKm = round2(end - start);
  const fuelLiters = round2(distanceKm / 6); // 1 litre per 6 km, per the programme's fuel policy

  data.fuelLogs = data.fuelLogs || [];
  const entry = {
    id: db.nextId(data.fuelLogs),
    task: String(task).trim(),
    driverName: String(driverName).trim(),
    unitId: Number(user.unitId), // logged automatically for visibility scoping
    sectionName: String(sectionName).trim(),
    placesVisited: String(placesVisited || '').trim(),
    date,
    startKm: start,
    startPlace: String(startPlace || '').trim(),
    endKm: end,
    endPlace: String(endPlace || '').trim(),
    distanceKm,
    fuelLiters,
    createdBy: user.id,
    createdByName: user.name,
    createdAt: new Date().toISOString()
  };
  data.fuelLogs.push(entry);
  db.write(data);
  res.status(201).json(entry);
});

// DELETE /api/calendar/fuel/:id — the entry's creator, or anyone managing its section
router.delete('/:id', (req, res) => {
  const data = db.read();
  const user = req.session.user;
  const mScope = manageScopeIds(data.units, user);
  const logs = data.fuelLogs || [];
  const idx = logs.findIndex(l => String(l.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Fuel log entry not found' });
  const entry = logs[idx];
  const canDelete = entry.createdBy === user.id || inScope(mScope, entry.unitId);
  if (!canDelete) return res.status(403).json({ error: 'You do not have permission to delete this entry' });
  logs.splice(idx, 1);
  db.write(data);
  res.json({ ok: true });
});

module.exports = router;
