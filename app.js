'use strict';
/* ---------- Configurazione ---------- */
const CFG = {
  API: '/api',              // '' = nessun server, l'app va coi dati di esempio
  VAPID: '',                // chiave pubblica VAPID per le push
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

/* Una data non valida non deve mai far cadere la schermata: toLocaleTimeString
   lancia RangeError su "Invalid Date", e l'errore si porta dietro tutti gli
   handler già registrati. Qui diventa un "--:--" e si va avanti. */
const dataOk = d => d != null && d !== '' && !isNaN(new Date(d));
const iso = d => (dataOk(d) ? new Date(d).toISOString() : null);
const fmt = d => (dataOk(d) ? new Date(d).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '--:--');
const fmtOrologio = d => `${fmt(d)}<small>${String(d.getSeconds()).padStart(2, '0')}</small>`;
// Formato atteso da <input type="datetime-local">: ora locale, minuti di precisione.
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

// Lettore CSV minimale con supporto alle virgolette, per reimportare un file
// sistemato su un foglio di calcolo.
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

/* ---------- Aspettare, avvisare, riprovare ---------- */
// Ogni richiesta ha un tetto. Senza, una rete morta lascia la pagina muta per
// sempre: sembra un crash, non un problema di connessione.
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

// Conferme ed errori in basso, spariscono da soli.
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

// Il pulsante dichiara che sta lavorando: così non lo si tocca due volte.
const attesa = (b, testo = 'Attendo...') => { if (b) { b.disabled = true; b.dataset.t = b.textContent; b.textContent = testo; } };
const pronto = b => { if (b) { b.disabled = false; if (b.dataset.t) b.textContent = b.dataset.t; } };

// Tre barre che si muovono al posto dei dati: la pagina non resta muta e non
// salta di altezza quando i dati arrivano.
const scheletro = `<ol class="tl" id="tl">${[0, 1, 2].map(() =>
  `<li class="it sk"><div class="tm"><span class="br s2"></span></div><div class="rail"></div>
   <div class="nd"><span class="br s6"></span><span class="br s4"></span></div></li>`).join('')}</ol>`;

/* ---------- Rilevamento ambiente ---------- */
const q = new URLSearchParams(location.search), ua = navigator.userAgent;
const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const env = {
  ios: /iPhone|iPad|iPod/.test(ua) || ipad,
  mobile: q.has('m') || /Android|iPhone|iPad|iPod/.test(ua) || ipad,
  standalone: q.has('s') || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
};
const S = { role: store.get('role'), token: store.get('token'), admin: false, sig: '' };
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });

/* ---------- Ruoli ---------- */
const GROUPS = CFG.GROUPS;
const GROUP_OF = new Map();
GROUPS.forEach(g => { GROUP_OF.set(g.label, g.label); g.units.forEach(u => GROUP_OF.set(u, g.label)); });

// Ruolo salvato da una versione precedente: non esiste più, ripartiamo puliti.
if (S.role && S.role !== CFG.ADMIN && !GROUP_OF.has(S.role)) {
  S.role = null; S.token = null;
  store.del('role'); store.del('token');
}

// Admin = ha un token firmato dal server. Il ruolo da solo non basta: quello
// lo può cambiare chiunque dalla console del browser.
const isAdmin = () => !!S.token;
const gruppo = () => (S.role ? (GROUP_OF.get(S.role) || '') : '');
const sameSquadra = g => S.role && GROUP_OF.get(g.label) === gruppo();

// Le squadre selezionabili: la squadra intera (vale per tutte le unità) oppure
// una singola unità.
const optSquadra = sel => GROUPS.map(g =>
  `<optgroup label="${esc(g.label)}"><option value="${esc(g.label)}"${sel === g.label ? ' selected' : ''}>${esc(g.label)} — tutta la squadra</option>` +
  g.units.map(u => `<option value="${esc(u)}"${sel === u ? ' selected' : ''}>${esc(u)}</option>`).join('') +
  '</optgroup>').join('');

/* ---------- Fasi ---------- */
let Fasce = [];
let inCorso = false;
let edF = null, edP = null, sporco = false;

function demoFasce() {
  const t = m => new Date(Date.now() + m * 6e4).toISOString();
  return [
    { id: 'f1', titolo: 'Briefing generale', inizio: t(-120), fine: t(-75), note: 'Badge obbligatorio.', personalizzazioni: [] },
    {
      id: 'f2', titolo: 'Preparazione e raccolta', inizio: t(-40), fine: t(20), note: '', personalizzazioni: [
        { id: 'p1', ruolo: 'Aula', tappa: '', istruzioni: 'Resta nella tua aula, controlla banchi e materiali, poi apri le porte.' },
        { id: 'p2', ruolo: 'Corridoio', tappa: 'Corridoio centrale', istruzioni: 'Fai il giro di tutti i banchi. Radio canale 1.' }
      ]
    },
    {
      id: 'f3', titolo: 'Laboratori', inizio: t(35), fine: t(80), note: '', personalizzazioni: [
        { id: 'p3', ruolo: 'Aula 1', tappa: 'Laboratorio 1', istruzioni: 'Prendi la scala A1-A2, piano A1, prima porta a destra.' },
        { id: 'p4', ruolo: 'Aula 2', tappa: 'Laboratorio 1', istruzioni: 'Prendi la scala A1-A2, piano A1, prima porta a destra.' },
        { id: 'p5', ruolo: 'Aula 3', tappa: 'Laboratorio 2', istruzioni: 'Prendi la scala A1-A2, sali al piano A2, va in fondo.' },
        { id: 'p6', ruolo: 'Aula 5', tappa: 'Laboratorio 2', istruzioni: 'Prendi la scala A1-A2, sali al piano A2, va in fondo.' },
        { id: 'p7', ruolo: 'Aula 6', tappa: 'Laboratorio 3', istruzioni: 'Prendi la scala B1-B2, piano B1, a sinistra.' },
        { id: 'p8', ruolo: 'Aula 8', tappa: 'Laboratorio 3', istruzioni: 'Prendi la scala B1-B2, piano B1, a sinistra.' },
        { id: 'p9', ruolo: 'Corridoio', tappa: 'Corridoio centrale', istruzioni: 'Accompagni di sezione in sezione: non resti in un laboratorio fisso.' }
      ]
    },
    { id: 'f4', titolo: 'Rientro e chiusura', inizio: t(150), fine: t(210), note: 'Badge e radio restituite al presidio.', personalizzazioni: [] }
  ];
}

/* ---------- Avvio ---------- */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(console.warn);
  if (env.mobile && !env.standalone) return showInstall();
  if (env.mobile) await notifGate();
  S.role || isAdmin() ? showTimeline() : showRoles();
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

/* ---------- Push ---------- */
const b64u8 = s => Uint8Array.from(atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function subscribePush() {
  if (!ONLINE || !CFG.VAPID || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) ||
      await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u8(CFG.VAPID) });
    await chiedi(CFG.API + '/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, ruolo: S.role, admin: isAdmin() })
    }, 15000);
  } catch (e) { console.warn('push', e); }
}

/* ---------- Scelta ruolo e login admin ---------- */
function showRoles() {
  screen.innerHTML = `<div class="wrap"><h1>Dove lavori?</h1>
    <p class="mut">Vedrai solo gli orari e gli avvisi che ti riguardano. Puoi cambiarlo quando vuoi.</p>
    <div class="roles">${GROUPS.map(g => `<button class="role${sameSquadra(g) ? ' on' : ''}" data-g="${esc(g.label)}">${esc(g.label)}${g.units.length ? `<small>${g.units.length} aule</small>` : ''}</button>`).join('')}</div>
    ${isAdmin() ? '<button class="btn ghost" id="adm2">Amministra le fasi</button>' : ''}
    <button class="btn ghost" id="adm">Sono un admin</button><div id="admbox"></div>
    ${S.role ? '<button class="btn ghost" id="back">Torna al programma</button>' : ''}</div>`;
  screen.querySelectorAll('.role').forEach(b => b.onclick = () => {
    const g = GROUPS.find(x => x.label === b.dataset.g);
    g.units.length ? showUnits(g) : setRole(g.label);
  });
  $('#back')?.addEventListener('click', showTimeline);
  $('#adm2')?.addEventListener('click', showAdmin);
  $('#adm').onclick = adminForm;
}

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
  subscribePush();
  showTimeline();
}

function adminForm() {
  $('#admbox').innerHTML = `<form class="box" id="af"><label for="pw">Password admin</label>
    <input type="password" id="pw" autocomplete="current-password" required>
    <button class="btn">Entra</button><p class="bad" id="err"></p></form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err'), b = $('#af').querySelector('button');
    if (!ONLINE) { err.textContent = 'Server non configurato: la password si verifica solo sul server.'; return; }
    attesa(b, 'Verifico...');
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'login', password: $('#pw').value })
      }, 12000);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.errore || 'Password errata.');
      S.token = d.token; store.set('token', d.token);
      err.textContent = '';
      avvisa('Accesso consentito');
      S.role ? showTimeline() : showRoles();
    } catch (x) {
      err.textContent = x.message;
      avvisa(x.message, true);
    }
    pronto(b);
  };
}

/* ---------- Caricamento ---------- */
// Il token scaduto è la causa più comune di pagine vuote senza spiegazione:
// me lo dico e lo butto, invece di lasciare l'admin su una lista muta.
function controllaToken() {
  if (!S.token || S.admin) return true;
  S.token = null; store.del('token');
  avvisa('Sessione scaduta: rientra come admin', true);
  return false;
}

async function carica() {
  if (!ONLINE) { Fasce = demoFasce(); S.admin = false; return { demo: true }; }
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
    S.admin = !!d.admin;                 // il server decide, non il token locale
    return {};
  } catch (x) {
    // Meglio dire cosa è successo che sparire in silenzio sui dati di esempio.
    const c = store.get('programma');
    if (c) { Fasce = c.fasce || []; return { offline: true, errore: x.message }; }
    Fasce = demoFasce();
    return { demo: true, errore: x.message };
  }
}

/* ---------- Itinerario ---------- */
function stato(f, k, prossimoIdx, now) {
  const s = new Date(f.inizio), e = f.fine ? new Date(f.fine) : null;
  if (isNaN(s)) return 'later';
  const fine = e && !isNaN(e) ? e : s;   // senza fine, finisce quando inizia
  if (now >= fine) return 'past';
  if (now >= s) return 'now';
  return k === prossimoIdx ? 'next' : 'later';
}

// Fase: una voce del programma, con pallino e orario. Per l'admin c'è in più
// l'anteprima di tutte le squadre, così può controllare senza uscire.
const rigoFase = (f, c, m, admin) => `<li class="it ${c}"><div class="tm">${fmt(f.inizio)}${dataOk(f.fine) ? `<small>fino ${fmt(f.fine)}</small>` : ''}</div><div class="rail"></div>
  <div class="nd"><h3>${esc(f.titolo)}${c === 'now' ? '<span class="pill">Adesso</span>' : c === 'next' ? '<span class="pill">Dopo</span>' : ''}</h3>
  ${m?.tappa ? `<p class="loc">${esc(m.tappa)}</p>` : ''}
  ${f.note ? `<p class="mut">${esc(f.note)}</p>` : ''}
  ${admin && (f.personalizzazioni || []).length ? `<ul class="pv">${f.personalizzazioni.map(p => `<li><b>${esc(p.ruolo)}</b>${p.tappa ? ' · ' + esc(p.tappa) : ''}<small>${esc(p.istruzioni || '')}</small></li>`).join('')}</ul>` : ''}
  </div></li>`;

// Tratto: le istruzioni per arrivare alla fase che sta sotto.
const rigoTratto = testo => `<li class="leg"><div class="tm"></div><div class="rail"></div><div class="legtxt">${esc(testo)}</div></li>`;

function renderList(scroll) {
  if (inCorso) return;                          // dati in arrivo: non toccare il DOM
  const now = new Date();
  const ord = [...Fasce].sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const prossimoIdx = ord.findIndex(f => new Date(f.inizio) > now);
  const st = ord.map((f, k) => stato(f, k, prossimoIdx, now));
  const sig = st.join() + S.role + S.admin;
  if (sig === S.sig && !scroll) return;         // niente re-render se non cambia nulla
  S.sig = sig;
  $('#tl').innerHTML = ord.map((f, k) => {
    const m = f.mia || null;
    // Le istruzioni stanno fra una fase e l'altra: sono quelle della fase che
    // sta sotto, perché descrivono come arrivarci. Sulla prima fase non c'è
    // nessuna da cui arrivare, quindi non compaiono.
    return (k > 0 && m?.istruzioni ? rigoTratto(m.istruzioni) : '') + rigoFase(f, st[k], m, S.admin);
  }).join('') || '<li class="vuoto">Nessuna fase in programma.</li>';
  if (scroll) $('.it.now, .it.next')?.scrollIntoView({ block: 'center' });
}

const batto = () => {
  const c = $('#clock');
  if (!c) { clearInterval(S.timer); S.timer = 0; return; }   // su un'altra schermata: basta
  c.innerHTML = fmtOrologio(new Date());
  renderList(false);
};

async function showTimeline() {
  inCorso = true;
  screen.innerHTML = `<header class="top"><b id="clock"></b><button class="chip" id="chg">${esc(S.role || 'Admin')}, cambia</button></header>
    <div class="wrap"><div id="banner"></div>
    ${scheletro}
    ${isAdmin() ? '<button class="btn ghost" id="adm2">Amministra le fasi</button>' : ''}
    ${env.mobile ? '<button class="btn ghost" id="test">Invia notifica di prova</button>' : ''}</div>`;
  $('#chg').onclick = showRoles;
  $('#adm2')?.addEventListener('click', showAdmin);
  $('#test')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Notifica di prova', { body: 'Se leggi questo, sei a posto.', icon: 'icon-192.png' });
  });
  // L'orologio parte subito: è l'unica cosa che non aspetta i dati.
  $('#clock').innerHTML = fmtOrologio(new Date());
  clearInterval(S.timer); S.timer = setInterval(batto, 1000);

  const d = await carica();
  inCorso = false;
  S.sig = '';
  const scaduto = !controllaToken();
  $('#banner').innerHTML = d.offline
    ? `<div class="banner bad">${esc(d.errore)} Stiamo vedendo l'ultimo programma salvato.<button class="btn mini" id="retry">Riprova</button></div>`
    : d.errore ? `<div class="banner bad">${esc(d.errore)} Stiamo usando i dati di esempio.</div>`
      : d.demo ? '<div class="banner">Dati di esempio: il server non è ancora collegato.</div>'
        : !Fasce.length ? '<div class="banner">Nessuna fase in programma: chiedi all\'admin di caricarle.</div>' : '';
  $('#retry')?.addEventListener('click', showTimeline);
  renderList(true);
  if (scaduto) $('#adm2')?.remove();
}

/* ---------- Amministrazione ---------- */
const segnaSporco = () => {
  sporco = true;
  const d = $('#dirty'); if (d) d.hidden = false;
};

const testataFase = f => `<div class="riga"><div>
    <b>${esc(f.titolo)}</b>
    <small>${fmt(f.inizio)}${dataOk(f.fine) ? ' — ' + fmt(f.fine) : ''}${(f.personalizzazioni || []).length ? ' · ' + f.personalizzazioni.length + ' squadre' : ''}</small>
  </div><div class="btnx">
    <button class="x" data-e="${esc(f.id)}" title="Modifica fase">&#9998;</button>
    <button class="x" data-d="${esc(f.id)}" title="Elimina fase">&times;</button></div></div>
  ${f.note ? `<p class="mut">${esc(f.note)}</p>` : ''}`;

const modFase = f => `<form class="mod" data-f="${esc(f.id)}">
  <label>Titolo</label><input name="titolo" value="${esc(f.titolo)}" required autocomplete="off">
  <div class="due"><div><label>Inizio</label><input type="datetime-local" name="inizio" value="${perInput(f.inizio)}" required></div>
    <div><label>Fine</label><input type="datetime-local" name="fine" value="${perInput(f.fine)}"></div></div>
  <label>Nota per tutti</label><input name="nota" value="${esc(f.note || '')}" autocomplete="off">
  <button class="btn">Salva fase</button></form>`;

const rigaSquadra = (f, p) => `<div class="riga"><div>
    <b>${esc(p.ruolo)}</b>${p.tappa ? ' · ' + esc(p.tappa) : ''}
    <small>${esc(p.istruzioni || '')}</small></div><div class="btnx">
    <button class="x" data-pe="${esc(p.id)}" data-f="${esc(f.id)}" title="Modifica">&#9998;</button>
    <button class="x" data-pd="${esc(p.id)}" data-f="${esc(f.id)}" title="Elimina">&times;</button></div></div>`;

const modSquadra = (f, p) => `<form class="mod mod-p" data-f="${esc(f.id)}" data-p="${esc(p.id)}">
  <label>Squadra</label><select name="ruolo">${optSquadra(p.ruolo)}</select>
  <label>Luogo</label><input name="tappa" value="${esc(p.tappa || '')}" placeholder="Laboratorio 2" autocomplete="off">
  <label>Istruzioni per arrivarci</label><textarea name="istruzioni" rows="3" placeholder="Prendi la scala A1-A2, piano A1">${esc(p.istruzioni || '')}</textarea>
  <button class="btn">Salva</button></form>`;

const aggSquadra = f => `<form class="agg" data-f="${esc(f.id)}">
  <div class="due"><div><label>Squadra</label><select name="ruolo">${optSquadra('')}</select></div>
    <div><label>Luogo</label><input name="tappa" placeholder="Laboratorio 2" autocomplete="off"></div></div>
  <label>Istruzioni per arrivarci</label><textarea name="istruzioni" rows="2" placeholder="Prendi la scala A1-A2, piano A1"></textarea>
  <button class="btn ghost">Aggiungi alla squadra</button></form>`;

function disegna() {
  const el = $('#lf');
  if (!el) return;
  el.innerHTML = [...Fasce]
    .sort((a, b) => new Date(a.inizio) - new Date(b.inizio))
    .map(f => `<li class="fz">
      ${edF === f.id ? modFase(f) : testataFase(f)}
      <div class="ps">${(f.personalizzazioni || []).map(p => edP === p.id ? modSquadra(f, p) : rigaSquadra(f, p)).join('')
        || '<p class="mut piccolo">Nessuna squadra personalizzata: vedranno la fase e basta.</p>'}</div>
      ${edF === f.id ? '' : aggSquadra(f)}
    </li>`).join('') || '<li class="vuoto">Nessuna fase. Aggiungine una sopra.</li>';
}

async function showAdmin() {
  screen.innerHTML = `<header class="top"><b>Amministrazione</b><button class="chip" id="esci">Esci</button></header>
    <div class="wrap">
      <h2>Fasi</h2>
      <p class="mut">Valgono per tutti. Sotto ogni fase puoi dire a ogni squadra dove trovarsi e come arrivarci.</p>
      <form class="box" id="ff">
        <label>Titolo</label><input name="titolo" required autocomplete="off" placeholder="Laboratori">
        <div class="due"><div><label>Inizio</label><input type="datetime-local" name="inizio" required></div>
          <div><label>Fine</label><input type="datetime-local" name="fine"></div></div>
        <label>Nota per tutti</label><input name="nota" autocomplete="off" placeholder="Badge obbligatorio">
        <button class="btn">Aggiungi fase</button></form>
      <ul class="lst" id="lf"></ul>

      <h2>Salva, esporta, importa</h2>
      <p class="mut">Finché non salvi, le modifiche stanno solo su questa pagina.</p>
      <p class="bad" id="dirty" hidden>Ci sono modifiche non salvate.</p>
      <button class="btn" id="salva">Salva sul server</button>
      <button class="btn ghost" id="expj">Scarica JSON</button>
      <button class="btn ghost" id="expc">Scarica CSV</button>
      <button class="btn ghost" id="log">Esci e scarta le modifiche</button>
      <label for="imp">Incolla qui un JSON o un CSV del programma</label>
      <textarea id="imp" rows="6" placeholder='{"fasce":[...]}'></textarea>
      <button class="btn ghost" id="doimp">Importa</button>
      <p class="bad" id="aerr"></p>
    </div>`;

  $('#ff [name=inizio]').value = perInput(Date.now());
  $('#ff').onsubmit = e => {
    e.preventDefault();
    const d = new FormData(e.target);
    const titolo = (d.get('titolo') || '').trim();
    if (!titolo) return avvisa('Metti un titolo alla fase', true);
    const inizio = iso(d.get('inizio'));
    if (!inizio) return avvisa('Scegli un orario di inizio valido', true);
    Fasce.push({
      id: 'f' + uid(), titolo, inizio,
      fine: d.get('fine') ? iso(d.get('fine')) : null,
      note: (d.get('nota') || '').trim(), personalizzazioni: []
    });
    e.target.reset();
    $('#ff [name=inizio]').value = perInput(Date.now());
    disegna(); segnaSporco();
    avvisa('Fase aggiunta');
  };

  $('#lf').onclick = e => {
    const b = e.target.closest('button');
    if (!b || !b.dataset) return;
    const d = b.dataset;
    if (d.e !== undefined) { edF = d.e; edP = null; disegna(); }
    else if (d.pe !== undefined) { edP = d.pe; edF = null; disegna(); }
    else if (d.d !== undefined) {
      const f = Fasce.find(x => x.id === d.d);
      if (f && confirm(`Eliminare la fase "${f.titolo}"?`)) {
        Fasce = Fasce.filter(x => x.id !== d.d);
        edF = null;
        disegna(); segnaSporco();
        avvisa('Fase eliminata');
      }
    } else if (d.pd !== undefined) {
      const f = Fasce.find(x => x.id === d.f);
      if (!f) return;
      f.personalizzazioni = f.personalizzazioni.filter(p => p.id !== d.pd);
      disegna(); segnaSporco();
      avvisa('Squadra rimossa');
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
      p.ruolo = ruolo; p.tappa = (d.get('tappa') || '').trim(); p.istruzioni = (d.get('istruzioni') || '').trim();
      edP = null;
      msg = 'Squadra aggiornata';
    } else if (form.classList.contains('agg')) {
      const ruolo = d.get('ruolo');
      if (f.personalizzazioni.some(p => p.ruolo === ruolo))
        return avvisa(`"${ruolo}" ha già una riga in "${f.titolo}"`, true);
      f.personalizzazioni.push({ id: 'p' + uid(), ruolo, tappa: (d.get('tappa') || '').trim(), istruzioni: (d.get('istruzioni') || '').trim() });
      msg = 'Squadra aggiunta';
    } else {
      const inizio = iso(d.get('inizio'));
      if (!inizio) return avvisa('Scegli un orario di inizio valido', true);
      f.titolo = (d.get('titolo') || '').trim() || 'Senza titolo';
      f.inizio = inizio;
      f.fine = d.get('fine') ? iso(d.get('fine')) : null;
      f.note = (d.get('nota') || '').trim();
      edF = null;
      msg = 'Fase aggiornata';
    }
    disegna(); segnaSporco();
    avvisa(msg);
  };

  $('#salva').onclick = async () => {
    const b = $('#salva');
    attesa(b, 'Salvo...');
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
        body: JSON.stringify({ azione: 'salva', fasce: Fasce })
      }, 15000);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.errore || 'Salvataggio fallito.');
      sporco = false;
      $('#dirty').hidden = true;
      $('#aerr').textContent = '';
      avvisa(`Salvato: ${d.fasce} fasi`);
    } catch (x) {
      $('#aerr').textContent = x.message;
      avvisa(x.message, true);
    }
    pronto(b);
  };

  $('#expj').onclick = () => scarica('programma.json', JSON.stringify({ fasce: Fasce }, null, 2), 'application/json');

  // Il CSV è una riga per personalizzazione: è la vista che serve per rivedere
  // il piano su un foglio di calcolo, e ci sta anche la nota della fase.
  $('#expc').onclick = () => {
    const righe = [['titolo', 'inizio', 'fine', 'nota', 'squadra', 'luogo', 'istruzioni']];
    for (const f of Fasce) {
      const ps = f.personalizzazioni || [];
      if (!ps.length) righe.push([f.titolo, f.inizio, f.fine || '', f.note || '', '', '', '']);
      for (const p of ps) righe.push([f.titolo, f.inizio, f.fine || '', f.note || '', p.ruolo, p.tappa, p.istruzioni]);
    }
    scarica('programma.csv', csv(righe), 'text/csv');
  };

  $('#log').onclick = () => {
    if (sporco && !confirm('Ci sono modifiche non salvate. Esci e scartale?')) return;
    S.token = null; store.del('token'); S.admin = false;
    showRoles();
  };
  $('#esci').onclick = showTimeline;

  $('#doimp').onclick = () => {
    const testo = $('#imp').value.trim();
    if (!testo) return $('#aerr').textContent = 'Incolla qualcosa prima.';
    try {
      if (testo.startsWith('{')) {
        const d = JSON.parse(testo);
        if (!Array.isArray(d.fasce)) throw new Error('Nel JSON manca "fasce".');
        // Una data non valida viene rifiutata qui, col nome della fase: entrare
        // senza controllo rompeva l'intera pagina di amministrazione.
        Fasce = d.fasce.map((f, n) => {
          const nome = (f.titolo || '').trim() || (n + 1) + 'ª fase';
          const inizio = iso(f.inizio);
          if (!inizio) throw new Error(`"${nome}": inizio non è una data valida (es. 2026-11-14T09:00).`);
          const fine = f.fine ? iso(f.fine) : null;
          if (f.fine && !fine) throw new Error(`"${nome}": fine non è una data valida.`);
          return {
            id: f.id || 'f' + uid(), titolo: nome, inizio, fine, note: f.note || '',
            personalizzazioni: (f.personalizzazioni || []).map(p => ({
              id: p.id || 'p' + uid(), ruolo: p.ruolo, tappa: p.tappa || '', istruzioni: p.istruzioni || ''
            }))
          };
        });
      } else {
        const righe = leggiCsv(testo);
        if (!righe.length || !('titolo' in righe[0]))
          throw new Error('Il CSV deve avere le colonne titolo, squadra, luogo, istruzioni.');
        const perTitolo = new Map();
        for (const r of righe) {
          const k = (r.titolo || '').trim() || 'Senza titolo';
          if (!perTitolo.has(k)) {
            const inizio = iso(r.inizio);
            if (!inizio) throw new Error(`"${k}": la colonna inizio non è una data valida.`);
            const fine = r.fine ? iso(r.fine) : null;
            if (r.fine && !fine) throw new Error(`"${k}": la colonna fine non è una data valida.`);
            perTitolo.set(k, { id: 'f' + uid(), titolo: k, inizio, fine, note: r.nota || '', personalizzazioni: [] });
          }
          const f = perTitolo.get(k);
          const sq = (r.squadra || '').trim();
          if (sq && !f.personalizzazioni.some(p => p.ruolo === sq))
            f.personalizzazioni.push({ id: 'p' + uid(), ruolo: sq, tappa: (r.luogo || '').trim(), istruzioni: (r.istruzioni || '').trim() });
        }
        Fasce = [...perTitolo.values()];
      }
      $('#imp').value = '';
      $('#aerr').textContent = '';
      edF = edP = null;
      disegna(); segnaSporco();
      avvisa(`Importate ${Fasce.length} fasi`);
    } catch (x) { $('#aerr').textContent = 'Import non riuscito: ' + x.message; }
  };

  // Prima mostra subito quello che c'è in memoria, poi allinea col server: se il
  // token è scaduto il server lo dice, e non serve fingere.
  disegna();
  inCorso = true;
  await carica();
  inCorso = false;
  if (!controllaToken()) return showRoles();
  edF = edP = null;
  disegna();
}

boot();