const webpush = require('web-push');

let configurato = false;
function init() {
  if (configurato) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:coordinamento@example.com',
    process.env.VAPID_PUBLIC,
    process.env.VAPID_PRIVATE
  );
  configurato = true;
}

// Ritorna 'ok', 'scaduta' (iscrizione da cancellare) oppure 'errore'.
async function invia(sub, dati) {
  init();
  try {
    await webpush.sendNotification(sub, JSON.stringify(dati), { TTL: 600, urgency: 'high' });
    return 'ok';
  } catch (e) {
    return e.statusCode === 404 || e.statusCode === 410 ? 'scaduta' : 'errore';
  }
}

module.exports = { invia };
