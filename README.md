# OpenDay Messedaglia

PWA per coordinare lo staff: accesso con badge, programma personalizzato,
completamento delle tappe e pannello admin per ruoli e fasi.

## Struttura

- `app.js`, `index.html`, `style.css`: interfaccia in JavaScript puro.
- `api/`: funzioni Node.js per Vercel, autenticazione e accesso a Firestore.
- `sw.js`, `manifest.webmanifest`: installazione e cache dell'interfaccia offline.
- `tests/`: verifiche automatiche senza connessione al database reale.

Firestore usa la collezione `config`, con i documenti `ruoli` e `programma`.
Ogni ruolo contiene nome, gruppo e badge. Il programma contiene fasi,
personalizzazioni e completamenti. Le scritture del programma sono transazionali.

## Configurazione locale

Installare Node.js e le dipendenze con `npm ci`, poi avviare `npx vercel dev`.
Le API richiedono `ADMIN_PASSWORD` e `FIREBASE_KEY` (JSON dell'account di servizio)
nelle variabili d'ambiente locali o nelle impostazioni del progetto Vercel.
Non salvare credenziali nel repository.

Eseguire `npm test` per le verifiche automatiche.
Senza server o credenziali, l'app mostra l'ultimo programma salvato sul dispositivo,
se presente. I completamenti richiedono una conferma del server; non vengono
accodati per l'invio offline.

## Rimozione del sistema di notifiche

L'app non richiede permessi di notifica e non invia push. Sono stati rimossi
`/api/subscribe`, `/api/tick`, il test push admin e la dipendenza `web-push`.
Il service worker conserva la cache offline e disiscrive le vecchie sottoscrizioni
quando la nuova versione viene attivata.

Dopo la distribuzione di questa versione, disattivare anche l'eventuale servizio
cron esterno che chiamava `/api/tick`: la sua configurazione non è nel repository.
`CRON_SECRET` e le variabili `VAPID_*` non sono più necessarie. Il documento storico
`config/iscrizioni` non è più usato; non viene cancellato automaticamente.
