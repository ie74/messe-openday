const { leggi, scrivi, trovaRuolo } = require('./_lib');

// Il ruolo viene dal badge (header X-Badge), mai dal corpo della richiesta.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ errore: 'Metodo non consentito' });
  const { subscription } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ errore: 'Iscrizione non valida.' });
  try {
    const r = await trovaRuolo(req.headers['x-badge']);
    if (!r) return res.status(401).json({ errore: 'Badge non valido o revocato.' });
    const lista = (await leggi('iscrizioni', { items: [] })).items || [];
    const vecchia = lista.find(x => x.endpoint === subscription.endpoint);
    const voce = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      ruolo: r.nome,
      gruppo: r.gruppo || '',
      inviate: vecchia?.inviate || {}
    };
    const nuova = lista.filter(x => x.endpoint !== subscription.endpoint);
    nuova.push(voce);
    await scrivi('iscrizioni', { items: nuova });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ errore: e.message }); }
};
