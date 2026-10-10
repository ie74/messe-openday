const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Simula documenti e conflitti Firestore senza account, rete o credenziali reali.
function fixture() {
  const docs = new Map([
    ['ruoli', { items: [
      { nome: 'C1', gruppo: 'Corridoio', badge: '1111-1111-1111-1111' },
      { nome: 'C2', gruppo: 'Corridoio', badge: '2222-2222-2222-2222' }
    ] }],
    ['programma', { attivo: true, fasce: [{ id: 'f1' }, { id: 'f2' }], completamenti: {} }]
  ]);
  let version = 0, retries = 0;
  const snapshot = id => ({ exists: docs.has(id), data: () => structuredClone(docs.get(id)) });
  const db = {
    collection: () => ({ doc: id => ({ id,
      get: async () => snapshot(id),
      set: async data => { docs.set(id, structuredClone(data)); version++; }
    }) }),
    async runTransaction(update) {
      for (;;) {
        const seen = version;
        let write;
        const result = await update({
          get: async ref => snapshot(ref.id),
          set: (ref, data) => { write = [ref.id, structuredClone(data)]; }
        });
        if (version !== seen) { retries++; continue; }
        docs.set(...write); version++;
        return result;
      }
    }
  };
  function load(file, requireModule) {
    const sandbox = { module: { exports: {} }, require: requireModule, Buffer,
      process: { env: { ADMIN_PASSWORD: 'only-for-tests', FIREBASE_KEY: '{}' } }, structuredClone };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
    return sandbox.module.exports;
  }
  const lib = load('api/_lib.js', name => name === 'firebase-admin'
    ? { credential: { cert: () => ({}) }, initializeApp: () => ({ firestore: () => db }) }
    : require(name));
  const fasi = load('api/_fasi.js', require);
  const dipendenza = name => name === './_lib' ? lib : name === './_fasi' ? fasi : require(name);
  const admin = load('api/admin.js', dipendenza);
  const programma = load('api/programma.js', dipendenza);
  const badge = load('api/badge.js', name => name === './_lib' ? lib : require(name));
  async function call(handler, body = {}, headers = {}, method = 'POST', query = {}) {
    const response = { code: 200, status(code) { this.code = code; return this; },
      json(data) { this.data = JSON.parse(JSON.stringify(data)); return this; } };
    await handler({ method, headers, body, query }, response);
    return response;
  }
  return { lib, admin, programma, badge, call, docs, retries: () => retries,
    auth: { authorization: 'Bearer ' + lib.rilasciaToken() } };
}

test('login admin, password errata e token alterato/scaduto', async () => {
  const f = fixture();
  assert.equal((await f.call(f.admin, { azione: 'login', password: 'wrong' })).code, 401);
  const success = await f.call(f.admin, { azione: 'login', password: 'only-for-tests' });
  assert.equal(f.lib.verificaToken(success.data.token), true);
  assert.equal(f.lib.verificaToken(success.data.token + 'x'), false);
  assert.equal(f.lib.verificaToken(success.data.token + '.extra'), false);
  assert.equal(f.lib.verificaToken(f.lib.rilasciaToken(-1)), false);
});

test('badge identifica il ruolo; query e corpo non possono impersonarne un altro', async () => {
  const f = fixture();
  assert.equal((await f.call(f.badge, { codice: '1111-1111-1111-1111' })).data.ruolo, 'C1');
  const result = await f.call(f.admin,
    { azione: 'segna_completato', ruolo: 'C2', fasciaId: 'f1', completato: true },
    { 'x-badge': '1111-1111-1111-1111' });
  assert.deepEqual(result.data.completamenti, { C1: ['f1'] });
  const view = await f.call(f.programma, {}, { 'x-badge': '1111-1111-1111-1111' }, 'GET', { ruolo: 'C2' });
  assert.equal(view.data.ruolo, 'C1');
});

test('ruolo senza attività vede la fase ma non può completarla, anche via API', async () => {
  const f = fixture();
  f.docs.set('programma', { attivo: true, completamenti: {}, fasce: [
    { id: 'f1', titolo: 'Accoglienza', personalizzazioni: [
      { ruolo: 'Corridoio', nessunaAttivita: true },
      { ruolo: 'C2', tappa: 'Atrio', nessunaAttivita: false }
    ] }
  ] });
  const c1 = { 'x-badge': '1111-1111-1111-1111' };
  const c2 = { 'x-badge': '2222-2222-2222-2222' };
  const vista = await f.call(f.programma, {}, c1, 'GET');
  assert.equal(vista.data.fasce.length, 1);
  assert.equal(vista.data.fasce[0].mia.nessunaAttivita, true);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', fasciaId: 'f1', completato: true }, c1)).code, 403);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', ruolo: 'C1', fasciaId: 'f1', completato: true }, f.auth)).code, 403);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', fasciaId: 'f1', completato: true }, c2)).code, 200);
  assert.deepEqual(f.docs.get('programma').completamenti, { C2: ['f1'] });
});

test('badge revocato, tappa inesistente e input incompleto vengono rifiutati', async () => {
  const f = fixture();
  assert.equal((await f.call(f.badge, { codice: 'bad' })).code, 401);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', fasciaId: 'f1', completato: true })).code, 401);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', ruolo: 'C1', fasciaId: 'gone', completato: true }, f.auth)).code, 400);
  assert.equal((await f.call(f.admin, { azione: 'segna_completato', ruolo: 'C1', fasciaId: 'f1' }, f.auth)).code, 400);
});

test('completamento idempotente e annullamento', async () => {
  const f = fixture(), headers = { 'x-badge': '1111-1111-1111-1111' };
  const body = { azione: 'segna_completato', fasciaId: 'f1', completato: true };
  await f.call(f.admin, body, headers);
  const duplicate = await f.call(f.admin, body, headers);
  assert.deepEqual(duplicate.data.completamenti.C1, ['f1']);
  const undone = await f.call(f.admin, { ...body, completato: false }, headers);
  assert.deepEqual(undone.data.completamenti.C1, []);
});

test('due squadre completano simultaneamente senza perdere dati', async () => {
  const f = fixture();
  const responses = await Promise.all(['C1', 'C2'].map(ruolo => f.call(f.admin,
    { azione: 'segna_completato', ruolo, fasciaId: 'f1', completato: true }, f.auth)));
  assert.equal(responses.every(r => r.code === 200), true);
  assert.deepEqual(f.docs.get('programma').completamenti, { C1: ['f1'], C2: ['f1'] });
  assert.ok(f.retries() > 0, 'Il test deve esercitare un conflitto di scrittura');
});

test('salvataggio programma e toggle simultanei conservano i completamenti', async () => {
  const f = fixture();
  await Promise.all([
    f.call(f.admin, { azione: 'segna_completato', ruolo: 'C1', fasciaId: 'f1', completato: true }, f.auth),
    f.call(f.admin, { azione: 'salva', fasce: [{ id: 'f1', titolo: 'Nuovo titolo' }, { id: 'f2' }] }, f.auth),
    f.call(f.admin, { azione: 'toggle_attivo', attivo: false }, f.auth)
  ]);
  assert.deepEqual(f.docs.get('programma').completamenti, { C1: ['f1'] });
  assert.equal(f.docs.get('programma').fasce[0].titolo, 'Nuovo titolo');
  assert.equal(f.docs.get('programma').attivo, false);
});

test('salvare e rigenerare ruoli mantiene gli altri badge e non usa iscrizioni', async () => {
  const f = fixture(), before = structuredClone(f.docs.get('programma'));
  const roles = f.docs.get('ruoli').items;
  const saved = await f.call(f.admin, { azione: 'ruoli_salva', ruoli: roles }, f.auth);
  assert.equal(saved.code, 200);
  assert.equal(saved.data.ruoli[0].badge, roles[0].badge);
  assert.deepEqual(f.docs.get('programma'), before);
  await f.call(f.admin, { azione: 'ruoli_rigenera', nome: 'C1' }, f.auth);
  assert.equal((await f.call(f.badge, { codice: roles[0].badge })).code, 401);
  assert.equal(f.docs.get('ruoli').items[1].badge, roles[1].badge);
  assert.equal(f.docs.has('iscrizioni'), false);
});

test('test notifiche rimosso; azioni admin e metodi restano protetti', async () => {
  const f = fixture();
  assert.equal((await f.call(f.admin, { azione: 'test_push' }, f.auth)).code, 400);
  assert.equal((await f.call(f.admin, { azione: 'ruoli_lista' })).code, 401);
  assert.equal((await f.call(f.admin, {}, {}, 'GET')).code, 405);
});

test('creare un ruolo conserva badge e programma e abilita subito accesso e istruzioni di gruppo', async () => {
  const f = fixture(), roles = structuredClone(f.docs.get('ruoli').items);
  f.docs.set('programma', { attivo: true, completamenti: { C1: ['f1'] }, fasce: [
    { id: 'f1', personalizzazioni: [{ ruolo: 'Corridoio', tappa: 'Atrio' }] },
    { id: 'f2', personalizzazioni: [
      { ruolo: 'Corridoio', tappa: 'Atrio' }, { ruolo: 'C3', tappa: 'Laboratorio' }
    ] }
  ] });
  const before = structuredClone(f.docs.get('programma'));
  const result = await f.call(f.admin,
    { azione: 'ruoli_crea', nome: '  C3  ', gruppo: '  Corridoio  ', badge: 'inventato' }, f.auth);
  assert.equal(result.code, 200);
  assert.deepEqual(result.data.ruoli.slice(0, 2), roles);
  const role = result.data.ruolo;
  assert.equal(role.nome, 'C3');
  assert.equal(role.gruppo, 'Corridoio');
  assert.match(role.badge, /^[0-9a-f]{4}(?:-[0-9a-f]{4}){3}$/);
  assert.deepEqual(f.docs.get('programma'), before);
  const login = await f.call(f.badge, { codice: role.badge });
  assert.equal(login.data.ruolo, 'C3');
  assert.equal(login.data.gruppo, 'Corridoio');
  const view = await f.call(f.programma, {}, { 'x-badge': role.badge }, 'GET');
  assert.equal(view.data.fasce[0].mia.tappa, 'Atrio');
  assert.equal(view.data.fasce[1].mia.tappa, 'Laboratorio');
});

test('la creazione richiede admin, nome e gruppo validi e un nome unico', async () => {
  const f = fixture(), before = structuredClone(f.docs.get('ruoli'));
  assert.equal((await f.call(f.admin, { azione: 'ruoli_crea', nome: 'C3', gruppo: 'Aula' })).code, 401);
  for (const fields of [
    {}, { nome: 'C3' }, { nome: ' ', gruppo: 'Aula' }, { nome: 'C3', gruppo: ' ' },
    { nome: {}, gruppo: 'Aula' }, { nome: 'C3', gruppo: [] }, { nome: 'aDmIn', gruppo: 'Aula' }
  ]) assert.equal((await f.call(f.admin, { azione: 'ruoli_crea', ...fields }, f.auth)).code, 400);
  const duplicate = await f.call(f.admin, { azione: 'ruoli_crea', nome: ' c1 ', gruppo: 'Altro' }, f.auth);
  assert.equal(duplicate.code, 409);
  assert.match(duplicate.data.errore, /esiste già/);
  assert.deepEqual(f.docs.get('ruoli'), before);
});

test('si può creare il primo ruolo anche con un gruppo nuovo', async () => {
  const f = fixture();
  f.docs.delete('ruoli');
  const result = await f.call(f.admin, { azione: 'ruoli_crea', nome: 'Guida 1', gruppo: 'Guide' }, f.auth);
  assert.equal(result.code, 200);
  assert.equal(result.data.ruoli.length, 1);
  assert.equal(f.docs.get('ruoli').items[0].gruppo, 'Guide');
});

test('creazioni simultanee e rigenerazione badge conservano tutti i ruoli', async () => {
  const f = fixture();
  const responses = await Promise.all([
    f.call(f.admin, { azione: 'ruoli_crea', nome: 'C3', gruppo: 'Corridoio' }, f.auth),
    f.call(f.admin, { azione: 'ruoli_crea', nome: 'Aula 1', gruppo: 'Aula' }, f.auth),
    f.call(f.admin, { azione: 'ruoli_rigenera', nome: 'C1' }, f.auth)
  ]);
  assert.equal(responses.every(r => r.code === 200), true);
  assert.deepEqual(f.docs.get('ruoli').items.map(r => r.nome).sort(), ['Aula 1', 'C1', 'C2', 'C3']);
  assert.equal(f.docs.get('ruoli').items[1].badge, '2222-2222-2222-2222');
  assert.equal((await f.call(f.badge, { codice: '1111-1111-1111-1111' })).code, 401);
  assert.ok(f.retries() > 0);
});

test('due admin non possono creare simultaneamente lo stesso nome', async () => {
  const f = fixture();
  const responses = await Promise.all(['C3', 'c3'].map(nome => f.call(f.admin,
    { azione: 'ruoli_crea', nome, gruppo: 'Corridoio' }, f.auth)));
  assert.deepEqual(responses.map(r => r.code).sort(), [200, 409]);
  assert.equal(f.docs.get('ruoli').items.length, 3);
});
