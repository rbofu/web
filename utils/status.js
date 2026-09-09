// Shared activity-status logic (server side). See public/js/status.js for the
// browser-side twin used by the calendar/reporting pages - keep both in sync.

// Local calendar date (no timezone shift), matching how <input type="date">
// values are stored ("YYYY-MM-DD" wall-clock dates with no time zone).
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// activity: { start_date, end_date }, hasReport: boolean
function getActivityStatus(activity, hasReport) {
  const today = todayISO();
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

module.exports = { todayISO, getActivityStatus };
