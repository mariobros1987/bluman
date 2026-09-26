/**
 * KYC/AML Fase K9/§5.5 — cadenza della formazione AML. PURO: nessun DB/HTTP.
 *
 * La formazione va ripetuta periodicamente (§12: promemoria all'MLRO). La cadenza di default è 12 mesi,
 * marcata `[da verificare]` rispetto alle Implementing Procedures maltesi finché il titolare non la
 * conferma — quindi è un parametro, non un numero cablato nella logica di business.
 */

/** Cadenza di default della formazione, in mesi. `[da verificare]` — configurabile in futuro. */
export const MESI_CADENZA_FORMAZIONE_DEFAULT = 12;

function adData(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Data della prossima formazione attesa: ultima formazione + cadenza. `null` se non c'è mai stata. */
export function prossimaFormazione(ultimaData: Date | string | null | undefined, mesiCadenza = MESI_CADENZA_FORMAZIONE_DEFAULT): Date | null {
  const d = adData(ultimaData);
  if (!d) return null;
  const p = new Date(d);
  p.setMonth(p.getMonth() + Math.max(1, Math.floor(mesiCadenza)));
  return p;
}

/**
 * §12 — la formazione è DOVUTA se non se n'è mai svolta, oppure se dall'ultima è passata la cadenza.
 * Detection + reminder: la programmazione la fa l'MLRO (regola 14).
 */
export function formazioneDovuta(ultimaData: Date | string | null | undefined, adesso: Date = new Date(), mesiCadenza = MESI_CADENZA_FORMAZIONE_DEFAULT): boolean {
  const prossima = prossimaFormazione(ultimaData, mesiCadenza);
  if (!prossima) return true; // mai svolta
  return adesso.getTime() >= prossima.getTime();
}

/** Frase esplicativa (regola 12). Stringa vuota se la formazione non è dovuta. */
export function motivoFormazione(ultimaData: Date | string | null | undefined, adesso: Date = new Date(), mesiCadenza = MESI_CADENZA_FORMAZIONE_DEFAULT): string {
  if (!formazioneDovuta(ultimaData, adesso, mesiCadenza)) return '';
  const d = adData(ultimaData);
  if (!d) return 'Nessuna formazione AML registrata: programmarne una.';
  return `Ultima formazione AML il ${d.toLocaleDateString('it-IT')}: è passata la cadenza di ${mesiCadenza} mesi, va ripetuta.`;
}
