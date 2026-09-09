// An activity's status is derived, not stored — it's always a function of
// today's date versus the activity's dates, except once a completion report
// has been filed, which permanently marks it Completed regardless of date.
//
//   upcoming        — hasn't started yet
//   ongoing         — today falls within its date range
//   awaiting_report — its date range has passed and no report has been filed
//   completed       — a report has been filed (at any point)

function computeStatus(event, todayISO){
  const today = todayISO || new Date().toISOString().slice(0, 10);
  if (event.report) return 'completed';
  if (today < event.startDate) return 'upcoming';
  if (today <= event.endDate) return 'ongoing';
  return 'awaiting_report';
}

const STATUS_LABELS = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  awaiting_report: 'Awaiting Report',
  completed: 'Completed',
};

module.exports = { computeStatus, STATUS_LABELS };
