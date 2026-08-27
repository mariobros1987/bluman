// Rotte notifiche (Blocco 3): lista per destinatario corrente, creazione di
// una notifica, marca-tutte-come-lette.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. L'helper `destinatarioCorrente` viveva nel
// monolite subito sopra queste rotte: è stato spostato qui dentro insieme a
// loro, definito prima delle rotte che lo usano.
// `registraRotteNotifiche` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';

export async function registraRotteNotifiche(server: FastifyInstance): Promise<void> {
  // ─── NOTIFICHE (Blocco 3) ─────────────────────────────────────────
  // Le notifiche sono per destinatario, non per tenant: la campanella dello
  // studio mostra le righe dell'utente loggato, quella del portale quelle del
  // cliente. L'identità cliente arriva dal JWT come `client-<clienteId>`.
  const destinatarioCorrente = (req: any): { tenantId: string; where: Record<string, any> } | null => {
    const tenantId = req.tenantId as string;
    const userId = req.userId as string | undefined;
    if (!userId) return null;
    if (req.ruolo === 'cliente' || userId.startsWith('client-')) {
      return { tenantId, where: { tenantId, destinatarioClienteId: userId.replace(/^client-/, '') } };
    }
    return { tenantId, where: { tenantId, destinatarioId: userId } };
  };

  server.get('/notifiche', async (req) => {
    const dest = destinatarioCorrente(req);
    if (!dest) return [];
    try {
      return await prisma.notifica.findMany({
        where: dest.where,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
    } catch {
      return [];
    }
  });

  server.post<{ Body: Record<string, any> }>('/notifiche', async (req, reply) => {
    const tenantId = (req as any).tenantId as string;
    const body = (req.body || {}) as Record<string, any>;
    // Nessuna scorciatoia tipo `destinatarioId || 'usr-01'`: una notifica senza
    // destinatario reale è solo rumore che nessuno leggerà mai.
    const destinatarioId = body.destinatarioId as string | undefined;
    const destinatarioClienteId = body.destinatarioClienteId as string | undefined;
    if (!destinatarioId && !destinatarioClienteId) {
      return reply.code(400).send({ errore: 'destinatarioId o destinatarioClienteId è obbligatorio' });
    }
    const notif = await prisma.notifica.create({
      data: {
        tenantId,
        destinatarioId: destinatarioId ?? null,
        destinatarioClienteId: destinatarioClienteId ?? null,
        destinatarioTipo: destinatarioClienteId ? 'cliente' : 'user',
        tipoEvento: body.tipoEvento ?? null,
        link: body.link ?? null,
        canale: body.canale || 'in_app',
        oggetto: body.oggetto || body.title || 'Notifica Studio',
        corpo: body.corpo || body.body || '',
        statoLettura: 'non_letta',
        inviataAt: new Date(),
      },
    });
    return reply.code(201).send(notif);
  });

  server.patch('/notifiche/read-all', async (req) => {
    const dest = destinatarioCorrente(req);
    if (!dest) return { ok: true };
    try {
      await prisma.notifica.updateMany({
        where: { ...dest.where, statoLettura: 'non_letta' },
        data: { statoLettura: 'letta' },
      });
      return { ok: true };
    } catch {
      return { ok: true };
    }
  });
}
