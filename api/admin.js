const { rilasciaToken, verificaToken, confronta, segreto, troppo, nota, azzera, leggi, scrivi,
  leggiRuoli, trovaRuolo, generaCodice } = require('./_lib');
const { invia } = require('./_push');

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
    if (!fasciaId) return res.status(400).json({ errore: 'Dati mancanti.' });
    let ruolo = '';
    if (admin && req.body.ruolo) ruolo = String(req.body.ruolo);
    else {
      const r = await trovaRuolo(req.headers['x-badge']);
      if (!r) return res.status(401).json({ errore: 'Badge non valido o revocato.' });
      ruolo = r.nome;
    }
    try {
      const prog = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
      const completamenti = prog.completamenti || {};
      const lista = completamenti[ruolo] || [];
      if (completato) { if (!lista.includes(fasciaId)) lista.push(fasciaId); }
      else { const i = lista.indexOf(fasciaId); if (i >= 0) lista.splice(i, 1); }
      completamenti[ruolo] = lista;
      await scrivi('programma', { ...prog, completamenti });
      return res.json({ ok: true, completamenti });
    } catch (e) { return res.status(500).json({ errore: e.message }); }
  }

  // Da qui in poi, solo admin.
  if (!admin) return res.status(401).json({ errore: 'Token mancante o scaduto: rientra come admin.' });

  if (azione === 'ruoli_lista') {
    try { return res.json({ ruoli: await leggiRuoli() }); }
    catch (e) { return res.status(500).json({ errore: e.message }); }
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

      const prog = await leggi('programma', { fasce: [], attivo: false, completamenti: {} });
      prog.fasce = (prog.fasce || []).map(f => ({
        ...f,
        personalizzazioni: (f.personalizzazioni || []).map(p => ({ ...p, ruolo: mappa(p.ruolo) }))
      }));
      const completamenti = {};
      for (const [k, v] of Object.entries(prog.completamenti || {})) completamenti[mappa(k)] = v;
      prog.completamenti = completamenti;
      await scrivi('programma', prog);

      if (Object.keys(rinomine).length || Object.keys(gruppi).length) {
        const iscritti = (await leggi('iscrizioni', { items: [] })).items || [];
        iscritti.forEach(s => { s.ruolo = mappa(s.ruolo); s.gruppo = mappa(s.gruppo); });
        await scrivi('iscrizioni', { items: iscritti });
      }
      await scrivi('ruoli', { items: risultato });
      res.json({ ok: true, ruoli: risultato, rimossi, rinominati: Object.keys(rinomine).length });
    } catch (e) { res.status(500).json({ errore: e.message }); }
    return;
  }

  if (azione === 'ruoli_rigenera') {
    const { nome } = req.body || {};
    try {
      const lista = await leggiRuoli();
      const r = lista.find(x => x.nome === nome);
      if (!r) return res.status(404).json({ errore: 'Ruolo non trovato.' });
      r.badge = generaCodice();
      await scrivi('ruoli', { items: lista });
      res.json({ ok: true, badge: r.badge });
    } catch (e) { res.status(500).json({ errore: e.message }); }
    return;
  }

  if (azione === 'test_push') {
    try {
      const lista = (await leggi('iscrizioni', { items: [] })).items || [];
      let inviati = 0;
      for (const sub of lista) {
        const esito = await invia({ endpoint: sub.endpoint, keys: sub.keys }, {
          title: 'Notifica di prova', body: 'Se la leggi, le notifiche funzionano su questo dispositivo.',
          tag: 'prova', vibrate: [200, 100, 200]
        });
        if (esito === 'ok') inviati++;
      }
      return res.json({ ok: true, inviati, totali: lista.length });
    } catch (e) { return res.status(500).json({ errore: e.message }); }
  }

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
