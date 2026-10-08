const { leggi, verificaToken } = require('./_lib');

function miaDi(f, ruolo, gruppo) {
  const ps = f.personalizzazioni || [];
  return ps.find(p => p.ruolo === ruolo) || ps.find(p => p.ruolo === gruppo) || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ errore: 'Metodo non consentito' });
  const r = String(req.query.ruolo || ''), g = String(req.query.gruppo || '');
  const admin = verificaToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  try {
    const doc = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
    // Support retro-compatibility if doc contains items property
    const fasce = doc.fasce || doc.items || [];
    const attivo = typeof doc.attivo === 'boolean' ? doc.attivo : false;
    const completamenti = doc.completamenti || {};

    res.json({
      admin,
      attivo,
      completamenti,
      fasce: fasce.map(f => ({
        ...f,
        personalizzazioni: admin ? (f.personalizzazioni || []) : [],
        mia: miaDi(f, r, g)
      }))
    });
  } catch (e) { res.status(503).json({ errore: e.message }); }
};