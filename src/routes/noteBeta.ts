// Note della beta — chi prova il gestionale scrive, pagina per pagina, ciò che non va o che si
// può migliorare; chi risponde dello studio le raccoglie e le segna risolte.
//
// Permessi (regola 9), tutti con controllo esplicito del ruolo:
// - leggere le note di UNA pagina e scriverne: chi lavora nello studio (non il cliente del portale);
// - l'elenco completo, «risolta» e la riapertura: advisor e super admin;
// - eliminare: chi ha scritto la nota finché è aperta, oppure advisor e super admin.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { eStatoNotaBeta, paginaGenerale, puoGestireNoteBeta, puoScrivereNoteBeta } from '../domain/notaBeta.js';
import { AggiornaNotaBetaSchema, CreaNotaBetaSchema } from '../schemas/noteBeta.schema.js';

function soloStaff(req: FastifyRequest, reply: FastifyReply): boolean {
  if (puoScrivereNoteBeta(req.ruolo as string | undefined)) return true;
  reply.code(403).send({ errore: 'Le note della beta sono riservate a chi lavora nello studio.' });
  return false;
}

export async function registraRotteNoteBeta(server: FastifyInstance): Promise<void> {
  // GET /note-beta?pagina=/primanota&stato=aperta
  server.get<{ Querystring: { pagina?: string; stato?: string } }>('/note-beta', async (req, reply) => {
    if (!soloStaff(req, reply)) return reply;
    const tenantId = req.tenantId as string;
    const { pagina, stato } = req.query || {};

    // Senza una pagina è l'elenco completo dello studio: solo per chi lo gestisce.
    if (!pagina && !puoGestireNoteBeta(req.ruolo as string)) {
      return reply.code(403).send({ errore: 'L’elenco completo delle note è riservato al responsabile dello studio.' });
    }
    if (stato && !eStatoNotaBeta(stato)) return reply.code(400).send({ errore: 'Stato della nota non valido' });

    try {
      const note = await prisma.notaBeta.findMany({
        where: {
          tenantId,
          ...(pagina ? { pagina: paginaGenerale(pagina) } : {}),
          ...(stato ? { stato } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      return reply.send(note);
    } catch (err) {
      // Un errore di lettura si dichiara: una risposta vuota direbbe «nessuna nota».
      req.log.error(err, 'Errore lettura note della beta');
      return reply.code(500).send({ errore: 'Le note della beta non sono state lette.' });
    }
  });

  // POST /note-beta
  server.post<{ Body: unknown }>('/note-beta', async (req, reply) => {
    if (!soloStaff(req, reply)) return reply;
    const parse = CreaNotaBetaSchema.safeParse(req.body || {});
    if (!parse.success) {
      return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Nota non valida' });
    }
    const tenantId = req.tenantId as string;
    const { percorso, tipo, testo } = parse.data;

    try {
      // Chi scrive lo dice la sessione, non il corpo della richiesta.
      const autore = req.userId
        ? await prisma.user.findUnique({ where: { id: req.userId as string }, select: { nome: true, email: true } })
        : null;
      const nota = await prisma.notaBeta.create({
        data: {
          tenantId,
          userId: (req.userId as string | undefined) ?? null,
          autoreNome: autore?.nome?.trim() || autore?.email || req.user?.email || 'Utente dello studio',
          ruolo: String(req.ruolo ?? ''),
          pagina: paginaGenerale(percorso),
          percorso: percorso.split(/[?#]/)[0] || '/',
          tipo,
          testo,
        },
      });
      return reply.code(201).send(nota);
    } catch (err) {
      req.log.error(err, 'Errore salvataggio nota della beta');
      return reply.code(500).send({ errore: 'La nota non è stata salvata.' });
    }
  });

  // PATCH /note-beta/:id — risolta / riaperta
  server.patch<{ Params: { id: string }; Body: unknown }>('/note-beta/:id', async (req, reply) => {
    if (!soloStaff(req, reply)) return reply;
    if (!puoGestireNoteBeta(req.ruolo as string)) {
      return reply.code(403).send({ errore: 'Solo il responsabile dello studio può segnare una nota come risolta.' });
    }
    const parse = AggiornaNotaBetaSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: 'Stato della nota non valido' });
    const tenantId = req.tenantId as string;

    try {
      const nota = await prisma.notaBeta.findFirst({ where: { id: req.params.id, tenantId } });
      if (!nota) return reply.code(404).send({ errore: 'Nota non trovata' });
      const risolta = parse.data.stato === 'risolta';
      const aggiornata = await prisma.notaBeta.update({
        where: { id: nota.id },
        data: {
          stato: parse.data.stato,
          risoltaAt: risolta ? new Date() : null,
          risoltaDa: risolta ? ((req.userId as string | undefined) ?? null) : null,
        },
      });
      return reply.send(aggiornata);
    } catch (err) {
      req.log.error(err, 'Errore aggiornamento nota della beta');
      return reply.code(500).send({ errore: 'La nota non è stata aggiornata.' });
    }
  });

  // DELETE /note-beta/:id
  server.delete<{ Params: { id: string } }>('/note-beta/:id', async (req, reply) => {
    if (!soloStaff(req, reply)) return reply;
    const tenantId = req.tenantId as string;

    try {
      const nota = await prisma.notaBeta.findFirst({ where: { id: req.params.id, tenantId } });
      if (!nota) return reply.code(404).send({ errore: 'Nota non trovata' });
      const gestisce = puoGestireNoteBeta(req.ruolo as string);
      const propriaEAperta = nota.userId != null && nota.userId === req.userId && nota.stato === 'aperta';
      if (!gestisce && !propriaEAperta) {
        return reply.code(403).send({ errore: 'Puoi eliminare solo le tue note ancora aperte.' });
      }
      await prisma.notaBeta.delete({ where: { id: nota.id } });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'NOTA_BETA_ELIMINATA',
        entita: nota.pagina,
        dettagli: `Eliminata la nota della beta di ${nota.autoreNome} sulla pagina ${nota.pagina}`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err, 'Errore eliminazione nota della beta');
      return reply.code(500).send({ errore: 'La nota non è stata eliminata.' });
    }
  });
}
