// La personalizzazione del singolo ruolo prevale su quella del suo gruppo.
const miaDi = (fase, ruolo, gruppo) => {
  const righe = fase.personalizzazioni || [];
  return righe.find(riga => riga.ruolo === ruolo)
    || righe.find(riga => riga.ruolo === gruppo) || null;
};

const senzaAttivita = (fase, ruolo, gruppo) => miaDi(fase, ruolo, gruppo)?.nessunaAttivita === true;

module.exports = { miaDi, senzaAttivita };
