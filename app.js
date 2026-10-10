'use strict';
/* ---------- Configurazione ---------- */
const CFG = {
  API: '/api',              // '' = nessun server, l'app va coi dati di esempio
  ADMIN: 'Admin',
  // false = salta la schermata "installa l'app" (utile per i test). Da riattivare prima dell'evento.
  CONTROLLA_INSTALLAZIONE: false,
  GROUPS: [
    { label: 'Corridoio', units: [] },
    { label: 'Aula', units: ['Aula 1', 'Aula 2', 'Aula 3', 'Aula 4', 'Aula 5', 'Aula 6', 'Aula 7', 'Aula 8'] }
  ]
};
const ONLINE = !!CFG.API;

/* ---------- Utilità ---------- */
const $ = s => document.querySelector(s);
const screen = $('#screen');
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

/* ---------- Richieste & messaggi ---------- */
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
  timer: 0,
  tabAdmin: 'dashboard'
};

let installEvt = null;
S.badge = store.get('badge', null);
S.gruppo = store.get('gruppo', '');
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });

// RuoliDB: caricato dinamicamente dal server. Fallback su CFG.GROUPS se offline.
let RuoliDB = []; // Array di { nome, gruppo }

const isAdmin = () => S.role === CFG.ADMIN && !!S.token;
const gruppo = () => isAdmin() ? '' : (S.gruppo || '');
const authHeaders = () => {
  const headers = { 'Content-Type': 'application/json' };
  if (isAdmin()) headers.Authorization = 'Bearer ' + S.token;
  else if (S.badge) headers['X-Badge'] = S.badge;
  return headers;
};

const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
const QRGEN_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const scriptCaricati = new Map();
const loadScript = url => {
  if (scriptCaricati.has(url)) return scriptCaricati.get(url);
  const caricamento = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => {
      scriptCaricati.delete(url);
      script.remove();
      reject(new Error('Libreria non caricata.'));
    };
    document.head.appendChild(script);
  });
  scriptCaricati.set(url, caricamento);
  return caricamento;
};
const urlBadge = codice => {
  const url = new URL('./', location.href);
  url.searchParams.set('b', codice);
  return url.href;
};
let stopScanner = null;
const fermaInterazioni = () => {
  clearInterval(S.timer);
  S.timer = 0;
  stopScanner?.();
};
const svuotaCacheProgramma = () => {
  for (const key of ['programma', 'completamenti', 'evento_attivo']) store.del(key);
  Fasce = []; Completamenti = {}; EventoAttivo = false;
};

// Ricostruisce le strutture derivate da RuoliDB (o CFG.GROUPS come fallback)
function ricalcolaRuoli() {
  const fonte = RuoliDB.length ? RuoliDB : CFG.GROUPS.flatMap(g =>
    g.units.length ? g.units.map(u => ({ nome: u, gruppo: g.label })) : [{ nome: g.label, gruppo: g.label }]
  );

  // Ricrea TUTTE_LE_SQUADRE (solo nomi individuali)
  TUTTE_LE_SQUADRE.length = 0;
  fonte.forEach(r => { if (!TUTTE_LE_SQUADRE.includes(r.nome)) TUTTE_LE_SQUADRE.push(r.nome); });
}

const TUTTE_LE_SQUADRE = [];
ricalcolaRuoli(); // inizializzazione con fallback

// Genera le <option> per il select squadra nella tab Modifica Fasi.
// Mostra: per ogni gruppo distinto → opzione "tutto il gruppo" + singoli nomi.
const optSquadra = sel => {
  const fonte = RuoliDB.length ? RuoliDB : CFG.GROUPS.flatMap(g =>
    g.units.length ? g.units.map(u => ({ nome: u, gruppo: g.label })) : [{ nome: g.label, gruppo: g.label }]
  );
  const gruppi = [...new Map(fonte.map(r => [r.gruppo || r.nome, r.gruppo || r.nome])).keys()];
  return gruppi.map(g => {
    const membri = fonte.filter(r => (r.gruppo || r.nome) === g);
    const haMembers = membri.length > 1 || (membri.length === 1 && membri[0].nome !== g);
    return `<optgroup label="${esc(g)}">
      <option value="${esc(g)}"${sel === g ? ' selected' : ''}>${esc(g)} — tutto il gruppo</option>
      ${haMembers ? membri.map(r => `<option value="${esc(r.nome)}"${sel === r.nome ? ' selected' : ''}>${esc(r.nome)}</option>`).join('') : ''}
    </optgroup>`;
  }).join('');
};

async function loadRuoliDB() {
  if (!ONLINE) return;
  try {
    const r = await chiedi(CFG.API + '/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
      body: JSON.stringify({ azione: 'ruoli_lista' })
    });
    const d = await r.json();
    if (r.ok && Array.isArray(d.ruoli)) {
      RuoliDB = d.ruoli.map(r => ({ nome: r.nome, gruppo: r.gruppo || r.nome }));
      ricalcolaRuoli();
    }
  } catch (e) { console.warn('loadRuoliDB:', e.message); }
}

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
  if (CFG.CONTROLLA_INSTALLAZIONE && env.mobile && !env.standalone) return showInstall();
  const codice = q.get('b');
  if (codice) {
    showRoles();
    if (await entraConBadge(codice, $('#cerr'))) {
      const url = new URL(location.href);
      url.searchParams.delete('b');
      history.replaceState(null, '', url);
    }
    return;
  }
  if (isAdmin()) return showAdmin();
  if (S.badge && await entraConBadge(S.badge, null, true)) return showTimeline();
  showRoles();
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
    <p class="mut">Installa l'app per accedere rapidamente al programma dalla schermata Home.</p>
    <ol style="text-align:left; margin: 20px auto; max-width: 340px; line-height: 1.6">${steps}</ol>
    ${env.ios ? '' : `<button class="btn" id="inst" ${installEvt ? '' : 'hidden'}>Installa app</button>`}</div>`;
  $('#inst')?.addEventListener('click', async () => { installEvt.prompt(); await installEvt.userChoice; });
}

/* ---------- Schermata 3: Scelta Ruolo ---------- */
function showRoles() {
  fermaInterazioni();
  inCorso = false;
  screen.innerHTML = `<div class="wrap"><h1>Benvenuto</h1>
    <p class="mut">Usa il badge della tua squadra per vedere tappe e istruzioni.</p>
    <button class="btn" id="scan">Scansiona il badge</button>
    <form class="box" id="codf">
      <label for="cod">Oppure scrivi il codice stampato sul badge</label>
      <input type="text" id="cod" autocomplete="off" autocapitalize="characters" placeholder="xxxx-xxxx-xxxx-xxxx">
      <button class="btn ghost">Entra</button>
      <p class="bad" id="cerr"></p>
    </form>
    <div id="scanbox"></div>
    <button class="btn ghost" id="adm">Sono un admin</button>
    <div id="admbox"></div></div>`;
  $('#scan').onclick = avviaScanner;
  $('#codf').onsubmit = async e => { e.preventDefault(); await entraConBadge($('#cod').value, $('#cerr')); };
  $('#adm').onclick = adminForm;
}

function revocaBadge() {
  S.badge = null; S.role = null; S.gruppo = '';
  store.del('badge'); store.del('role'); store.del('gruppo');
  svuotaCacheProgramma();
  avvisa('Badge non più valido: usa il tuo badge.', true);
  showRoles();
}

// Verifica il codice e salva il ruolo. Con silenzioso=true non cambia schermata.
async function entraConBadge(codice, errEl, silenzioso = false) {
  const c = String(codice || '').trim();
  const errore = t => { if (errEl) errEl.textContent = t; else avvisa(t, true); };
  if (!c) return errore('Scrivi il codice del badge.'), false;
  if (!ONLINE) return errore('Serve il server per il badge.'), false;
  try {
    const r = await chiedi(CFG.API + '/badge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codice: c })
    });
    const d = await r.json();
    if (!r.ok) {
      if (silenzioso) {
        S.badge = null; S.role = null; S.gruppo = '';
        store.del('badge'); store.del('role'); store.del('gruppo');
        svuotaCacheProgramma();
        return false;
      }
      errore(d.errore || 'Badge non valido.');
      return false;
    }
    if (S.badge !== c || S.role !== d.ruolo || S.token) svuotaCacheProgramma();
    S.token = null; store.del('token');
    S.badge = c; S.role = d.ruolo; S.gruppo = d.gruppo || '';
    store.set('badge', c); store.set('role', S.role); store.set('gruppo', S.gruppo);
    if (!silenzioso) showTimeline();
    return true;
  } catch (e) {
    // Senza rete, al riavvio si usa l'ultimo ruolo salvato
    if (silenzioso && S.badge && S.role) return true;
    errore('Server non raggiungibile.');
    return false;
  }
}

const estraiCodice = testo => {
  try { return new URL(testo).searchParams.get('b') || ''; }
  catch { return testo; }
};

async function avviaScanner() {
  stopScanner?.();
  const box = $('#scanbox');
  if (!navigator.mediaDevices?.getUserMedia) {
    box.innerHTML = '<p class="mut">La fotocamera non è disponibile qui: usa il codice qui sopra.</p>';
    return;
  }
  box.innerHTML = '<p class="mut">Carico il lettore...</p>';
  try { await loadScript(JSQR_URL); }
  catch { box.innerHTML = '<p class="bad">Lettore QR non caricato: usa il codice.</p>'; return; }

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch { box.innerHTML = '<p class="bad">Permesso fotocamera negato: usa il codice.</p>'; return; }

  box.innerHTML = `<video id="vid" playsinline muted style="width:100%;border-radius:8px"></video>
    <p class="mut">Inquadra il QR del badge</p>
    <button class="btn ghost" id="stopScan">Chiudi fotocamera</button>`;
  const video = $('#vid');
  video.srcObject = stream;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let attivo = true;
  const stop = () => {
    attivo = false; stream.getTracks().forEach(t => t.stop()); box.innerHTML = '';
    if (stopScanner === stop) stopScanner = null;
  };
  stopScanner = stop;
  $('#stopScan').onclick = stop;
  try { await video.play(); }
  catch { stop(); avvisa('Fotocamera non avviata: usa il codice del badge.', true); return; }

  const passo = async () => {
    if (!attivo) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const letto = window.jsQR(img.data, img.width, img.height);
      const codice = letto ? estraiCodice(letto.data) : '';
      if (codice) {
        stop();
        await entraConBadge(codice, null);
        return;
      }
    }
    requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

function adminForm() {
  $('#admbox').innerHTML = `<form class="box" id="af">
    <label for="pw">Password admin</label>
    <input type="password" id="pw" autocomplete="current-password" required>
    <button class="btn">Entra</button>
    <p class="bad" id="err"></p>
  </form>`;
  $('#af').onsubmit = async e => {
    e.preventDefault();
    const err = $('#err');
    if (!ONLINE) { err.textContent = 'Serve il server per il login admin.'; return; }
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ azione: 'login', password: $('#pw').value })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.errore || 'Password errata.');
      svuotaCacheProgramma();
      S.token = d.token; store.set('token', S.token);
      S.badge = null; store.del('badge');
      S.role = CFG.ADMIN; store.set('role', CFG.ADMIN);
      S.gruppo = ''; store.set('gruppo', '');
      showAdmin();
    } catch (x) { err.textContent = x.message || 'Password errata o server non raggiungibile.'; }
  };
}

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
      headers: authHeaders()
    });
    if (r.status === 401) {
      if (isAdmin()) {
        S.token = null; S.role = null; S.gruppo = '';
        store.del('token'); store.del('role'); store.del('gruppo');
        svuotaCacheProgramma();
        showRoles(); avvisa('Sessione admin scaduta: accedi di nuovo.', true);
      } else revocaBadge();
      return { revocato: true };
    }
    if (!r.ok) throw new Error('Il server ha risposto ' + r.status + '.');
    const d = await r.json();
    store.set('programma', d);
    Fasce = d.fasce || [];
    EventoAttivo = !!d.attivo;
    Completamenti = d.completamenti || {};
    store.set('completamenti', Completamenti);
    return {};
  } catch (x) {
    const c = store.get('programma');
    if (c) {
      Fasce = c.fasce || [];
      EventoAttivo = typeof c.attivo === 'boolean' ? c.attivo : true;
      Completamenti = store.get('completamenti', {});
      return { offline: true, errore: x.message };
    }
    Fasce = []; EventoAttivo = false; Completamenti = {};
    return { offline: true, senzaCache: true, errore: x.message };
  }
}

/* ---------- Checklist Completamento ---------- */
let salvataggioTappa = false;
async function toggleCompletato(fasciaId) {
  const r = S.role;
  if (!r || salvataggioTappa) return;
  const list = Completamenti[r] || [];
  const fatto = list.includes(fasciaId);
  const nuovaLista = fatto ? list.filter(id => id !== fasciaId) : [...list, fasciaId];
  Completamenti[r] = nuovaLista;
  salvataggioTappa = true;
  renderList(false);
  try {
    if (ONLINE) {
      const risposta = await chiedi(CFG.API + '/admin', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ azione: 'segna_completato', ruolo: r, fasciaId, completato: !fatto })
      });
      const dati = await risposta.json();
      if (!risposta.ok || !dati.ok) throw new Error(dati.errore || 'Salvataggio della tappa fallito.');
      if (S.role !== r) return;
      Completamenti = dati.completamenti || Completamenti;
    }
    store.set('completamenti', Completamenti);
    const programma = store.get('programma');
    if (programma) store.set('programma', { ...programma, completamenti: Completamenti });
    avvisa(fatto ? 'Tappa segnata come non completata' : 'Tappa completata!');
  } catch (e) {
    if (S.role === r) Completamenti[r] = list;
    avvisa('Tappa non salvata: ' + e.message, true);
  } finally {
    salvataggioTappa = false;
    if ($('#tl')) renderList(false);
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
          <button class="chk-btn ${isFatto ? 'done' : ''}" data-fascia="${esc(f.id)}" ${salvataggioTappa ? 'disabled' : ''}>
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
  $('#tl').onclick = e => {
    const button = e.target.closest('[data-fascia]');
    if (button && !button.disabled) toggleCompletato(button.dataset.fascia);
  };
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
  fermaInterazioni();
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
  if (d.revocato) return;
  inCorso = false;

  let bHtml = '';
  if (!EventoAttivo) {
    bHtml += `<div class="banner warn"><b>EVENTO IN ATTESA DI AVVIO</b><br>Il coordinatore non ha ancora attivato l'evento. Gli orari sottostanti sono indicativi.</div>`;
  } else {
    bHtml += `<div class="banner active"><b>EVENTO ATTIVO</b> - Segui gli orari e segna le tappe man mano che le completi.</div>`;
  }

  if (d.offline) {
    bHtml += `<div class="banner bad">${esc(d.errore)} ${d.senzaCache ? 'Nessun programma disponibile offline.' : 'Stiamo vedendo l\'ultimo programma salvato.'}<button class="btn mini" id="retry">Riprova</button></div>`;
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

  fermaInterazioni();
  inCorso = true;
  const dati = await carica();
  if (dati.revocato) return;
  await loadRuoliDB();
  inCorso = false;


  screen.innerHTML = `<header class="top">
      <b>Pannello Admin</b>
      <button class="chip" id="admLogout">Esci da Admin</button>
    </header>
    <div class="wrap">
      ${dati.offline ? `<div class="banner bad">${esc(dati.errore)} I dati potrebbero non essere aggiornati.</div>` : ''}
      <!-- Toggle Attivazione Generale -->
      <div class="toggle-card ${EventoAttivo ? 'active' : ''}">
        <div class="toggle-info">
          <h3>${EventoAttivo ? 'EVENTO ATTIVO' : 'EVENTO IN PAUSA / IN ATTESA'}</h3>
          <p>${EventoAttivo ? 'Le tappe e gli indicatori di ritardo sono attivi.' : 'Attiva l\'evento quando il programma deve iniziare.'}</p>
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
        <button class="tab-btn ${S.tabAdmin === 'modifica' ? 'active' : ''}" id="tabMod">Fasi e istruzioni</button>
        <button class="tab-btn ${S.tabAdmin === 'ruoli' ? 'active' : ''}" id="tabRuoli">Ruoli e badge</button>
      </div>

      <div id="tabContent"></div>
    </div>`;

  $('#admLogout').onclick = () => {
    S.token = null; store.del('token');
    S.role = null; S.badge = null; S.gruppo = '';
    store.del('role'); store.del('badge'); store.del('gruppo');
    RuoliDB = []; ricalcolaRuoli(); svuotaCacheProgramma();
    avvisa('Logout eseguito');
    showRoles();
  };

  $('#toggleEvt').onchange = async e => {
    const val = e.target.checked;
    const precedente = EventoAttivo;
    e.target.disabled = true;
    EventoAttivo = val;
    store.set('evento_attivo', val);
    
    $('.toggle-card').className = `toggle-card ${val ? 'active' : ''}`;
    $('.toggle-info h3').textContent = val ? 'EVENTO ATTIVO' : 'EVENTO IN PAUSA / IN ATTESA';
    $('.toggle-info p').textContent = val ? 'Le tappe e gli indicatori di ritardo sono attivi.' : 'Attiva l\'evento quando il programma deve iniziare.';

    if (ONLINE) {
      try {
        const risposta = await chiedi(CFG.API + '/admin', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
          body: JSON.stringify({ azione: 'toggle_attivo', attivo: val })
        });
        const dati = await risposta.json();
        if (!risposta.ok || !dati.ok) throw new Error(dati.errore || 'Salvataggio fallito.');
        avvisa(val ? 'Evento ATTIVATO per tutto lo staff' : 'Evento messo in PAUSA');
      } catch (err) {
        EventoAttivo = precedente; store.set('evento_attivo', precedente);
        e.target.checked = precedente;
        $('.toggle-card').className = `toggle-card ${precedente ? 'active' : ''}`;
        $('.toggle-info h3').textContent = precedente ? 'EVENTO ATTIVO' : 'EVENTO IN PAUSA / IN ATTESA';
        $('.toggle-info p').textContent = precedente ? 'Le tappe e gli indicatori di ritardo sono attivi.' : 'Attiva l\'evento quando il programma deve iniziare.';
        avvisa('Stato evento non salvato: ' + err.message, true);
      }
    }
    e.target.disabled = false;
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
    } else if (S.tabAdmin === 'modifica') {
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
          <div class="new-assignments">
            <h4>Istruzioni per ruoli e gruppi</h4>
            <p class="mut">Aggiungi qui le assegnazioni della fase. Puoi dare istruzioni a un gruppo intero o a un singolo ruolo.</p>
            <div id="nuoveAssegnazioni"></div>
            <button class="btn ghost" type="button" id="aggiungiAssegnazione">Aggiungi ruolo o gruppo</button>
          </div>
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

      $('#ff [name=inizio]').value = perInput(calcolaProssimoInizio());
      $('#aggiungiAssegnazione').onclick = () => {
        $('#nuoveAssegnazioni').insertAdjacentHTML('beforeend', nuovaAssegnazione());
      };
      $('#nuoveAssegnazioni').onclick = e => {
        const btn = e.target.closest('[data-rimuovi-assegnazione]');
        if (btn) btn.closest('.new-assignment').remove();
      };
      $('#ff').onsubmit = e => {
        e.preventDefault();
        const d = new FormData(e.target);
        const titolo = (d.get('titolo') || '').trim();
        if (!titolo) return avvisa('Inserisci un titolo per la fase', true);
        const inizio = iso(d.get('inizio'));
        if (!inizio) return avvisa('Seleziona un orario di inizio valido', true);
        let personalizzazioni;
        try { personalizzazioni = leggiNuoveAssegnazioni(e.target); }
        catch (errore) { return avvisa(errore.message, true); }
        Fasce.push({
          id: 'f' + uid(), titolo, inizio,
          fine: d.get('fine') ? iso(d.get('fine')) : null,
          durataSpostamento: parseInt(d.get('durataSpostamento') || 0, 10),
          note: (d.get('nota') || '').trim(), personalizzazioni
        });
        e.target.reset();
        $('#nuoveAssegnazioni').replaceChildren();
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
    } else if (S.tabAdmin === 'ruoli') {
      renderRuoli(c);
    }
  };

  $('#tabDash').onclick = () => { S.tabAdmin = 'dashboard'; updateTabs(); renderTab(); };
  $('#tabTl').onclick = () => { S.tabAdmin = 'timeline'; updateTabs(); renderTab(); };
  $('#tabMod').onclick = () => { S.tabAdmin = 'modifica'; updateTabs(); renderTab(); };
  $('#tabRuoli').onclick = () => { S.tabAdmin = 'ruoli'; updateTabs(); renderTab(); };

  function updateTabs() {
    $('#tabDash').className = `tab-btn ${S.tabAdmin === 'dashboard' ? 'active' : ''}`;
    $('#tabTl').className = `tab-btn ${S.tabAdmin === 'timeline' ? 'active' : ''}`;
    $('#tabMod').className = `tab-btn ${S.tabAdmin === 'modifica' ? 'active' : ''}`;
    $('#tabRuoli').className = `tab-btn ${S.tabAdmin === 'ruoli' ? 'active' : ''}`;
  }

  renderTab();
}

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

const segnaSporco = () => {
  sporco = true;
  const d = $('#dirty'); if (d) d.hidden = false;
};

const nuovaAssegnazione = () => `<div class="new-assignment">
  <div class="assignment-main">
    <div><label>Ruolo o gruppo</label><select name="ruolo" required>
      <option value="">Seleziona un ruolo o gruppo</option>${optSquadra('')}
    </select></div>
    <div><label>Luogo personale</label><input name="tappa" placeholder="es. Laboratorio 2" autocomplete="off"></div>
  </div>
  <label>Istruzioni per lo spostamento</label><textarea name="istruzioniSpostamento" rows="2" placeholder="es. Prendi le scale B e vai al 1° piano"></textarea>
  <label>Note personali per questo team</label><input name="note" placeholder="es. Controllare i badge prima di entrare" autocomplete="off">
  <button class="btn ghost" type="button" data-rimuovi-assegnazione>Rimuovi assegnazione</button>
</div>`;

function leggiNuoveAssegnazioni(form) {
  const visti = new Set();
  return [...form.querySelectorAll('.new-assignment')].map(riga => {
    const valore = nome => riga.querySelector(`[name="${nome}"]`).value.trim();
    const ruolo = valore('ruolo');
    if (!ruolo) throw new Error('Seleziona un ruolo o un gruppo per ogni assegnazione.');
    if (visti.has(ruolo)) throw new Error(`"${ruolo}" ha già una riga in questa fase.`);
    visti.add(ruolo);
    return {
      id: 'p' + uid(), ruolo, tappa: valore('tappa'),
      istruzioniSpostamento: valore('istruzioniSpostamento'), note: valore('note')
    };
  });
}

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

/* ---------- Tab Ruoli & Badge ---------- */
async function renderRuoli(c) {
  c.innerHTML = `<p class="mut" style="margin-top:12px">Carico i ruoli...</p>`;

  let ruoli = [];
  if (ONLINE) {
    try {
      const r = await chiedi(CFG.API + '/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
        body: JSON.stringify({ azione: 'ruoli_lista' })
      });
      const d = await r.json();
      if (r.ok) ruoli = d.ruoli || [];
      else avvisa(d.errore || 'Errore nel caricamento dei ruoli', true);
    } catch (e) {
      avvisa('Server non raggiungibile: ' + e.message, true);
    }
  }

  const aggiornaLista = lista => {
    ruoli = lista;
    RuoliDB = ruoli.map(r => ({ nome: r.nome, gruppo: r.gruppo || r.nome }));
    ricalcolaRuoli();
  };
  aggiornaLista(ruoli);
  let creazioneInCorso = false;

  const disegna = () => {
    let html = `
      <h2 style="margin-top:16px">Ruoli e Badge</h2>
      <p class="mut">Ogni squadra accede tramite il suo codice badge univoco. Clicca "QR" per generare e stampare il QR di accesso, oppure "Rigenera" per invalidare il vecchio codice.</p>
      <form class="box" id="fNuovoRuolo">
        <h3>Crea un ruolo</h3>
        <label for="nomeRuolo">Nome del ruolo</label>
        <input type="text" id="nomeRuolo" name="nome" required autocomplete="off" placeholder="es. Aula 9" aria-describedby="nuovoRuoloErr">
        <label for="gruppoRuolo">Gruppo di appartenenza</label>
        <input type="text" id="gruppoRuolo" name="gruppo" required autocomplete="off" list="gruppiRuoli" placeholder="es. Aula" aria-describedby="gruppoRuoloHelp nuovoRuoloErr">
        <datalist id="gruppiRuoli">${[...new Set(ruoli.map(r => r.gruppo).filter(Boolean))].map(g => `<option value="${esc(g)}"></option>`).join('')}</datalist>
        <p class="mut" id="gruppoRuoloHelp" style="font-size:0.85rem; margin-top:8px">Scegli un gruppo esistente o scrivine uno nuovo. Le istruzioni del gruppo valgono per tutti i ruoli che ne fanno parte.</p>
        <button class="btn" id="btnCreaRuolo" ${!ONLINE ? 'disabled' : ''}>Crea ruolo</button>
        <p class="bad" id="nuovoRuoloErr" role="alert"></p>
      </form>`;

    if (!ONLINE) {
      html += `<div class="banner bad">Il server non è raggiungibile. I ruoli non sono modificabili offline.</div>`;
    } else if (!ruoli.length) {
      html += `<p class="mut" style="margin-top:16px">Nessun ruolo configurato. Crea il primo ruolo con il modulo qui sopra.</p>`;
    } else {
      html += `<ul class="lst" style="margin-top:12px" id="listaRuoli">`;
      ruoli.forEach((r, i) => {
        const link = urlBadge(r.badge);
        html += `<li class="fz">
          <div class="riga">
            <div style="flex:1; min-width:0">
              <b>${esc(r.nome)}</b>
              ${r.gruppo && r.gruppo !== r.nome ? `<small class="mut"> — gruppo: ${esc(r.gruppo)}</small>` : ''}
              <br><code style="font-size:0.78rem; color:var(--text-muted); word-break:break-all">${esc(r.badge)}</code>
            </div>
            <div class="btnx" style="gap:6px; flex-wrap:wrap">
              <button class="btn ghost" style="font-size:0.8rem; padding:4px 10px" data-qr="${esc(r.badge)}" data-link="${esc(link)}">QR</button>
              <button class="btn ghost" style="font-size:0.8rem; padding:4px 10px" data-rigenera="${esc(r.nome)}" data-i="${i}">Rigenera</button>
            </div>
          </div>
        </li>`;
      });
      html += `</ul>`;
    }

    // L'editor completo resta disponibile come opzione avanzata.
    html += `
      <details style="margin-top:24px">
        <summary>Gestione avanzata dei ruoli (JSON)</summary>
      <form class="box" id="fRuoliJson">
        <h3>Modifica la lista dei ruoli</h3>
        <p class="mut" style="font-size:0.85rem">Modifica la lista completa dei ruoli. I badge esistenti vengono conservati se il nome non cambia.</p>
        <textarea id="ruoliJson" rows="10" style="font-family:monospace; font-size:0.82rem; width:100%; box-sizing:border-box">${esc(JSON.stringify(ruoli.map(r => ({ nome: r.nome, gruppo: r.gruppo || '' })), null, 2))}</textarea>
        <p class="mut" style="font-size:0.78rem; margin-top:4px">Formato: array di oggetti <code>{"nome":"...", "gruppo":"..."}</code>. Il campo gruppo può essere uguale al nome o vuoto.</p>
        <button class="btn" id="btnSalvaRuoli">Salva ruoli</button>
        <p class="bad" id="ruoliErr"></p>
      </form>
      </details>

      <div id="qrPreview" style="display:none; text-align:center; margin-top:16px; padding:16px; background:var(--panel); border-radius:12px">
        <p id="qrLabel" class="mut" style="margin-bottom:8px"></p>
        <div id="qrCanvas"></div>
        <a id="qrLink" class="btn ghost" style="display:inline-block; margin-top:10px; font-size:0.85rem" target="_blank">Apri link badge</a>
        <button class="btn ghost" id="qrChiudi" style="margin-top:8px; font-size:0.85rem">Chiudi</button>
      </div>`;

    c.innerHTML = html;

    $('#fNuovoRuolo').onsubmit = async e => {
      e.preventDefault();
      if (creazioneInCorso) return;
      const form = e.currentTarget;
      const btn = $('#btnCreaRuolo'), err = $('#nuovoRuoloErr');
      const nomeInput = $('#nomeRuolo'), gruppoInput = $('#gruppoRuolo');
      const nome = nomeInput.value.trim(), gruppo = gruppoInput.value.trim();
      err.textContent = '';
      if (!ONLINE) { err.textContent = 'Serve il server per creare un ruolo.'; return; }
      if (!nome || !gruppo) { err.textContent = 'Nome e gruppo sono obbligatori.'; return; }
      creazioneInCorso = true;
      nomeInput.disabled = gruppoInput.disabled = true;
      attesa(btn, 'Creo...');
      try {
        const r = await chiedi(CFG.API + '/admin', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ azione: 'ruoli_crea', nome, gruppo })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.errore || 'Errore nella creazione del ruolo');
        aggiornaLista(d.ruoli);
        if (form.isConnected) {
          disegna();
          $('#nomeRuolo').focus();
        }
        avvisa(`Ruolo "${nome}" creato. Il badge è pronto.`);
      } catch (x) { err.textContent = x.message; avvisa(x.message, true); }
      finally {
        creazioneInCorso = false;
        nomeInput.disabled = gruppoInput.disabled = false;
        pronto(btn);
      }
    };

    // Salva ruoli modificati
    $('#fRuoliJson').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#btnSalvaRuoli');
      const err = $('#ruoliErr');
      if (!ONLINE) { err.textContent = 'Serve il server per salvare i ruoli.'; return; }
      let nuovi;
      try { nuovi = JSON.parse($('#ruoliJson').value); }
      catch { err.textContent = 'JSON non valido: controlla la sintassi.'; return; }
      if (!Array.isArray(nuovi)) { err.textContent = 'Il JSON deve essere un array.'; return; }
      attesa(btn, 'Salvo...');
      try {
        // Preserva badge esistenti dove il nome coincide
        const payload = nuovi.map(n => {
          const vecchio = ruoli.find(v => v.nome === n.nome);
          return { nome: String(n.nome || '').trim(), gruppo: String(n.gruppo || n.nome || '').trim(), badge: vecchio?.badge };
        });
        const r = await chiedi(CFG.API + '/admin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
          body: JSON.stringify({ azione: 'ruoli_salva', ruoli: payload })
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.errore || 'Errore salvataggio');
        aggiornaLista(d.ruoli || payload);
        avvisa(`Salvati ${ruoli.length} ruoli`);
        err.textContent = '';
        disegna();
      } catch (x) { err.textContent = x.message; avvisa(x.message, true); }
      finally { pronto(btn); }
    };

    // Rigenera badge
    c.querySelectorAll('[data-rigenera]').forEach(btn => {
      btn.onclick = async () => {
        const nome = btn.dataset.rigenera;
        if (!confirm(`Rigenerare il badge per "${nome}"? Il vecchio codice smetterà di funzionare.`)) return;
        try {
          const r = await chiedi(CFG.API + '/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + S.token },
            body: JSON.stringify({ azione: 'ruoli_rigenera', nome })
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.errore || 'Errore rigenerazione');
          const idx = ruoli.findIndex(x => x.nome === nome);
          if (idx >= 0) ruoli[idx].badge = d.badge;
          avvisa(`Badge rigenerato per ${nome}`);
          disegna();
        } catch (x) { avvisa(x.message, true); }
      };
    });

    // Mostra QR
    c.querySelectorAll('[data-qr]').forEach(btn => {
      btn.onclick = async () => {
        const codice = btn.dataset.qr;
        const link = btn.dataset.link;
        const preview = $('#qrPreview');
        const canvas = $('#qrCanvas');
        const label = $('#qrLabel');
        const qrLink = $('#qrLink');
        canvas.innerHTML = '<p class="mut">Carico il generatore QR...</p>';
        preview.style.display = 'block';
        preview.scrollIntoView({ block: 'center' });
        label.textContent = `Badge: ${codice}`;
        qrLink.href = link;
        $('#qrChiudi').onclick = () => { preview.style.display = 'none'; };
        try {
          await loadScript(QRGEN_URL);
          const qr = window.qrcode(0, 'M');
          qr.addData(link);
          qr.make();
          canvas.innerHTML = qr.createImgTag(4, 8);
        } catch (err) {
          canvas.innerHTML = `<p class="mut" style="word-break:break-all">${esc(link)}</p>`;
          avvisa('Generatore QR non caricato: copia il link manualmente.', true);
        }
      };
    });
  };

  disegna();
}

boot();
