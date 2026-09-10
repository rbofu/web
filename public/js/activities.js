function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function load() {
  const res = await fetch('/api/activities');
  if (!res.ok) return;
  const { activities, conflicts } = await res.json();
  renderBanner(conflicts);
  renderTable(activities, conflicts);
}

function renderBanner(conflicts) {
  const el = document.getElementById('conflictBanner');
  if (!conflicts.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<strong>${conflicts.length} scheduling conflict${conflicts.length > 1 ? 's' : ''}:</strong> ` +
    conflicts.map(c =>
      `${escapeHtml(c.participant)} is booked on both "${escapeHtml(c.a.name)}" and "${escapeHtml(c.b.name)}"`
    ).join(' · ');
}

function renderTable(activities, conflicts) {
  const flaggedIds = new Set();
  conflicts.forEach(c => { flaggedIds.add(c.a.id); flaggedIds.add(c.b.id); });

  const body = document.getElementById('activityTableBody');
  const empty = document.getElementById('emptyState');
  if (!activities.length) {
    body.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  body.innerHTML = activities.map(a => {
    const people = a.participants.map(p => `<span class="pchip-sm">${escapeHtml(p)}</span>`).join(' ');
    const attachments = a.attachments.length
      ? `${a.attachments.length} attachment${a.attachments.length > 1 ? 's' : ''}`
      : '<span class="hint">—</span>';
    const flagged = flaggedIds.has(a.id);
    const canEdit = window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.id === a.created_by);
    const canReport = Boolean(window.currentUser);
    return `<tr class="${flagged ? 'row-conflict' : ''}">
      <td>${escapeHtml(a.name)}${flagged ? ' <span class="flag" title="Scheduling conflict">⚠</span>' : ''}</td>
      <td>${a.start_date}</td>
      <td>${a.end_date}</td>
      <td>${statusBadgeHtml(a, a.has_report)}</td>
      <td>${escapeHtml(a.location || '') || '<span class="hint">—</span>'}</td>
      <td>${people || '<span class="hint">—</span>'}</td>
      <td>${attachments}</td>
      <td>${escapeHtml(a.created_by_name)}</td>
      <td>
        ${canEdit ? `<a class="link-btn" href="/activities/${a.id}/edit">Edit</a>` : ''}
        ${canEdit ? `<button class="link-btn danger" data-id="${a.id}">Delete</button>` : ''}
        ${canReport ? `<a class="link-btn" href="/activities/${a.id}/report">Report</a>` : ''}
      </td>
    </tr>`;
  }).join('');

  body.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this activity?')) return;
      await fetch(`/api/activities/${btn.dataset.id}`, { method: 'DELETE' });
      load();
    });
  });
}

load();
