// Completare un'attività senza ore segnate: si chiede conferma, non si blocca (titolare,
// 28/11/2026). La domanda è una sola, uguale dalla spunta e dall'ultimo passaggio.
import { confirm } from '../components/ui/ConfirmProvider';

export const DOMANDA_COMPLETARE_SENZA_ORE = 'Non hai segnato ore su questa attività: completare lo stesso?';

/** Vero se sull'attività non risultano ore consuntivate. */
export function senzaOreSegnate(oreConsuntivate: number | null | undefined): boolean {
  return !(typeof oreConsuntivate === 'number' && oreConsuntivate > 0);
}

/**
 * `true` = si può completare: l'attività ha ore, oppure l'operatore ha confermato di chiuderla
 * senza. `false` = l'operatore ha rinunciato, e lo stato non si tocca.
 */
export async function confermaCompletamentoSenzaOre(oreConsuntivate: number | null | undefined): Promise<boolean> {
  if (!senzaOreSegnate(oreConsuntivate)) return true;
  return confirm({ titolo: 'Attività senza ore', messaggio: DOMANDA_COMPLETARE_SENZA_ORE, confermaLabel: 'Completa lo stesso' });
}
