const { leggi, scrivi, confronta } = require('./_lib');
const { invia } = require('./_push');
const MIN = 60000;

// Scadenza = momento in cui la squadra deve essere in posizione (stessa formula di app.js)
const scadenza = f => {
  const inizio = new Date(f.inizio).getTime();
  if (isNaN(inizio)) return null;
  return inizio + parseInt(f.durataSpostamento || 0, 10) * MIN;
};

const messaggio = (f, p, livello) => {
  const luogo = p.tappa || 'la postazione assegnata';
  return livello === 1
    ? { title: 'Sei in ritardo', body: `${f.titolo}: raggiungi ${luogo}`, tag: `ritardo-${f.id}`, renotify: true, vibrate: [300, 150, 300] }
    : { title: 'RITARDO CRITICO', body: `${f.titolo}: vai subito a ${luogo}`, tag: `ritardo-${f.id}`, renotify: true, urgente: true, vibrate: [600, 200, 600, 200, 600] };
};

// Chiamato ogni minuto da un cron esterno (es. cron-job.org) con Authorization: Bearer CRON_SECRET
module.exports = async (req, res) => {
  const tok = String(req.headers.authorization || '').replace(/^Bearer /, '') || String(req.query.k || '');
  if (!process.env.CRON_SECRET || !confronta(tok, process.env.CRON_SECRET))
    return res.status(401).json({ errore: 'Non autorizzato' });
  try {
    const prog = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
    if (!prog.attivo) return res.json({ ok: true, nota: 'evento non attivo' });

    const fasce = prog.fasce || prog.items || [];
    const completamenti = prog.completamenti || {};
    const lista = (await leggi('iscrizioni', { items: [] })).items || [];
    const ora = Date.now();
    const scartate = new Set();
    let inviati = 0;

    for (const sub of lista) {
      if (!sub.ruolo || sub.ruolo === 'Admin') continue;
      sub.inviate = sub.inviate || {};
      for (const f of fasce) {
        const dl = scadenza(f);
        if (dl === null) continue;
        if ((completamenti[sub.ruolo] || []).includes(f.id)) continue;   // già fatta: niente sollecito
        const ritardo = ora - dl;
        const livello = ritardo >= 5 * MIN ? 2 : ritardo >= MIN ? 1 : 0;
        if (!livello || sub.inviate[f.id] >= livello) continue;           // già inviato a questo livello
        const pers = f.personalizzazioni || [];
        const p = pers.find(x => x.ruolo === sub.ruolo) || pers.find(x => x.ruolo === sub.gruppo);
        if (!p) continue;
        const esito = await invia({ endpoint: sub.endpoint, keys: sub.keys }, messaggio(f, p, livello));
        if (esito === 'scaduta') { scartate.add(sub.endpoint); break; }
        if (esito === 'ok') { sub.inviate[f.id] = livello; inviati++; }
      }
    }

    const pulite = lista.filter(s => !scartate.has(s.endpoint));
    await scrivi('iscrizioni', { items: pulite });
    res.json({ ok: true, inviati, iscrizioni: pulite.length, rimosse: scartate.size });
  } catch (e) { res.status(500).json({ errore: e.message }); }
};
