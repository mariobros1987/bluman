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
