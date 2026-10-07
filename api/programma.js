const { leggi } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ errore: 'Metodo non consentito' });
  const r = String(req.query.role || ''), g = String(req.query.gruppo || '');
  try {
    const [tappe, spostamenti, voci] = await Promise.all([
      leggi('tappe'), leggi('spostamenti'), leggi('voci')
    ]);
    // Il filtro dei ruoli gira QUI e non sul telefono: chi scarica la pagina
    // riceve solo le voci che gli spettano, non tutto il programma.
    const items = r === 'Admin' ? voci
      : voci.filter(v => !v.ruoli?.length || v.ruoli.includes(r) || (g && v.ruoli.includes(g)));
    res.json({ tappe, spostamenti, items });
  } catch (e) {
    res.status(503).json({ errore: e.message });
  }
};