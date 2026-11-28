// Lo storno di un incasso (deciso dal titolare il 28/11/2026): un incasso registrato per errore non
// si cancella, si annulla con una riga contraria che riapre la rata e lascia traccia. PURO: lo
// usano la rotta e la pagina, così il pulsante e il rifiuto del server dicono la stessa cosa.
//
// La registrazione di storno ha l'importo negativo e nomina l'incasso che annulla
// (`stornoDiId`): la somma delle registrazioni di una rata resta il suo incassato vero, e tutti
// i punti che già sommano (solleciti, report, note di credito) non cambiano.

export interface RegistrazionePerStorno {
  id: string;
  importoIncassatoCentesimi: number;
  stornoDiId?: string | null;
}

/** Il motivo si scrive davvero: è ciò che resta nel registro accanto a chi ha stornato. */
export const LUNGHEZZA_MINIMA_MOTIVO_STORNO = 5;
export const LUNGHEZZA_MASSIMA_MOTIVO_STORNO = 500;

/** Quanto è stato incassato davvero su una rata: incassi meno storni. */
export function totaleIncassatoCentesimi(registrazioni: ReadonlyArray<RegistrazionePerStorno>): number {
  return registrazioni.reduce((tot, r) => tot + r.importoIncassatoCentesimi, 0);
}

/** Gli incassi che si possono ancora stornare: non sono storni e nessuno storno li nomina. */
export function incassiStornabili<T extends RegistrazionePerStorno>(registrazioni: ReadonlyArray<T>): T[] {
  const giaStornati = new Set(registrazioni.map((r) => r.stornoDiId).filter((id): id is string => !!id));
  return registrazioni.filter((r) => !r.stornoDiId && r.importoIncassatoCentesimi > 0 && !giaStornati.has(r.id));
}

/**
 * `null` se l'incasso si può stornare; altrimenti la frase per l'operatore.
 * `registrazioniDellaRata` sono tutte le registrazioni della rata, incasso compreso.
 */
export function motivoIncassoNonStornabile(
  incasso: RegistrazionePerStorno,
  registrazioniDellaRata: ReadonlyArray<RegistrazionePerStorno>,
  contesto: { statoFattura: string; statoRata: string },
): string | null {
  if (incasso.stornoDiId || incasso.importoIncassatoCentesimi <= 0) {
    return 'Questa riga è già uno storno: uno storno non si storna. Se serve, registra di nuovo l’incasso.';
  }
  if (registrazioniDellaRata.some((r) => r.stornoDiId === incasso.id)) {
    return 'Questo incasso è già stato stornato.';
  }
  if (contesto.statoFattura === 'annullata') {
    return 'La fattura è annullata con una Nota di Credito, che ha già rimborsato gli incassi: non c’è niente da stornare.';
  }
  if (contesto.statoRata === 'stornata') {
    return 'La rata è stata chiusa da una Nota di Credito: l’incasso non si storna da qui.';
  }
  return null;
}

/** Lo stato di una rata dato quanto risulta incassato. Una rata chiusa da Nota di Credito non passa di qui. */
export function statoRataDaIncassato(
  importoRataCentesimi: number,
  incassatoCentesimi: number,
): 'in_attesa' | 'parziale' | 'incassato' {
  if (incassatoCentesimi <= 0) return 'in_attesa';
  return incassatoCentesimi >= importoRataCentesimi ? 'incassato' : 'parziale';
}

/**
 * Una fattura è saldata quando ogni rata è incassata o stornata da Nota di Credito, e almeno una
 * è incassata (tutte stornate non è un incasso). È la regola A8, scritta una volta sola per
 * l'incasso e per lo storno.
 */
export function fatturaSaldata(statiRate: ReadonlyArray<string>): boolean {
  return statiRate.every((st) => st === 'incassato' || st === 'stornata') && statiRate.includes('incassato');
}

export interface MovimentoCandidato {
  id: string;
  contoBancarioId: string | null;
  importoCentesimi: number;
  data: Date;
  registrazioneIncassoId?: string | null;
}

/**
 * Il movimento di Prima Nota di un incasso. Dal 28/11/2026 il movimento nomina la sua
 * registrazione; per gli incassi di prima si cerca fra i movimenti d'incasso della stessa
 * fattura, non ancora legati, con lo stesso importo, preferendo quelli con la stessa data.
 * `null` = non si sa quale sia (nessuno, o più d'uno su conti diversi): lo storno si ferma invece
 * di far uscire denaro da un conto scelto a caso.
 */
export function movimentoDellIncasso<T extends MovimentoCandidato>(
  incasso: { id: string; importoIncassatoCentesimi: number; dataIncasso: Date },
  movimentiDellaFattura: ReadonlyArray<T>,
): T | null {
  const legato = movimentiDellaFattura.find((m) => m.registrazioneIncassoId === incasso.id);
  if (legato) return legato;
  const candidati = movimentiDellaFattura.filter(
    (m) => !m.registrazioneIncassoId && m.importoCentesimi === incasso.importoIncassatoCentesimi,
  );
  const stessaData = candidati.filter((m) => m.data.getTime() === incasso.dataIncasso.getTime());
  const rosa = stessaData.length > 0 ? stessaData : candidati;
  // Più righe uguali sullo stesso conto sono intercambiabili; su conti diversi no.
  const unConto = new Set(rosa.map((m) => m.contoBancarioId)).size === 1;
  return rosa.length > 0 && unConto ? rosa[0]! : null;
}
