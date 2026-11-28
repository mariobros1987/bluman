// Accentratore delle mail — i messaggi: elenco, dettaglio, smistamento, letto, archivio, raccolta.
//
// Permessi (regola 9): l'intero prefisso `/posta` è il modulo `posta` della Matrice Permessi
// (`rbacModuli.ts`). È la posta dei clienti, quindi di default la vede solo chi risponde dello
// studio (advisor, super admin): ai collaboratori interni la apre l'admin dalla matrice («read»
// consulta, «write» smista e archivia), al collaboratore esterno mai (`PREFISSI_VIETATI_ESTERNO`).
// La configurazione — caselle e inoltri — sta in `postaConfigurazione.ts`.
import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { sanitizzaHtmlDocumento } from '../util/htmlSanitizer.js';
import { rifirmaUrlUpload, rinnovaUrlSupabaseSeServe } from '../services/storageService.js';
import { raccogliPostaDelTenant } from '../services/postaRaccolta.js';
import { AggiornaMessaggioSchema, ElencoMessaggiSchema } from '../schemas/posta.schema.js';

const LUNGHEZZA_ANTEPRIMA = 200;

/** I campi dell'elenco: mai il corpo intero né l'HTML, che si leggono solo dal dettaglio. */
const CAMPI_ELENCO = {
  id: true,
  casellaId: true,
  mittenteEmail: true,
  mittenteNome: true,
  destinatari: true,
  oggetto: true,
  testo: true,
  ricevutoAt: true,
  clienteId: true,
  progettoId: true,
  attribuzione: true,
  criterio: true,
  lettoAt: true,
  archiviatoAt: true,
  haAllegati: true,
  cliente: { select: { id: true, nome: true } },
  progetto: { select: { id: true, nome: true } },
  casella: { select: { id: true, nome: true, tipo: true } },
} as const;

function conAnteprima<T extends { testo: string | null }>(riga: T): Omit<T, 'testo'> & { anteprima: string | null } {
  const { testo, ...resto } = riga;
  // Su una riga sola: gli a capo di un messaggio citato romperebbero l'elenco.
  return { ...resto, anteprima: testo ? testo.replace(/\s+/g, ' ').trim().slice(0, LUNGHEZZA_ANTEPRIMA) : null };
}

export async function registraRottePosta(server: FastifyInstance): Promise<void> {
  // GET /posta/messaggi?vista=da_smistare&clienteId=…&q=…&pagina=1
  server.get<{ Querystring: unknown }>('/posta/messaggi', async (req, reply) => {
    const parse = ElencoMessaggiSchema.safeParse(req.query || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Filtri non validi' });
    const tenantId = req.tenantId as string;
    const f = parse.data;

    const where = {
      tenantId,
      // Senza «archiviati=si» è la coda di lavoro: un «mostra tutto» la riempirebbe di messaggi già smaltiti.
      archiviatoAt: f.archiviati === 'si' ? { not: null } : null,
      ...(f.vista === 'da_smistare' ? { clienteId: null } : {}),
      ...(f.vista === 'attribuiti' ? { clienteId: { not: null } } : {}),
      ...(f.letti === 'si' ? { lettoAt: { not: null } } : {}),
      ...(f.letti === 'no' ? { lettoAt: null } : {}),
      ...(f.clienteId ? { clienteId: f.clienteId } : {}),
      ...(f.progettoId ? { progettoId: f.progettoId } : {}),
      ...(f.casellaId ? { casellaId: f.casellaId } : {}),
      ...(f.q
        ? {
            OR: [
              { oggetto: { contains: f.q, mode: 'insensitive' as const } },
              { testo: { contains: f.q, mode: 'insensitive' as const } },
              { mittenteEmail: { contains: f.q, mode: 'insensitive' as const } },
              { mittenteNome: { contains: f.q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    try {
      const [righe, totale] = await Promise.all([
        prisma.messaggioPosta.findMany({
          where,
          orderBy: { ricevutoAt: 'desc' },
          skip: (f.pagina - 1) * f.perPagina,
          take: f.perPagina,
          select: CAMPI_ELENCO,
        }),
        prisma.messaggioPosta.count({ where }),
      ]);
      return reply.send({ messaggi: righe.map(conAnteprima), totale, pagina: f.pagina, perPagina: f.perPagina });
    } catch (err) {
      // Un errore di lettura si dichiara: un elenco vuoto direbbe «nessun messaggio».
      req.log.error(err, 'Errore lettura messaggi di posta');
      return reply.code(500).send({ errore: 'I messaggi non sono stati letti.' });
    }
  });

  // GET /posta/stato — i numeri della coda e lo stato della raccolta, casella per casella.
  server.get('/posta/stato', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const [caselle, daSmistare, nonLetti] = await Promise.all([
        prisma.casellaPosta.findMany({
          where: { tenantId },
          orderBy: { createdAt: 'asc' },
          // Niente host, utenza né password: lo stato lo legge chiunque veda la posta.
          select: {
            id: true, nome: true, indirizzo: true, tipo: true, attiva: true,
            ultimaRaccoltaAt: true, ultimoSuccessoAt: true, ultimoErrore: true,
            cliente: { select: { id: true, nome: true } },
          },
        }),
        prisma.messaggioPosta.count({ where: { tenantId, archiviatoAt: null, clienteId: null } }),
        prisma.messaggioPosta.count({ where: { tenantId, archiviatoAt: null, lettoAt: null } }),
      ]);
      return reply.send({ caselle, daSmistare, nonLetti });
    } catch (err) {
      req.log.error(err, 'Errore lettura stato della posta');
      return reply.code(500).send({ errore: 'Lo stato della raccolta non è stato letto.' });
    }
  });

  // GET /posta/smistamento — i clienti e i progetti fra cui scegliere quando si smista. Solo id
  // e nome: chi smista la posta non ha per forza il modulo Clienti, e qui non gli serve altro.
  server.get('/posta/smistamento', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const [clienti, progetti] = await Promise.all([
        prisma.cliente.findMany({ where: { tenantId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } }),
        prisma.progetto.findMany({ where: { tenantId }, orderBy: { nome: 'asc' }, select: { id: true, nome: true, clienteId: true } }),
      ]);
      return reply.send({ clienti, progetti });
    } catch (err) {
      req.log.error(err, 'Errore lettura clienti e progetti per lo smistamento');
      return reply.code(500).send({ errore: 'Clienti e progetti non sono stati letti.' });
    }
  });

  // GET /posta/messaggi/:id — il messaggio intero, con gli allegati.
  server.get<{ Params: { id: string } }>('/posta/messaggi/:id', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const m = await prisma.messaggioPosta.findFirst({
        where: { id: req.params.id, tenantId },
        select: {
          ...CAMPI_ELENCO,
          html: true,
          messageId: true,
          consegnatoA: true,
          raccoltoAt: true,
          allegati: { select: { id: true, nome: true, mime: true, dimensioneByte: true, url: true, motivoNonSalvato: true } },
        },
      });
      if (!m) return reply.code(404).send({ errore: 'Messaggio non trovato' });

      // Gli indirizzi dei file scadono: si rifirmano alla lettura, come per gli altri documenti.
      const allegati = await Promise.all(
        m.allegati.map(async (a) => ({ ...a, url: a.url ? ((await rinnovaUrlSupabaseSeServe(rifirmaUrlUpload(a.url))) as string) : null })),
      );
      return reply.send({
        ...m,
        // L'HTML arriva da un mittente qualunque: esce solo ciò che il sanitizzatore ammette, e il
        // browser lo mostra comunque in un riquadro isolato (`DettaglioMessaggioPosta.tsx`).
        html: m.html ? sanitizzaHtmlDocumento(m.html) : null,
        allegati,
      });
    } catch (err) {
      req.log.error(err, 'Errore lettura messaggio di posta');
      return reply.code(500).send({ errore: 'Il messaggio non è stato letto.' });
    }
  });

  // PATCH /posta/messaggi/:id — smista (cliente/progetto), segna letto, archivia.
  server.patch<{ Params: { id: string }; Body: unknown }>('/posta/messaggi/:id', async (req, reply) => {
    const parse = AggiornaMessaggioSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Modifica non valida' });
    const tenantId = req.tenantId as string;
    const modifica = parse.data;

    try {
      const attuale = await prisma.messaggioPosta.findFirst({
        where: { id: req.params.id, tenantId },
        select: { id: true, oggetto: true, clienteId: true, progettoId: true, attribuzione: true },
      });
      if (!attuale) return reply.code(404).send({ errore: 'Messaggio non trovato' });

      const dati: Record<string, unknown> = {};
      const smista = modifica.clienteId !== undefined || modifica.progettoId !== undefined;
      let clienteId = attuale.clienteId;
      let progettoId = attuale.progettoId;

      if (smista) {
        if (modifica.clienteId !== undefined) {
          clienteId = modifica.clienteId;
          // Cambiato il cliente, il progetto di prima non è più suo: resta solo se lo si ripete.
          if (modifica.progettoId === undefined && clienteId !== attuale.clienteId) progettoId = null;
        }
        if (modifica.progettoId !== undefined) progettoId = modifica.progettoId;

        if (progettoId) {
          const progetto = await prisma.progetto.findFirst({ where: { id: progettoId, tenantId }, select: { clienteId: true } });
          if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato' });
          // Il progetto porta con sé il suo cliente: un messaggio non sta nel progetto di un cliente e sotto un altro.
          if (modifica.clienteId && modifica.clienteId !== progetto.clienteId) {
            return reply.code(400).send({ errore: 'Il progetto scelto non è di questo cliente.' });
          }
          clienteId = progetto.clienteId;
        }
        if (clienteId) {
          const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true } });
          if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });
        }
        dati.clienteId = clienteId;
        dati.progettoId = progettoId;
        dati.attribuzione = clienteId ? 'manuale' : 'da_smistare';
        dati.criterio = null;
      }
      if (modifica.letto !== undefined) {
        dati.lettoAt = modifica.letto ? new Date() : null;
        dati.lettoDa = modifica.letto ? ((req.userId as string | undefined) ?? null) : null;
      }
      if (modifica.archiviato !== undefined) dati.archiviatoAt = modifica.archiviato ? new Date() : null;

      const aggiornato = await prisma.messaggioPosta.update({ where: { id: attuale.id }, data: dati, select: CAMPI_ELENCO });

      if (smista && (clienteId !== attuale.clienteId || progettoId !== attuale.progettoId)) {
        await recordAudit({
          tenantId,
          userId: req.userId,
          ruolo: req.ruolo,
          azione: 'POSTA_MESSAGGIO_SMISTATO',
          entita: 'messaggio_posta',
          dettagli: `Messaggio «${attuale.oggetto || 'senza oggetto'}» (${attuale.id}): cliente ${attuale.clienteId ?? 'nessuno'} → ${clienteId ?? 'nessuno'}, progetto ${attuale.progettoId ?? 'nessuno'} → ${progettoId ?? 'nessuno'}`,
          ipAddress: req.ip,
        });
      }
      return reply.send(conAnteprima(aggiornato));
    } catch (err) {
      req.log.error(err, 'Errore aggiornamento messaggio di posta');
      return reply.code(500).send({ errore: 'Il messaggio non è stato aggiornato.' });
    }
  });

  // POST /posta/raccogli — «Raccogli ora»: lo stesso giro di quello automatico, per questo studio.
  server.post('/posta/raccogli', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const esito = await raccogliPostaDelTenant(tenantId);
      // 200 anche con caselle in errore: l'esito è per casella, e una casella ferma non annulla
      // i messaggi raccolti dalle altre. Chi legge guarda `caselle[].errore`.
      return reply.send(esito);
    } catch (err) {
      req.log.error(err, 'Errore raccolta della posta');
      return reply.code(500).send({ errore: 'La raccolta non è partita.' });
    }
  });
}
