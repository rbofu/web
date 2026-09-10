let activities = [];
let conflicts = [];
let officers = [];
let current = new Date();
current.setDate(1);

const palette = ['#B5652E','#2B6B66','#5B5EA6','#A24E6A','#6B7A3A','#3E7CB1','#9B5B2D','#4C6B5A'];
function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}
function fmtISO(d) {
  // Local calendar date (no UTC conversion). Using toISOString() here was the
  // bug: it converts to UTC first, which silently shifts the date by one day
  // for any timezone ahead of UTC - making activity bars appear to start and
  // end a day later than the dates that were actually selected.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// activity ids that are part of at least one conflict, for quick lookup
function conflictedActivityIds() {
  const ids = new Set();
  conflicts.forEach(c => { ids.add(c.a.id); ids.add(c.b.id); });
  return ids;
}

function renderAttachments(a) {
  if (!a.attachments || !a.attachments.length) return '';
  return `<div class="attachments">${a.attachments.map(f =>
    `<a class="att-chip" href="/api/activities/${a.id}/attachments/${f.id}" target="_blank" rel="noopener">📎 ${escapeHtml(f.original_name)}</a>`
  ).join('')}</div>`;
}

async function loadActivities() {
  const res = await fetch('/api/activities');
  if (!res.ok) return;
  const data = await res.json();
  activities = data.activities;
  conflicts = data.conflicts;
  renderConflictBanner();
  render();
}

async function loadOfficers() {
  const res = await fetch('/api/officers');
  if (!res.ok) return;
  const data = await res.json();
  officers = data.officers;
}

function renderConflictBanner() {
  const el = document.getElementById('conflictBanner');
  if (!conflicts.length) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<strong>${conflicts.length} scheduling conflict${conflicts.length > 1 ? 's' : ''}:</strong> ` +
    conflicts.map(c =>
      `${escapeHtml(c.participant)} is booked on both "${escapeHtml(c.a.name)}" and "${escapeHtml(c.b.name)}"`
    ).join(' · ');
}

function render() {
  const year = current.getFullYear(), month = current.getMonth();
  document.getElementById('monthLabel').textContent =
    current.toLocaleString('default', { month: 'long', year: 'numeric' });
  document.getElementById('agendaTitle').textContent =
    current.toLocaleString('default', { month: 'long' }) + ' agenda';

  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const today = new Date();
  const conflictedIds = conflictedActivityIds();

  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const iso = fmtISO(d);
    const cell = document.createElement('div');
    cell.className = 'day' + (d.getMonth() !== month ? ' outside' : '') + (sameDay(d, today) ? ' today' : '');

    const dayActivities = activities.filter(a => a.start_date <= iso && iso <= a.end_date);
    let chipsHtml = '';
    dayActivities.slice(0, 3).forEach(a => {
      const bg = a.participants.length ? colorFor(a.participants[0]) : '#8A8577';
      const flagged = conflictedIds.has(a.id) ? ' chip-conflict' : '';
      const st = getActivityStatus(a, a.has_report);
      const blinkDot = st.blink ? '<span class="status-dot"></span>' : '';
      // include data-activity-id so chips can be clicked to edit (if permitted)
      chipsHtml += `<div class="chip${flagged}" data-activity-id="${a.id}" title="${escapeHtml(a.name)} — ${st.label}">${blinkDot}${escapeHtml(a.name)}</div>`;
    });
    if (dayActivities.length > 3) chipsHtml += `<div class="more">+${dayActivities.length - 3} more</div>`;

    cell.innerHTML = `<div class="num">${d.getDate()}</div><div class="chips">${chipsHtml}</div>`;
    grid.appendChild(cell);
  }

  const monthActivities = activities
    .filter(a => a.start_date <= fmtISO(new Date(year, month + 1, 0)) && a.end_date >= fmtISO(new Date(year, month, 1)))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  const agenda = document.getElementById('agendaList');
  if (!monthActivities.length) {
    agenda.innerHTML = '<div class="agenda-empty">No activities this month yet.</div>';
  } else {
    agenda.innerHTML = monthActivities.map(a => {
      const people = a.participants.map(p =>
        `<span class="pchip" style="background:${colorFor(p)}">${escapeHtml(p)}</span>`
      ).join('');
      const flagged = conflictedIds.has(a.id) ? ' ⚠' : '';
      return `<div class="agenda-item" data-activity-id="${a.id}">
        <div class="agenda-date">${a.start_date}${a.start_date !== a.end_date ? ' → ' + a.end_date : ''} ${statusBadgeHtml(a, a.has_report)}</div>
        <div class="agenda-title">${escapeHtml(a.name)}${flagged}</div>
        ${a.location ? `<div class="agenda-location">📍 ${escapeHtml(a.location)}</div>` : ''}
        <div class="people">${people}</div>
        ${renderAttachments(a)}
      </div>`;
    }).join('');
  }

  renderTimeline(year, month);
  renderStatStrip(monthActivities, conflictedIds);

  // Attach click handlers to activity chips and agenda items for editing
  attachActivityClickHandlers();
}

function renderStatStrip(monthActivities, conflictedIds) {
  const strip = document.getElementById('calStatStrip');
  if (!strip) return;
  const today = new Date();
  const todayIso = fmtISO(today);
  const ongoing = activities.filter(a => a.start_date <= todayIso && todayIso <= a.end_date).length;
  const upcoming = monthActivities.filter(a => a.start_date > todayIso).length;
  const flaggedThisMonth = monthActivities.filter(a => conflictedIds.has(a.id)).length;

  strip.innerHTML = `
    <div class="stat-pill"><strong>${monthActivities.length}</strong>Activities this month</div>
    <div class="stat-pill"><strong>${ongoing}</strong>Ongoing today</div>
    <div class="stat-pill"><strong>${upcoming}</strong>Upcoming this month</div>
    <div class="stat-pill"><strong>${flaggedThisMonth}</strong>Double-booking conflicts</div>
  `;
}

// --- Officer timeline / Gantt chart ---
function renderTimeline(year, month) {
  const head = document.getElementById('timelineHeadRow');
  const body = document.getElementById('timelineBody');
  if (!head || !body) return;

  document.getElementById('timelineMonthLabel').textContent =
    current.toLocaleString('default', { month: 'long', year: 'numeric' });

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const conflictedIds = conflictedActivityIds();

  head.innerHTML = '<th class="timeline-name-col">Officer</th>' +
    Array.from({ length: daysInMonth }, (_, i) => {
      const d = new Date(year, month, i + 1);
      const weekend = d.getDay() === 0 || d.getDay() === 6;
      return `<th class="${weekend ? 'timeline-weekend' : ''}">${i + 1}</th>`;
    }).join('');

  if (!officers.length) {
    body.innerHTML = '<tr><td class="timeline-name-col">No officer accounts yet.</td></tr>';
    return;
  }

  body.innerHTML = officers.map(o => {
    const rowColor = colorFor(o.full_name);
    const dayCells = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      const iso = fmtISO(date);
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;
      const matches = activities.filter(a =>
        a.start_date <= iso && iso <= a.end_date &&
        (a.participants || []).some(p => p.trim().toLowerCase() === o.full_name.trim().toLowerCase())
      );
      dayCells.push({
        isWeekend,
        activity: matches[0] || null,
        conflict: matches.length > 1 || matches.some(m => conflictedIds.has(m.id))
      });
    }

    // Merge consecutive days with the same activity into one spanning cell,
    // similar to a Gantt bar.
    let cellsHtml = '';
    let i = 0;
    while (i < dayCells.length) {
      const cell = dayCells[i];
      if (cell.activity) {
        let j = i;
        while (j + 1 < dayCells.length && dayCells[j + 1].activity && dayCells[j + 1].activity.id === cell.activity.id) {
          j++;
        }
        const span = j - i + 1;
        const conflictClass = dayCells.slice(i, j + 1).some(c => c.conflict) ? ' timeline-conflict' : '';
        cellsHtml += `<td class="timeline-bar${conflictClass}" colspan="${span}" style="background:${rowColor}" title="${escapeHtml(cell.activity.name)}${cell.activity.location ? ' — ' + escapeHtml(cell.activity.location) : ''}">${escapeHtml(cell.activity.name)}</td>`;
        i = j + 1;
      } else {
        cellsHtml += `<td class="${cell.isWeekend ? 'timeline-weekend' : ''}"></td>`;
        i++;
      }
    }

    return `<tr><th class="timeline-name-col">${escapeHtml(o.full_name)}</th>${cellsHtml}</tr>`;
  }).join('');
}

// --- New activity modal / edit modal ---
const overlay = document.getElementById('overlay');
const tagInput = document.getElementById('tagInput');
const fParticipant = document.getElementById('fParticipant');
let draftParticipants = [];
let editingActivityId = null; // null => creating new activity, otherwise editing existing


function openModal(activity) {
  // If an activity object is provided, prefill for editing, otherwise prepare for creation.
  document.getElementById('errMsg').hidden = true;
  document.getElementById('activityForm').reset();
  draftParticipants = [];
  editingActivityId = null;

  if (activity) {
    editingActivityId = activity.id;
    document.getElementById('modalTitle').textContent = 'Edit activity';
    document.getElementById('fName').value = activity.name || '';
    document.getElementById('fStart').value = activity.start_date || fmtISO(new Date());
    document.getElementById('fEnd').value = activity.end_date || fmtISO(new Date());
    document.getElementById('fLocation').value = activity.location || '';
    document.getElementById('fNotes').value = activity.notes || '';
    draftParticipants = (activity.participants || []).slice();
    // Note: attachments editing isn't supported in the quick modal - hide/disable file input.
    const fileInput = document.getElementById('fAttachments');
    if (fileInput) fileInput.disabled = true;
  } else {
    document.getElementById('modalTitle').textContent = 'New activity';
    const todayIso = fmtISO(new Date());
    document.getElementById('fStart').value = todayIso;
    document.getElementById('fEnd').value = todayIso;
    const fileInput = document.getElementById('fAttachments');
    if (fileInput) fileInput.disabled = false;
  }

  renderTags();
  overlay.classList.add('show');
  setTimeout(() => document.getElementById('fName').focus(), 50);
}
function closeModal() { overlay.classList.remove('show'); editingActivityId = null; }


function renderTags() {
  tagInput.querySelectorAll('.tag').forEach(el => el.remove());
  draftParticipants.forEach(name => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.style.background = colorFor(name);
    tag.innerHTML = `${escapeHtml(name)} <button type="button" data-name="${escapeHtml(name)}">✕</button>`;
    tagInput.insertBefore(tag, fParticipant);
  });
  tagInput.querySelectorAll('.tag button').forEach(b => {
    b.addEventListener('click', () => {
      draftParticipants = draftParticipants.filter(n => n !== b.dataset.name);
      renderTags();
    });
  });
}

fParticipant.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const v = fParticipant.value.trim();
    if (v && !draftParticipants.includes(v)) { draftParticipants.push(v); renderTags(); }
    fParticipant.value = '';
  }
});

document.getElementById('newActivityBtn').addEventListener('click', () => openModal());
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('closeX').addEventListener('click', closeModal);
overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

document.getElementById('activityForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const isEdit = Boolean(editingActivityId);
  const url = isEdit ? `/activities/${editingActivityId}/edit` : '/api/activities';

  const formData = new FormData();
  formData.append('name', document.getElementById('fName').value.trim());
  formData.append('start_date', document.getElementById('fStart').value);
  formData.append('end_date', document.getElementById('fEnd').value);
  formData.append('location', document.getElementById('fLocation').value.trim());
  formData.append('notes', document.getElementById('fNotes').value.trim());
  formData.append('participants', JSON.stringify(draftParticipants));

  // Only include attachments on create (edit via modal doesn't support changing attachments)
  if (!isEdit) {
    const fileInput = document.getElementById('fAttachments');
    for (let i = 0; i < fileInput.files.length; i++) {
      formData.append('attachments', fileInput.files[i]);
    }
  }

  const res = await fetch(url, { method: 'POST', body: formData });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = document.getElementById('errMsg');
    // server may return HTML for errors in page-mode; try to extract message
    err.textContent = data.error || data.message || 'Could not save activity.';
    err.hidden = false;
    return;
  }
  closeModal();
  loadActivities();
});

document.getElementById('prevBtn').addEventListener('click', () => { current.setMonth(current.getMonth() - 1); render(); });
document.getElementById('nextBtn').addEventListener('click', () => { current.setMonth(current.getMonth() + 1); render(); });
document.getElementById('todayBtn').addEventListener('click', () => { current = new Date(); current.setDate(1); render(); });

// Attach click handlers for activity chips/agenda items so users can edit their own activities.
function attachActivityClickHandlers() {
  // chips in calendar grid
  document.querySelectorAll('.chip[data-activity-id]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      const id = Number(el.getAttribute('data-activity-id'));
      const a = activities.find(x => x.id === id);
      if (!a) return;
      // allow edit only if current user created it or is admin
      if (window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.id === a.created_by)) {
        openModal(a);
      } else {
        // otherwise navigate to activity view/edit page
        window.location.href = `/activities/${a.id}/edit`;
      }
    });
  });

  // agenda items
  document.querySelectorAll('.agenda-item[data-activity-id]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      // avoid clicks that target links (attachments)
      if (e.target && (e.target.tagName === 'A' || e.target.closest('a'))) return;
      const id = Number(el.getAttribute('data-activity-id'));
      const a = activities.find(x => x.id === id);
      if (!a) return;
      if (window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.id === a.created_by)) {
        openModal(a);
      } else {
        window.location.href = `/activities/${a.id}/edit`;
      }
    });
  });
}

(async function init() {
  await loadOfficers();
  await loadActivities();
})();
