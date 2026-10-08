const { leggi, scrivi } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ errore: 'Metodo non consentito' });
  const { subscription, ruolo, gruppo } = req.body || {};
  if (!subscription?.endpoint) return res.status(400).json({ errore: 'Iscrizione non valida.' });
  try {
    const lista = (await leggi('iscrizioni', { items: [] })).items || [];
    const vecchia = lista.find(x => x.endpoint === subscription.endpoint);
    const voce = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
      ruolo: String(ruolo || ''),
      gruppo: String(gruppo || ''),
      inviate: vecchia?.inviate || {}   // conserva i solleciti già mandati
    };
    const nuova = lista.filter(x => x.endpoint !== subscription.endpoint);
    nuova.push(voce);
    await scrivi('iscrizioni', { items: nuova });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ errore: e.message }); }
};
