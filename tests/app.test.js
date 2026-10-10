const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frontend(response, initialStorage = {}) {
  const storage = new Map(Object.entries(initialStorage).map(([key, value]) => [key, JSON.stringify(value)]));
  const elements = new Map();
  const intervals = new Map();
  let nextInterval = 0;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '',
      dataset: {}, addEventListener() {}, scrollIntoView() {} });
    return elements.get(selector);
  };
  const sandbox = { console, URL, URLSearchParams, AbortController, structuredClone,
    location: { origin: 'https://example.test', href: 'https://example.test/', search: '' },
    navigator: { userAgent: 'iPhone', platform: 'iPhone', maxTouchPoints: 1 },
    document: { querySelector: element, body: { appendChild() {} } },
    localStorage: { getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    matchMedia: () => ({ matches: false }), addEventListener() {},
    setTimeout: () => 1, clearTimeout() {},
    setInterval: (callback, ms) => { const id = ++nextInterval; intervals.set(id, { callback, ms }); return id; },
    clearInterval: id => intervals.delete(id),
    fetch: async (...args) => typeof response === 'function' ? response(...args) : response };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run("S.role = 'C1'; S.badge = '1111-1111-1111-1111'; Fasce = [{ id: 'f1', titolo: 'Accoglienza' }]");
  return { run, storage, element, intervals };
}

test('avvio mobile senza credenziali arriva al benvenuto senza permessi di notifica', async () => {
  const f = frontend();
  f.run('S.role = null; S.badge = null');
  await f.run('boot()');
  assert.match(f.element('#screen').innerHTML, /Benvenuto/);
  assert.doesNotMatch(f.element('#screen').innerHTML, /notifiche/i);
});

test('gli header usano il badge o il token admin e gli URL badge codificano il codice', () => {
  const f = frontend();
  assert.equal(f.run('authHeaders()["X-Badge"]'), '1111-1111-1111-1111');
  f.run("S.role = 'Admin'; S.token = 'test-token'");
  assert.equal(f.run('authHeaders().Authorization'), 'Bearer test-token');
  assert.equal(f.run('authHeaders()["X-Badge"]'), undefined);
  assert.equal(new URL(f.run("urlBadge('a&b')")).searchParams.get('b'), 'a&b');
});

test('un errore HTTP ripristina la tappa senza annunciare un successo o salvarlo offline', async () => {
  const f = frontend({ ok: false, json: async () => ({ errore: 'Errore server' }) }, { completamenti: { C1: [] } });
  await f.run("toggleCompletato('f1')");
  assert.equal(f.run('Completamenti.C1.length'), 0);
  assert.deepEqual(JSON.parse(f.storage.get('completamenti')), { C1: [] });
  assert.match(f.element('#toast').textContent, /Tappa non salvata: Errore server/);
  assert.equal(f.run('salvataggioTappa'), false);
});

test('il successo del server aggiorna anche la copia locale del programma', async () => {
  const f = frontend({ ok: true, json: async () => ({ ok: true, completamenti: { C1: ['f1'] } }) },
    { programma: { fasce: [{ id: 'f1' }], completamenti: {} } });
  await f.run("toggleCompletato('f1')");
  assert.deepEqual(JSON.parse(f.storage.get('programma')).completamenti, { C1: ['f1'] });
  assert.equal(f.element('#toast').textContent, 'Tappa completata!');
});

test('un server indisponibile senza cache non produce un programma di esempio', async () => {
  const f = frontend({ ok: false, status: 503 });
  const result = await f.run('carica()');
  assert.equal(result.senzaCache, true);
  assert.equal(f.run('Fasce.length'), 0);
});

test('una nuova fase raccoglie insieme le istruzioni di più ruoli e rifiuta duplicati', () => {
  const f = frontend();
  assert.match(f.run('nuovaAssegnazione()'), /name="istruzioniSpostamento"/);
  assert.match(f.run('nuovaAssegnazione()'), /name="nessunaAttivita"/);
  const righe = `[{ ruolo: 'Aula', tappa: 'Atrio', istruzioniSpostamento: 'Scala nord', note: '' },
    { ruolo: 'C1', tappa: 'Laboratorio 2', istruzioniSpostamento: 'Prendi la scala sud', note: 'Porta i badge' }]`;
  const form = dati => `({ querySelectorAll: () => ${dati}.map(valori => ({
    querySelector: selettore => ({ value: valori[selettore.slice(7, -2)] ?? '' })
  })) })`;
  const personalizzazioni = JSON.parse(JSON.stringify(f.run(`leggiNuoveAssegnazioni(${form(righe)})`)));
  assert.equal(personalizzazioni.length, 2);
  assert.deepEqual(personalizzazioni.map(({ ruolo, tappa, istruzioniSpostamento, note }) =>
    ({ ruolo, tappa, istruzioniSpostamento, note })), [
    { ruolo: 'Aula', tappa: 'Atrio', istruzioniSpostamento: 'Scala nord', note: '' },
    { ruolo: 'C1', tappa: 'Laboratorio 2', istruzioniSpostamento: 'Prendi la scala sud', note: 'Porta i badge' }
  ]);
  assert.ok(personalizzazioni.every(p => p.id.startsWith('p')));
  assert.throws(() => f.run(`leggiNuoveAssegnazioni(${form("[{ ruolo: 'C1' }, { ruolo: 'C1' }]")})`),
    /ha già una riga/);
});

test('ruolo senza attività vede la fase senza pulsante e non invia completamenti', async () => {
  let richieste = 0;
  const f = frontend(async () => { richieste++; return { ok: true, json: async () => ({ ok: true }) }; });
  f.run(`Fasce = [{ id: 'f1', titolo: 'Accoglienza', inizio: '2026-10-10T10:00:00Z',
    mia: { ruolo: 'C1', nessunaAttivita: true } }]; inCorso = false; renderList(true)`);
  assert.match(f.element('#tl').innerHTML, /Accoglienza/);
  assert.match(f.element('#tl').innerHTML, /Nessuna attività/);
  assert.doesNotMatch(f.element('#tl').innerHTML, /data-fascia="f1"/);
  await f.run("toggleCompletato('f1')");
  assert.equal(richieste, 0);
});

test('l’assegnazione inattiva viene salvata senza luogo né istruzioni', () => {
  const f = frontend();
  const dati = f.run(`leggiNuoveAssegnazioni({ querySelectorAll: () => [{
    querySelector: selettore => selettore === '[name="nessunaAttivita"]'
      ? { checked: true } : { value: ({ ruolo: 'C1', tappa: 'Atrio',
        istruzioniSpostamento: 'Vai al primo piano', note: 'Nota' })[selettore.slice(7, -2)] }
  }] })`);
  assert.equal(dati[0].nessunaAttivita, true);
  assert.equal(dati[0].tappa, '');
  assert.equal(dati[0].istruzioniSpostamento, '');
  assert.equal(dati[0].note, '');
});

test('staff aggiorna programma e completamenti dal server ogni 2 minuti', async () => {
  let calls = 0;
  const f = frontend(async () => ({ ok: true, json: async () => ({
    attivo: true, completamenti: { C1: calls++ ? ['f1'] : [] },
    fasce: [{ id: 'f1', titolo: 'Accoglienza', inizio: '2026-10-10T10:00:00Z' }]
  }) }));
  await f.run('showTimeline()');
  const timer = [...f.intervals.values()].find(i => i.ms === 120000);
  assert.ok(timer);
  assert.match(f.element('#tl').innerHTML, /Segna come completata/);
  await timer.callback();
  assert.match(f.element('#tl').innerHTML, /Tappa completata/);
});

test('admin aggiorna i completamenti ogni 30 secondi mantenendo una bozza di programma', async () => {
  let calls = 0;
  const f = frontend(async (url) => url.includes('/programma')
    ? { ok: true, json: async () => ({ attivo: true,
      completamenti: { C1: calls++ ? ['f1'] : [] },
      fasce: [{ id: 'f1', titolo: calls > 1 ? 'Remoto' : 'Originale' }] }) }
    : { ok: true, json: async () => ({ ruoli: [{ nome: 'C1', gruppo: 'Corridoio' }] }) });
  f.run("S.role = 'Admin'; S.token = 'test-token'");
  await f.run('showAdmin()');
  f.run("Fasce[0].titolo = 'Bozza locale'; sporco = true");
  const timer = [...f.intervals.values()].find(i => i.ms === 30000);
  assert.ok(timer);
  await timer.callback();
  assert.equal(f.run('Fasce[0].titolo'), 'Bozza locale');
  assert.equal(f.run('Completamenti.C1[0]'), 'f1');
});

test('dashboard non considera in ritardo una fase inattiva per il ruolo', async () => {
  const f = frontend(async url => url.includes('/programma')
    ? { ok: true, json: async () => ({ attivo: true, completamenti: {}, fasce: [{
      id: 'f1', titolo: 'Accoglienza', fine: '2020-01-01T10:00:00Z',
      personalizzazioni: [{ ruolo: 'C1', nessunaAttivita: true }]
    }] }) }
    : { ok: true, json: async () => ({ ruoli: [{ nome: 'C1', gruppo: 'Corridoio' }] }) });
  f.run("S.role = 'Admin'; S.token = 'test-token'; S.tabAdmin = 'dashboard'");
  await f.run('showAdmin()');
  assert.match(f.element('#tabContent').innerHTML, /Nessuna attività/);
  assert.doesNotMatch(f.element('#tabContent').innerHTML, /Da verificare/);
});

test('regia distingue conferme, attese, ritardi e ruoli senza attività', () => {
  const f = frontend();
  const quadro = f.run(`preparaRegia([
    { id: 'f1', titolo: 'Accoglienza', inizio: '2026-10-10T19:00:00Z', fine: '2026-10-10T20:04:00Z',
      personalizzazioni: [{ ruolo: 'Corridoio', nessunaAttivita: true }, { ruolo: 'C2', nessunaAttivita: false }] },
    { id: 'f2', titolo: 'Laboratori', inizio: '2026-10-10T20:00:00Z', fine: '2026-10-10T20:08:00Z' },
    { id: 'f3', titolo: 'Saluti', inizio: '2026-10-10T20:09:00Z' }
  ], [{ nome: 'C1', gruppo: 'Corridoio' }, { nome: 'C2', gruppo: 'Corridoio' }],
  { C2: ['f2'] }, new Date('2026-10-10T20:10:00Z'), true)`);
  assert.equal(quadro.fasi[0].conteggi.inattivi, 1);
  assert.equal(quadro.fasi[0].righe[1].stato, 'ritardo');
  assert.equal(quadro.fasi[1].righe[0].stato, 'attesa');
  assert.equal(quadro.fasi[1].righe[1].stato, 'completato');
  assert.equal(quadro.allerte.length, 2);
  assert.equal(quadro.allerte[0].fase.id, 'f1');
  assert.equal(quadro.allerte[0].minuti, 6);
  assert.equal(quadro.fasi[2].conteggi.ritardo, 0, 'senza fine non si presume un ritardo');
});

test('regia sospende gli allarmi quando l’evento è in pausa e indica fase corrente e prossima', () => {
  const f = frontend();
  const quadro = f.run(`preparaRegia([
    { id: 'f0', inizio: '2026-10-10T19:00:00Z', fine: '2026-10-10T19:30:00Z' },
    { id: 'f1', inizio: '2026-10-10T20:00:00Z', fine: '2026-10-10T20:30:00Z' },
    { id: 'f2', inizio: '2026-10-10T21:00:00Z', fine: '2026-10-10T21:30:00Z' }
  ], [{ nome: 'C1', gruppo: 'Corridoio' }], {}, new Date('2026-10-10T20:10:00Z'), false)`);
  assert.equal(quadro.allerte.length, 0);
  assert.equal(quadro.correnti[0].fase.id, 'f1');
  assert.equal(quadro.prossima.fase.id, 'f2');
  assert.equal(quadro.fasi[0].righe[0].stato, 'pausa');
});

test('regia admin mostra alert e dettaglio ruolo, e apre la fase dall’alert', async () => {
  const f = frontend(async url => url.includes('/programma')
    ? { ok: true, json: async () => ({ attivo: true, completamenti: {}, fasce: [{
      id: 'f1', titolo: 'Accoglienza', inizio: '2020-01-01T09:00:00Z', fine: '2020-01-01T10:00:00Z',
      personalizzazioni: [{ ruolo: 'C1', tappa: 'Atrio' }]
    }] }) }
    : { ok: true, json: async () => ({ ruoli: [{ nome: 'C1', gruppo: 'Corridoio' }] }) });
  f.run("S.role = 'Admin'; S.token = 'test-token'");
  await f.run('showAdmin()');
  const html = f.element('#tabContent').innerHTML;
  assert.match(html, /Regia della serata/);
  assert.match(html, /Aggiornato dal server/);
  assert.match(html, /Da verificare/);
  assert.match(html, /Luogo previsto: Atrio/);
  const dettaglio = { dataset: { fase: 'f1' }, open: false, scrollIntoView() {} };
  f.element('#tabContent').querySelectorAll = () => [dettaglio];
  f.element('#tabContent').onclick({ target: { closest: sel => sel === '[data-apri-fase]'
    ? { dataset: { apriFase: 'f1' } } : null } });
  assert.equal(dettaglio.open, true);
  assert.equal(f.run("S.fasiRegiaAperte.has('f1')"), true);
});

test('regia si aggiorna dal server ogni 30 secondi conservando le fasi aperte', async () => {
  let letture = 0;
  const f = frontend(async url => url.includes('/programma')
    ? { ok: true, json: async () => ({ attivo: true, completamenti: { C1: letture++ ? ['f1'] : [] }, fasce: [{
      id: 'f1', titolo: 'Accoglienza', inizio: '2020-01-01T09:00:00Z', fine: '2020-01-01T10:00:00Z'
    }] }) }
    : { ok: true, json: async () => ({ ruoli: [{ nome: 'C1', gruppo: 'Corridoio' }] }) });
  f.run("S.role = 'Admin'; S.token = 'test-token'");
  await f.run('showAdmin()');
  assert.match(f.element('#tabContent').innerHTML, /Conferma mancante/);
  f.run("S.fasiRegiaAperte.add('f1')");
  const timer = [...f.intervals.values()].find(i => i.ms === 30000);
  assert.ok(timer);
  await timer.callback();
  assert.doesNotMatch(f.element('#tabContent').innerHTML, /Conferma mancante/);
  assert.match(f.element('#tabContent').innerHTML, /data-fase="f1" open/);
  assert.match(f.element('#tabContent').innerHTML, /Conferme complete/);
});
