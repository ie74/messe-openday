const { rilasciaToken, verificaToken, confronta, segreto, troppo, nota, azzera, scrivi, aggiorna,
  leggiRuoli, trovaRuolo, generaCodice } = require('./_lib');

const bearer = req => String(req.headers.authorization || '').replace(/^Bearer /, '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ errore: 'Metodo non consentito' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'sconosciuto';
  const { azione } = req.body || {};
  const admin = verificaToken(bearer(req));

  if (azione === 'login') {
    if (troppo(ip)) return res.status(429).json({ errore: 'Troppi tentativi. Riprova tra qualche minuto.' });
    let pw;
    try { pw = segreto(); } catch (e) { return res.status(500).json({ errore: e.message }); }
    if (!confronta(req.body.password, pw)) {
      nota(ip);
      return res.status(401).json({ errore: 'Password errata.' });
    }
    azzera(ip);
    return res.json({ token: rilasciaToken() });
  }

  // Completamento tappa: il ruolo viene dal badge (X-Badge). L'admin può indicare un ruolo.
  if (azione === 'segna_completato') {
    const { fasciaId, completato } = req.body || {};
    if (typeof fasciaId !== 'string' || !fasciaId || typeof completato !== 'boolean')
      return res.status(400).json({ errore: 'Dati mancanti o non validi.' });
    let ruolo = '';
    try {
      if (admin && req.body.ruolo) ruolo = String(req.body.ruolo);
      else {
        const r = await trovaRuolo(req.headers['x-badge']);
        if (!r) return res.status(401).json({ errore: 'Badge non valido o revocato.' });
        ruolo = r.nome;
      }
      const prog = await aggiorna('programma', corrente => {
        if (!(corrente.fasce || corrente.items || []).some(f => f.id === fasciaId))
          throw Object.assign(new Error('La tappa non esiste più nel programma.'), { status: 400 });
        const completamenti = { ...(corrente.completamenti || {}) };
        const lista = new Set(completamenti[ruolo] || []);
        if (completato) lista.add(fasciaId); else lista.delete(fasciaId);
        completamenti[ruolo] = [...lista];
        return { ...corrente, completamenti };
      });
      return res.json({ ok: true, completamenti: prog.completamenti });
    } catch (e) { return res.status(e.status || 500).json({ errore: e.message }); }
  }

  // Da qui in poi, solo admin.
  if (!admin) return res.status(401).json({ errore: 'Token mancante o scaduto: rientra come admin.' });

  if (azione === 'ruoli_lista') {
    try { return res.json({ ruoli: await leggiRuoli() }); }
    catch (e) { return res.status(500).json({ errore: e.message }); }
  }

  if (azione === 'ruoli_crea') {
    const { nome: datoNome, gruppo: datoGruppo } = req.body;
    if (typeof datoNome !== 'string' || typeof datoGruppo !== 'string')
      return res.status(400).json({ errore: 'Inserisci nome e gruppo del ruolo.' });
    const nome = datoNome.trim(), gruppo = datoGruppo.trim();
    if (!nome || !gruppo)
      return res.status(400).json({ errore: 'Nome e gruppo sono obbligatori.' });
    if (nome.toLowerCase() === 'admin')
      return res.status(400).json({ errore: 'Il nome Admin è riservato all’amministratore.' });
    const ruolo = { nome, gruppo, badge: generaCodice() };
    try {
      // Aggiunge al documento corrente, anche se altri admin creano ruoli insieme.
      const doc = await aggiorna('ruoli', corrente => {
        const lista = corrente.items || [];
        if (lista.some(r => r.nome.toLowerCase() === nome.toLowerCase()))
          throw Object.assign(new Error(`Il ruolo "${nome}" esiste già.`), { status: 409 });
        return { ...corrente, items: [...lista, ruolo] };
      }, { items: [] });
      return res.json({ ok: true, ruolo, ruoli: doc.items });
    } catch (e) { return res.status(e.status || 500).json({ errore: e.message }); }
  }

  if (azione === 'ruoli_salva') {
    const nuovi = req.body.ruoli;
    if (!Array.isArray(nuovi)) return res.status(400).json({ errore: 'Dati non validi.' });
    try {
      const vecchi = await leggiRuoli();
      const viste = new Set(), risultato = [];
      const rinomine = {}, gruppi = {};
      for (const r of nuovi) {
        const nome = String(r.nome || '').trim(), gruppo = String(r.gruppo || '').trim();
        if (!nome) return res.status(400).json({ errore: 'Un ruolo ha il nome vuoto.' });
        if (viste.has(nome.toLowerCase())) return res.status(400).json({ errore: `Il ruolo "${nome}" compare due volte.` });
        viste.add(nome.toLowerCase());
        // Il badge esistente si conserva; uno nuovo viene generato. Il client non può inventarne.
        const badge = r.badge && vecchi.some(v => v.badge === r.badge) ? r.badge : generaCodice();
        if (r.vecchioNome && r.vecchioNome !== nome) rinomine[r.vecchioNome] = nome;
        if (r.vecchioGruppo && r.vecchioGruppo !== gruppo) gruppi[r.vecchioGruppo] = gruppo;
        risultato.push({ nome, gruppo, badge });
      }
      const rimossi = vecchi.map(v => v.nome).filter(n => !risultato.some(r => r.nome === n) && !rinomine[n]);
      const mappa = s => rinomine[s] ?? gruppi[s] ?? s;

      if (Object.keys(rinomine).length || Object.keys(gruppi).length) {
        await aggiorna('programma', prog => {
          const fasce = (prog.fasce || prog.items || []).map(f => ({
            ...f,
            personalizzazioni: (f.personalizzazioni || []).map(p => ({ ...p, ruolo: mappa(p.ruolo) }))
          }));
          const completamenti = Object.fromEntries(
            Object.entries(prog.completamenti || {}).map(([k, v]) => [mappa(k), v])
          );
          return { ...prog, fasce, completamenti };
        });
      }
      await scrivi('ruoli', { items: risultato });
      res.json({ ok: true, ruoli: risultato, rimossi, rinominati: Object.keys(rinomine).length });
    } catch (e) { res.status(500).json({ errore: e.message }); }
    return;
  }

  if (azione === 'ruoli_rigenera') {
    const { nome } = req.body || {};
    try {
      const badge = generaCodice();
      await aggiorna('ruoli', corrente => {
        const lista = corrente.items || [];
        if (!lista.some(r => r.nome === nome))
          throw Object.assign(new Error('Ruolo non trovato.'), { status: 404 });
        return { ...corrente, items: lista.map(r => r.nome === nome ? { ...r, badge } : r) };
      });
      res.json({ ok: true, badge });
    } catch (e) { res.status(e.status || 500).json({ errore: e.message }); }
    return;
  }

  if (azione === 'salva') {
    const { fasce, attivo } = req.body;
    if (!Array.isArray(fasce)) return res.status(400).json({ errore: 'Dati non validi.' });
    for (const f of fasce) {
      const dup = (f.personalizzazioni || []).map(p => p.ruolo).filter((v, k, a) => a.indexOf(v) !== k);
      if (dup.length) return res.status(400).json({ errore: `Nella fase "${f.titolo}" la squadra "${dup[0]}" compare due volte.` });
    }
    try {
      const nuovoProg = await aggiorna('programma', prog => ({
        ...prog,
        fasce,
        attivo: typeof attivo === 'boolean' ? attivo : (prog.attivo || false)
      }));
      res.json({ ok: true, fasce: fasce.length, attivo: nuovoProg.attivo });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  } else if (azione === 'toggle_attivo') {
    const { attivo } = req.body;
    try {
      const prog = await aggiorna('programma', corrente => ({ ...corrente, attivo: !!attivo }));
      res.json({ ok: true, attivo: prog.attivo });
    } catch (e) { res.status(500).json({ errore: e.message }); }
  } else {
    res.status(400).json({ errore: 'Azione sconosciuta' });
  }
};
