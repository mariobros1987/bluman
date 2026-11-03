// Lettura del livello di un utente su un modulo della Matrice Permessi, condivisa tra l'hook
// RBAC di server.ts (che blocca le rotte in mappa) e le rotte trasversali come /search, che
// devono filtrare i risultati per modulo invece di bloccare tutta la richiesta.
// La semantica è una sola: riga PermessoModulo se esiste, altrimenti default per ruolo;
// FAIL-CLOSED sul default per ruolo se la lettura fallisce (voce 5, 09/10/2026).

import { prisma } from './prismaClient.js';
import { permessoDefaultPerRuolo, type LivelloPermesso, type ModuloChiaveRbac } from './rbacModuli.js';

export async function livelloModuloUtente(
  tenantId: string,
  userId: string,
  ruolo: string | undefined,
  modulo: ModuloChiaveRbac,
): Promise<LivelloPermesso> {
  try {
    const permesso = await prisma.permessoModulo.findUnique({
      where: { tenantId_userId_moduloChiave: { tenantId, userId, moduloChiave: modulo } },
      select: { livello: true },
    });
    // Nessuna riga sulla matrice → default per ruolo, non accesso pieno.
    return (permesso?.livello as LivelloPermesso | undefined) ?? permessoDefaultPerRuolo(ruolo, modulo);
  } catch (err) {
    // Il log dice che il livello applicato è un *ripiego*, non una riga della matrice.
    const livello = permessoDefaultPerRuolo(ruolo, modulo);
    console.error(
      `Verifica permesso modulo fallita su '${modulo}': applico il default per ruolo '${livello}'.`,
      err instanceof Error ? err.message : err,
    );
    return livello;
  }
}
