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

## Creare un ruolo

Nel pannello admin, aprire **Ruoli e Badge**, compilare **Nome del ruolo** e
**Gruppo di appartenenza**, poi premere **Crea ruolo**. Si può scegliere un gruppo
già presente o scriverne uno nuovo. Il badge viene generato dal server ed è subito
disponibile nell'elenco, insieme al pulsante QR.

Il nuovo ruolo compare anche nella dashboard e nelle personalizzazioni delle fasi.
Riceve le istruzioni assegnate al suo gruppo; le istruzioni specifiche del ruolo
hanno precedenza. Nome e gruppo sono obbligatori; i nomi duplicati, anche con
maiuscole diverse, vengono rifiutati. Il nome Admin è riservato.
La creazione è transazionale e conserva i ruoli e i badge già presenti.
L'editor JSON della lista completa rimane nella sezione **Gestione avanzata**.

## Creare una fase con istruzioni

Nel pannello admin, aprire **Fasi e istruzioni**. Il modulo **Nuova Fase**
permette di aggiungere più assegnazioni prima di creare la fase: per ogni riga
si sceglie un ruolo o un gruppo e si possono indicare luogo, istruzioni per lo
spostamento e note. Se un ruolo deve solo seguire la fase, selezionare
**Nessuna attività** nella sua assegnazione: la fase resta visibile, ma il ruolo
non può segnarla come completata e non viene contato in ritardo nella dashboard.
Un'assegnazione specifica per il ruolo prevale su quella del gruppo. Si possono
rimuovere le righe non necessarie. La fase e le
sue assegnazioni vengono aggiunte insieme al programma; per renderle disponibili
allo staff occorre poi premere **Salva modifiche sul server**.

La timeline dello staff ricarica automaticamente il programma e i completamenti
dal server ogni 2 minuti; il pannello admin lo fa ogni 30 secondi. Un aggiornamento
automatico non cancella i dati già modificati nell'editor e ancora da salvare.

## Regia admin

La scheda **Regia · Timeline** mostra le fasi previste ora e la prossima fase,
le conferme mancanti dopo la fine prevista e il dettaglio di ogni ruolo aprendo
una fase. Le segnalazioni compaiono alla fine prevista; dopo cinque minuti senza
conferma diventano **Da verificare**, in ordine di tempo trascorso. I ruoli con
**Nessuna attività** non generano segnalazioni. Il controllo si ferma quando
l'evento è in pausa e richiede un orario di fine valido per calcolare il ritardo.
L'interfaccia indica l'ora dell'ultimo aggiornamento server o che sta mostrando
dati locali.

Gli orari descrivono il programma previsto. Al momento i completamenti salvano
solo gli ID delle fasi: non permettono di sapere dove si trovi effettivamente un
ruolo né a che ora abbia completato una tappa.

## Rimozione del sistema di notifiche

L'app non richiede permessi di notifica e non invia push. Sono stati rimossi
`/api/subscribe`, `/api/tick`, il test push admin e la dipendenza `web-push`.
Il service worker conserva la cache offline e disiscrive le vecchie sottoscrizioni
quando la nuova versione viene attivata.

Dopo la distribuzione di questa versione, disattivare anche l'eventuale servizio
cron esterno che chiamava `/api/tick`: la sua configurazione non è nel repository.
`CRON_SECRET` e le variabili `VAPID_*` non sono più necessarie. Il documento storico
`config/iscrizioni` non è più usato; non viene cancellato automaticamente.
