const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function worker(overrides = {}) {
  const handlers = {}, removed = [], cached = [];
  let unsubscribed = false;
  const caches = {
    keys: async () => ['evento-v1', 'openday-v1', 'openday-v2', 'other-app'],
    delete: async key => removed.push(key),
    open: async () => ({ addAll: async () => {}, put: async (...args) => cached.push(args) }),
    match: async () => undefined
  };
  const self = { addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting() {}, location: { origin: 'https://example.test' }, clients: { claim: async () => {} },
    registration: { pushManager: { getSubscription: async () => ({ unsubscribe: async () => { unsubscribed = true; } }) } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'),
    { self, caches, URL, Response, console, fetch: async () => new Response('ok'), ...overrides });
  return { handlers, removed, cached, caches, unsubscribed: () => unsubscribed };
}

test('upgrade mantiene PWA, rimuove solo cache proprie e disiscrive la vecchia push', async () => {
  const w = worker();
  assert.deepEqual(Object.keys(w.handlers).sort(), ['activate', 'fetch', 'install']);
  let done;
  w.handlers.activate({ waitUntil: p => { done = p; } });
  await done;
  assert.deepEqual(w.removed, ['evento-v1', 'openday-v1']);
  assert.equal(w.unsubscribed(), true);
});

test('API e richieste esterne non vengono intercettate', () => {
  const w = worker();
  for (const url of ['https://example.test/api/programma', 'https://external.test/app.js']) {
    w.handlers.fetch({ request: new Request(url), respondWith: () => assert.fail('Richiesta intercettata') });
  }
});

test('una risposta di errore non inquina la cache', async () => {
  const w = worker({ fetch: async () => new Response('error', { status: 500 }) });
  let response;
  w.handlers.fetch({ request: new Request('https://example.test/app.js'), respondWith: p => { response = p; } });
  assert.equal((await response).status, 500);
  assert.equal(w.cached.length, 0);
});

test('offline usa la copia statica disponibile e non serve HTML al posto di immagini', async () => {
  const w = worker({ fetch: async () => { throw new Error('offline'); } });
  w.caches.match = async request => typeof request === 'object' && request.url.endsWith('style.css')
    ? new Response('cached CSS') : undefined;
  let response;
  w.handlers.fetch({ request: new Request('https://example.test/style.css'), respondWith: p => { response = p; } });
  assert.equal(await (await response).text(), 'cached CSS');
  w.handlers.fetch({ request: new Request('https://example.test/missing.png'), respondWith: p => { response = p; } });
  assert.equal((await response).type, 'error');
});
