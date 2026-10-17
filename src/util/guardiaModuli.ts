/**
 * Guardia di attivazione modulo per-studio. Le rotte di un modulo la interrogano per rispondere 403
 * quando lo studio non ha quel modulo attivo (concesso dalla piattaforma E non spento dall'admin).
 *
 * Sul solo errore di lettura, o riga assente, risponde **attivo**. Non è la stessa scelta dell'hook
 * RBAC dei moduli, che dal 09/10/2026 è fail-closed (§23 `server.ts`, voce 5): là l'errore riguarda
 * un *permesso*, e una porta aperta per errore non si vede. Qui la risposta `true` non apre niente —
 * è la condizione perché il gate KYC **entri in funzione**, cioè perché l'operazione venga bloccata
 * se lo studio non ha dichiarato il profilo o il cliente non ha una pratica approvata. Il ripiego
 * prudente è quindi «il modulo c'è»: un guasto di lettura non deve poter sospendere il controllo.
 */
import { prisma } from './prismaClient.js';
import { moduloAttivoPerTenant, MODULO_KYC } from './moduliTenant.js';

export async function moduloKycAttivo(tenantId: string): Promise<boolean> {
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { moduliConcessi: true, moduliDisattivati: true },
    });
    if (!t) return true; // niente riga: si applica il controllo, non lo si salta
    return moduloAttivoPerTenant(t.moduliConcessi, t.moduliDisattivati, MODULO_KYC);
  } catch {
    return true; // errore di lettura: si applica il controllo, non lo si salta
  }
}
