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
const fmt = d => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const fmtOrologio = d => `${fmt(d)}<small>${String(d.getSeconds()).padStart(2, '0')}</small>`;

// L'id di una tappa/spostamento: nome normalizzato, con suffisso se esiste già.
const slug = n => String(n).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
const idUnico = (base, gia) => {
  let id = base, n = 2;
  while (gia.includes(id)) id = `${base}-${n++}`;
  return id;
};

const scarica = (nome, testo, tipo) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([testo], { type: tipo }));
  a.download = nome; a.click(); URL.revokeObjectURL(a.href);
};
const csv = righe => righe.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');

// Lettore CSV minimale, con supporto alle virgolette: serve per incollare
// indietro un file sistemato su un foglio di calcolo.
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
  return corpo.filter(x => x.some(y => y !== '')).map(x => Object.fromEntries(testata.map((k, i) => [k.trim(), x[i] ?? ''])));
}

/* ---------- Rilevamento ambiente ---------- */
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
const GROUP_LABEL = new Set(GROUPS.map(g => g.label));
const GROUP_OF = new Map();
GROUPS.forEach(g => { GROUP_OF.set(g.label, g.label); g.units.forEach(u => GROUP_OF.set(u, g.label)); });

if (S.role && S.role !== CFG.ADMIN && !GROUP_OF.has(S.role)) {
  S.role = null; S.token = null;
  store.del('role'); store.del('token');
}

// Admin = ha un token firmato dal server. Non basta il ruolo: quello lo
// può cambiare chiunque dalla console del browser.
const isAdmin = () => !!S.token;
const roleMatches = r => r === S.role || (GROUP_LABEL.has(r) && GROUP_OF.get(r) === GROUP_OF.get(S.role));
const visible = i => isAdmin() || !i.ruoli?.length || i.ruoli.some(roleMatches);
const isGroup = r => S.role && GROUP_OF.get(r) === GROUP_OF.get(S.role);

/* ---------- Luogo: tappe e spostamenti ---------- */
let Tappe = [], Spostamenti = [];
const SCALA = ['Scala A1-A2', 'Scala B1-B2'];

const LUOGO_DEMO = {
  tappe: ['Ingresso A', 'Corridoio centrale', 'Sala principale', 'Deposito materiali', ...SCALA,
    'Laboratorio 1', 'Laboratorio 2', 'Laboratorio 3', ...GROUPS.flatMap(g => g.units)]
    .map(nome => ({ id: slug(nome), nome })),
  spostamenti: [
    { da: 'Ingresso A', a: 'Corridoio centrale', istruzione: 'Tieni la destra, i cartelli blu' },
    { da: 'Ingresso A', a: 'Sala principale', istruzione: 'A destra, oltre la porta vetrata' },
    { da: 'Corridoio centrale', a: 'Sala principale', istruzione: 'Oltre il bancone della reception' },
    { da: 'Corridoio centrale', a: 'Deposito materiali', istruzione: 'In fondo a sinistra' },
    { da: 'Corridoio centrale', a: 'Scala A1-A2', istruzione: 'In fondo al corridoio, a sinistra' },
    { da: 'Corridoio centrale', a: 'Scala B1-B2', istruzione: 'Sul lato opposto del corridoio' },
    { da: 'Scala A1-A2', a: 'Laboratorio 1', istruzione: 'Piano A1, prima porta a destra' },
    { da: 'Scala A1-A2', a: 'Laboratorio 2', istruzione: 'Salendo, piano A2, in fondo' },
    { da: 'Scala B1-B2', a: 'Laboratorio 3', istruzione: 'Piano B1, a sinistra' },
    ...GROUPS.flatMap(g => g.units.map(u => ({ da: 'Corridoio centrale', a: u, istruzione: 'Segui i cartelli col numero dell\'aula' })))
  ].map((s, i) => ({ id: slug(`${s.da}-${s.a}`) + (i ? '-' + i : ''), ...s }))
};

const PARTENZA = { 'Corridoio': 'Ingresso A', 'Aula': '@Aula' };
const risolvi = t => t?.[0] !== '@' ? t
  : isAdmin() ? t.slice(1) + ' (tutte)'
    : GROUP_OF.get(S.role) === t.slice(1) ? S.role : t;

function percorso(da, a) {
  if (!da || !a || da === a) return null;
  const coda = [{ tappa: da, passi: [] }], visto = new Set([da]);
  while (coda.length) {
    const { tappa, passi } = coda.shift();
    if (tappa === a) return passi;
    for (const l of Spostamenti) {
      if (l.da !== tappa && l.a !== tappa) continue;
      const prossimo = l.da === tappa ? l.a : l.da;
      if (visto.has(prossimo)) continue;
      visto.add(prossimo);
      coda.push({ tappa: prossimo, passi: [...passi, { tappa: prossimo, come: l.istruzione }] });
    }
  }
  return null;
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
    await fetch(CFG.API + '/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub, ruolo: S.role, admin: isAdmin() })
    });
  } catch (e) { console.warn('push', e); }
}

/* ---------- Scelta ruolo e login admin ---------- */
function showRoles() {
  screen.innerHTML = `<div class="wrap"><h1>Dove lavori?</h1>
    <p class="mut">Vedrai solo gli orari e gli avvisi che ti riguardano. Puoi cambiarlo quando vuoi.</p>
    <div class="roles">${GROUPS.map(g => `<button class="role${isGroup(g.label) ? ' on' : ''}" data-g="${esc(g.label)}">${esc(g.label)}${g.units.length ? `<small>${g.units.length} aule</small>` : ''}</button>`).join('')}</div>
    ${isAdmin() ? '<button class="btn ghost" id="adm2">Amministra tappe e spostamenti</button>' : ''}
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
    const err = $('#err');
    if (!ONLINE) { err.textContent = 'Server non configurato: la password si verifica solo sul server.'; return; }
    try {
      const r = await fetch(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'login', password: $('#pw').value })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.errore || 'Password errata.');
      S.token = d.token; store.set('token', d.token);
      if (!S.role) { err.textContent = ''; return showRoles(); }
      showTimeline();
    } catch (x) { err.textContent = x.message; }
  };
}

/* ---------- Caricamento dati ---------- */
function vociDemo() {
  const t = m => new Date(Date.now() + m * 6e4).toISOString();
  return [
    { id: 'v1', titolo: 'Preparazione aula', ruoli: ['Aula'], inizio: t(-120), fine: t(-75), tappa: '@Aula', note: 'Controlla banchi e materiali, poi apri le porte.' },
    { id: 'v2', titolo: 'Raccolta al corridoio centrale', ruoli: ['Aula'], inizio: t(-40), fine: t(20), tappa: 'Corridoio centrale', notes: 'Aspetta i cartelli verdi.' },
    { id: 'v3', titolo: 'Briefing e consegna turni', ruoli: ['Corridoio'], inizio: t(-120), fine: t(-75), tappa: 'Ingresso A' },
    { id: 'v4', titolo: 'Affiancamento ai laboratori', ruoli: ['Corridoio'], inizio: t(35), fine: t(80), tappa: 'Corridoio centrale', note: 'Di sezione in sezione: non resti in un laboratorio solo.' },
    { id: 'v5', titolo: 'Laboratorio 1', ruoli: ['Aula 1', 'Aula 2'], inizio: t(35), fine: t(80), tappa: 'Laboratorio 1' },
    { id: 'v6', titolo: 'Laboratorio 2', ruoli: ['Aula 3', 'Aula 4', 'Aula 5'], inizio: t(35), fine: t(80), tappa: 'Laboratorio 2', note: 'Aule riunite, si conta sui banchi.' },
    { id: 'v7', titolo: 'Laboratorio 3', ruoli: ['Aula 6', 'Aula 7', 'Aula 8'], inizio: t(35), fine: t(80), tappa: 'Laboratorio 3' },
    { id: 'v8', titolo: 'Rientro e chiusura', ruoli: [], inizio: t(150), fine: t(210), tappa: 'Ingresso A', note: 'Badge e radio restituite al presidio.' }
  ];
}

async function carica() {
  if (!ONLINE) { Tappe = LUOGO_DEMO.tappe; Spostamenti = LUOGO_DEMO.spostamenti; return { items: vociDemo(), demo: true }; }
  try {
    const p = new URLSearchParams({
      role: isAdmin() ? CFG.ADMIN : (S.role || ''),
      gruppo: S.role ? (GROUP_OF.get(S.role) || '') : ''
    });
    const r = await fetch(CFG.API + '/programma?' + p, { cache: 'no-store' });
    if (!r.ok) throw 0;
    const d = await r.json();
    store.set('programma', d);
    Tappe = d.tappe || []; Spostamenti = d.spostamenti || [];
    return { items: d.items || [] };
  } catch {
    const c = store.get('programma');
    if (c) { Tappe = c.tappe || []; Spostamenti = c.spostamenti || []; return { items: c.items || [], stale: true }; }
    Tappe = LUOGO_DEMO.tappe; Spostamenti = LUOGO_DEMO.spostamenti;
    return { items: vociDemo(), demo: true };
  }
}

function status(i, k, nextIdx, now) {
  const s = new Date(i.inizio), e = i.fine ? new Date(i.fine) : null;
  if (now >= (e ?? s) && (e || now >= s)) return 'past';
  if (now >= s) return 'now';
  return k === nextIdx ? 'next' : 'later';
}

/* ---------- Righe dell'itinerario ---------- */
const rigoNodo = (i, c, tappa) => {
  const s = new Date(i.inizio), e = i.fine ? new Date(i.fine) : null;
  return `<li class="it ${c}"><div class="tm">${fmt(s)}${e ? `<small>fino ${fmt(e)}</small>` : ''}</div><div class="rail"></div>
    <div class="nd"><h3>${esc(i.titolo)}${c === 'now' ? '<span class="pill">Adesso</span>' : c === 'next' ? '<span class="pill">Dopo</span>' : ''}</h3>
    ${tappa ? `<p class="loc">${esc(tappa)}</p>` : ''}
    ${i.note ? `<p class="mut">${esc(i.note)}</p>` : ''}</div></li>`;
};
const rigoTratto = (come, avviso) => `<li class="leg${avviso ? ' bad' : ''}"><div class="tm"></div><div class="rail"></div>
  <div class="legtxt">${esc(come)}</div></li>`;
const rigoTappa = t => `<li class="pass"><div class="tm"></div><div class="rail"></div><div class="nd">${esc(t)}</div></li>`;

function renderList(scroll) {
  const now = new Date(), items = S.items.filter(visible).sort((a, b) => new Date(a.inizio) - new Date(b.inizio));
  const nextIdx = items.findIndex(i => new Date(i.inizio) > now);
  const st = items.map((i, k) => status(i, k, nextIdx, now));
  const sig = st.join() + S.role;
  if (sig === S.sig && !scroll) return;
  S.sig = sig;
  const inizio = PARTENZA[GROUP_OF.get(S.role)];
  let da = inizio ? risolvi(inizio) : null;
  $('#tl').innerHTML = items.map((i, k) => {
    const c = st[k], tappa = risolvi(i.tappa), da0 = da, via = percorso(da, tappa);
    if (tappa) da = tappa;
    const tratto = via ? via.map(v => rigoTratto(v.come) + rigoTappa(v.tappa)).join('')
      : da0 && tappa && da0 !== tappa ? rigoTratto(`Nessun collegamento da ${da0} a ${tappa}: chiedi al coordinatore.`, true)
        : '';
    return tratto + rigoNodo(i, c, tappa);
  }).join('') || '<li class="vuoto">Nessuna voce per il tuo ruolo.</li>';
  if (scroll) $('.it.now, .it.next')?.scrollIntoView({ block: 'center' });
}

const batto = () => { $('#clock').innerHTML = fmtOrologio(new Date()); renderList(false); };

async function showTimeline() {
  screen.innerHTML = `<header class="top"><b id="clock"></b><button class="chip" id="chg">${esc(S.role || 'Admin')}, cambia</button></header>
    <div class="wrap"><div id="banner"></div>
    <ol class="tl" id="tl"></ol>
    ${isAdmin() ? '<button class="btn ghost" id="adm2">Amministra tappe e spostamenti</button>' : ''}
    ${env.mobile ? '<button class="btn ghost" id="test">Invia notifica di prova</button>' : ''}</div>`;
  $('#chg').onclick = showRoles;
  $('#adm2')?.addEventListener('click', showAdmin);
  $('#test')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Notifica di prova', { body: 'Se leggi questo, sei a posto.', icon: 'icon-192.png' });
  });
  const d = await carica();
  S.items = d.items; S.sig = '';
  $('#banner').innerHTML = d.demo ? '<div class="banner">Dati di esempio: il server non è ancora collegato.</div>'
    : d.stale ? '<div class="banner">Sei offline: vedi l\'ultimo programma salvato.</div>'
      : !Tappe.length ? '<div class="banner">Nessuna tappa nel database: chiedi all\'admin di aprire le tappe e gli spostamenti.</div>' : '';
  renderList(true);
  batto();
  clearInterval(S.timer); S.timer = setInterval(batto, 1000);
}

/* ---------- Amministrazione: tappe e spostamenti ---------- */
function showAdmin() {
  screen.innerHTML = `<header class="top"><b>Amministrazione</b><button class="chip" id="esci">Esci</button></header>
    <div class="wrap">
      <h2>Tappe</h2>
      <p class="mut">I posti: aule, corridoi, scale, laboratori. Le aule 1-8 devono chiamarsi come i ruoli.</p>
      <form class="box" id="ft"><label for="tn">Nome tappa</label>
        <input id="tn" placeholder="Laboratorio 1" required autocomplete="off">
        <button class="btn">Aggiungi tappa</button></form>
      <ul class="lst" id="lt"></ul>

      <h2>Spostamenti</h2>
      <p class="mut">Come si va da una tappa a un'altra. Si possono percorrere in entrambi i sensi, e il percorso più breve si calcola da solo.</p>
      <form class="box" id="fs">
        <label for="sd">Da</label><select id="sd"></select>
        <label for="sa">A</label><select id="sa"></select>
        <label for="si">Istruzione</label>
        <input id="si" placeholder="Piano A1, prima porta a destra" required autocomplete="off">
        <button class="btn">Aggiungi spostamento</button></form>
      <ul class="lst" id="ls"></ul>

      <h2>Salva, esporta, importa</h2>
      <p class="mut">Finché non salvi, le modifiche stanno solo su questa pagina.</p>
      <button class="btn" id="salva">Salva sul server</button>
      <button class="btn ghost" id="expj">Scarica JSON</button>
      <button class="btn ghost" id="expc">Scarica CSV</button>
      <button class="btn ghost" id="log">Esci e scarta le modifiche</button>
      <label for="imp" class="mut">Incolla qui un JSON o un CSV per sostituire tutto</label>
      <textarea id="imp" rows="6" placeholder='{"tappe":[...],"spostamenti":[...]}'></textarea>
      <button class="btn ghost" id="doimp">Importa</button>
      <p class="bad" id="aerr"></p>
    </div>`;

  const disegna = () => {
    $('#lt').innerHTML = Tappe.map(t => `<li><span>${esc(t.nome)}</span><button class="x" data-id="${esc(t.id)}" aria-label="Elimina ${esc(t.nome)}">&times;</button></li>`).join('')
      || '<li class="vuoto">Nessuna tappa.</li>';
    $('#ls').innerHTML = Spostamenti.map(s => `<li><span>${esc(s.da)} &rarr; ${esc(s.a)}<small>${esc(s.istruzione || '')}</small></span>
      <button class="x" data-id="${esc(s.id)}" aria-label="Elimina">&times;</button></li>`).join('')
      || '<li class="vuoto">Nessuno spostamento.</li>';
    const opt = Tappe.map(t => `<option value="${esc(t.nome)}">${esc(t.nome)}</option>`).join('');
    $('#sd').innerHTML = opt; $('#sa').innerHTML = opt;
    // Le tappe senza spostamento sono isolate: il percorso non esiste e in
    // programma compare "nessun collegamento". Meglio vederlo qui.
    const isolate = Tappe.filter(t => !Spostamenti.some(s => s.da === t.nome || s.a === t.nome));
    $('#aerr').textContent = isolate.length ? `Tappe isolate (irraggiungibili): ${isolate.map(t => t.nome).join(', ')}` : '';
  };
  disegna();

  $('#ft').onsubmit = e => {
    e.preventDefault();
    const nome = $('#tn').value.trim();
    if (!nome) return;
    if (Tappe.some(t => t.nome.toLowerCase() === nome.toLowerCase())) return $('#aerr').textContent = `La tappa "${nome}" esiste già.`;
    Tappe.push({ id: idUnico(slug(nome), Tappe.map(t => t.id)), nome });
    $('#tn').value = ''; disegna();
  };

  $('#fs').onsubmit = e => {
    e.preventDefault();
    const da = $('#sd').value, a = $('#sa').value, istruzione = $('#si').value.trim();
    if (!da || !a || da === a) return $('#aerr').textContent = 'Scegli due tappe diverse.';
    Spostamenti.push({ id: idUnico(slug(`${da}-${a}`), Spostamenti.map(s => s.id)), da, a, istruzione });
    $('#si').value = ''; disegna();
  };

  $('#lt').onclick = e => {
    const id = e.target.dataset.id; if (!id) return;
    const nome = Tappe.find(t => t.id === id)?.nome;
    Tappe = Tappe.filter(t => t.id !== id);
    // Spazzare via anche gli spostamenti che la toccavano, o il grafo si rompe.
    Spostamenti = Spostamenti.filter(s => s.da !== nome && s.a !== nome);
    disegna();
  };
  $('#ls').onclick = e => {
    const id = e.target.dataset.id; if (!id) return;
    Spostamenti = Spostamenti.filter(s => s.id !== id); disegna();
  };

  $('#salva').onclick = async () => {
    const b = $('#salva'); b.disabled = true; b.textContent = 'Salvo...';
    try {
      const r = await fetch(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
        body: JSON.stringify({ azione: 'salva', tappe: Tappe, spostamenti: Spostamenti })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.errore || 'Salvataggio fallito.');
      if (/Token/.test(d.errore || '')) { S.token = null; store.del('token'); showRoles(); return; }
      $('#aerr').textContent = `Salvato: ${d.tappe} tappe, ${d.spostamenti} spostamenti.`;
    } catch (x) { $('#aerr').textContent = x.message; }
    b.disabled = false; b.textContent = 'Salva sul server';
  };

  $('#expj').onclick = () => scarica('luogo.json', JSON.stringify({ tappe: Tappe, spostamenti: Spostamenti }, null, 2), 'application/json');
  $('#expc').onclick = () => {
    scarica('tappe.csv', csv([['id', 'nome'], ...Tappe.map(t => [t.id, t.nome])]), 'text/csv');
    scarica('spostamenti.csv', csv([['id', 'da', 'a', 'istruzione'], ...Spostamenti.map(s => [s.id, s.da, s.a, s.istruzione])]), 'text/csv');
  };
  $('#log').onclick = async () => { S.token = null; store.del('token'); showRoles(); };
  $('#esci').onclick = showTimeline;

  $('#doimp').onclick = () => {
    const testo = $('#imp').value.trim();
    if (!testo) return $('#aerr').textContent = 'Incolla qualcosa prima.';
    try {
      if (testo.startsWith('{')) {
        const d = JSON.parse(testo);
        if (!Array.isArray(d.tappe) || !Array.isArray(d.spostamenti)) throw new Error('Nel JSON mancano tappe o spostamenti.');
        Tappe = d.tappe; Spostamenti = d.spostamenti;
      } else {
        const righe = leggiCsv(testo);
        const ch = Object.keys(righe[0] || {});
        if (ch.includes('da') && ch.includes('a')) {
          Spostamenti = righe.map((r, i) => ({ id: r.id || idUnico(slug(`${r.da}-${r.a}`), []), da: r.da, a: r.a, istruzione: r.istruzione || '' }));
        } else if (ch.includes('nome')) {
          Tappe = righe.map(r => ({ id: r.id || slug(r.nome), nome: r.nome }));
        } else throw new Error('Il CSV deve avere le colonne "nome", oppure "da" e "a".');
      }
      $('#imp').value = ''; disegna();
    } catch (x) { $('#aerr').textContent = 'Import non riuscito: ' + x.message; }
  };
}

boot();