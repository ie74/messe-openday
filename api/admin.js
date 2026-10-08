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

  // Endpoints that can be performed by teams or admin (like segna_completato)
  if (azione === 'segna_completato') {
    const { ruolo, fasciaId, completato } = req.body || {};
    if (!ruolo || !fasciaId) return res.status(400).json({ errore: 'Dati mancanti.' });
    try {
      const prog = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
      const completamenti = prog.completamenti || {};
      const teamList = completamenti[ruolo] || [];
      if (completato) {
        if (!teamList.includes(fasciaId)) teamList.push(fasciaId);
      } else {
        const idx = teamList.indexOf(fasciaId);
        if (idx >= 0) teamList.splice(idx, 1);
      }
      completamenti[ruolo] = teamList;
      await scrivi('programma', { ...prog, completamenti });
      return res.json({ ok: true, completamenti });
    } catch (e) {
      return res.status(500).json({ errore: e.message });
    }
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!verificaToken(token)) return res.status(401).json({ errore: 'Token mancante o scaduto: rientra come admin.' });

  if (azione === 'salva') {
    const { fasce, attivo } = req.body;
    if (!Array.isArray(fasce)) return res.status(400).json({ errore: 'Dati non validi.' });
    for (const f of fasce) {
      const dup = (f.personalizzazioni || []).map(p => p.ruolo).filter((v, k, a) => a.indexOf(v) !== k);
      if (dup.length) return res.status(400).json({ errore: `Nella fase "${f.titolo}" la squadra "${dup[0]}" compare due volte.` });
    }
    try {
      const prog = await leggi('programma', { completamenti: {} });
      const nuovoProg = {
        ...prog,
        fasce,
        attivo: typeof attivo === 'boolean' ? attivo : (prog.attivo || false)
      };
      await scrivi('programma', nuovoProg);
      res.json({ ok: true, fasce: fasce.length, attivo: nuovoProg.attivo });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  } else if (azione === 'toggle_attivo') {
    const { attivo } = req.body;
    try {
      const prog = await leggi('programma', { fasce: [], completamenti: {} });
      prog.attivo = !!attivo;
      await scrivi('programma', prog);
      res.json({ ok: true, attivo: prog.attivo });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  } else {
    res.status(400).json({ errore: 'Azione sconosciuta' });
  }
};