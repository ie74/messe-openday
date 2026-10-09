const { trovaRuolo } = require('./_lib');

// Il telefono invia il codice del badge (QR o stampato) e riceve il ruolo.
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ errore: 'Metodo non consentito' });
  try {
    const r = await trovaRuolo(req.body?.codice);
    if (!r) return res.status(401).json({ errore: 'Badge non valido o revocato.' });
    res.json({ ruolo: r.nome, gruppo: r.gruppo || '' });
  } catch (e) { res.status(500).json({ errore: e.message }); }
};
