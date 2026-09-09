// Browser-side twin of utils/status.js - keep the logic identical.
function todayISOLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getActivityStatus(activity, hasReport) {
  const today = todayISOLocal();
  if (today < activity.start_date) {
    return { key: 'upcoming', label: 'Upcoming', blink: false };
  }
  if (today <= activity.end_date) {
    return { key: 'ongoing', label: 'Ongoing', blink: true };
  }
  if (hasReport) {
    return { key: 'completed', label: 'Completed', blink: false };
  }
  return { key: 'awaiting_report', label: 'Awaiting report', blink: false };
}

function statusBadgeHtml(activity, hasReport) {
  const s = getActivityStatus(activity, hasReport);
  const blinkClass = s.blink ? ' status-blink' : '';
  const dot = s.key === 'ongoing' ? '<span class="status-dot"></span>' : '';
  return `<span class="status-badge status-${s.key}${blinkClass}">${dot}${s.label}</span>`;
}
