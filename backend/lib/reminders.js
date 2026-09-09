// Checks all calendar events and emails a reminder to the owning unit's
// members when today falls within their configured "remind X days before"
// window — each event is only reminded once (reminderSent flag).
const db = require('../db');
const { sendMail } = require('./mailer');

function daysBetween(a, b){
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function todayISO(){ return new Date().toISOString().slice(0, 10); }

async function checkAndSendReminders(){
  const data = db.read();
  const today = todayISO();
  let changed = false;

  for (const event of data.calendarEvents){
    const days = Number(event.reminderDaysBefore || 0);
    if (!days || event.reminderSent) continue;
    if (today > event.startDate) continue; // already started/passed, don't bother
    const daysUntilStart = daysBetween(today, event.startDate);
    if (daysUntilStart > days) continue; // not within the reminder window yet

    const unit = data.units.find(u => String(u.id) === String(event.unitId));
    const recipients = data.users
      .filter(u => String(u.unitId) === String(event.unitId) && u.email)
      .map(u => u.email);

    if (recipients.length){
      await sendMail({
        to: recipients,
        subject: `Reminder: "${event.title}" on ${event.startDate}`,
        text: `This is a reminder that "${event.title}" (${event.category}) is scheduled for ` +
              `${event.startDate}${event.endDate !== event.startDate ? ' to ' + event.endDate : ''}` +
              `${event.location ? ' at ' + event.location : ''}, organised by ${unit ? unit.name : 'your unit'}.\n\n` +
              `${event.description || ''}`
      });
    }
    event.reminderSent = true;
    changed = true;
  }

  if (changed) db.write(data);
}

module.exports = { checkAndSendReminders };
