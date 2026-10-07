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
    const { tappe, spostamenti } = req.body;
    if (!Array.isArray(tappe) || !Array.isArray(spostamenti))
      return res.status(400).json({ errore: 'Dati non validi.' });
    // Niente spostamenti che puntano a una tappa cancellata: romperebbe il grafo.
    const nomi = new Set(tappe.map(t => t.nome));
    const rotto = spostamenti.find(s => !nomi.has(s.da) || !nomi.has(s.a));
    if (rotto) return res.status(400).json({ errore: `Lo spostamento "${rotto.da} → ${rotto.a}" punta a una tappa inesistente.` });
    try {
      await scrivi('tappe', tappe);
      await scrivi('spostamenti', spostamenti);
      res.json({ ok: true, tappe: tappe.length, spostamenti: spostamenti.length });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  }
};