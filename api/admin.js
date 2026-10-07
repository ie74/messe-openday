const { rilasciaToken, verificaToken, confronta, troppo, nota, azzera, leggi, scrivi } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ errore: 'Metodo non consentito' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sconosciuto';
  const { azione } = req.body || {};

  if (azione === 'login') {
    if (troppo(ip)) return res.status(429).json({ errore: 'Troppi tentativi. Riprova tra qualche minuto.' });
    if (!confronta(req.body.password, process.env.ADMIN_PASSWORD || '')) {
      nota(ip);
      return res.status(401).json({ errore: 'Password errata.' });
    }
    azzera(ip);
    return res.json({ token: rilasciaToken() });
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!verificaToken(token)) return res.status(401).json({ errore: 'Token mancante o scaduto: rientra come admin.' });

  if (azione === 'salva') {
    const { fasce } = req.body;
    if (!Array.isArray(fasce)) return res.status(400).json({ errore: 'Dati non validi.' });
    // Una riga sola per squadra: con due, quale vinca dipenderebbe dall'ordine
    // di lettura e nessuno se ne accorgerebbe.
    for (const f of fasce) {
      const dup = (f.personalizzazioni || []).map(p => p.ruolo).filter((v, k, a) => a.indexOf(v) !== k);
      if (dup.length) return res.status(400).json({ errore: `Nella fase "${f.titolo}" la squadra "${dup[0]}" compare due volte.` });
    }
    try {
      await scrivi('fasce', fasce);
      res.json({ ok: true, fasce: fasce.length });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  }
};