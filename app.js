'use strict';
/* ---------- Configurazione ---------- */
const CFG = {
  BACKEND: false,            // metti true quando il backend è pronto
  API: '',                   // es. 'https://tuo-server.it'
  VAPID: '',                 // chiave pubblica VAPID per le push
  ADMIN: 'Admin',
  // Ogni gruppo può avere delle unità. Una voce che punta al gruppo ("Aula")
  // la vede tutto il gruppo, anche chi sta in una sola unità.
  GROUPS: [
    { label: 'Corridoio', units: [] },
    { label: 'Aula', units: ['Aula 1', 'Aula 2', 'Aula 3', 'Aula 4', 'Aula 5', 'Aula 6', 'Aula 7', 'Aula 8'] }
  ]
};

/* ---------- Utilità ---------- */
const $ = s => document.querySelector(s);
const screen = $('#screen'), modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } }
};
const fmt = d => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
// L'orologio mostra anche i secondi, per capire che è vivo. Gli orari del
// programma restano al minuto: secondi lì non servono e affollerebbero la lista.
const fmtOrologio = d => `${fmt(d)}<small>${String(d.getSeconds()).padStart(2, '0')}</small>`;

/* ---------- Rilevamento ambiente (?m=1 e ?s=1 forzano mobile/installata per i test) ---------- */
const q = new URLSearchParams(location.search), ua = navigator.userAgent;
const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const env = {
  ios: /iPhone|iPad|iPod/.test(ua) || ipad,
  mobile: q.has('m') || /Android|iPhone|iPad|iPod/.test(ua) || ipad,
  standalone: q.has('s') || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
};
const S = { role: store.get('role'), token: store.get('token'), items: [], sig: '' };
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });

/* ---------- Ruoli ---------- */
const GROUPS = CFG.GROUPS;
const GROUP_LABEL = new Set(GROUPS.map(g => g.label));   // i nomi che sono gruppi
const GROUP_OF = new Map(); // ruolo -> gruppo
GROUPS.forEach(g => {
  GROUP_OF.set(g.label, g.label);
  g.units.forEach(u => GROUP_OF.set(u, g.label));
});

// Ruolo salvato da una versione precedente (es. "Staff"): non esiste più, ripartiamo puliti.
if (S.role && S.role !== CFG.ADMIN && !GROUP_OF.has(S.role)) {
  S.role = null; S.token = null;
  store.del('role'); store.del('token');
}

// "Corridoio" la vede chi è in Corridoio, "Aula 3" solo chi è in Aula 3,
// "Aula" la vedono tutte e otto perché è il nome del gruppo.
const roleMatches = r => r === S.role || (GROUP_LABEL.has(r) && GROUP_OF.get(r) === GROUP_OF.get(S.role));
const visible = i => S.role === CFG.ADMIN || !i.roles?.length || i.roles.some(roleMatches);
const isGroup = r => S.role && GROUP_OF.get(r) === GROUP_OF.get(S.role);

/* ---------- Tappe e collegamenti ---------- */
// Una tappa è un luogo. Ogni collegamento si può percorrere in entrambi i
// sensi, e i laboratori sono raggiungibili solo dalla scala indicata: è il
// grafo a imporre la strada, non il testo.
// (Con il backend, tappe e collegamenti arriveranno con il resto del programma.)
const SCALE = ['Scala A1-A2', 'Scala B1-B2'];
const LAB = ['Laboratorio 1', 'Laboratorio 2', 'Laboratorio 3'];

// Elenco di riferimento dei posti, più leggibile dei soli collegamenti.
const TAPPE = ['Ingresso A', 'Corridoio centrale', 'Sala principale', 'Deposito materiali', ...SCALE, ...LAB, ...GROUPS.flatMap(g => g.units)];

// Da dove parte ognuno: chi è in un'aula parte dalla propria, chi è in
// corridoio dall'ingresso. Per l'admin non ha senso, non ha una partenza.
const PARTENZA = { 'Corridoio': 'Ingresso A', 'Aula': '@Aula' };

const LINK = [
  { da: 'Ingresso A', a: 'Corridoio centrale', come: 'Tieni la destra, i cartelli blu' },
  { da: 'Ingresso A', a: 'Sala principale', come: 'A destra, oltre la porta vetrata' },
  { da: 'Corridoio centrale', a: 'Sala principale', come: 'Oltre il bancone della reception' },
  { da: 'Corridoio centrale', a: 'Deposito materiali', come: 'In fondo a sinistra' },

  // Le scale: due sole, e i laboratori stanno su una o sull'altra.
  { da: 'Corridoio centrale', a: 'Scala A1-A2', come: 'In fondo al corridoio, a sinistra' },
  { da: 'Corridoio centrale', a: 'Scala B1-B2', come: 'Sul lato opposto del corridoio' },
  { da: 'Scala A1-A2', a: 'Laboratorio 1', come: 'Piano A1, prima porta a destra' },
  { da: 'Scala A1-A2', a: 'Laboratorio 2', come: 'Salendo, piano A2, in fondo' },
  { da: 'Scala B1-B2', a: 'Laboratorio 3', come: 'Piano B1, a sinistra' },

  // Ogni aula si raggiunge dal corridoio centrale.
  ...GROUPS.flatMap(g => g.units.map(u => ({ da: 'Corridoio centrale', a: u, come: 'Segui i cartelli col numero dell\'aula' })))
];

// '@Aula' = la tappa in cui ti trovi: per chi è in Aula 3 è Aula 3. Per l'admin,
// che non sta in una stanza sola, resta il nome del gruppo.
const risolvi = t => t?.[0] !== '@' ? t
  : S.role === CFG.ADMIN ? t.slice(1) + ' (tutte)'
    : GROUP_OF.get(S.role) === t.slice(1) ? S.role : t;

// Cammino minimo fra due tappe: un hop per ogni collegamento attraversato.
// Ritorna i passi da fare, o null se le due tappe sono la stessa o non collegate.
function percorso(da, a) {
  if (!da || !a || da === a) return null;
  const coda = [{ tappa: da, passi: [] }], visto = new Set([da]);
  while (coda.length) {
    const { tappa, passi } = coda.shift();
    if (tappa === a) return passi;
    for (const l of LINK) {
      if (l.da !== tappa && l.a !== tappa) continue;
      const prossimo = l.da === tappa ? l.a : l.da;
      if (visto.has(prossimo)) continue;
      visto.add(prossimo);
      coda.push({ tappa: prossimo, passi: [...passi, { tappa: prossimo, come: l.come }] });
    }
  }
  return null;
}

/* ---------- Avvio ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  if (env.mobile && !env.standalone) return showInstall();   // mobile non installata: solo istruzioni
  if (env.mobile) await notifGate();                          // mobile installata: notifiche obbligatorie
  S.role ? showTimeline() : showRoles();                      // PC: direttamente qui
}

/* ---------- Schermata di installazione ---------- */
function showInstall() {
  const steps = env.ios
    ? `<li>Apri questa pagina in <b>Safari</b>, non dentro WhatsApp o Instagram</li>
       <li>Tocca <b>Condividi</b> in basso</li>
       <li>Scegli <b>Aggiungi alla schermata Home</b></li>
       <li>Apri l'app dall'<b>icona sulla Home</b></li>`
    : `<li>Tocca <b>Installa app</b> qui sotto, oppure apri il menu ⋮ del browser</li>
       <li>Conferma l'installazione</li>
       <li>Apri l'app dall'<b>icona sulla Home</b></li>`;
  screen.innerHTML = `<div class="wrap center"><h1>Installa l'app</h1>
    <p class="mut">Gli avvisi arrivano solo se l'app è sulla schermata Home.</p>
    <ol class="steps">${steps}</ol>
    ${env.ios ? '' : `<button class="btn" id="inst" ${installEvt ? '' : 'hidden'}>Installa app</button>`}</div>`;
  $('#inst')?.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; });
}

/* ---------- Popup notifiche (non chiudibile) ---------- */
const openModal = html => { modal.innerHTML = `<div class="sheet">${html}</div>`; modal.hidden = false; };
const closeModal = () => { modal.hidden = true; modal.innerHTML = ''; };

function notifGate() {
  return new Promise(resolve => {
    const draw = () => {
      const st = 'Notification' in window ? Notification.permission : 'unsupported';
      if (st === 'granted') { closeModal(); subscribePush(); return resolve(); }
      if (st === 'default') {
        openModal(`<h2>Attiva le notifiche</h2>
          <p class="mut">Avvisi e cambi di programma arrivano solo così. Non mettere il telefono in silenzioso e disattiva le modalità Focus.</p>
          <button class="btn" id="ask">Attiva notifiche</button>`);
      } else {
        const how = st === 'denied'
          ? (env.ios ? 'Vai in Impostazioni, Notifiche, scegli questa app e attiva Consenti notifiche.'
            : 'Vai in Impostazioni, App, scegli questa app, Notifiche, e attivale.')
          : 'Serve iOS 16.4 o successivo: aggiorna da Impostazioni, Generali, Aggiornamento software.';
        openModal(`<h2 class="bad">${st === 'denied' ? 'Notifiche bloccate' : 'Notifiche non disponibili'}</h2>
          <p class="mut">${how} Poi riapri l'app.</p>
          <button class="btn ghost" id="go">Continua senza notifiche</button>`);
      }
      $('#ask')?.addEventListener('click', () => Notification.requestPermission().then(draw));
      $('#go')?.addEventListener('click', () => { closeModal(); resolve(); });
    };
    draw();
  });
}

/* ---------- Push (si attiva con BACKEND e VAPID) ---------- */
const b64u8 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function subscribePush() {
  if (!CFG.BACKEND || !CFG.VAPID || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(CFG.VAPID) });
    await fetch(CFG.API + '/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, role: S.role })
    });
  } catch (e) { console.warn('push', e); }
}

/* ---------- Scelta ruolo e login admin ---------- */
function showRoles() {
  screen.innerHTML = `<div class="wrap"><h1>Dove lavori?</h1>
    <p class="mut">Vedrai solo gli orari e gli avvisi che ti riguardano. Puoi cambiarlo quando vuoi.</p>
    <div class="roles">${GROUPS.map(g => `<button class="role${isGroup(g.label) ? ' on' : ''}" data-g="${esc(g.label)}">${esc(g.label)}${g.units.length ? `<small>${g.units.length} aule</small>` : ''}</button>`).join('')}</div>
    <button class="btn ghost" id="adm">Sono un admin</button><div id="admbox"></div>
    ${S.role ? '<button class="btn ghost" id="back">Torna al programma</button>' : ''}</div>`;
  screen.querySelectorAll('.role').forEach(b => b.onclick = () => {
    const g = GROUPS.find(x => x.label === b.dataset.g);
    g.units.length ? showUnits(g) : setRole(g.label);
  });
  $('#back')?.addEventListener('click', showTimeline);
  $('#adm').onclick = adminForm;
}

/* ---------- Scelta dell'unita dentro un gruppo ---------- */
function showUnits(g) {
  screen.innerHTML = `<div class="wrap"><h1>${esc(g.label)}</h1>
    <p class="mut">Scegli la tua aula: gli orari e gli avvisi saranno solo quelli.</p>
    <div class="roles">${g.units.map(u => `<button class="role${u === S.role ? ' on' : ''}" data-u="${esc(u)}">${esc(u)}</button>`).join('')}</div>
    <button class="btn ghost" id="back">Torna indietro</button></div>`;
  screen.querySelectorAll('.role').forEach(b => b.onclick = () => setRole(b.dataset.u));
  $('#back').onclick = showRoles;
}

function setRole(r) {
  S.role = r; store.set('role', r);
  if (r !== CFG.ADMIN) { S.token = null; store.del('token'); }
  subscribePush();                       // aggiorna il ruolo sul server
  showTimeline();
}

function adminForm() {
  $('#admbox').innerHTML = `<form class="box" id="af"><label for="pw">Password admin</label>
    <input type="password" id="pw" autocomplete="current-password" required>
    <button class="btn">Entra</button><p class="bad" id="err"></p></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err');
    if (!CFG.BACKEND) { err.textContent = 'Backend non collegato: la password si verifica solo sul server.'; return; }
    try {
      const r = await fetch(CFG.API + '/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('#pw').value })
      });
      if (!r.ok) throw 0;
      S.token = (await r.json()).token; store.set('token', S.token); setRole(CFG.ADMIN);
    } catch { err.textContent = 'Password errata o server non raggiungibile.'; }
  };
}

/* ---------- Timeline ---------- */
function demoItems() {
  const t = m => new Date(Date.now() + m * 6e4).toISOString();
  return [
    // Aula: ognuno parte dalla propria, e '@Aula' vuol dire proprio quella.
    { id: 1, start: t(-120), end: t(-75), title: 'Preparazione aula', roles: ['Aula'], tappa: '@Aula', notes: 'Controlla banchi e materiali, poi apri le porte.' },
    { id: 2, start: t(-40), end: t(20), title: 'Raccolta al corridoio centrale', roles: ['Aula'], tappa: 'Corridoio centrale', notes: 'Aspetta i cartelli verdi.' },

    // Corridoio: gli stessi compiti, ma senza una aula o un laboratorio fisso.
    { id: 3, start: t(-120), end: t(-75), title: 'Briefing e consegna turni', roles: ['Corridoio'], tappa: 'Ingresso A' },
    { id: 4, start: t(35), end: t(80), title: 'Affiancamento ai laboratori', roles: ['Corridoio'], tappa: 'Corridoio centrale', notes: 'Di sezione in sezione: non resti in un laboratorio solo.' },

    // Laboratori: ognuno si raggiunge solo dalla sua scala.
    { id: 5, start: t(35), end: t(80), title: 'Laboratorio 1', roles: ['Aula 1', 'Aula 2'], tappa: 'Laboratorio 1' },
    { id: 6, start: t(35), end: t(80), title: 'Laboratorio 2', roles: ['Aula 3', 'Aula 4', 'Aula 5'], tappa: 'Laboratorio 2', notes: 'Aule riunite, si conta sui banchi.' },
    { id: 7, start: t(35), end: t(80), title: 'Laboratorio 3', roles: ['Aula 6', 'Aula 7', 'Aula 8'], tappa: 'Laboratorio 3' },

    { id: 8, start: t(150), end: t(210), title: 'Rientro e chiusura', roles: [], tappa: 'Ingresso A', notes: 'Badge e radio restituite al presidio.' }
  ];
}

async function loadItems() {
  if (CFG.BACKEND) {
    try {
      const r = await fetch(CFG.API + '/api/timeline', { cache: 'no-store' });
      if (!r.ok) throw 0;
      const d = await r.json(); store.set('timeline', d); return { items: d };
    } catch { const c = store.get('timeline'); if (c) return { items: c, stale: true }; }
  }
  return { items: demoItems(), demo: true };
}

function status(i, k, nextIdx, now) {
  const s = new Date(i.start), e = i.end ? new Date(i.end) : null;
  if (now >= (e ?? s) && (e || now >= s)) return 'past';
  if (now >= s) return 'now';
  return k === nextIdx ? 'next' : 'later';
}

/* ---------- Righe dell'itinerario: nodi, tratti e tappe attraversate ---------- */
// Nodo: una voce del programma, con pallino e orario.
const rigoNodo = (i, c, tappa) => {
  const s = new Date(i.start), e = i.end ? new Date(i.end) : null;
  return `<li class="it ${c}"><div class="tm">${fmt(s)}${e ? `<small>fino ${fmt(e)}</small>` : ''}</div><div class="rail"></div>
    <div class="nd"><h3>${esc(i.title)}${c === 'now' ? '<span class="pill">Adesso</span>' : c === 'next' ? '<span class="pill">Dopo</span>' : ''}</h3>
    ${tappa ? `<p class="loc">${esc(tappa)}</p>` : ''}
    ${i.notes ? `<p class="mut">${esc(i.notes)}</p>` : ''}</div></li>`;
};

// Tratto: il pezzo di linea fra due tappe, con l'istruzione per attraversarlo.
const rigoTratto = (come, avviso) => `<li class="leg${avviso ? ' bad' : ''}"><div class="tm"></div><div class="rail"></div>
  <div class="legtxt">${esc(come)}</div></li>`;

// Tappa attraversata: un nodo, ma senza orario e senza testo.
const rigoTappa = t => `<li class="pass"><div class="tm"></div><div class="rail"></div><div class="nd">${esc(t)}</div></li>`;

function renderList(scroll) {
  const now = new Date(), items = S.items.filter(visible).sort((a, b) => new Date(a.start) - new Date(b.start));
  const nextIdx = items.findIndex(i => new Date(i.start) > now);
  const st = items.map((i, k) => status(i, k, nextIdx, now));
  const sig = st.join() + S.role;
  if (sig === S.sig && !scroll) return;       // niente re-render se non cambia nulla
  S.sig = sig;
  const inizio = PARTENZA[GROUP_OF.get(S.role)];   // l'admin non ha una partenza
  let da = inizio ? risolvi(inizio) : null;
  $('#tl').innerHTML = items.map((i, k) => {
    const c = st[k], tappa = risolvi(i.tappa), da0 = da, via = percorso(da, tappa);
    if (tappa) da = tappa;
    // Fra una voce e la successiva si disegna il tratto: le istruzioni stanno
    // in mezzo, e ogni tappa attraversata diventa a sua volta un nodo.
    const tratto = via ? via.map(v => rigoTratto(v.come) + rigoTappa(v.tappa)).join('')
      : da0 && tappa && da0 !== tappa ? rigoTratto(`Nessun collegamento da ${da0} a ${tappa}: chiedi al coordinatore.`, true)
        : '';
    return tratto + rigoNodo(i, c, tappa);
  }).join('') || '<li class="vuoto">Nessuna voce per il tuo ruolo.</li>';
  if (scroll) $('.it.now, .it.next')?.scrollIntoView({ block: 'center' });
}

// Un timer solo: l'orologio gira ogni secondo, la lista si ridisegna solo
// quando gli stati cambiano davvero (ci pensa la firma in renderList).
const batto = () => {
  $('#clock').innerHTML = fmtOrologio(new Date());
  renderList(false);
};

async function showTimeline() {
  screen.innerHTML = `<header class="top"><b id="clock"></b><button class="chip" id="chg">${esc(S.role)}, cambia</button></header>
    <div class="wrap"><div id="banner"></div>
    <ol class="tl" id="tl"></ol>
    ${env.mobile ? '<button class="btn ghost" id="test">Invia notifica di prova</button>' : ''}</div>`;
  $('#chg').onclick = showRoles;
  $('#test')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Notifica di prova', { body: 'Se leggi questo, sei a posto.', icon: 'icon-192.png' });
  });
  const d = await loadItems();
  S.items = d.items; S.sig = '';
  $('#banner').innerHTML = d.demo ? '<div class="banner">Dati di esempio: il backend non è ancora collegato.</div>'
    : d.stale ? '<div class="banner">Sei offline: vedi l\'ultimo programma salvato.</div>' : '';
  renderList(true);
  batto();                                        // primo disegno dell'orologio
  clearInterval(S.timer); S.timer = setInterval(batto, 1000);
}

boot();