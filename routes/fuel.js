const express = require('express');
const db = require('../db');
const { requireLogin } = require('../middleware/auth');
const { UNITS } = require('../utils/units');

const router = express.Router();

const KM_PER_LITER = 6; // 1 litre of fuel per 6 km travelled

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// --- Vehicles (car monitoring) -------------------------------------------

function loadVehicles() {
  const rows = db.prepare(`
    SELECT v.*, u.full_name AS created_by_name
    FROM vehicles v
    JOIN users u ON u.id = v.created_by
    ORDER BY v.plate_number ASC
  `).all();

  const totalsStmt = db.prepare(`
    SELECT COUNT(*) AS trips, COALESCE(SUM(distance_km),0) AS km, COALESCE(SUM(fuel_liters),0) AS liters
    FROM fuel_logs WHERE vehicle_id = ?
  `);

  const todayISO = new Date().toISOString().slice(0, 10);
  const soonISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return rows.map((v) => {
    const totals = totalsStmt.get(v.id);
    let docFlag = 'ok';
    const expiries = [v.insurance_expiry, v.inspection_expiry].filter(Boolean);
    if (expiries.some((d) => d < todayISO)) docFlag = 'overdue';
    else if (expiries.some((d) => d <= soonISO)) docFlag = 'due_soon';

    return {
      ...v,
      totalTrips: totals.trips,
      totalKm: round2(totals.km),
      totalLiters: round2(totals.liters),
      docFlag
    };
  });
}

router.get('/api/vehicles', requireLogin, (req, res) => {
  res.json({ vehicles: loadVehicles(), units: UNITS });
});

router.post('/api/vehicles', requireLogin, (req, res) => {
  const plateNumber = String(req.body.plateNumber || '').trim();
  const makeModel = String(req.body.makeModel || '').trim();
  if (!plateNumber) return res.status(400).json({ error: 'Plate number is required.' });
  if (!makeModel) return res.status(400).json({ error: 'Make / model is required.' });

  const status = ['active', 'maintenance', 'inactive'].includes(req.body.status) ? req.body.status : 'active';
  const lastOdometerKm = req.body.lastOdometerKm !== '' && req.body.lastOdometerKm != null
    ? Number(req.body.lastOdometerKm) : null;
  const serviceDueKm = req.body.serviceDueKm !== '' && req.body.serviceDueKm != null
    ? Number(req.body.serviceDueKm) : null;

  const info = db.prepare(`
    INSERT INTO vehicles (plate_number, make_model, unit, assigned_driver, status, last_odometer_km,
      insurance_expiry, inspection_expiry, service_due_km, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    plateNumber,
    makeModel,
    String(req.body.unit || '').trim() || null,
    String(req.body.assignedDriver || '').trim() || null,
    status,
    Number.isFinite(lastOdometerKm) ? lastOdometerKm : null,
    String(req.body.insuranceExpiry || '').trim() || null,
    String(req.body.inspectionExpiry || '').trim() || null,
    Number.isFinite(serviceDueKm) ? serviceDueKm : null,
    String(req.body.notes || '').trim() || null,
    req.session.user.id
  );

  res.status(201).json({ id: info.lastInsertRowid });
});

router.put('/api/vehicles/:id', requireLogin, (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
  if (req.session.user.role !== 'admin' && vehicle.created_by !== req.session.user.id) {
    return res.status(403).json({ error: 'You are not allowed to edit this vehicle.' });
  }

  const plateNumber = String(req.body.plateNumber || '').trim();
  const makeModel = String(req.body.makeModel || '').trim();
  if (!plateNumber) return res.status(400).json({ error: 'Plate number is required.' });
  if (!makeModel) return res.status(400).json({ error: 'Make / model is required.' });

  const status = ['active', 'maintenance', 'inactive'].includes(req.body.status) ? req.body.status : vehicle.status;
  const lastOdometerKm = req.body.lastOdometerKm !== '' && req.body.lastOdometerKm != null
    ? Number(req.body.lastOdometerKm) : null;
  const serviceDueKm = req.body.serviceDueKm !== '' && req.body.serviceDueKm != null
    ? Number(req.body.serviceDueKm) : null;

  db.prepare(`
    UPDATE vehicles SET plate_number = ?, make_model = ?, unit = ?, assigned_driver = ?, status = ?,
      last_odometer_km = ?, insurance_expiry = ?, inspection_expiry = ?, service_due_km = ?, notes = ?
    WHERE id = ?
  `).run(
    plateNumber,
    makeModel,
    String(req.body.unit || '').trim() || null,
    String(req.body.assignedDriver || '').trim() || null,
    status,
    Number.isFinite(lastOdometerKm) ? lastOdometerKm : null,
    String(req.body.insuranceExpiry || '').trim() || null,
    String(req.body.inspectionExpiry || '').trim() || null,
    Number.isFinite(serviceDueKm) ? serviceDueKm : null,
    String(req.body.notes || '').trim() || null,
    req.params.id
  );

  res.json({ ok: true });
});

router.delete('/api/vehicles/:id', requireLogin, (req, res) => {
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
  if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
  if (req.session.user.role !== 'admin' && vehicle.created_by !== req.session.user.id) {
    return res.status(403).json({ error: 'You are not allowed to delete this vehicle.' });
  }
  db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Fuel logs -------------------------------------------------------------

router.get('/api/fuel-logs', requireLogin, (req, res) => {
  const rows = db.prepare(`
    SELECT f.*, u.full_name AS created_by_name, v.plate_number AS vehicle_plate
    FROM fuel_logs f
    JOIN users u ON u.id = f.created_by
    LEFT JOIN vehicles v ON v.id = f.vehicle_id
    ORDER BY f.date ASC, f.id ASC
  `).all();
  res.json({ logs: rows });
});

router.post('/api/fuel-logs', requireLogin, (req, res) => {
  const task = String(req.body.task || '').trim();
  const driverName = String(req.body.driverName || '').trim();
  const date = String(req.body.date || '').trim();
  const startKm = Number(req.body.startKm);
  const endKm = Number(req.body.endKm);

  if (!task) return res.status(400).json({ error: 'Task / assignment is required.' });
  if (!driverName) return res.status(400).json({ error: 'Driver name is required.' });
  if (!date) return res.status(400).json({ error: 'Date is required.' });
  if (!Number.isFinite(startKm) || !Number.isFinite(endKm)) {
    return res.status(400).json({ error: 'Starting and ending kilometers must be numbers.' });
  }
  if (endKm < startKm) {
    return res.status(400).json({ error: 'Ending kilometer cannot be less than starting kilometer.' });
  }

  const distanceKm = round2(endKm - startKm);
  const fuelLiters = round2(distanceKm / KM_PER_LITER);

  const vehicleId = req.body.vehicleId ? Number(req.body.vehicleId) : null;

  const info = db.prepare(`
    INSERT INTO fuel_logs (task, section_name, vehicle_id, driver_name, date, places_visited,
      start_km, start_place, end_km, end_place, distance_km, fuel_liters, unit, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task,
    String(req.body.sectionName || '').trim() || null,
    Number.isFinite(vehicleId) ? vehicleId : null,
    driverName,
    date,
    String(req.body.placesVisited || '').trim() || null,
    startKm,
    String(req.body.startPlace || '').trim() || null,
    endKm,
    String(req.body.endPlace || '').trim() || null,
    distanceKm,
    fuelLiters,
    req.session.user.unit || null,
    req.session.user.id
  );

  // Keep the vehicle's odometer reading current, so the fleet view reflects
  // the latest trip without a separate manual update.
  if (Number.isFinite(vehicleId)) {
    db.prepare('UPDATE vehicles SET last_odometer_km = ? WHERE id = ? AND (last_odometer_km IS NULL OR last_odometer_km < ?)')
      .run(endKm, vehicleId, endKm);
  }

  res.status(201).json({ id: info.lastInsertRowid, distanceKm, fuelLiters });
});

router.delete('/api/fuel-logs/:id', requireLogin, (req, res) => {
  const log = db.prepare('SELECT * FROM fuel_logs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Not found' });
  if (req.session.user.role !== 'admin' && log.created_by !== req.session.user.id) {
    return res.status(403).json({ error: 'You can only delete entries you logged.' });
  }
  db.prepare('DELETE FROM fuel_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// --- Page ---

router.get('/fuel', requireLogin, (req, res) => {
  res.render('fuel', { user: req.session.user, units: UNITS });
});

module.exports = router;
