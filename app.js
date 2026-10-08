'use strict';
/* ---------- Configurazione ---------- */
const CFG = {
  API: '/api',              // '' = nessun server, l'app va coi dati di esempio
  VAPID: 'BBxn7vitSX1STlCj3Nlo1frlbu0nSpwr4Ht2F-QXIOHZs1VL1sowzgt3EFuP_RfAqcARbkHEsoLJPxLBLwApwYA',                // chiave pubblica VAPID per le push
  ADMIN: 'Admin',
  GROUPS: [
    { label: 'Corridoio', units: [] },
    { label: 'Aula', units: ['Aula 1', 'Aula 2', 'Aula 3', 'Aula 4', 'Aula 5', 'Aula 6', 'Aula 7', 'Aula 8'] }
  ]
};
const ONLINE = !!CFG.API;

/* ---------- Utilità ---------- */
const $ = s => document.querySelector(s);
const screen = $('#screen'), modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  del(k) { try { localStorage.removeItem(k); } catch { } }
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const dataOk = d => d != null && d !== '' && !isNaN(new Date(d));
const iso = d => (dataOk(d) ? new Date(d).toISOString() : null);
const fmt = d => (dataOk(d) ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const fmtOrologio = d => `${fmt(d)}<small>${String(d.getSeconds()).padStart(2, '0')}</small>`;
const perInput = d => {
  if (!dataOk(d)) return '';
  const x = new Date(d), p = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}T${p(x.getHours())}:${p(x.getMinutes())}`;
};

const scarica = (nome, testo, tipo) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], { type: tipo }));
  a.download = nome; a.click(); URL.revokeObjectURL(a.href);
};
const csv = righe => righe.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

function leggiCsv(testo) {
  const righe = []; let r = [], c = '', dentro = false;
  for (let i = 0; i < testo.length; i++) {
    const ch = testo[i];
    if (dentro) { if (ch === '"' && testo[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') dentro = false; else c += ch; }
    else if (ch === '"') dentro = true;
    else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n') { r.push(c); righe.push(r); r = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || r.length) { r.push(c); righe.push(r); }
  const [testata, ...corpo] = righe;
  return corpo.filter(x => x.some(y => y !== '')).map(x => Object.fromEntries(testata.map((k, i) => [k.trim().toLowerCase(), x[i] ?? ''])));
}

/* ---------- Avvisi & Tetti ---------- */
async function chiedi(url, opts = {}, ms = 8000) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError'
      ? `Il server non ha risposto in ${Math.round(ms / 1000)} secondi.`
      : 'Server non raggiungibile: controlla la rete.');
  } finally { clearTimeout(t); }
}

let toastT = null;
function avvisa(testo, male = false) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = testo;
  t.className = male ? 'male' : '';
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, 3400);
}

const attesa = (b, testo = 'Attendo...') => { if (b) { b.disabled = true; b.dataset.t = b.textContent; b.textContent = testo; } };
const pronto = b => { if (b) { b.disabled = false; if (b.dataset.t) b.textContent = b.dataset.t; } };

const scheletro = `<ol class="tl" id="tl">${[0, 1, 2].map(() =>
  `<li class="it sk"><div class="tm"><span class="br s2"></span></div><div class="rail"></div>
   <div class="nd"><span class="br s6"></span><span class="br s4"></span></div></li>`).join('')}</ol>`;

/* ---------- Ambiente e Stato ---------- */
const q = new URLSearchParams(location.search), ua = navigator.userAgent;
const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const env = {
  ios: /iPhone|iPad|iPod/.test(ua) || ipad,
  mobile: q.has('m') || /Android|iPhone|iPad|iPod/.test(ua) || ipad,
  standalone: q.has('s') || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
};

const S = {
  role: store.get('role'),
  token: store.get('token'),
  admin: false,
  sig: '',
  timer: 0,
  tabAdmin: 'dashboard'
};

let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });

const GROUPS = CFG.GROUPS;
const GROUP_OF = new Map();
GROUPS.forEach(g => { GROUP_OF.set(g.label, g.label); g.units.forEach(u => GROUP_OF.set(u, g.label)); });

const TUTTE_LE_SQUADRE = [];
GROUPS.forEach(g => {
  if (g.units.length) g.units.forEach(u => TUTTE_LE_SQUADRE.push(u));
  else TUTTE_LE_SQUADRE.push(g.label);
});

const isAdmin = () => S.role === CFG.ADMIN && !!S.token;
const gruppo = () => (S.role && S.role !== CFG.ADMIN ? (GROUP_OF.get(S.role) || '') : '');
const sameSquadra = g => S.role && GROUP_OF.get(g.label) === gruppo();

const optSquadra = sel => GROUPS.map(g =>
  `<optgroup label="${esc(g.label)}"><option value="${esc(g.label)}"${sel === g.label ? ' selected' : ''}>${esc(g.label)} — tutta la squadra</option>` +
  g.units.map(u => `<option value="${esc(u)}"${sel === u ? ' selected' : ''}>${esc(u)}</option>`).join('') +
  '</optgroup>').join('');

/* ---------- Dati e Fasi ---------- */
let Fasce = [];
let EventoAttivo = false;
let Completamenti = store.get('completamenti', {});
let inCorso = false;
let edF = null, edP = null, sporco = false;

function demoFasce() {
  const t = m => new Date(Date.now() + m * 6e4).toISOString();
  return [
    {
      id: 'f1', titolo: 'Briefing generale', inizio: t(-60), fine: t(-35), durataSpostamento: 10, note: 'Badge e radio obbligatori per tutti.',
      personalizzazioni: [
        { id: 'p1_1', ruolo: 'Aula', tappa: 'Aula Magna', istruzioniSpostamento: 'Raduno all\'ingresso principale dell\'istituto', note: 'Ritira le cartelline all\'ingresso' },
        { id: 'p1_2', ruolo: 'Corridoio', tappa: 'Atrio Centrale', istruzioniSpostamento: 'Presentarsi al bancone accoglienza', note: 'Indossare la pettorina di servizio' }
      ]
    },
    {
      id: 'f2', titolo: 'Preparazione e Accoglienza', inizio: t(-30), fine: t(20), durataSpostamento: 10, note: '',
      personalizzazioni: [
        { id: 'p2_1', ruolo: 'Aula', tappa: 'Propria Aula', istruzioniSpostamento: 'Salire le scale centrali e aprire le aule', note: 'Verificare funzionamento proiettore' },
        { id: 'p2_2', ruolo: 'Corridoio', tappa: 'Corridoio Principale', istruzioniSpostamento: 'Posizionarsi lungo il corridoio A', note: 'Accogliere i primi visitatori' }
      ]
    },
    {
      id: 'f3', titolo: 'Laboratori e Presentazioni', inizio: t(30), fine: t(90), durataSpostamento: 15, note: '',
      personalizzazioni: [
        { id: 'p3_1', ruolo: 'Aula 1', tappa: 'Laboratorio Informatico', istruzioniSpostamento: 'Prendi la scala A1, 1° piano a destra', note: 'Avvia le postazioni demo per gli studenti' },
        { id: 'p3_2', ruolo: 'Aula 2', tappa: 'Laboratorio Scienze', istruzioniSpostamento: 'Prendi la scala B2, piano terra', note: 'Prepara i microscopi' },
        { id: 'p3_3', ruolo: 'Corridoio', tappa: 'Zona Laboratori', istruzioniSpostamento: 'Presidiare il corridoio B', note: 'Indirizzare i gruppi di visitatori verso i laboratori' }
      ]
    },
    {
      id: 'f4', titolo: 'Rientro e Chiusura', inizio: t(100), fine: t(150), durataSpostamento: 10, note: '',
      personalizzazioni: [
        { id: 'p4_1', ruolo: 'Aula', tappa: 'Propria Aula', istruzioniSpostamento: 'Spegni le luci e chiudi le finestre', note: 'Restituisci le chiavi in segreteria' },
        { id: 'p4_2', ruolo: 'Corridoio', tappa: 'Presidio Centrale', istruzioniSpostamento: 'Riconsegna radio e badge', note: 'Firma il registro di chiusura' }
      ]
    }
  ];
}

/* ---------- Boot & Schermata 1 & 2 ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  if (env.mobile && !env.standalone) return showInstall();
  if (env.mobile) await notifGate();

  if (isAdmin()) showAdmin();
  else if (S.role) showTimeline();
  else showRoles();
}

function showInstall() {
  const steps = env.ios
    ? `<li>Apri questa pagina in <b>Safari</b>, non dentro WhatsApp o Instagram</li>
       <li>Tocca <b>Condividi</b> in basso</li>
       <li>Scegli <b>Aggiungi alla schermata Home</b></li>
       <li>Apri l'app dall'<b>icona sulla Home</b></li>`
    : `<li>Tocca <b>Installa app</b> qui sotto, oppure apri il menu del browser</li>
       <li>Conferma l'installazione</li>
       <li>Apri l'app dall'<b>icona sulla Home</b></li>`;
  screen.innerHTML = `<div class="wrap center"><h1>Installa l'app</h1>
    <p class="mut">Gli avvisi e il coordinamento in tempo reale richiedono l'app installata.</p>
    <ol style="text-align:left; margin: 20px auto; max-width: 340px; line-height: 1.6">${steps}</ol>
    ${env.ios ? '' : `<button class="btn" id="inst" ${installEvt ? '' : 'hidden'}>Installa app</button>`}</div>`;
  $('#inst')?.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; });
}

const openModal = html => { modal.innerHTML = `<div class="sheet">${html}</div>`; modal.hidden = false; };
const closeModal = () => { modal.hidden = true; modal.innerHTML = ''; };

function notifGate() {
  return new Promise(resolve => {
    const draw = () => {
      const st = 'Notification' in window ? Notification.permission : 'unsupported';
      if (st === 'granted') { closeModal(); subscribePush(); return resolve(); }
      if (st === 'default') {
        openModal(`<h2>Attiva le notifiche</h2>
          <p class="mut" style="margin-top:6px">Avvisi e cambi di programma arrivano solo così. Non mettere il telefono in silenzioso.</p>
          <button class="btn" id="ask">Attiva notifiche</button>`);
      } else {
        openModal(`<h2 class="bad">Notifiche disattivate</h2>
          <p class="mut" style="margin-top:6px">Puoi comunque usare l'app, ma ti consigliamo di abilitare le notifiche.</p>
          <button class="btn ghost" id="go">Continua senza notifiche</button>`);
      }
      $('#ask')?.addEventListener('click', () => Notification.requestPermission().then(draw));
      $('#go')?.addEventListener('click', () => { closeModal(); resolve(); });
    };
    draw();
  });
}

const b64u8 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function subscribePush() {
  if (!ONLINE || !CFG.VAPID || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(CFG.VAPID) });
    await chiedi(CFG.API + '/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, ruolo: S.role, gruppo: gruppo(), admin: isAdmin() })
    }, 15000);
  } catch (e) { console.warn('push', e); }
}

/* ---------- Schermata 3: Scelta Ruolo ---------- */
function showRoles() {
  screen.innerHTML = `<div class="wrap"><h1>Dove lavori?</h1>
    <p class="mut">Scegli la tua squadra per vedere tappe, spostamenti e istruzioni personalizzate.</p>
    <div class="roles">
      <button class="role role-admin" id="radm">Admin / Coordinatore<small>Richiede password</small></button>
      ${GROUPS.map(g => `<button class="role${sameSquadra(g) ? ' on' : ''}" data-g="${esc(g.label)}">${esc(g.label)}${g.units.length ? `<small>${g.units.length} aule</small>` : ''}</button>`).join('')}
    </div>
    <div id="admbox"></div>
    ${S.role && !isAdmin() ? '<button class="btn ghost" id="back">Torna alla timeline</button>' : ''}</div>`;

  screen.querySelectorAll('.role[data-g]').forEach(b => b.onclick = () => {
    const g = GROUPS.find(x => x.label === b.dataset.g);
    g.units.length ? showUnits(g) : setRole(g.label);
  });
  $('#radm').onclick = adminForm;
  $('#back')?.addEventListener('click', showTimeline);
}

function showUnits(g) {
  screen.innerHTML = `<div class="wrap"><h1>${esc(g.label)}</h1>
    <p class="mut">Scegli la tua aula specifica:</p>
    <div class="roles">${g.units.map(u => `<button class="role${u === S.role ? ' on' : ''}" data-u="${esc(u)}">${esc(u)}</button>`).join('')}</div>
    <button class="btn ghost" id="back">Torna indietro</button></div>`;
  screen.querySelectorAll('.role').forEach(b => b.onclick = () => setRole(b.dataset.u));
  $('#back').onclick = showRoles;
}

function setRole(r) {
  S.role = r; store.set('role', r);
  subscribePush();
  showTimeline();
}

function adminForm() {
  $('#admbox').innerHTML = `<form class="box" id="af"><label for="pw">Password Admin</label>
    <input type="password" id="pw" autocomplete="current-password" placeholder="Inserisci la password" required>
    <button class="btn">Accedi a Pannello Admin</button><p class="bad" id="err" style="margin-top:8px"></p></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err'), b = $('#af').querySelector('button');
    if (!ONLINE) {
      S.role = CFG.ADMIN; store.set('role', CFG.ADMIN);
      S.token = 'demo-token'; store.set('token', 'demo-token');
      avvisa('Accesso Admin in modalità demo');
      return showAdmin();
    }
    attesa(b, 'Verifico password...');
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'login', password: $('#pw').value })
      }, 12000);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.errore || 'Password errata.');
      S.token = d.token; store.set('token', d.token);
      S.role = CFG.ADMIN; store.set('role', CFG.ADMIN);
      err.textContent = '';
      avvisa('Accesso consentito');
      showAdmin();
    } catch (x) {
      err.textContent = x.message;
      avvisa(x.message, true);
    }
    pronto(b);
  };
}

/* ---------- Caricamento Dati ---------- */
async function carica() {
  if (!ONLINE) {
    Fasce = demoFasce();
    EventoAttivo = store.get('evento_attivo', true);
    Completamenti = store.get('completamenti', {});
    return { demo: true };
  }
  try {
    const p = new URLSearchParams({ ruolo: S.role || '', gruppo: gruppo() });
    const r = await chiedi(CFG.API + '/programma?' + p, {
      cache: 'no-store',
      headers: S.token ? { Authorization: 'Bearer ' + S.token } : {}
    });
    if (!r.ok) throw new Error('Il server ha risposto ' + r.status + '.');
    const d = await r.json();
    store.set('programma', d);
    Fasce = d.fasce || [];
    EventoAttivo = !!d.attivo;
    Completamenti = d.completamenti || {};
    store.set('completamenti', Completamenti);
    S.admin = !!d.admin;
    return {};
  } catch (x) {
    const c = store.get('programma');
    if (c) {
      Fasce = c.fasce || [];
      EventoAttivo = typeof c.attivo === 'boolean' ? c.attivo : true;
      Completamenti = store.get('completamenti', {});
      return { offline: true, errore: x.message };
    }
    Fasce = demoFasce();
    EventoAttivo = store.get('evento_attivo', true);
    Completamenti = store.get('completamenti', {});
    return { demo: true, errore: x.message };
  }
}

/* ---------- Checklist Completamento ---------- */
async function toggleCompletato(fasciaId) {
  const r = S.role;
  if (!r) return;
  const list = Completamenti[r] || [];
  const fatto = list.includes(fasciaId);
  const nuovaLista = fatto ? list.filter(id => id !== fasciaId) : [...list, fasciaId];
  Completamenti[r] = nuovaLista;
  store.set('completamenti', Completamenti);
  renderList(false);
  avvisa(fatto ? 'Tappa segnata come non completata' : 'Tappa completata!');

  if (ONLINE) {
    try {
      await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'segna_completato', ruolo: r, fasciaId, completato: !fatto })
      });
    } catch (e) { console.warn('Errore salvataggio completamento', e); }
  }
}

/* ---------- Render Timeline ---------- */
function getStatoOrario(inizio, fine, now) {
  const s = new Date(inizio), e = fine ? new Date(fine) : null;
  if (isNaN(s)) return 'later';
  const f = e && !isNaN(e) ? e : s;
  if (now >= f) return 'past';
  if (now >= s) return 'now';
  return 'next';
}

let ultimoHtml = '';
function renderList(scroll) {
  if (inCorso) return;
  const now = new Date();
  const ord = [...Fasce].sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const completatiRole = Completamenti[S.role] || [];

  const html = ord.map((f) => {
    const m = f.mia || null;
    // Senza personalizzazione per questa squadra: niente spostamento, niente luogo personale.
    const durataSpost = m ? parseInt(f.durataSpostamento || 0, 10) : 0;
    const tInizio = new Date(f.inizio);
    const tFineSpost = new Date(tInizio.getTime() + durataSpost * 60000);
    const tInizioTappa = durataSpost > 0 ? tFineSpost : tInizio;
    const tFineTappa = f.fine ? new Date(f.fine) : null;

    const stSpost = durataSpost > 0 ? getStatoOrario(tInizio, tFineSpost, now) : null;
    const stTappa = getStatoOrario(tInizioTappa, tFineTappa, now);

    const luogoTeam = m?.tappa || '';
    const noteTeam = m?.note || f.note || '';
    const istruzioniSpost = m?.istruzioniSpostamento || m?.istruzioni || '';
    const isFatto = completatiRole.includes(f.id);

    // Ritardo = minuti passati dalla FINE della tappa, se non è ancora segnata come completata.
    // Dopo 1 minuto: gialla. Dopo 5 minuti: rossa e lampeggiante.
    const minRitardo = tFineTappa && !isNaN(tFineTappa) ? (now - tFineTappa) / 60000 : -1;
    const allarme = EventoAttivo && !isFatto && minRitardo >= 1
      ? (minRitardo >= 5 ? 'alert' : 'warn')
      : '';
    const pillAllarme = allarme === 'alert' ? '<span class="pill alarm-pill">Ritardo critico</span>'
      : allarme === 'warn' ? '<span class="pill warn-pill">In ritardo</span>' : '';

    let res = '';

    // 1. Bolla Spostamento in Evidenza
    if (durataSpost > 0) {
      res += `<li class="it it-spostamento ${stSpost} ${allarme}">
        <div class="tm">${fmt(tInizio)}<small>fino ${fmt(tFineSpost)}</small></div>
        <div class="rail"></div>
        <div class="nd">
          <h3>SPOSTAMENTO VERSO ${esc(luogoTeam).toUpperCase()}${stSpost === 'now' ? '<span class="pill shift-pill">In corso</span>' : ''}${pillAllarme}</h3>
          ${istruzioniSpost ? `<p class="mut"><b>Istruzioni:</b> ${esc(istruzioniSpost)}</p>` : ''}
        </div>
      </li>`;
    }

    // 2. Card Tappa / Attività
    res += `<li class="it ${stTappa} ${isFatto ? 'fatto' : ''} ${allarme}">
      <div class="tm">${fmt(tInizioTappa)}${dataOk(tFineTappa) ? `<small>fino ${fmt(tFineTappa)}</small>` : ''}</div>
      <div class="rail"></div>
      <div class="nd">
        <h3>${esc(f.titolo)}${stTappa === 'now' ? '<span class="pill">In svolgimento</span>' : ''}${isFatto ? '<span class="pill ok-pill">Completata</span>' : ''}${pillAllarme}</h3>
        ${luogoTeam ? `<p class="loc">Luogo: ${esc(luogoTeam)}</p>` : ''}
        ${noteTeam ? `<p class="mut">Nota: ${esc(noteTeam)}</p>` : ''}

        <div class="chk-box">
          <button class="chk-btn ${isFatto ? 'done' : ''}" onclick="toggleCompletato('${f.id}')">
            ${isFatto ? '[X] Tappa completata' : '[ ] Segna come completata'}
          </button>
        </div>
      </div>
    </li>`;

    return res;
  }).join('') || '<li class="vuoto">Nessuna fase in programma per questo team.</li>';

  // Riscrive il DOM solo se qualcosa è cambiato: l'orologio aggiorna ogni secondo
  // e riscrivere sempre il DOM farebbe ripartire il lampeggio di continuo.
  if (!scroll && html === ultimoHtml) return;
  ultimoHtml = html;
  $('#tl').innerHTML = html;
  if (scroll) $('.it.now, .it.next')?.scrollIntoView({ block: 'center' });
}

const batto = () => {
  const c = $('#clock');
  if (!c) { clearInterval(S.timer); S.timer = 0; return; }
  c.innerHTML = fmtOrologio(new Date());
  if (S.role && S.role !== CFG.ADMIN) renderList(false);
};

/* ---------- Schermata 4: Timeline Utente ---------- */
async function showTimeline() {
  inCorso = true;
  screen.innerHTML = `<header class="top"><b id="clock"></b><button class="chip" id="chg">${esc(S.role || 'Ruolo')}, cambia</button></header>
    <div class="wrap">
      <div id="banner"></div>
      ${scheletro}
    </div>`;

  $('#chg').onclick = showRoles;

  $('#clock').innerHTML = fmtOrologio(new Date());
  clearInterval(S.timer); S.timer = setInterval(batto, 1000);

  const d = await carica();
  inCorso = false;

  let bHtml = '';
  if (!EventoAttivo) {
    bHtml += `<div class="banner warn"><b>EVENTO IN ATTESA DI AVVIO</b><br>Il coordinatore non ha ancora attivato l'evento. Gli orari sottostanti sono indicativi.</div>`;
  } else {
    bHtml += `<div class="banner active"><b>EVENTO ATTIVO</b> - Segui gli orari e segna le tappe man mano che le completi.</div>`;
  }

  if (d.offline) {
    bHtml += `<div class="banner bad">${esc(d.errore)} Stiamo vedendo l'ultimo programma salvato.<button class="btn mini" id="retry">Riprova</button></div>`;
  } else if (d.demo) {
    bHtml += '<div class="banner">Dati in modalità offline/demo.</div>';
  }

  $('#banner').innerHTML = bHtml;
  $('#retry')?.addEventListener('click', showTimeline);

  renderList(true);
}

/* ---------- Schermata 5: Admin Dashboard & Modifica ---------- */
async function showAdmin() {
  if (!isAdmin()) {
    return showRoles();
  }

  inCorso = true;
  await carica();
  inCorso = false;

  screen.innerHTML = `<header class="top">
      <b>Pannello Admin</b>
      <button class="chip" id="admTest">Test notifiche</button>
      <button class="chip" id="admLogout">Esci da Admin</button>
    </header>
    <div class="wrap">
      <!-- Toggle Attivazione Generale -->
      <div class="toggle-card ${EventoAttivo ? 'active' : ''}">
        <div class="toggle-info">
          <h3>${EventoAttivo ? 'EVENTO ATTIVO' : 'EVENTO IN PAUSA / IN ATTESA'}</h3>
          <p>${EventoAttivo ? 'Lo staff riceve il flusso live e l\'avvio delle fasi.' : 'Tutto caricato in memoria. Attiva il toggle prima dell\'avvio.'}</p>
        </div>
        <label class="switch">
          <input type="checkbox" id="toggleEvt" ${EventoAttivo ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <!-- Navigation Tabs -->
      <div class="tabs">
        <button class="tab-btn ${S.tabAdmin === 'dashboard' ? 'active' : ''}" id="tabDash">Status Squadre</button>
        <button class="tab-btn ${S.tabAdmin === 'timeline' ? 'active' : ''}" id="tabTl">Timeline Globale</button>
        <button class="tab-btn ${S.tabAdmin === 'modifica' ? 'active' : ''}" id="tabMod">Modifica Fasi</button>
      </div>

      <div id="tabContent"></div>
    </div>`;

  $('#admTest').onclick = async e => {
    if (!ONLINE) return avvisa('Serve il server per il test notifiche', true);
    const b = e.currentTarget;
    attesa(b, 'Invio in corso...');
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
        body: JSON.stringify({ azione: 'test_push' })
      }, 15000);
      const d = await r.json();
      if (!r.ok) throw new Error(d.errore || 'Errore sconosciuto');
      avvisa(`Notifica inviata a ${d.inviati} dispositivi su ${d.totali}`);
    } catch (x) { avvisa(x.message, true); }
    finally { pronto(b); }
  };

  $('#admLogout').onclick = () => {
    S.token = null; store.del('token');
    S.role = null; store.del('role');
    avvisa('Logout eseguito');
    showRoles();
  };

  $('#toggleEvt').onchange = async e => {
    const val = e.target.checked;
    EventoAttivo = val;
    store.set('evento_attivo', val);
    avvisa(val ? 'Evento ATTIVATO per tutto lo staff' : 'Evento messo in PAUSA');
    
    $('.toggle-card').className = `toggle-card ${val ? 'active' : ''}`;
    $('.toggle-info h3').textContent = val ? 'EVENTO ATTIVO' : 'EVENTO IN PAUSA / IN ATTESA';
    $('.toggle-info p').textContent = val ? 'Lo staff riceve il flusso live e l\'avvio delle fasi.' : 'Tutto caricato in memoria. Attiva il toggle prima dell\'avvio.';

    if (ONLINE) {
      try {
        await chiedi(CFG.API + '/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
          body: JSON.stringify({ azione: 'toggle_attivo', attivo: val })
        });
      } catch (err) { avvisa('Errore sincronizzazione toggle: ' + err.message, true); }
    }
  };

  const renderTab = () => {
    const c = $('#tabContent');
    if (!c) return;

    if (S.tabAdmin === 'dashboard') {
      const now = new Date();
      const nTotali = Fasce.length; // Ogni fase in programma è una tappa dell'evento
      let html = '<div class="dashboard-grid">';
      
      TUTTE_LE_SQUADRE.forEach(sq => {
        const rawCompl = Completamenti[sq] || [];
        // Filtra solo le tappe attualmente esistenti in Fasce e rimuovi duplicati
        const validCompl = Array.from(new Set(rawCompl.filter(id => Fasce.some(f => f.id === id))));

        const nCompletati = validCompl.length;
        const perc = nTotali > 0 ? Math.min(100, Math.round((nCompletati / nTotali) * 100)) : 0;

        let inRitardo = false;
        Fasce.forEach(f => {
          if (f.fine && new Date(f.fine) < now && !validCompl.includes(f.id)) {
            inRitardo = true;
          }
        });

        const isComplete = nTotali > 0 && nCompletati === nTotali;
        const statusClass = isComplete ? 'completed' : inRitardo ? 'late' : '';
        const badgeLabel = isComplete ? 'Completato' : inRitardo ? 'In Ritardo' : 'In Corso';
        const badgeClass = isComplete ? 'ok' : inRitardo ? 'late' : 'idle';

        html += `<div class="team-card ${statusClass}">
          <div class="team-head">
            <h4>${esc(sq)}</h4>
            <span class="badge-status ${badgeClass}">${badgeLabel}</span>
          </div>
          <p class="mut" style="font-size:0.85rem">${nCompletati} su ${nTotali} tappe completate (${perc}%)</p>
          <div class="p-bar-bg">
            <div class="p-bar-fill" style="width: ${perc}%"></div>
          </div>
        </div>`;
      });
      html += '</div>';
      c.innerHTML = html;
    } else if (S.tabAdmin === 'timeline') {
      const ord = [...Fasce].sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
      let html = '<ol class="tl" style="margin-top:14px">';
      ord.forEach(f => {
        const durataSpost = parseInt(f.durataSpostamento || 0, 10);
        html += `<li class="it">
          <div class="tm">${fmt(f.inizio)}${dataOk(f.fine) ? `<small>fino ${fmt(f.fine)}</small>` : ''}</div>
          <div class="rail"></div>
          <div class="nd">
            <h3>${esc(f.titolo)} ${durataSpost > 0 ? `<small style="color:var(--shift)">(Spostamento: ${durataSpost}m)</small>` : ''}</h3>
            ${f.note ? `<p class="mut">${esc(f.note)}</p>` : ''}
            <ul class="pv">
              ${(f.personalizzazioni || []).map(p => `<li><b>${esc(p.ruolo)}</b> → Luogo: <i>${esc(p.tappa || 'N/D')}</i> ${p.istruzioniSpostamento ? `<br><small>Spostamento: ${esc(p.istruzioniSpostamento)}</small>` : ''} ${p.note ? `<br><small>Nota: ${esc(p.note)}</small>` : ''}</li>`).join('') || '<li class="mut">Nessuna personalizzazione team</li>'}
            </ul>
          </div>
        </li>`;
      });
      html += '</ol>';
      c.innerHTML = html;
    } else {
      c.innerHTML = `
        <form class="box" id="ff">
          <h3>Nuova Fase</h3>
          <label>Titolo fase</label><input name="titolo" required autocomplete="off" placeholder="es. Laboratori o Accoglienza">
          <div class="tre">
            <div><label>Inizio</label><input type="datetime-local" name="inizio" required></div>
            <div><label>Fine</label><input type="datetime-local" name="fine"></div>
            <div><label>Spostamento (min)</label><input type="number" name="durataSpostamento" value="10" min="0" required></div>
          </div>
          <label>Nota generale per tutti</label><input name="nota" autocomplete="off" placeholder="es. Badge obbligatorio">
          <button class="btn">Aggiungi Fase</button>
        </form>

        <ul class="lst" id="lf"></ul>

        <h2 style="margin-top:24px">Salva, esporta, importa</h2>
        <p class="mut">Finché non salvi sul server, le modifiche rimangono in questa sessione.</p>
        <p class="bad" id="dirty" hidden>Ci sono modifiche non salvate.</p>
        <button class="btn" id="salva">Salva modifiche sul server</button>
        <button class="btn ghost" id="expj">Scarica JSON</button>
        <button class="btn ghost" id="expc">Scarica CSV</button>
        
        <label for="imp" style="margin-top:16px; display:block">Incolla qui un JSON o un CSV del programma</label>
        <textarea id="imp" rows="4" placeholder='{"fasce":[...]}'></textarea>
        <button class="btn ghost" id="doimp">Importa programma</button>
        <p class="bad" id="aerr" style="margin-top:8px"></p>
      `;

function calcolaProssimoInizio() {
  if (!Fasce.length) return Date.now();
  const ord = [...Fasce].sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const ultima = ord[ord.length - 1];
  if (ultima && ultima.fine && dataOk(ultima.fine)) {
    return new Date(ultima.fine).getTime();
  } else if (ultima && ultima.inizio && dataOk(ultima.inizio)) {
    return new Date(ultima.inizio).getTime() + 30 * 60000;
  }
  return Date.now();
}

      $('#ff [name=inizio]').value = perInput(calcolaProssimoInizio());
      $('#ff').onsubmit = e => {
        e.preventDefault();
        const d = new FormData(e.target);
        const titolo = (d.get('titolo') || '').trim();
        if (!titolo) return avvisa('Inserisci un titolo per la fase', true);
        const inizio = iso(d.get('inizio'));
        if (!inizio) return avvisa('Seleziona un orario di inizio valido', true);
        Fasce.push({
          id: 'f' + uid(), titolo, inizio,
          fine: d.get('fine') ? iso(d.get('fine')) : null,
          durataSpostamento: parseInt(d.get('durataSpostamento') || 0, 10),
          note: (d.get('nota') || '').trim(), personalizzazioni: []
        });
        e.target.reset();
        $('#ff [name=inizio]').value = perInput(calcolaProssimoInizio());
        disegnaFasiEditor(); segnaSporco();
        avvisa('Fase aggiunta');
      };

      disegnaFasiEditor();

      $('#salva').onclick = async () => {
        const b = $('#salva');
        attesa(b, 'Salvo...');
        try {
          const r = await chiedi(CFG.API + '/admin', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
            body: JSON.stringify({ azione: 'salva', fasce: Fasce, attivo: EventoAttivo })
          }, 15000);
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.errore || 'Salvataggio fallito.');
          sporco = false;
          $('#dirty').hidden = true;
          $('#aerr').textContent = '';
          avvisa(`Salvato con successo: ${d.fasce} fasi`);
        } catch (x) {
          $('#aerr').textContent = x.message;
          avvisa(x.message, true);
        }
        pronto(b);
      };

      $('#expj').onclick = () => scarica('programma.json', JSON.stringify({ fasce: Fasce, attivo: EventoAttivo }, null, 2), 'application/json');

      $('#expc').onclick = () => {
        const righe = [['titolo', 'inizio', 'fine', 'durata_spostamento', 'nota_generale', 'squadra', 'luogo', 'istruzioni_spostamento', 'nota_team']];
        for (const f of Fasce) {
          const ps = f.personalizzazioni || [];
          if (!ps.length) righe.push([f.titolo, f.inizio, f.fine || '', f.durataSpostamento || 0, f.note || '', '', '', '', '']);
          for (const p of ps) righe.push([f.titolo, f.inizio, f.fine || '', f.durataSpostamento || 0, f.note || '', p.ruolo, p.tappa, p.istruzioniSpostamento || p.istruzioni || '', p.note || '']);
        }
        scarica('programma.csv', csv(righe), 'text/csv');
      };

      $('#doimp').onclick = () => {
        const testo = $('#imp').value.trim();
        if (!testo) return $('#aerr').textContent = 'Incolla qualcosa prima.';
        try {
          if (testo.startsWith('{')) {
            const d = JSON.parse(testo);
            if (!Array.isArray(d.fasce)) throw new Error('Nel JSON manca "fasce".');
            Fasce = d.fasce.map((f, n) => ({
              id: f.id || 'f' + uid(),
              titolo: (f.titolo || '').trim() || (n + 1) + 'ª fase',
              inizio: iso(f.inizio),
              fine: f.fine ? iso(f.fine) : null,
              durataSpostamento: parseInt(f.durataSpostamento || 0, 10),
              note: f.note || '',
              personalizzazioni: (f.personalizzazioni || []).map(p => ({
                id: p.id || 'p' + uid(), ruolo: p.ruolo, tappa: p.tappa || '', istruzioniSpostamento: p.istruzioniSpostamento || p.istruzioni || '', note: p.note || ''
              }))
            }));
          } else {
            const righe = leggiCsv(testo);
            if (!righe.length || !('titolo' in righe[0])) throw new Error('CSV non valido: richiede la colonna titolo.');
            const perTitolo = new Map();
            for (const r of righe) {
              const k = (r.titolo || '').trim() || 'Senza titolo';
              if (!perTitolo.has(k)) {
                perTitolo.set(k, {
                  id: 'f' + uid(), titolo: k, inizio: iso(r.inizio), fine: r.fine ? iso(r.fine) : null,
                  durataSpostamento: parseInt(r.durata_spostamento || 0, 10), note: r.nota_generale || '', personalizzazioni: []
                });
              }
              const f = perTitolo.get(k);
              const sq = (r.squadra || '').trim();
              if (sq && !f.personalizzazioni.some(p => p.ruolo === sq))
                f.personalizzazioni.push({ id: 'p' + uid(), ruolo: sq, tappa: (r.luogo || '').trim(), istruzioniSpostamento: (r.istruzioni_spostamento || '').trim(), note: (r.nota_team || '').trim() });
            }
            Fasce = [...perTitolo.values()];
          }
          $('#imp').value = '';
          $('#aerr').textContent = '';
          disegnaFasiEditor(); segnaSporco();
          avvisa(`Importate ${Fasce.length} fasi`);
        } catch (x) { $('#aerr').textContent = 'Import non riuscito: ' + x.message; }
      };
    }
  };

  $('#tabDash').onclick = () => { S.tabAdmin = 'dashboard'; updateTabs(); renderTab(); };
  $('#tabTl').onclick = () => { S.tabAdmin = 'timeline'; updateTabs(); renderTab(); };
  $('#tabMod').onclick = () => { S.tabAdmin = 'modifica'; updateTabs(); renderTab(); };

  function updateTabs() {
    $('#tabDash').className = `tab-btn ${S.tabAdmin === 'dashboard' ? 'active' : ''}`;
    $('#tabTl').className = `tab-btn ${S.tabAdmin === 'timeline' ? 'active' : ''}`;
    $('#tabMod').className = `tab-btn ${S.tabAdmin === 'modifica' ? 'active' : ''}`;
  }

  renderTab();
}

const segnaSporco = () => {
  sporco = true;
  const d = $('#dirty'); if (d) d.hidden = false;
};

const testataFase = f => `<div class="riga"><div>
    <b>${esc(f.titolo)}</b>
    <small>${fmt(f.inizio)}${dataOk(f.fine) ? ' — ' + fmt(f.fine) : ''} · Spostamento: ${f.durataSpostamento || 0}m ${(f.personalizzazioni || []).length ? ' · ' + f.personalizzazioni.length + ' squadre' : ''}</small>
  </div><div class="btnx">
    <button class="x" data-e="${esc(f.id)}" title="Modifica fase">&#9998;</button>
    <button class="x" data-d="${esc(f.id)}" title="Elimina fase">&times;</button></div></div>
  ${f.note ? `<p class="mut">${esc(f.note)}</p>` : ''}`;

const modFase = f => `<form class="mod" data-f="${esc(f.id)}">
  <label>Titolo</label><input name="titolo" value="${esc(f.titolo)}" required autocomplete="off">
  <div class="tre">
    <div><label>Inizio</label><input type="datetime-local" name="inizio" value="${perInput(f.inizio)}" required></div>
    <div><label>Fine</label><input type="datetime-local" name="fine" value="${perInput(f.fine)}"></div>
    <div><label>Spostamento (min)</label><input type="number" name="durataSpostamento" value="${f.durataSpostamento || 0}" min="0"></div>
  </div>
  <label>Nota generale per tutti</label><input name="nota" value="${esc(f.note || '')}" autocomplete="off">
  <button class="btn">Salva fase</button></form>`;

const rigaSquadra = (f, p) => `<div class="riga"><div>
    <b>${esc(p.ruolo)}</b> → Luogo: <i>${esc(p.tappa || 'N/D')}</i>
    ${p.istruzioniSpostamento ? `<small>Spostamento: ${esc(p.istruzioniSpostamento)}</small>` : ''}
    ${p.note ? `<small>Nota team: ${esc(p.note)}</small>` : ''}
  </div><div class="btnx">
    <button class="x" data-pe="${esc(p.id)}" data-f="${esc(f.id)}" title="Modifica">&#9998;</button>
    <button class="x" data-pd="${esc(p.id)}" data-f="${esc(f.id)}" title="Elimina">&times;</button></div></div>`;

const modSquadra = (f, p) => `<form class="mod mod-p" data-f="${esc(f.id)}" data-p="${esc(p.id)}">
  <label>Squadra / Aula</label><select name="ruolo">${optSquadra(p.ruolo)}</select>
  <label>Luogo personale del team</label><input name="tappa" value="${esc(p.tappa || '')}" placeholder="es. Laboratorio 2" autocomplete="off">
  <label>Istruzioni per lo spostamento</label><textarea name="istruzioniSpostamento" rows="2" placeholder="es. Prendi le scale B e vai al 1° piano">${esc(p.istruzioniSpostamento || p.istruzioni || '')}</textarea>
  <label>Note personali per questo team</label><input name="note" value="${esc(p.note || '')}" placeholder="es. Controllare i badge prima di entrare">
  <button class="btn">Salva squadra</button></form>`;

const aggSquadra = f => `<form class="agg" data-f="${esc(f.id)}">
  <div class="due">
    <div><label>Squadra / Aula</label><select name="ruolo">${optSquadra('')}</select></div>
    <div><label>Luogo personale</label><input name="tappa" placeholder="es. Laboratorio 2" autocomplete="off"></div>
  </div>
  <label>Istruzioni per lo spostamento</label><textarea name="istruzioniSpostamento" rows="2" placeholder="es. Prendi le scale B e vai al 1° piano"></textarea>
  <label>Note personali per questo team</label><input name="note" placeholder="es. Controllare le schede agli ingressi">
  <button class="btn ghost">Aggiungi personalizzazione team</button></form>`;

function disegnaFasiEditor() {
  const el = $('#lf');
  if (!el) return;
  el.innerHTML = [...Fasce]
    .sort((a, b) => new Date(a.inizio) - new Date(b.inizio))
    .map(f => `<li class="fz">
      ${edF === f.id ? modFase(f) : testataFase(f)}
      <div class="ps">${(f.personalizzazioni || []).map(p => edP === p.id ? modSquadra(f, p) : rigaSquadra(f, p)).join('')
        || '<p class="mut piccolo">Nessuna istruzione personalizzata per team.</p>'}</div>
      ${edF === f.id ? '' : aggSquadra(f)}
    </li>`).join('') || '<li class="vuoto">Nessuna fase creata.</li>';

  $('#lf').onclick = e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset) return;
    const d = b.dataset;
    if (d.e !== undefined) { edF = d.e; edP = null; disegnaFasiEditor(); }
    else if (d.pe !== undefined) { edP = d.pe; edF = null; disegnaFasiEditor(); }
    else if (d.d !== undefined) {
      const f = Fasce.find(x => x.id === d.d);
      if (f && confirm(`Eliminare la fase "${f.titolo}"?`)) {
        Fasce = Fasce.filter(x => x.id !== d.d);
        edF = null;
        disegnaFasiEditor(); segnaSporco();
        avvisa('Fase eliminata');
      }
    } else if (d.pd !== undefined) {
      const f = Fasce.find(x => x.id === d.f);
      if (!f) return;
      f.personalizzazioni = f.personalizzazioni.filter(p => p.id !== d.pd);
      disegnaFasiEditor(); segnaSporco();
      avvisa('Personalizzazione squadra rimossa');
    }
  };

  $('#lf').onsubmit = e => {
    e.preventDefault();
    const form = e.target, d = new FormData(form);
    const f = Fasce.find(x => x.id === form.dataset.f);
    if (!f) return;
    let msg;
    if (form.classList.contains('mod-p')) {
      const p = f.personalizzazioni.find(x => x.id === form.dataset.p);
      if (!p) return;
      const ruolo = d.get('ruolo');
      if (f.personalizzazioni.some(x => x.id !== p.id && x.ruolo === ruolo))
        return avvisa(`"${ruolo}" ha già una riga in "${f.titolo}"`, true);
      p.ruolo = ruolo;
      p.tappa = (d.get('tappa') || '').trim();
      p.istruzioniSpostamento = (d.get('istruzioniSpostamento') || '').trim();
      p.note = (d.get('note') || '').trim();
      edP = null;
      msg = 'Squadra aggiornata';
    } else if (form.classList.contains('agg')) {
      const ruolo = d.get('ruolo');
      if (f.personalizzazioni.some(p => p.ruolo === ruolo))
        return avvisa(`"${ruolo}" ha già una riga in "${f.titolo}"`, true);
      f.personalizzazioni.push({
        id: 'p' + uid(), ruolo,
        tappa: (d.get('tappa') || '').trim(),
        istruzioniSpostamento: (d.get('istruzioniSpostamento') || '').trim(),
        note: (d.get('note') || '').trim()
      });
      msg = 'Squadra aggiunta';
    } else {
      const inizio = iso(d.get('inizio'));
      if (!inizio) return avvisa('Scegli un orario di inizio valido', true);
      f.titolo = (d.get('titolo') || '').trim() || 'Senza titolo';
      f.inizio = inizio;
      f.fine = d.get('fine') ? iso(d.get('fine')) : null;
      f.durataSpostamento = parseInt(d.get('durataSpostamento') || 0, 10);
      f.note = (d.get('nota') || '').trim();
      edF = null;
      msg = 'Fase aggiornata';
    }
    disegnaFasiEditor(); segnaSporco();
    avvisa(msg);
  };
}

boot();