const { leggi, verificaToken } = require('./_lib');

// Una riga vale per chi ha esattamente quel ruolo; se non c'è, si eredita quella
// della squadra (una riga su "Aula" vale per Aula 1, 2, ... 8).
//
// Dipende SOLO dal ruolo, mai dal token. Essere admin serve per MODIFICARE
// tutto, non per cambiare quello che vedi come staff: se qui il token contasse,
// un admin che passa da una fase all'altra non vedrebbe mai le sue istruzioni.
function miaDi(f, ruolo, gruppo) {
  const ps = f.personalizzazioni || [];
  return ps.find(p => p.ruolo === ruolo) || ps.find(p => p.ruolo === gruppo) || null;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ errore: 'Metodo non consentito' });
  const r = String(req.query.ruolo || ''), g = String(req.query.gruppo || '');
  // Il token dice solo se il richiesto può vedere TUTTE le personalizzazioni,
  // cioè se può entrare nell'admin. Non serve a filtrare: senza token le altre
  // non arrivano proprio sul telefono.
  const admin = verificaToken(String(req.headers.authorization || '').replace(/^Bearer /, ''));
  try {
    const fasce = await leggi('fasce');
    res.json({
      admin,
      fasce: fasce.map(f => ({
        ...f,
        personalizzazioni: admin ? (f.personalizzazioni || []) : [],
        mia: miaDi(f, r, g)
      }))
    });
  } catch (e) { res.status(503).json({ errore: e.message }); }
};