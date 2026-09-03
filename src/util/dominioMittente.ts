/**
 * Il dominio su cui vanno pubblicati i record DNS della posta, ricavato dagli indirizzi
 * configurati dallo studio.
 *
 * Sta in `src/util/` e non accanto al pannello che lo usa perché il presidio gira con il vitest
 * del backend (`vitest.config.ts` esclude `frontend/**`: il frontend ha la sua toolchain Vite e
 * nessun runner di test). Una funzione pura, senza React e senza dipendenze, importabile dal
 * `.tsx` del pannello e dal test in radice, vale più di due copie che divergono.
 *
 * Prima questo dominio era scritto nel codice — quello di un solo studio — e ogni altro studio
 * leggeva le istruzioni DNS del dominio di qualcun altro (regola 6).
 */

/**
 * La parte dopo la chiocciola del primo indirizzo utilizzabile, o `null` se non ce n'è nessuno.
 *
 * Un indirizzo senza `@` o senza punto nel dominio non produce un dominio: meglio niente che una
 * stringa che sembra un dominio e non lo è, perché quella finirebbe in istruzioni da seguire.
 */
export function dominioDaIndirizzo(...indirizzi: string[]): string | null {
  for (const indirizzo of indirizzi) {
    const dopo = (indirizzo || '').trim().toLowerCase().split('@')[1];
    if (dopo && dopo.includes('.') && !dopo.startsWith('.') && !dopo.endsWith('.')) return dopo;
  }
  return null;
}
