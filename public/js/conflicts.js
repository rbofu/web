// Browser copy of utils/conflicts.js — kept in sync manually since this
// project intentionally has no build step.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function findConflicts(activities) {
  const byParticipant = {};
  activities.forEach((a) => {
    (a.participants || []).forEach((p) => {
      const key = p.trim().toLowerCase();
      if (!key) return;
      if (!byParticipant[key]) byParticipant[key] = { label: p.trim(), items: [] };
      byParticipant[key].items.push(a);
    });
  });

  const conflicts = [];
  Object.values(byParticipant).forEach(({ label, items }) => {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (rangesOverlap(a.start_date, a.end_date, b.start_date, b.end_date)) {
          conflicts.push({ participant: label, a, b });
        }
      }
    }
  });
  return conflicts;
}
