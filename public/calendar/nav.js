// Shared top navigation + small helpers used across every Program Calendar page.
function esc(str=''){ return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function renderCalNav(activeTab){
  const res = await fetch('/api/calendar/context');
  if (res.status === 401){ window.location.href = '/calendar/login'; return null; }
  const context = await res.json();
  const u = context.user;
  const isAdmin = u.role === 'admin';

  const nav = document.getElementById('calNav');
  nav.innerHTML = `
    <div class="cn-inner">
      <a href="/calendar" class="cn-brand"><span class="cn-logo">P</span> Program Calendar</a>
      <div class="cn-tabs">
        <a href="/calendar" class="${activeTab==='calendar'?'active':''}">Calendar</a>
        <a href="/calendar/reporting.html" class="${activeTab==='reporting'?'active':''}">Activity Reporting</a>
        <a href="/calendar/fuel.html" class="${activeTab==='fuel'?'active':''}">Driver Fuel</a>
        <a href="/calendar/profile.html" class="${activeTab==='profile'?'active':''}">Profile</a>
        ${isAdmin ? `<a href="/calendar/admin.html" class="${activeTab==='admin'?'active':''}">Admin</a>` : ''}
      </div>
      <div class="cn-who">
        <span>${esc(u.name)} <span class="cn-role">(${esc(u.role)})</span></span>
        <a href="#" id="cnLogout">Log out</a>
      </div>
    </div>`;
  document.getElementById('cnLogout').addEventListener('click', async (e) => {
    e.preventDefault();
    await fetch('/calendar/logout', { method: 'POST' });
    window.location.href = '/calendar/login';
  });
  return context;
}

// ---- Scheduling conflict detection (shared by Calendar + Activity Reporting pages) ----
// Two activities conflict when they share at least one participant and their date ranges overlap.
function findConflicts(events){
  const conflicts = [];
  for (let i = 0; i < events.length; i++){
    for (let j = i + 1; j < events.length; j++){
      const a = events[i], b = events[j];
      const overlap = a.startDate <= b.endDate && b.startDate <= a.endDate;
      if (!overlap) continue;
      const aIds = new Set((a.participantIds || []));
      const shared = (b.participantIds || []).filter(id => aIds.has(id));
      if (!shared.length) continue;
      const usersById = {};
      (a.participants || []).forEach(p => usersById[p.id] = p.name);
      (b.participants || []).forEach(p => usersById[p.id] = p.name);
      shared.forEach(id => conflicts.push({ personId: id, personName: usersById[id] || 'Someone', eventA: a.title, eventB: b.title }));
    }
  }
  return conflicts;
}

function renderConflictBanner(container, conflicts){
  if (!conflicts.length){ container.innerHTML = ''; container.style.display = 'none'; return; }
  container.style.display = 'block';
  const parts = conflicts.map(c => `${esc(c.personName)} is booked on both "${esc(c.eventA)}" and "${esc(c.eventB)}"`);
  container.innerHTML = `<strong>${conflicts.length} scheduling conflict${conflicts.length===1?'':'s'}:</strong> ${parts.join(' · ')}`;
}

// Consistent color per officer id (distinct palette from the per-unit colors used elsewhere).
const OFFICER_COLORS = ['#6a4fa3','#b5651d','#2f6f4f','#1f6f8b','#a3335c','#4a6fa5','#7a8a2e','#9c4a2a'];
function colorForOfficer(id){ return OFFICER_COLORS[Number(id) % OFFICER_COLORS.length]; }
