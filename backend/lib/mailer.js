// Sends email reminders. If SMTP_* environment variables are set, it sends
// real email via nodemailer. Otherwise (e.g. in local development, or this
// demo), it writes each message to data/mail-outbox.json instead, so the
// feature is fully testable without needing a real mail account — view sent
// messages under the admin panel's "Mail Outbox" tab.
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const OUTBOX_FILE = path.join(__dirname, '..', 'data', 'mail-outbox.json');

function hasSmtpConfig(){
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function readOutbox(){
  try{ return JSON.parse(fs.readFileSync(OUTBOX_FILE, 'utf-8')); }
  catch(e){ return []; }
}

function appendToOutbox(message){
  const outbox = readOutbox();
  outbox.unshift(message);
  fs.writeFileSync(OUTBOX_FILE, JSON.stringify(outbox.slice(0, 200), null, 2));
}

let transporter = null;
function getTransporter(){
  if (!transporter && hasSmtpConfig()){
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

// sendMail({ to, subject, text }) — "to" may be a single address or an array.
async function sendMail({ to, subject, text }){
  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
  if (!recipients.length) return { sent: false, reason: 'No recipient email addresses' };

  const record = { to: recipients, subject, text, date: new Date().toISOString() };

  if (hasSmtpConfig()){
    try{
      await getTransporter().sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: recipients.join(', '),
        subject, text
      });
      record.delivery = 'smtp';
      appendToOutbox(record);
      return { sent: true };
    }catch(err){
      record.delivery = 'smtp-failed';
      record.error = err.message;
      appendToOutbox(record);
      return { sent: false, reason: err.message };
    }
  }

  // No SMTP configured — simulate delivery so the feature still works end-to-end.
  record.delivery = 'simulated (no SMTP configured)';
  appendToOutbox(record);
  return { sent: true, simulated: true };
}

module.exports = { sendMail, readOutbox, hasSmtpConfig };
