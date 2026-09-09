let vehicles = [];
let fuelLogs = [];

const KM_PER_LITER = 6;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function round1(n) { return Math.round(n * 10) / 10; }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

async function init() {
  wireTabs();
  wireVehicleModal();
  wireLogModal();
  wireLivePreview();
  await Promise.all([loadVehicles(), loadLogs()]);
}

// ---------------- Data loading ----------------

async function loadVehicles() {
  const res = await fetch('/api/vehicles');
  const data = res.ok ? await res.json() : { vehicles: [] };
  vehicles = data.vehicles || [];
  renderFleet();
  renderVehicleSelect();
  renderStatStrip();
  renderFleetAlerts();
}

async function loadLogs() {
  const res = await fetch('/api/fuel-logs');
  const data = res.ok ? await res.json() : { logs: [] };
  fuelLogs = data.logs || [];
  renderLogsTable();
  renderStatStrip();
}

// ---------------- Tabs ----------------

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const target = btn.dataset.tab;
      document.getElementById('fleetTab').hidden = target !== 'fleet';
      document.getElementById('logsTab').hidden = target !== 'logs';
    });
  });
}

// ---------------- Stat strip ----------------

function renderStatStrip() {
  const strip = document.getElementById('fuelStatStrip');
  const activeVehicles = vehicles.filter((v) => v.status === 'active').length;
  const dueCount = vehicles.filter((v) => v.docFlag !== 'ok').length;

  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const monthLogs = fuelLogs.filter((l) => (l.date || '').slice(0, 7) === thisMonth);
  const monthKm = monthLogs.reduce((sum, l) => sum + l.distance_km, 0);
  const monthFuel = monthLogs.reduce((sum, l) => sum + l.fuel_liters, 0);

  strip.innerHTML = `
    <div class="stat-pill"><strong>${vehicles.length}</strong>Vehicles registered</div>
    <div class="stat-pill"><strong>${activeVehicles}</strong>Active vehicles</div>
    <div class="stat-pill"><strong>${dueCount}</strong>Documents due / overdue</div>
    <div class="stat-pill"><strong>${round1(monthKm)} km</strong>Travelled this month</div>
    <div class="stat-pill"><strong>${round2(monthFuel)} L</strong>Fuel used this month</div>
  `;
}

function renderFleetAlerts() {
  const banner = document.getElementById('fleetAlertBanner');
  const flagged = vehicles.filter((v) => v.docFlag !== 'ok');
  if (!flagged.length) { banner.hidden = true; return; }
  banner.hidden = false;
  banner.innerHTML = '⚠ ' + flagged.map((v) => {
    const label = v.docFlag === 'overdue' ? 'document overdue' : 'document due within 30 days';
    return `<strong>${esc(v.plate_number)}</strong> (${label})`;
  }).join(' &nbsp;·&nbsp; ');
}

// ---------------- Fleet (vehicles) ----------------

const STATUS_LABEL = { active: 'Active', maintenance: 'In maintenance', inactive: 'Inactive' };
const STATUS_CLASS = { active: 'status-completed', maintenance: 'status-ongoing', inactive: 'status-upcoming' };
const DOC_LABEL = { ok: 'Documents current', due_soon: 'Document due soon', overdue: 'Document overdue' };
const DOC_CLASS = { ok: 'status-completed', due_soon: 'status-ongoing', overdue: 'status-awaiting_report' };

function renderFleet() {
  const grid = document.getElementById('fleetGrid');
  const empty = document.getElementById('fleetEmpty');
  if (!vehicles.length) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = vehicles.map((v) => {
    const canManage = window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.id === v.created_by);
    return `<div class="fleet-card">
      <div class="fleet-card-top">
        <div>
          <div class="fleet-plate">${esc(v.plate_number)}</div>
          <div class="fleet-model">${esc(v.make_model)}</div>
        </div>
        <span class="status-badge ${STATUS_CLASS[v.status]}">${STATUS_LABEL[v.status]}</span>
      </div>
      <div class="fleet-meta">
        <div>👤 ${esc(v.assigned_driver) || '—'}</div>
        <div>🏷️ ${esc(v.unit) || '—'}</div>
        <div>🧭 ${v.last_odometer_km != null ? round1(v.last_odometer_km) + ' km' : '—'}</div>
      </div>
      <div class="fleet-docs">
        <span class="status-badge ${DOC_CLASS[v.docFlag]}">${DOC_LABEL[v.docFlag]}</span>
        ${v.insurance_expiry ? `<span class="muted-sm">Insurance: ${esc(v.insurance_expiry)}</span>` : ''}
        ${v.inspection_expiry ? `<span class="muted-sm">Inspection: ${esc(v.inspection_expiry)}</span>` : ''}
      </div>
      <div class="fleet-totals">${v.totalTrips} trip${v.totalTrips === 1 ? '' : 's'} logged · ${v.totalKm} km · ${v.totalLiters} L fuel</div>
      ${v.notes ? `<div class="fleet-notes">${esc(v.notes)}</div>` : ''}
      ${canManage ? `<div class="row-actions fleet-actions">
        <a data-edit-vehicle="${v.id}">Edit</a>
        <a data-delete-vehicle="${v.id}" class="danger">Delete</a>
      </div>` : ''}
    </div>`;
  }).join('');

  grid.querySelectorAll('[data-edit-vehicle]').forEach((a) => a.addEventListener('click', () => openVehicleModal(Number(a.dataset.editVehicle))));
  grid.querySelectorAll('[data-delete-vehicle]').forEach((a) => a.addEventListener('click', async () => {
    if (!confirm('Delete this vehicle? Its logged fuel entries will be kept but unlinked.')) return;
    const res = await fetch(`/api/vehicles/${a.dataset.deleteVehicle}`, { method: 'DELETE' });
    if (res.ok) { await loadVehicles(); await loadLogs(); } else alert('Could not delete this vehicle.');
  }));
}

function renderVehicleSelect() {
  const sel = document.getElementById('lVehicle');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Not tracked —</option>' +
    vehicles.map((v) => `<option value="${v.id}">${esc(v.plate_number)} — ${esc(v.make_model)}</option>`).join('');
  sel.value = current;
}

function wireVehicleModal() {
  const overlay = document.getElementById('vehicleOverlay');
  const form = document.getElementById('vehicleForm');
  const errBox = document.getElementById('vehicleErr');

  document.getElementById('newVehicleBtn').addEventListener('click', () => openVehicleModal(null));
  document.getElementById('vehicleCloseX').addEventListener('click', () => overlay.classList.remove('show'));
  document.getElementById('vehicleCancelBtn').addEventListener('click', () => overlay.classList.remove('show'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;

    const payload = {
      plateNumber: document.getElementById('vPlate').value.trim(),
      makeModel: document.getElementById('vMakeModel').value.trim(),
      assignedDriver: document.getElementById('vDriver').value.trim(),
      unit: document.getElementById('vUnit').value,
      status: document.getElementById('vStatus').value,
      lastOdometerKm: document.getElementById('vOdometer').value,
      insuranceExpiry: document.getElementById('vInsurance').value,
      inspectionExpiry: document.getElementById('vInspection').value,
      serviceDueKm: document.getElementById('vServiceDue').value,
      notes: document.getElementById('vNotes').value.trim()
    };

    const id = document.getElementById('vId').value;
    const res = await fetch(id ? `/api/vehicles/${id}` : '/api/vehicles', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      overlay.classList.remove('show');
      await loadVehicles();
      await loadLogs();
    } else {
      const body = await res.json().catch(() => ({}));
      errBox.textContent = body.error || 'Could not save this vehicle.';
      errBox.hidden = false;
    }
  });
}

function openVehicleModal(id) {
  const overlay = document.getElementById('vehicleOverlay');
  const form = document.getElementById('vehicleForm');
  form.reset();
  document.getElementById('vehicleErr').hidden = true;
  document.getElementById('vId').value = id || '';
  overlay.querySelector('h3').textContent = id ? 'Edit vehicle' : 'Add vehicle';

  if (id) {
    const v = vehicles.find((x) => x.id === id);
    if (v) {
      document.getElementById('vPlate').value = v.plate_number;
      document.getElementById('vMakeModel').value = v.make_model;
      document.getElementById('vDriver').value = v.assigned_driver || '';
      document.getElementById('vUnit').value = v.unit || '';
      document.getElementById('vStatus').value = v.status;
      document.getElementById('vOdometer').value = v.last_odometer_km != null ? v.last_odometer_km : '';
      document.getElementById('vInsurance').value = v.insurance_expiry || '';
      document.getElementById('vInspection').value = v.inspection_expiry || '';
      document.getElementById('vServiceDue').value = v.service_due_km != null ? v.service_due_km : '';
      document.getElementById('vNotes').value = v.notes || '';
    }
  }
  overlay.classList.add('show');
}

// ---------------- Fuel logs ----------------

function computePreview() {
  const startEl = document.getElementById('lStartKm');
  const endEl = document.getElementById('lEndKm');
  const box = document.getElementById('logPreview');
  if (startEl.value === '' || endEl.value === '') {
    box.innerHTML = 'Enter the starting and ending kilometers to see the distance and fuel used.';
    return;
  }
  const start = Number(startEl.value);
  const end = Number(endEl.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    box.innerHTML = '<span class="warn">Kilometer readings must be numbers.</span>';
    return;
  }
  if (end < start) {
    box.innerHTML = '<span class="warn">Ending kilometer cannot be less than starting kilometer.</span>';
    return;
  }
  const distance = round2(end - start);
  const fuel = round2(distance / KM_PER_LITER);
  box.innerHTML = `Distance covered: <strong>${distance} km</strong> &nbsp;·&nbsp; Fuel consumed (distance ÷ 6): <strong>${fuel} L</strong>`;
}

function wireLivePreview() {
  ['lStartKm', 'lEndKm'].forEach((id) => document.getElementById(id).addEventListener('input', computePreview));
}

function wireLogModal() {
  const overlay = document.getElementById('logOverlay');
  const form = document.getElementById('logForm');
  const errBox = document.getElementById('logErr');

  document.getElementById('newLogBtn').addEventListener('click', () => {
    form.reset();
    errBox.hidden = true;
    computePreview();
    overlay.classList.add('show');
  });
  document.getElementById('logCloseX').addEventListener('click', () => overlay.classList.remove('show'));
  document.getElementById('logCancelBtn').addEventListener('click', () => overlay.classList.remove('show'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.hidden = true;

    const payload = {
      task: document.getElementById('lTask').value.trim(),
      sectionName: document.getElementById('lSection').value.trim(),
      vehicleId: document.getElementById('lVehicle').value || null,
      driverName: document.getElementById('lDriver').value.trim(),
      date: document.getElementById('lDate').value,
      placesVisited: document.getElementById('lPlaces').value.trim(),
      startKm: document.getElementById('lStartKm').value,
      startPlace: document.getElementById('lStartPlace').value.trim(),
      endKm: document.getElementById('lEndKm').value,
      endPlace: document.getElementById('lEndPlace').value.trim()
    };

    const res = await fetch('/api/fuel-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      overlay.classList.remove('show');
      await loadLogs();
      await loadVehicles();
    } else {
      const body = await res.json().catch(() => ({}));
      errBox.textContent = body.error || 'Could not save this log entry.';
      errBox.hidden = false;
    }
  });
}

function renderLogsTable() {
  const wrap = document.getElementById('tableWrap');
  if (!fuelLogs.length) {
    wrap.innerHTML = '<p class="empty-state">No fuel logs recorded yet. Use "Log a day\'s travel" to add the first entry.</p>';
    return;
  }

  const groups = {};
  fuelLogs.forEach((l) => { (groups[l.task] = groups[l.task] || []).push(l); });

  let grandDistance = 0, grandFuel = 0;
  const taskNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  const sectionsHtml = taskNames.map((task) => {
    const rows = [...groups[task]].sort((a, b) => new Date(a.date) - new Date(b.date));
    let taskDistance = 0, taskFuel = 0;

    const rowsHtml = rows.map((l) => {
      taskDistance += l.distance_km;
      taskFuel += l.fuel_liters;
      const canDelete = window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.id === l.created_by);
      return `<tr>
        <td>${esc(l.date)}</td>
        <td>${esc(l.driver_name)}</td>
        <td>${esc(l.section_name) || '—'}</td>
        <td>${esc(l.vehicle_plate) || '—'}</td>
        <td>${esc(l.places_visited) || '—'}</td>
        <td>${l.start_km} km<br><span class="muted-sm">${esc(l.start_place) || '—'}</span></td>
        <td>${l.end_km} km<br><span class="muted-sm">${esc(l.end_place) || '—'}</span></td>
        <td>${l.distance_km} km</td>
        <td>${l.fuel_liters} L</td>
        <td>${esc(l.created_by_name) || '—'}</td>
        <td class="row-actions">${canDelete ? `<a data-delete-log="${l.id}" class="danger">Delete</a>` : ''}</td>
      </tr>`;
    }).join('');

    grandDistance += taskDistance;
    grandFuel += taskFuel;

    return `<div class="task-group">
      <div class="task-head">
        <h3>${esc(task)}</h3>
        <span class="task-total">${rows.length} day${rows.length === 1 ? '' : 's'} · Total ${round1(taskDistance)} km · ${round2(taskFuel)} L fuel</span>
      </div>
      <table>
        <thead><tr>
          <th>Date</th><th>Driver</th><th>Section</th><th>Vehicle</th><th>Places Visited</th>
          <th>Start</th><th>End</th><th>Distance</th><th>Fuel</th><th>Logged by</th><th></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join('');

  wrap.innerHTML = sectionsHtml + `<div class="grand-total">
    Grand total across all tasks: ${round1(grandDistance)} km travelled · ${round2(grandFuel)} L fuel consumed
  </div>`;

  wrap.querySelectorAll('[data-delete-log]').forEach((a) => a.addEventListener('click', async () => {
    if (!confirm('Delete this fuel log entry? This cannot be undone.')) return;
    const res = await fetch(`/api/fuel-logs/${a.dataset.deleteLog}`, { method: 'DELETE' });
    if (res.ok) { await loadLogs(); await loadVehicles(); } else alert('Could not delete this entry.');
  }));
}

init();
