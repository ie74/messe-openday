const { createHmac, timingSafeEqual } = require('crypto');

/* Token admin: "payload.signatura". Nel payload c'è solo la scadenza — essere
   admin si deduce dal token, non da un campo che il telefono può cambiare. */
const segreto = () => process.env.ADMIN_PASSWORD || 'sviluppo';
const firma = p => createHmac('sha256', segreto()).update(p).digest('base64url');

const rilasciaToken = (ttl = 12 * 3600e3) => {
  const p = Buffer.from(JSON.stringify({ exp: Date.now() + ttl })).toString('base64url');
  return p + '.' + firma(p);
};

function verificaToken(t) {
  if (!t || typeof t !== 'string' || !t.includes('.')) return false;
  const [p, s] = t.split('.');
  const atteso = Buffer.from(firma(p)), dato = Buffer.from(s);
  if (atteso.length !== dato.length || !timingSafeEqual(atteso, dato)) return false;
  try { return Date.now() < JSON.parse(Buffer.from(p, 'base64url')).exp; } catch { return false; }
}

const confronta = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
};

/* Freno ai tentativi a forza bruta. In memoria per istanza: sul serverless non
   è un muro, serve ad alzare il costo di un attacco automatico. */
const FRENO = new Map(), FINESTRA = 15 * 60e3, MAX = 5;
const recenti = ip => (FRENO.get(ip) || []).filter(t => Date.now() - t < FINESTRA);
const troppo = ip => recenti(ip).length >= MAX;
const nota = ip => FRENO.set(ip, [...recenti(ip), Date.now()]);
const azzera = ip => FRENO.delete(ip);

/* Firestore. Non usiamo l'SDK web nel browser: tutto passa da qui con l'Admin
   SDK, che scavalca le regole, e così le regole restano "nega tutto". */
let app = null;
function fs() {
  if (app) return app.firestore();
  const grezza = process.env.FIREBASE_KEY;    // testo JSON del file di credenziali
  if (!grezza) throw new Error('Manca la variabile FIREBASE_KEY su Vercel.');
  const admin = require('firebase-admin');
  app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(grezza)) });
  return app.firestore();
}

const leggi = async (id, vuoto = []) => {
  const d = await fs().collection('config').doc(id).get();
  return d.exists ? (d.data().items ?? vuoto) : vuoto;
};
const scrivi = (id, items) => fs().collection('config').doc(id)
  .set({ items, aggiornato: new Date().toISOString() });

module.exports = { rilasciaToken, verificaToken, confronta, troppo, nota, azzera, leggi, scrivi };