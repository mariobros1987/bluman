/**
 * KYC/AML Fase K0 (Malta, spec v0.2) — logica di compliance a livello di studio.
 *
 * Puro dove possibile: `modalitaBozza` e `profiloRegolatorioMancante` decidono sull'oggetto
 * settings, `calcolaHashEvento` è deterministico.
 *
 * Due cose che sembrano la stessa e non lo sono, e che fino al 16/10/2026 erano confuse:
 *  - `modalitaBozza` è l'**etichetta** della configurazione dello studio: manca il profilo o
 *    manca l'MLRO. Dice «questo studio non è ancora configurato per intero».
 *  - `profiloRegolatorioMancante` è la **condizione che avvisa**: senza profilo regolatorio lo
 *    studio non ha dichiarato quali regole antiriciclaggio applica. Dal 17/10/2026 produce un
 *    avviso e **non** un blocco (decisione del titolare, `services/kycGate.ts`): l'operatività
 *    resta aperta, ma la configurazione incompleta si vede.
 *
 * L'MLRO **non** blocca: è la decisione presa col titolare il 27/09/2026 (annotata in
 * `routes/kyc.ts`), perché advisor e super_admin sono già l'autorità che approva — e lo studio
 * non deve restare fermo per una nomina che può arrivare dopo. Il commento di questo file
 * affermava il contrario («e nominato l'MLRO … nessun incarico potrà passare in esecuzione») e
 * nessun codice lo applicava: erano due affermazioni false invece di una regola.
 */
import crypto from 'node:crypto';

export interface ComplianceSettingsBozza {
  regulatoryProfile?: string | null;
  mlroUserId?: string | null;
}

/**
 * Modalità bozza: manca il profilo regolatorio (`CSP_MFSA`/`ALTRO_SOGGETTO_OBBLIGATO`) OPPURE
 * l'MLRO. È l'etichetta mostrata in Impostazioni, non il criterio dell'avviso: quello è
 * `profiloRegolatorioMancante`.
 */
export function modalitaBozza(s: ComplianceSettingsBozza | null | undefined): boolean {
  if (!s) return true;
  return !s.regulatoryProfile || !s.mlroUserId;
}

/**
 * Manca il profilo regolatorio (§14): genera un **avviso**, non un blocco (17/10/2026). Una riga
 * assente vale come profilo assente — «non ho potuto leggere le impostazioni» non è «lo studio ha
 * dichiarato il profilo».
 */
export function profiloRegolatorioMancante(s: ComplianceSettingsBozza | null | undefined): boolean {
  return !s?.regulatoryProfile;
}

/**
 * Hash concatenato di un evento di compliance (tamper-evident): dipende dal contenuto e
 * dall'hash dell'evento precedente, così una modifica retroattiva rompe la catena. Deterministico.
 */
export function calcolaHashEvento(input: {
  tipo: string;
  payload: unknown;
  createdAt: string;
  hashPrecedente: string | null;
}): string {
  const materiale = JSON.stringify({
    tipo: input.tipo,
    payload: input.payload ?? null,
    createdAt: input.createdAt,
    hashPrecedente: input.hashPrecedente ?? null,
  });
  return crypto.createHash('sha256').update(materiale).digest('hex');
}

export interface EventoCatena {
  tipo: string;
  payload: unknown;
  /** ISO 8601 — deve essere ESATTAMENTE la stringa usata per calcolare l'hash alla scrittura. */
  createdAt: string;
  hashPrecedente: string | null;
  hash: string;
}

/**
 * Verifica l'integrità della catena append-only (spec §8 — audit trail immutabile).
 * Riceve gli eventi in ordine cronologico crescente (dal più vecchio) e, per ognuno,
 * ricontrolla due cose: che l'anello punti all'hash del predecessore e che l'hash memorizzato
 * coincida con quello ricalcolato dal contenuto. La prima riga che non torna rompe la catena:
 * una manomissione retroattiva del payload o un evento inserito/rimosso viene rilevato.
 * Puro e deterministico. `rotturaIndice` è l'indice (base 0, nell'array crescente) del primo
 * anello incoerente, o `null` se la catena è integra.
 */
export function verificaCatena(eventiAsc: EventoCatena[]): { integra: boolean; rotturaIndice: number | null } {
  let precedente: string | null = null;
  for (let i = 0; i < eventiAsc.length; i++) {
    const e = eventiAsc[i];
    if (!e) continue;
    if ((e.hashPrecedente ?? null) !== precedente) return { integra: false, rotturaIndice: i };
    const atteso = calcolaHashEvento({
      tipo: e.tipo,
      payload: e.payload,
      createdAt: e.createdAt,
      hashPrecedente: e.hashPrecedente ?? null,
    });
    if (atteso !== e.hash) return { integra: false, rotturaIndice: i };
    precedente = e.hash;
  }
  return { integra: true, rotturaIndice: null };
}
