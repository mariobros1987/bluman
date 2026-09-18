/**
 * La regola dell'IVA in fattura, in un posto solo e testabile.
 *
 * Prima stava dentro `FatturazioneTab.tsx`, inline nel JSX: giusta, ma non collaudabile senza
 * montare il componente. Qui è una funzione pura, così un test la mette alla prova sui casi che
 * contano (estero, esente, aliquota 0 vera contro «non dichiarata») senza rendering.
 *
 * **Deve combaciare con il backend** (`src/adapters/prisma/prismaApp.ts`, `emettiFattura`): è la
 * stessa regola scritta due volte, e se le due si allontanano l'anteprima mostra un totale che il
 * database poi non conferma — il difetto corretto il 18/09/2026. Il backend resta l'autorità; questo
 * è la copia del browser, tenuta onesta da `fatturazione.test.ts`.
 */

export type TipoClienteFiscale = 'privato_italia' | 'business_italia' | 'estero';

/**
 * L'aliquota da applicare, in percentuale (0..100).
 *
 * Vince quella registrata sul cliente. Se non è dichiarata — `null`/`undefined`, non lo `0` — si
 * ripiega sul tipo del documento: estero 0, altrimenti 22. La distinzione fra «0» e «non dichiarata»
 * è il motivo per cui il parametro è nullable e non un numero con default: un cliente esente ha
 * aliquota 0 *davvero*, e non deve ripiegare sul 22.
 */
export function risolviAliquotaIva(
  aliquotaClienteDefault: number | null | undefined,
  tipoFiscale: TipoClienteFiscale,
): number {
  if (aliquotaClienteDefault === null || aliquotaClienteDefault === undefined) {
    return tipoFiscale === 'estero' ? 0 : 22;
  }
  return Number(aliquotaClienteDefault);
}

export interface TotaliFattura {
  imponibile: number;
  iva: number;
  totale: number;
}

/**
 * Da imponibile e aliquota ai tre numeri della fattura. L'IVA si **somma sopra** l'imponibile: è
 * l'imponibile che l'utente ha scelto, non un lordo da scorporare.
 */
export function calcolaTotaliFattura(imponibile: number, aliquotaPct: number): TotaliFattura {
  const iva = Math.round(imponibile * (aliquotaPct / 100) * 100) / 100;
  return { imponibile, iva, totale: imponibile + iva };
}
