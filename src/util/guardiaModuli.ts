/**
 * Guardia di attivazione modulo per-studio. Le rotte di un modulo la interrogano per rispondere 403
 * quando lo studio non ha quel modulo attivo (concesso dalla piattaforma E non spento dall'admin).
 *
 * Fail-open sul solo errore di lettura o riga assente, come l'hook RBAC dei moduli (§23): la sessione
 * è già stata verificata, e un guasto di lettura non deve trasformarsi in un blocco inspiegabile.
 */
import { prisma } from './prismaClient.js';
import { moduloAttivoPerTenant, MODULO_KYC } from './moduliTenant.js';

export async function moduloKycAttivo(tenantId: string): Promise<boolean> {
  try {
    const t = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { moduliConcessi: true, moduliDisattivati: true },
    });
    if (!t) return true; // niente riga: non è questa guardia a decidere (fail-open)
    return moduloAttivoPerTenant(t.moduliConcessi, t.moduliDisattivati, MODULO_KYC);
  } catch {
    return true; // errore di lettura: fail-open, come la matrice RBAC
  }
}
