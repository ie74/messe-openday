'use strict';
/* ---------- Configurazione ---------- */
const CFG = {
  BACKEND: false,            // metti true quando il backend è pronto
  API: '',                   // es. 'https://tuo-server.it'
  VAPID: '',                 // chiave pubblica VAPID per le push
  ROLES: ['Accoglienza', 'Percorsi', 'Logistica', 'Sicurezza', 'Staff']
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
const mapUrl = p => 'https://www.google.com/maps/search/?api=1&query=' +
  encodeURIComponent(p.lat != null ? p.lat + ',' + p.lng : p.name);

/* ---------- Rilevamento ambiente (?m=1 e ?s=1 forzano mobile/installata per i test) ---------- */
const q = new URLSearchParams(location.search), ua = navigator.userAgent;
const ipad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
const env = {
  ios: /iPhone|iPad|iPod/.test(ua) || ipad,
  mobile: q.has('m') || /Android|iPhone|iPad|iPod/.test(ua) || ipad,
  standalone: q.has('s') || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
};
const S = { role: store.get('role'), token: store.get('token'), showAll: false, items: [], sig: '' };
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#inst')?.removeAttribute('hidden'); });

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
  screen.innerHTML = `<div class="wrap"><h1>Scegli il tuo ruolo</h1>
    <p class="mut">Vedrai solo orari e avvisi che ti riguardano. Puoi cambiarlo quando vuoi.</p>
    <div class="roles">${CFG.ROLES.map(r => `<button class="role${r === S.role ? ' on' : ''}" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>
    <button class="btn ghost" id="adm">Sono un admin</button><div id="admbox"></div>
    ${S.role ? '<button class="btn ghost" id="back">Torna al programma</button>' : ''}</div>`;
  screen.querySelectorAll('.role').forEach(b => b.onclick = () => setRole(b.dataset.r));
  $('#back')?.addEventListener('click', showTimeline);
  $('#adm').onclick = adminForm;
}

function setRole(r) {
  S.role = r; store.set('role', r);
  if (r !== 'Admin') { S.token = null; store.del('token'); }
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
      S.token = (await r.json()).token; store.set('token', S.token); setRole('Admin');
    } catch { err.textContent = 'Password errata o server non raggiungibile.'; }
  };
}

/* ---------- Timeline ---------- */
function demoItems() {
  const t = m => new Date(Date.now() + m * 6e4).toISOString();
  return [
    { id: 1, start: t(-120), end: t(-75), title: 'Briefing generale', roles: [], place: { name: 'Sala principale' }, route: ['Ingresso A', 'Seguire i cartelli blu'], notes: 'Badge obbligatorio.' },
    { id: 2, start: t(-40), end: t(20), title: 'Allestimento postazioni', roles: ['Logistica', 'Staff'], place: { name: 'Area carico' }, route: ['Uscire dal retro', 'Girare a destra', 'Cancello 2'] },
    { id: 3, start: t(35), end: t(80), title: 'Apertura accrediti', roles: ['Accoglienza'], place: { name: 'Desk accrediti' }, route: ['Hall centrale', 'Desk a sinistra dell\'ingresso'] },
    { id: 4, start: t(60), title: 'Presidio percorso nord', roles: ['Percorsi', 'Sicurezza'], place: { name: 'Punto di controllo 1' }, route: ['Seguire il tracciato giallo', 'Fermarsi al secondo incrocio'], notes: 'Radio sul canale 2.' },
    { id: 5, start: t(150), end: t(210), title: 'Chiusura e rientro', roles: [], place: { name: 'Sala principale' }, route: ['Rientro dal percorso più breve'] }
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

const visible = i => S.role === 'Admin' || S.showAll || !i.roles?.length || i.roles.includes(S.role);

function status(i, k, nextIdx, now) {
  const s = new Date(i.start), e = i.end ? new Date(i.end) : null;
  if (now >= (e ?? s) && (e || now >= s)) return 'past';
  if (now >= s) return 'now';
  return k === nextIdx ? 'next' : 'later';
}

function renderList(scroll) {
  const now = new Date(), items = S.items.filter(visible).sort((a, b) => new Date(a.start) - new Date(b.start));
  const nextIdx = items.findIndex(i => new Date(i.start) > now);
  const st = items.map((i, k) => status(i, k, nextIdx, now));
  const sig = st.join() + S.showAll + S.role;
  $('#clock').textContent = fmt(now);
  if (sig === S.sig && !scroll) return;       // niente re-render se non cambia nulla (non chiude i percorsi aperti)
  S.sig = sig;
  $('#tl').innerHTML = items.map((i, k) => {
    const s = new Date(i.start), e = i.end ? new Date(i.end) : null, c = st[k];
    return `<li class="it ${c}"><div class="tm">${fmt(s)}${e ? `<small>fino alle ${fmt(e)}</small>` : ''}</div><div>
      <h3>${esc(i.title)}${c === 'now' ? '<span class="pill">Adesso</span>' : c === 'next' ? '<span class="pill">Dopo</span>' : ''}</h3>
      ${i.place ? `<a class="loc" href="${mapUrl(i.place)}" target="_blank" rel="noopener">${esc(i.place.name)} – apri in Mappe</a>` : ''}
      ${i.route?.length ? `<details ${c === 'now' || c === 'next' ? 'open' : ''}><summary>Percorso, ${i.route.length} passi</summary><ol>${i.route.map(p => `<li>${esc(p)}</li>`).join('')}</ol></details>` : ''}
      ${i.notes ? `<p class="mut">${esc(i.notes)}</p>` : ''}</div></li>`;
  }).join('') || '<li class="it"><p class="mut">Nessuna voce per il tuo ruolo.</p></li>';
  if (scroll) $('.it.now, .it.next')?.scrollIntoView({ block: 'center' });
}

async function showTimeline() {
  screen.innerHTML = `<header class="top"><b id="clock"></b><button class="chip" id="chg">${esc(S.role)}, cambia</button></header>
    <div class="wrap"><div id="banner"></div>
    <label class="sw"><input type="checkbox" id="all" ${S.showAll ? 'checked' : ''}> Mostra tutto il programma</label>
    <ol class="tl" id="tl"></ol>
    ${env.mobile ? '<button class="btn ghost" id="test">Invia notifica di prova</button>' : ''}</div>`;
  $('#chg').onclick = showRoles;
  $('#all').onchange = e => { S.showAll = e.target.checked; renderList(false); };
  $('#test')?.addEventListener('click', async () => {
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Notifica di prova', { body: 'Se leggi questo, sei a posto.', icon: 'icon-192.png' });
  });
  const d = await loadItems();
  S.items = d.items; S.sig = '';
  $('#banner').innerHTML = d.demo ? '<div class="banner">Dati di esempio: il backend non è ancora collegato.</div>'
    : d.stale ? '<div class="banner">Sei offline: vedi l\'ultimo programma salvato.</div>' : '';
  renderList(true);
  clearInterval(S.timer); S.timer = setInterval(() => renderList(false), 30000);
}

boot();
