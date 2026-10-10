const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function frontend(response, initialStorage = {}) {
  const storage = new Map(Object.entries(initialStorage).map(([key, value]) => [key, JSON.stringify(value)]));
  const elements = new Map();
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
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    fetch: async () => response };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8').replace(/boot\(\);\s*$/, '');
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  run("S.role = 'C1'; S.badge = '1111-1111-1111-1111'; Fasce = [{ id: 'f1', titolo: 'Accoglienza' }]");
  return { run, storage, element };
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
