const API = '/api/calendar';
let allEvents = [];
let manageUnitIds = new Set();
let currentUser = null;
let reportingEventId = null;

async function init(){
  const context = await renderCalNav('reporting');
  if (!context) return;
  currentUser = context.user;
  manageUnitIds = new Set(context.manageUnits.map(u => String(u.id)));

  const res = await fetch(`${API}/events`);
  allEvents = res.ok ? await res.json() : [];

  const conflicts = findConflicts(allEvents);
  renderConflictBanner(document.getElementById('conflictBanner'), conflicts);
  const conflictedTitles = new Set();
  conflicts.forEach(c => { conflictedTitles.add(c.eventA); conflictedTitles.add(c.eventB); });

  renderTable(conflictedTitles);
}

function statusBadge(status){
  const map = {
    upcoming: ['status-upcoming', 'UPCOMING'],
    ongoing: ['status-ongoing', 'ONGOING'],
    awaiting_report: ['status-awaiting', 'AWAITING REPORT'],
    completed: ['status-completed', 'COMPLETED'],
  };
  const [cls, label] = map[status] || map.upcoming;
  return `<span class="status-badge ${cls}">${label}</span>`;
}

function renderTable(conflictedTitles){
  const wrap = document.getElementById('tableWrap');
  if (!allEvents.length){ wrap.innerHTML = '<p class="empty">No activities logged yet.</p>'; return; }

  const sorted = [...allEvents].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  wrap.innerHTML = `<table>
    <thead><tr>
      <th>Activity</th><th>Start</th><th>End</th><th>Status</th><th>Location</th>
      <th>Participants</th><th>Attachments</th><th>Unit</th><th></th>
    </tr></thead>
    <tbody>
      ${sorted.map(e => {
        const isConflict = conflictedTitles.has(e.title);
        const canManage = manageUnitIds.has(String(e.unitId));
        return `<tr class="${isConflict ? 'conflict-row' : ''}">
          <td>${esc(e.title)} ${isConflict ? '<span class="warn" title="Scheduling conflict">⚠</span>' : ''}</td>
          <td>${e.startDate}</td>
          <td>${e.endDate}</td>
          <td>${statusBadge(e.status)}</td>
          <td>${esc(e.location || '—')}</td>
          <td>${(e.participants || []).map(p => `<span class="chip" style="background:${colorForOfficer(p.id)}">${esc(p.name)}</span>`).join('') || '—'}</td>
          <td>${(e.attachments || []).length || '—'}</td>
          <td>${esc(e.unitName)}</td>
          <td class="row-actions">
            ${canManage ? `<a data-report="${e.id}">Report</a><a data-delete="${e.id}" class="danger">Delete</a>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('[data-report]').forEach(a => a.addEventListener('click', () => openReportModal(a.dataset.report)));
  wrap.querySelectorAll('[data-delete]').forEach(a => a.addEventListener('click', async () => {
    if (!confirm('Delete this activity? This cannot be undone.')) return;
    const res = await fetch(`${API}/events/${a.dataset.delete}`, { method: 'DELETE' });
    if (res.ok) init(); else alert('Could not delete this activity.');
  }));
}

function openReportModal(eventId){
  reportingEventId = eventId;
  const ev = allEvents.find(e => String(e.id) === String(eventId));
  document.getElementById('reportModalTitle').textContent = `Completion report — ${ev.title}`;
  document.getElementById('reportText').value = ev.report ? ev.report.text : '';
  document.getElementById('reportModalBg').classList.add('show');
}
document.getElementById('reportCancelBtn').addEventListener('click', () => {
  document.getElementById('reportModalBg').classList.remove('show');
});
document.getElementById('reportSaveBtn').addEventListener('click', async () => {
  const text = document.getElementById('reportText').value.trim();
  if (!text) return;
  const res = await fetch(`${API}/events/${reportingEventId}/report`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
  });
  if (res.ok){
    document.getElementById('reportModalBg').classList.remove('show');
    init();
  } else {
    alert('Could not save this report.');
  }
});

init();
