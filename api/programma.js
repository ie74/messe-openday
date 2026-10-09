const { leggi, verificaToken, trovaRuolo } = require('./_lib');

function miaDi(f, ruolo, gruppo) {
  const ps = f.personalizzazioni || [];
  return ps.find(p => p.ruolo === ruolo) || ps.find(p => p.ruolo === gruppo) || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ errore: 'Metodo non consentito' });
  const admin = verificaToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  try {
    let ruolo = '', gruppo = '';
    if (admin) {
      // L'admin può vedere la vista di un ruolo specifico ("vedi come")
      ruolo = String(req.query.ruolo || ''); gruppo = String(req.query.gruppo || '');
    } else {
      // Tutti gli altri: solo il ruolo del badge. Il parametro della query viene ignorato.
      const r = await trovaRuolo(req.headers['x-badge']);
      if (!r) return res.status(401).json({ errore: 'Badge non valido o revocato.', badge: false });
      ruolo = r.nome; gruppo = r.gruppo || '';
    }

    const doc = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
    const fasce = doc.fasce || doc.items || [];
    res.json({
      admin,
      ruolo,
      attivo: typeof doc.attivo === 'boolean' ? doc.attivo : false,
      completamenti: doc.completamenti || {},
      fasce: fasce.map(f => ({
        ...f,
        personalizzazioni: admin ? (f.personalizzazioni || []) : [],
        mia: miaDi(f, ruolo, gruppo)
      }))
    });
  } catch (e) { res.status(503).json({ errore: e.message }); }
};
