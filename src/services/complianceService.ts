/**
 * KYC/AML Fase K0 (Malta, spec v0.2) — logica di compliance a livello di studio.
 *
 * Puro dove possibile: `modalitaBozza` decide sull'oggetto settings, `calcolaHashEvento` è
 * deterministico. Il primo gate del modulo: finché lo studio non ha scelto il profilo regolatorio
 * e nominato l'MLRO, resta in bozza e nessun incarico potrà passare in esecuzione (fasi successive).
 */
import crypto from 'node:crypto';

export interface ComplianceSettingsBozza {
  regulatoryProfile?: string | null;
  mlroUserId?: string | null;
}

/**
 * Modalità bozza: manca il profilo regolatorio (`CSP_MFSA`/`ALTRO_SOGGETTO_OBBLIGATO`) OPPURE
 * l'MLRO. In bozza il modulo KYC è usabile ma non abilita gli incarichi (spec §8 regola 2).
 */
export function modalitaBozza(s: ComplianceSettingsBozza | null | undefined): boolean {
  if (!s) return true;
  return !s.regulatoryProfile || !s.mlroUserId;
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
