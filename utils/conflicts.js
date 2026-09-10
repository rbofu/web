// Two date ranges (ISO yyyy-mm-dd strings) overlap if each starts on or
// before the other one ends.
function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

// Given a list of activities shaped like:
//   { id, name, start_date, end_date, participants: [names] }
// return every pair of activities that share a participant and overlap
// in time, as: { participant, a: activity, b: activity }
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

module.exports = { rangesOverlap, findConflicts };
