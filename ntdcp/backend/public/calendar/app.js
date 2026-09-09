const API = '/api/calendar';
const COLORS = ['#0e7a72', '#124d6e', '#256b3f', '#e8a63b', '#8e44ad', '#c0392b', '#16697a', '#b8860b'];

let state = {
  view: 'month',           // month | week | day | agenda
  cursor: startOfMonth(new Date()),
  context: null,
  officers: [],
  events: [],
  allEvents: [],           // unfiltered, for conflict detection
  unitFilter: '',
  manageUnitIds: new Set(),
};

function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d){ const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; }
function toISO(d){ return d.toISOString().slice(0, 10); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function colorForUnit(unitId){ return COLORS[Number(unitId) % COLORS.length]; }
function fmtDateTime(iso){ return new Date(iso).toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }); }

const els = {
  monthLabel: document.getElementById('monthLabel'),
  calGrid: document.getElementById('calGrid'),
  calHead: document.getElementById('calHead'),
  calBody: document.getElementById('calBody'),
  legend: document.getElementById('legend'),
  unitFilter: document.getElementById('unitFilter'),
  viewSwitch: document.getElementById('viewSwitch'),
  prevBtn: document.getElementById('prevBtn'),
  nextBtn: document.getElementById('nextBtn'),
  todayBtn: document.getElementById('todayBtn'),
  addActivityBtn: document.getElementById('addActivityBtn'),
  conflictBanner: document.getElementById('conflictBanner'),
  timelineSub: document.getElementById('timelineSub'),
  timelineTable: document.getElementById('timelineTable'),
  dayModalBg: document.getElementById('dayModalBg'),
  dayModalTitle: document.getElementById('dayModalTitle'),
  dayEventsList: document.getElementById('dayEventsList'),
  dayAddBtn: document.getElementById('dayAddBtn'),
  dayCloseBtn: document.getElementById('dayCloseBtn'),
  eventModalBg: document.getElementById('eventModalBg'),
  eventModalTitle: document.getElementById('eventModalTitle'),
  eventForm: document.getElementById('eventForm'),
  eventCancelBtn: document.getElementById('eventCancelBtn'),
  detailModalBg: document.getElementById('detailModalBg'),
  detailBody: document.getElementById('detailBody'),
  detailManageActions: document.getElementById('detailManageActions'),
  detailCloseBtn: document.getElementById('detailCloseBtn'),
};

async function init(){
  state.context = await renderCalNav('calendar');
  if (!state.context) return;
  state.manageUnitIds = new Set(state.context.manageUnits.map(u => String(u.id)));

  els.unitFilter.innerHTML = '<option value="">All units I can see</option>' +
    state.context.viewUnits.map(unit => `<option value="${unit.id}">${'— '.repeat(unit.depth)}${esc(unit.name)}</option>`).join('');

  els.legend.innerHTML = state.context.viewUnits.map(unit =>
    `<span><span class="dot" style="background:${colorForUnit(unit.id)}"></span>${esc(unit.name)}</span>`
  ).join('');

  const offRes = await fetch(`${API}/officers`);
  state.officers = offRes.ok ? await offRes.json() : [];
  populateUnitSelect(document.getElementById('ev_unit'), state.context.manageUnits);
  renderParticipantPicker([]);

  await refreshAll();
}

function populateUnitSelect(select, units){
  select.innerHTML = units.map(u => `<option value="${u.id}">${'— '.repeat(u.depth)}${esc(u.name)}</option>`).join('');
}

function renderParticipantPicker(selectedIds){
  const wrap = document.getElementById('ev_participants');
  wrap.innerHTML = state.officers.map(o => `
    <label>
      <input type="checkbox" value="${o.id}" ${selectedIds.includes(Number(o.id)) ? 'checked' : ''}>
      ${esc(o.name)}
    </label>`).join('') || '<span style="color:var(--muted);font-size:.85rem;">No officers in view.</span>';
}
function getSelectedParticipants(){
  return [...document.querySelectorAll('#ev_participants input:checked')].map(i => Number(i.value));
}

// ---------- Date-range helpers per view ----------
function currentRange(){
  if (state.view === 'month'){
    const gridStart = new Date(state.cursor);
    gridStart.setDate(1 - state.cursor.getDay());
    const gridEnd = addDays(gridStart, 41);
    return { start: gridStart, end: gridEnd };
  }
  if (state.view === 'week'){
    const start = startOfWeek(state.cursor);
    return { start, end: addDays(start, 6) };
  }
  if (state.view === 'day'){
    return { start: state.cursor, end: state.cursor };
  }
  const start = startOfMonth(state.cursor);
  const end = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + 1, 0);
  return { start, end };
}

async function refreshAll(){
  await Promise.all([loadEvents(), loadConflicts()]);
  render();
  renderTimeline();
}

async function loadEvents(){
  const { start, end } = currentRange();
  const params = new URLSearchParams({ start: toISO(start), end: toISO(end) });
  if (state.unitFilter) params.set('unitId', state.unitFilter);
  const res = await fetch(`${API}/events?${params.toString()}`);
  state.events = res.ok ? await res.json() : [];
}

// Conflicts are computed across everything in view — not limited by the current
// filter or date range — so the warning never hides a real double-booking.
async function loadConflicts(){
  const res = await fetch(`${API}/events`);
  state.allEvents = res.ok ? await res.json() : [];
  const conflicts = findConflicts(state.allEvents);
  renderConflictBanner(els.conflictBanner, conflicts);
  state.conflictPairs = new Set(conflicts.map(c => [c.eventA, c.eventB].sort().join('||')));
}

function eventsOn(dateISO){
  return state.events.filter(e => e.startDate <= dateISO && dateISO <= e.endDate);
}

// ---------- Rendering dispatch ----------
function render(){
  document.querySelectorAll('#viewSwitch button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  els.calHead.style.display = (state.view === 'month' || state.view === 'week') ? 'grid' : 'none';
  if (state.view === 'month') return renderMonth();
  if (state.view === 'week') return renderWeek();
  if (state.view === 'day') return renderDay();
  return renderAgenda();
}

function labelForRange(){
  if (state.view === 'month') return state.cursor.toLocaleDateString('en-GB', { month:'long', year:'numeric' });
  if (state.view === 'agenda') return state.cursor.toLocaleDateString('en-GB', { month:'long', year:'numeric' }) + ' — Agenda';
  if (state.view === 'day') return state.cursor.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const { start, end } = currentRange();
  const sameMonth = start.getMonth() === end.getMonth();
  return `${start.toLocaleDateString('en-GB', { day:'numeric', month: sameMonth ? undefined : 'short' })} – ${end.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`;
}

function dayCellHtml(date, maxChips){
  const iso = toISO(date);
  const todayISO = toISO(new Date());
  const out = date.getMonth() !== state.cursor.getMonth();
  const isToday = iso === todayISO;
  const dayEvents = eventsOn(iso);
  const shown = dayEvents.slice(0, maxChips);
  const extra = dayEvents.length - shown.length;
  return `<div class="cal-day ${out ? 'out' : ''} ${isToday ? 'today' : ''}" data-date="${iso}">
    <div class="num">${date.getDate()}</div>
    ${shown.map(e => `<span class="chip" style="background:${colorForUnit(e.unitId)}" title="${esc(e.title)}">${esc(e.title)}</span>`).join('')}
    ${extra > 0 ? `<div class="more-link">+${extra} more</div>` : ''}
  </div>`;
}

function renderMonth(){
  els.monthLabel.textContent = labelForRange();
  const { start } = currentRange();
  let html = '';
  for (let week = 0; week < 6; week++){
    html += '<div class="cal-week">';
    for (let d = 0; d < 7; d++) html += dayCellHtml(addDays(start, week * 7 + d), 3);
    html += '</div>';
  }
  els.calBody.innerHTML = html;
  bindDayCellClicks();
}

function renderWeek(){
  els.monthLabel.textContent = labelForRange();
  const { start } = currentRange();
  let html = '<div class="cal-week" style="min-height:320px;">';
  for (let d = 0; d < 7; d++) html += dayCellHtml(addDays(start, d), 8);
  html += '</div>';
  els.calBody.innerHTML = html;
  els.calBody.querySelectorAll('.cal-day').forEach(c => c.style.minHeight = '320px');
  bindDayCellClicks();
}

function renderDay(){
  els.monthLabel.textContent = labelForRange();
  const iso = toISO(state.cursor);
  const dayEvents = eventsOn(iso);
  els.calBody.innerHTML = `<div class="day-view-list">
    ${dayEvents.length ? dayEvents.map(e => dayEventItemHtml(e)).join('') : '<p class="empty">No activities scheduled for this day.</p>'}
  </div>`;
  bindEventItemActions(els.calBody, iso);
}

function renderAgenda(){
  els.monthLabel.textContent = labelForRange();
  const byDate = {};
  [...state.events].sort((a, b) => new Date(a.startDate) - new Date(b.startDate)).forEach(e => {
    (byDate[e.startDate] = byDate[e.startDate] || []).push(e);
  });
  const dates = Object.keys(byDate).sort();
  els.calBody.innerHTML = `<div class="agenda-list">
    ${dates.length ? dates.map(date => `
      <div class="agenda-group">
        <div class="date-label">${new Date(date + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })}</div>
        ${byDate[date].map(e => `
          <div class="agenda-item" data-view-event="${e.id}">
            <span class="dot" style="background:${colorForUnit(e.unitId)}"></span>
            ${e.image ? `<img src="${esc(e.image)}" class="thumb-sm" alt="">` : ''}
            <strong>${esc(e.title)}</strong>
            <span class="cat">${esc(e.category)} · ${esc(e.unitName)}${e.location ? ' · ' + esc(e.location) : ''}</span>
          </div>`).join('')}
      </div>`).join('') : '<p class="empty">No activities scheduled this month.</p>'}
  </div>`;
  els.calBody.querySelectorAll('[data-view-event]').forEach(el => el.addEventListener('click', () => openDetailModal(el.dataset.viewEvent)));
}

function bindDayCellClicks(){
  els.calBody.querySelectorAll('.cal-day').forEach(cell => {
    cell.addEventListener('click', () => openDayModal(cell.dataset.date));
  });
}

// ---------- Day list item (shared by day modal and day view) ----------
function participantChipsHtml(participants){
  if (!participants || !participants.length) return '';
  return `<div style="margin-top:6px;">${participants.map(p => `<span class="participant-chip" style="background:${colorForOfficer(p.id)}">${esc(p.name)}</span>`).join('')}</div>`;
}
function statusBadgeHtml(status){
  const styles = {
    upcoming:        { bg:'#eef2f8', color:'#33507a', label:'UPCOMING' },
    ongoing:         { bg:'#fdf3e3', color:'#8a5b12', label:'ONGOING' },
    awaiting_report: { bg:'#fdece3', color:'#b5541f', label:'AWAITING REPORT' },
    completed:       { bg:'#e3f3ec', color:'#1f7a52', label:'COMPLETED' },
  };
  const s = styles[status] || styles.upcoming;
  return `<span style="display:inline-block;font-size:.7rem;font-weight:700;padding:2px 8px;border-radius:10px;background:${s.bg};color:${s.color};">${s.label}</span>`;
}

function dayEventItemHtml(e){
  const canManage = state.manageUnitIds.has(String(e.unitId));
  return `<div class="day-event-item">
    <div style="display:flex;gap:12px;">
      ${e.image ? `<img src="${esc(e.image)}" class="thumb-sm" alt="">` : ''}
      <div style="flex:1;">
        <span class="tag" style="background:${colorForUnit(e.unitId)}">${esc(e.category)}</span> ${statusBadgeHtml(e.status)}
        <h4>${esc(e.title)}</h4>
        <div class="meta">${esc(e.unitName)} ${e.location ? '· ' + esc(e.location) : ''} ${e.startDate !== e.endDate ? `· ${e.startDate} to ${e.endDate}` : ''}</div>
        ${participantChipsHtml(e.participants)}
      </div>
    </div>
    ${e.description ? `<div style="font-size:.85rem;color:var(--ink);margin:6px 0;">${esc(e.description)}</div>` : ''}
    <div class="actions">
      <button data-view-event="${e.id}">View &amp; comment</button>
      ${canManage ? `<button data-edit-event="${e.id}">Edit</button><button class="danger" data-delete-event="${e.id}">Delete</button>` : ''}
    </div>
  </div>`;
}

function bindEventItemActions(container, contextDate){
  container.querySelectorAll('[data-view-event]').forEach(b => b.addEventListener('click', () => openDetailModal(b.dataset.viewEvent)));
  container.querySelectorAll('[data-edit-event]').forEach(b => b.addEventListener('click', () => {
    const ev = state.events.find(x => String(x.id) === b.dataset.editEvent);
    openEventModal(ev, contextDate);
  }));
  container.querySelectorAll('[data-delete-event]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this activity?')) return;
    const res = await fetch(`${API}/events/${b.dataset.deleteEvent}`, { method: 'DELETE' });
    if (!res.ok){ const err = await res.json().catch(()=>({})); alert(err.error || 'Could not delete.'); return; }
    await refreshAll();
    if (els.dayModalBg.classList.contains('show')) openDayModal(contextDate);
  }));
}

// ---------- Day modal ----------
function openDayModal(iso){
  const dayEvents = eventsOn(iso);
  els.dayModalTitle.textContent = new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  els.dayEventsList.innerHTML = dayEvents.length ? dayEvents.map(e => dayEventItemHtml(e)).join('') : '<p class="empty">No activities scheduled for this day.</p>';
  bindEventItemActions(els.dayEventsList, iso);
  els.dayAddBtn.onclick = () => openEventModal(null, iso);
  els.dayModalBg.classList.add('show');
}

// ---------- Add/Edit event modal ----------
function openEventModal(event, prefillDate){
  if (state.context.manageUnits.length === 0){
    alert('You do not have permission to add activities for any unit.');
    return;
  }
  els.eventModalTitle.textContent = event ? 'Edit Activity' : 'Add Activity';
  els.eventForm.dataset.id = event ? event.id : '';
  document.getElementById('ev_title').value = event ? event.title : '';
  document.getElementById('ev_start').value = event ? event.startDate : (prefillDate || toISO(new Date()));
  document.getElementById('ev_end').value = event ? event.endDate : (prefillDate || toISO(new Date()));
  document.getElementById('ev_category').value = event ? event.category : 'Meeting';
  document.getElementById('ev_location').value = event ? event.location : '';
  document.getElementById('ev_reminder').value = event ? String(event.reminderDaysBefore ?? 1) : '1';
  document.getElementById('ev_description').value = event ? event.description : '';
  const imgVal = event && event.image ? event.image : '';
  document.getElementById('ev_image').value = imgVal;
  document.getElementById('ev_image_pick').value = '';
  document.getElementById('ev_image_status').textContent = '';
  const preview = document.getElementById('ev_image_preview');
  preview.src = imgVal;
  preview.style.display = imgVal ? '' : 'none';
  populateUnitSelect(document.getElementById('ev_unit'), state.context.manageUnits);
  document.getElementById('ev_unit').value = event ? event.unitId : state.context.user.unitId;
  renderParticipantPicker(event ? (event.participantIds || []) : []);
  els.dayModalBg.classList.remove('show');
  els.detailModalBg.classList.remove('show');
  els.eventModalBg.classList.add('show');
}

document.getElementById('ev_image').addEventListener('input', () => {
  const preview = document.getElementById('ev_image_preview');
  const val = document.getElementById('ev_image').value;
  preview.src = val;
  preview.style.display = val ? '' : 'none';
});
document.getElementById('ev_image_pick').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const status = document.getElementById('ev_image_status');
  status.textContent = 'Uploading…';
  status.style.color = 'var(--muted)';
  try{
    const body = new FormData();
    body.append('file', file);
    const res = await fetch(`${API}/upload-image`, { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    document.getElementById('ev_image').value = data.url;
    const preview = document.getElementById('ev_image_preview');
    preview.src = data.url;
    preview.style.display = '';
    status.textContent = `Uploaded: ${data.name}`;
    status.style.color = 'var(--teal)';
  }catch(err){
    status.textContent = err.message || 'Upload failed';
    status.style.color = '#c0392b';
  }finally{
    e.target.value = '';
  }
});

els.eventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = els.eventForm.dataset.id;
  const body = {
    title: document.getElementById('ev_title').value,
    startDate: document.getElementById('ev_start').value,
    endDate: document.getElementById('ev_end').value,
    category: document.getElementById('ev_category').value,
    location: document.getElementById('ev_location').value,
    reminderDaysBefore: document.getElementById('ev_reminder').value,
    description: document.getElementById('ev_description').value,
    unitId: document.getElementById('ev_unit').value,
    image: document.getElementById('ev_image').value,
    participantIds: getSelectedParticipants(),
  };
  const res = await fetch(id ? `${API}/events/${id}` : `${API}/events`, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok){
    const err = await res.json().catch(() => ({}));
    alert(err.error || 'Could not save this activity.');
    return;
  }
  els.eventModalBg.classList.remove('show');
  await refreshAll();
});

els.eventCancelBtn.addEventListener('click', () => els.eventModalBg.classList.remove('show'));
els.dayCloseBtn.addEventListener('click', () => els.dayModalBg.classList.remove('show'));
els.detailCloseBtn.addEventListener('click', () => els.detailModalBg.classList.remove('show'));
els.addActivityBtn.addEventListener('click', () => openEventModal(null, toISO(new Date())));

// ---------- Event detail modal: full info + comments + attachments + report ----------
async function openDetailModal(eventId){
  els.dayModalBg.classList.remove('show');
  els.detailBody.innerHTML = '<p class="empty">Loading…</p>';
  els.detailManageActions.innerHTML = '';
  els.detailModalBg.classList.add('show');

  const res = await fetch(`${API}/events/${eventId}`);
  if (!res.ok){ els.detailBody.innerHTML = '<p class="empty">Could not load this activity.</p>'; return; }
  const e = await res.json();
  const canManage = state.manageUnitIds.has(String(e.unitId));

  els.detailBody.innerHTML = `
    ${e.image ? `<img src="${esc(e.image)}" class="event-cover" alt="">` : ''}
    <span class="detail-tag" style="background:${colorForUnit(e.unitId)}">${esc(e.category)}</span> ${statusBadgeHtml(e.status)}
    <h2>${esc(e.title)}</h2>
    <div class="detail-meta">${esc(e.unitName)} ${e.location ? '· ' + esc(e.location) : ''} · ${e.startDate}${e.endDate !== e.startDate ? ' to ' + e.endDate : ''}
      ${e.reminderDaysBefore ? `· reminder ${e.reminderDaysBefore} day(s) before${e.reminderSent ? ' (sent)' : ''}` : ''}</div>
    ${participantChipsHtml(e.participants)}
    ${e.description ? `<p>${esc(e.description)}</p>` : ''}

    <div class="detail-section">
      <h3>Completion Report</h3>
      ${e.report
        ? `<p style="font-size:.88rem;">${esc(e.report.text)}</p><div class="meta" style="font-size:.78rem;color:var(--muted);">By ${esc(e.report.submittedByName)} · ${fmtDateTime(e.report.submittedAt)}</div>`
        : '<p class="empty" style="padding:4px 0;">No report submitted yet.</p>'}
      ${canManage ? `<div class="comment-form" style="margin-top:10px;">
        <textarea id="reportInput" placeholder="Write a completion report…">${e.report ? esc(e.report.text) : ''}</textarea>
        <button class="btn" id="reportSubmit">${e.report ? 'Update' : 'Submit'}</button>
      </div>` : ''}
    </div>

    <div class="detail-section">
      <h3>Attachments</h3>
      <div id="attachList">
        ${(e.attachments || []).length ? e.attachments.map(a => `
          <div class="attachment-item">
            <a href="${API}/attachments/${encodeURIComponent(a.filename)}" target="_blank">${esc(a.name)}</a>
            <span class="meta">${esc(a.uploadedByName)} · ${fmtDateTime(a.date)}
              ${(a.uploadedBy === state.context.user.id || canManage) ? `<button class="del" data-del-attach="${a.id}">Remove</button>` : ''}
            </span>
          </div>`).join('') : '<p class="empty" style="padding:6px 0;">No files attached.</p>'}
      </div>
      <div class="attach-form"><input type="file" id="attachInput"></div>
    </div>

    <div class="detail-section">
      <h3>Comments</h3>
      <div id="commentList">
        ${(e.comments || []).length ? e.comments.map(c => `
          <div class="comment-item">
            <span class="who">${esc(c.authorName)}</span><span class="when">${fmtDateTime(c.date)}</span>
            <div>${esc(c.text)}</div>
            ${(c.authorId === state.context.user.id || canManage) ? `<button class="del" data-del-comment="${c.id}">Delete</button>` : ''}
          </div>`).join('') : '<p class="empty" style="padding:6px 0;">No comments yet.</p>'}
      </div>
      <div class="comment-form">
        <textarea id="commentInput" placeholder="Add a comment…"></textarea>
        <button class="btn" id="commentSubmit">Post</button>
      </div>
    </div>
  `;

  els.detailManageActions.innerHTML = canManage
    ? `<button class="btn secondary" id="detailEditBtn">Edit</button><button class="btn danger" id="detailDeleteBtn">Delete</button>`
    : '';

  if (canManage){
    document.getElementById('detailEditBtn').addEventListener('click', () => openEventModal(e, e.startDate));
    document.getElementById('detailDeleteBtn').addEventListener('click', async () => {
      if (!confirm('Delete this activity?')) return;
      await fetch(`${API}/events/${e.id}`, { method: 'DELETE' });
      els.detailModalBg.classList.remove('show');
      await refreshAll();
    });
    document.getElementById('reportSubmit').addEventListener('click', async () => {
      const text = document.getElementById('reportInput').value.trim();
      if (!text) return;
      const r = await fetch(`${API}/events/${eventId}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
      });
      if (r.ok){ await refreshAll(); openDetailModal(eventId); } else alert('Could not submit report.');
    });
  }

  document.getElementById('commentSubmit').addEventListener('click', async () => {
    const text = document.getElementById('commentInput').value.trim();
    if (!text) return;
    const r = await fetch(`${API}/events/${eventId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text })
    });
    if (r.ok) openDetailModal(eventId); else alert('Could not post comment.');
  });
  els.detailBody.querySelectorAll('[data-del-comment]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Delete this comment?')) return;
    const r = await fetch(`${API}/events/${eventId}/comments/${b.dataset.delComment}`, { method: 'DELETE' });
    if (r.ok) openDetailModal(eventId); else alert('Could not delete comment.');
  }));

  document.getElementById('attachInput').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('file', file);
    const r = await fetch(`${API}/events/${eventId}/attachments`, { method: 'POST', body });
    if (r.ok) openDetailModal(eventId); else alert('Could not upload attachment.');
  });
  els.detailBody.querySelectorAll('[data-del-attach]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Remove this attachment?')) return;
    const r = await fetch(`${API}/events/${eventId}/attachments/${b.dataset.delAttach}`, { method: 'DELETE' });
    if (r.ok) openDetailModal(eventId); else alert('Could not remove attachment.');
  }));
}

// ---------- Officer timeline (Gantt) ----------
function renderTimeline(){
  const monthStart = startOfMonth(state.cursor);
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  els.timelineSub.textContent = `Every officer's activities in ${monthStart.toLocaleDateString('en-GB',{month:'long',year:'numeric'})}, at a glance.`;

  const monthEvents = state.allEvents.filter(e => {
    const monthEndIso = toISO(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0));
    return e.startDate <= monthEndIso && e.endDate >= toISO(monthStart);
  });

  let head = '<tr><th>Officer</th>';
  for (let d = 1; d <= daysInMonth; d++){
    const dow = new Date(monthStart.getFullYear(), monthStart.getMonth(), d).getDay();
    head += `<th class="${dow===0||dow===6?'weekend':''}">${d}</th>`;
  }
  head += '</tr>';

  const rows = state.officers.map(o => {
    const officerEvents = monthEvents.filter(e => (e.participantIds || []).includes(o.id));
    let row = `<tr><td class="officer-name">${esc(o.name.toUpperCase())}</td>`;
    for (let d = 1; d <= daysInMonth; d++){
      const iso = toISO(new Date(monthStart.getFullYear(), monthStart.getMonth(), d));
      const dow = new Date(monthStart.getFullYear(), monthStart.getMonth(), d).getDay();
      const dayEvents = officerEvents.filter(e => e.startDate <= iso && iso <= e.endDate);
      const isConflict = dayEvents.length > 1;
      const first = dayEvents[0];
      const isStart = first && first.startDate === iso;
      row += `<td class="${dow===0||dow===6?'weekend':''}" style="position:relative;">`;
      if (first && isStart){
        const span = Math.min(
          (new Date(first.endDate) - new Date(first.startDate)) / 86400000 + 1,
          daysInMonth - d + 1
        );
        row += `<div class="timeline-bar ${isConflict?'conflict':''}" style="background:${colorForOfficer(o.id)};width:calc(${span*100}% + ${(span-1)*1}px);z-index:2;">${esc(first.title)}</div>`;
      } else if (first && !isStart){
        // continuation of a bar that started earlier — leave empty (bar already spans via width)
      }
      row += `</td>`;
    }
    return row + '</tr>';
  }).join('');

  els.timelineTable.innerHTML = head + rows;
}

// ---------- Navigation ----------
function familyOf(view){ return (view === 'month' || view === 'agenda') ? 'month' : 'day'; }

async function step(delta){
  if (state.view === 'month') state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  else if (state.view === 'week') state.cursor = addDays(state.cursor, delta * 7);
  else if (state.view === 'day') state.cursor = addDays(state.cursor, delta);
  else state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
  await refreshAll();
}
els.prevBtn.addEventListener('click', () => step(-1));
els.nextBtn.addEventListener('click', () => step(1));
els.todayBtn.addEventListener('click', async () => {
  state.cursor = state.view === 'month' || state.view === 'agenda' ? startOfMonth(new Date()) : new Date();
  await refreshAll();
});
els.unitFilter.addEventListener('change', async () => {
  state.unitFilter = els.unitFilter.value;
  await refreshAll();
});
els.viewSwitch.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', async () => {
    const newView = btn.dataset.view;
    if (familyOf(newView) !== familyOf(state.view)) state.cursor = new Date();
    state.view = newView;
    if (state.view === 'month' || state.view === 'agenda') state.cursor = startOfMonth(state.cursor);
    await refreshAll();
  });
});

init();
