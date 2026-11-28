// I dati del cliente senza i quali una fattura non si emette (deciso dal titolare il 28/11/2026:
// «bloccare, con un messaggio che elenca i dati mancanti»). PURO: lo usano le tre rotte che
// emettono una fattura, così il rifiuto dice la stessa cosa ovunque.
//
// La regola è la minima del tracciato della fattura elettronica, non tutta l'anagrafica: il
// cliente italiano deve avere partita IVA o codice fiscale (ne basta uno), e ogni cliente un
// indirizzo (sede legale, o residenza per la persona fisica). Per il cliente estero basta
// l'indirizzo: un identificativo fiscale estero non sempre esiste.

export type TipoClienteFiscale = 'privato_italia' | 'business_italia' | 'estero';

export interface ClientePerFattura {
  piva?: string | null;
  codiceFiscale?: string | null;
  sedeLegale?: string | null;
  indirizzoResidenza?: string | null;
}

export const CODICE_DATI_CLIENTE_MANCANTI = 'DATI_CLIENTE_MANCANTI';

const pieno = (v: string | null | undefined): boolean => typeof v === 'string' && v.trim().length > 0;

/** I dati che mancano per fatturare, con le parole che l'operatore trova nella scheda cliente. */
export function datiMancantiPerFatturare(cliente: ClientePerFattura, tipo: TipoClienteFiscale): string[] {
  const mancanti: string[] = [];
  if (tipo !== 'estero' && !pieno(cliente.piva) && !pieno(cliente.codiceFiscale)) {
    mancanti.push(tipo === 'business_italia' ? 'partita IVA (o codice fiscale)' : 'codice fiscale (o partita IVA)');
  }
  if (!pieno(cliente.sedeLegale) && !pieno(cliente.indirizzoResidenza)) {
    mancanti.push('indirizzo (sede legale o residenza)');
  }
  return mancanti;
}

/** La frase per l'operatore: dice cosa manca e dove si completa. */
export function messaggioDatiClienteMancanti(nomeCliente: string, mancanti: ReadonlyArray<string>): string {
  return (
    `La fattura non si può emettere: nella scheda di ${nomeCliente} ${mancanti.length === 1 ? 'manca' : 'mancano'} ` +
    `${mancanti.join(' e ')}. Completa la scheda del cliente e riprova.`
  );
}

/** Il corpo del rifiuto (409), uguale per tutte le rotte; `null` se non manca niente. */
export function rifiutoDatiClienteMancanti(
  cliente: (ClientePerFattura & { id: string; nome: string }) | null | undefined,
  tipo: TipoClienteFiscale,
): { errore: string; codice: string; datiMancanti: string[]; clienteId: string; clienteNome: string } | null {
  if (!cliente) return null;
  const datiMancanti = datiMancantiPerFatturare(cliente, tipo);
  if (datiMancanti.length === 0) return null;
  return {
    errore: messaggioDatiClienteMancanti(cliente.nome, datiMancanti),
    codice: CODICE_DATI_CLIENTE_MANCANTI,
    datiMancanti,
    clienteId: cliente.id,
    clienteNome: cliente.nome,
  };
}
