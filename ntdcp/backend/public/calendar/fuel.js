const API = '/api/calendar/fuel';
let context = null;
let allLogs = [];

async function init(){
  context = await renderCalNav('fuel');
  if (!context) return;
  wireForm();
  wireLivePreview();
  await loadLogs();
}

async function loadLogs(){
  const res = await fetch(API);
  allLogs = res.ok ? await res.json() : [];
  renderTable();
}

// ---- Live distance / fuel preview as the driver's km readings are typed ----
function round1(n){ return Math.round(n * 10) / 10; }
function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }

function computePreview(){
  const startEl = document.getElementById('f_startKm');
  const endEl = document.getElementById('f_endKm');
  const box = document.getElementById('previewBox');
  if (startEl.value === '' || endEl.value === ''){
    box.innerHTML = 'Enter the starting and ending kilometers to see the distance and fuel used.';
    return;
  }
  const start = Number(startEl.value);
  const end = Number(endEl.value);
  if (!Number.isFinite(start) || !Number.isFinite(end)){
    box.innerHTML = '<span class="warn">Kilometer readings must be numbers.</span>';
    return;
  }
  if (end < start){
    box.innerHTML = '<span class="warn">Ending kilometer cannot be less than starting kilometer.</span>';
    return;
  }
  const distance = round2(end - start);
  const fuel = round2(distance / 6);
  box.innerHTML = `Distance covered: <strong>${distance} km</strong> &nbsp;·&nbsp; Fuel consumed (distance ÷ 6): <strong>${fuel} L</strong>`;
}

function wireLivePreview(){
  ['f_startKm', 'f_endKm'].forEach(id => document.getElementById(id).addEventListener('input', computePreview));
}

function wireForm(){
  document.getElementById('fuelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('formError');
    errBox.textContent = '';

    const payload = {
      task: document.getElementById('f_task').value.trim(),
      sectionName: document.getElementById('f_section').value.trim(),
      driverName: document.getElementById('f_driver').value.trim(),
      date: document.getElementById('f_date').value,
      placesVisited: document.getElementById('f_places').value.trim(),
      startKm: document.getElementById('f_startKm').value,
      startPlace: document.getElementById('f_startPlace').value.trim(),
      endKm: document.getElementById('f_endKm').value,
      endPlace: document.getElementById('f_endPlace').value.trim(),
    };

    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok){
      e.target.reset();
      computePreview();
      await loadLogs();
    } else {
      const body = await res.json().catch(() => ({}));
      errBox.textContent = body.error || 'Could not save this log entry.';
    }
  });
}

// ---- Task-grouped table with per-task and grand-total aggregation ----
function renderTable(){
  const wrap = document.getElementById('tableWrap');
  if (!allLogs.length){
    wrap.innerHTML = '<p class="empty">No fuel logs recorded yet. Use the form above to add the first entry.</p>';
    return;
  }

  const canManageIds = new Set(context.manageUnits.map(u => String(u.id)));
  const groups = {};
  allLogs.forEach(l => { (groups[l.task] = groups[l.task] || []).push(l); });

  let grandDistance = 0, grandFuel = 0;
  const taskNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));

  const sectionsHtml = taskNames.map(task => {
    const rows = [...groups[task]].sort((a, b) => new Date(a.date) - new Date(b.date));
    let taskDistance = 0, taskFuel = 0;

    const rowsHtml = rows.map(l => {
      taskDistance += l.distanceKm;
      taskFuel += l.fuelLiters;
      const canDelete = canManageIds.has(String(l.unitId)) || l.createdBy === context.user.id;
      return `<tr>
        <td>${esc(l.date)}</td>
        <td>${esc(l.driverName)}</td>
        <td>${esc(l.sectionName || l.unitName || '—')}</td>
        <td>${esc(l.placesVisited) || '—'}</td>
        <td>${l.startKm} km<br><span class="muted-sm">${esc(l.startPlace) || '—'}</span></td>
        <td>${l.endKm} km<br><span class="muted-sm">${esc(l.endPlace) || '—'}</span></td>
        <td>${l.distanceKm} km</td>
        <td>${l.fuelLiters} L</td>
        <td>${esc(l.createdByName || '—')}</td>
        <td class="row-actions">${canDelete ? `<a data-delete="${l.id}" class="danger">Delete</a>` : ''}</td>
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
          <th>Date</th><th>Driver</th><th>Section</th><th>Places Visited</th>
          <th>Start</th><th>End</th><th>Distance</th><th>Fuel</th><th>Logged by</th><th></th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>`;
  }).join('');

  wrap.innerHTML = sectionsHtml + `<div class="grand-total">
    Grand total across all tasks: ${round1(grandDistance)} km travelled · ${round2(grandFuel)} L fuel consumed
  </div>`;

  wrap.querySelectorAll('[data-delete]').forEach(a => a.addEventListener('click', async () => {
    if (!confirm('Delete this fuel log entry? This cannot be undone.')) return;
    const res = await fetch(`${API}/${a.dataset.delete}`, { method: 'DELETE' });
    if (res.ok) loadLogs(); else alert('Could not delete this entry.');
  }));
}

init();
