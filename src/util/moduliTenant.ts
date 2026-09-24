/**
 * Attivazione moduli per-studio (spec: modularizzazione). PURO: nessun accesso a DB.
 *
 * Due livelli, come deciso dal titolare:
 * - `concessi`  — le chiavi modulo che la PIATTAFORMA (super_admin) concede allo studio (il "piano");
 * - `disattivati` — le chiavi che l'admin dello studio ha spento tra quelle concesse.
 * Un modulo è ATTIVO per lo studio se è concesso E non disattivato.
 *
 * Per ora l'unica chiave cablata è `kyc` (modulo Compliance/KYC). La struttura resta un elenco di
 * chiavi, così aggiungere altri moduli in seguito non cambia questo motore.
 */

export const MODULO_KYC = 'kyc';

/** Normalizza un valore JSON (che può arrivare come null / non-array dal DB) in un array di stringhe. */
function comeChiavi(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Vero se `chiave` è concesso allo studio E non spento dall'admin. */
export function moduloAttivoPerTenant(concessi: unknown, disattivati: unknown, chiave: string): boolean {
  return comeChiavi(concessi).includes(chiave) && !comeChiavi(disattivati).includes(chiave);
}

/** Vero se lo studio può accendere/spegnere questo modulo (cioè la piattaforma glielo ha concesso). */
export function moduloConcessoAlTenant(concessi: unknown, chiave: string): boolean {
  return comeChiavi(concessi).includes(chiave);
}
