const { createHmac, timingSafeEqual } = require('crypto');

/* Token admin: "payload.signatura". Nel payload c'è solo la scadenza — essere
   admin si deduce dal token, non da un campo che il telefono può cambiare. */
const segreto = () => {
  const p = process.env.ADMIN_PASSWORD;
  if (p === '[SENSITIVE]')
    throw new Error('ADMIN_PASSWORD è ancora "[SENSITIVE]": metti il valore vero in .vercel/.env.development.local');
  return p || 'sviluppo';
};
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
  const grezza = process.env.FIREBASE_KEY;
  if (!grezza) throw new Error('Manca la variabile FIREBASE_KEY.');
  if (grezza === '[SENSITIVE]')
    throw new Error('FIREBASE_KEY è ancora "[SENSITIVE]": metti il valore vero in .vercel/.env.development.local');
  let chiavi;
  try { chiavi = JSON.parse(grezza); }
  catch { throw new Error('FIREBASE_KEY non è JSON valido: deve stare tutto su una riga sola.'); }
  let admin;
  try { admin = require('firebase-admin'); }
  catch { throw new Error('firebase-admin non è installato. Nella cartella del progetto lancia: npm install'); }
  app = admin.initializeApp({ credential: admin.credential.cert(chiavi) });
  return app.firestore();
}

const leggi = async (id, vuoto = null) => {
  const d = await fs().collection('config').doc(id).get();
  return d.exists ? d.data() : vuoto;
};
const scrivi = (id, data) => fs().collection('config').doc(id)
  .set({ ...data, aggiornato: new Date().toISOString() });

module.exports = { rilasciaToken, verificaToken, confronta, troppo, nota, azzera, leggi, scrivi };