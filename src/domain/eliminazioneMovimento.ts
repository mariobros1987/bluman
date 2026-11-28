// Quando un movimento di Prima Nota NON si può eliminare, e perché (puro: lo usano la rotta e la
// pagina, così il pulsante e il rifiuto del server dicono la stessa cosa).
//
// Un movimento nato da un incasso o da un pagamento è metà di un'operazione: l'altra metà è la
// rata segnata «incassata» o la fattura d'acquisto segnata «pagata». Eliminando solo il movimento
// il denaro spariva dalla Prima Nota e dal saldo, ma la rata restava incassata: lo Scadenzario
// diceva «pagato» di un importo che nessuna riga registrava più.
//
// Qui si impedisce il danno. Un incasso sbagliato si annulla con lo storno (titolare, 28/11/2026):
// Scadenzario → «Storna incasso» scrive la riga contraria e riapre la rata. Anche lo storno è metà
// di un'operazione, e non si elimina.

export interface MovimentoPerEliminazione {
  tipo?: string | null;
  categoria?: string | null;
  fatturaId?: string | null;
  fatturaRicevutaId?: string | null;
  fattura?: { numero?: string | null } | null;
  fatturaRicevuta?: { numero?: string | null } | null;
}

/** `null` se il movimento si può eliminare; altrimenti la frase da mostrare all'operatore. */
export function motivoMovimentoNonEliminabile(m: MovimentoPerEliminazione): string | null {
  if (m.fatturaId) {
    const numero = m.fattura?.numero ? ` ${m.fattura.numero}` : '';
    if (m.tipo === 'uscita') {
      // Un'uscita legata a una fattura emessa è uno storno d'incasso o il rimborso di una Nota di Credito.
      return (
        `Questo movimento è lo storno o il rimborso di un incasso della fattura${numero}: è la traccia ` +
        'dell’annullamento, e non si elimina.'
      );
    }
    return (
      `Questo movimento è l'incasso della fattura${numero}: eliminandolo la rata resterebbe «incassata» ` +
      'senza il suo denaro in Prima Nota. Per annullarlo usa «Storna incasso» nello Scadenzario.'
    );
  }
  if (m.fatturaRicevutaId) {
    const numero = m.fatturaRicevuta?.numero ? ` ${m.fatturaRicevuta.numero}` : '';
    return (
      `Questo movimento è il pagamento della fattura d'acquisto${numero}: eliminandolo la fattura resterebbe «pagata» ` +
      'senza la sua uscita in Prima Nota. Non si elimina da qui.'
    );
  }
  return null;
}
