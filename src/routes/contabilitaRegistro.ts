// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte dei blocchi «COMPATIBILITÀ ROTTE PRECEDENTI» e «REGISTRO FATTURE
// (OPENSTAMANAGER ENGINE)». A differenza degli altri moduli estratti, questo
// blocco usa `app` (listaFattureTutte, emettiFattura).

import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { riprovaSuConflitto } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { campoOrdinamento, creaMetaPaginazione, leggiPaginazione } from '../util/paginazione.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';
import { operativitaBloccataDaKyc } from '../services/kycGate.js';

export async function registraRotteContabilitaRegistro(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── COMPATIBILITÀ ROTTE PRECEDENTI ────────────────────────────────
  server.get('/fatture/tutte', async () => {
    return app.listaFattureTutte();
  });

  server.post<{
    Params: { id: string };
    Body: {
      tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
      partitaIva?: string;
      codiceFiscale?: string;
      canale: 'sdi' | 'standard';
      righe: Array<{
        tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
        moduloProgettoId?: string;
        percentuale?: number;
        importo: number;
        descrizione: string;
      }>;
    };
  }>('/progetti/:id/fatture', async (req, reply) => {
    // K4 — gate KYC (§8.1) anche sulla fatturazione dalla scheda progetto. La rotta /invoices lo
    // applica già; questa passava da app.emettiFattura senza il blocco (rilievo audit §04): si poteva
    // fatturare un cliente con KYC non approvato. Risolvo il cliente dal progetto e blocco con 409
    // come /invoices. Le note di credito (rettifica) restano escluse; fail-open solo su errore di lettura.
    const bodyGate: any = req.body || {};
    if (bodyGate.tipoDocumento !== 'nota_credito' && (await moduloKycAttivo(req.tenantId))) {
      const prog = await prisma.progetto.findFirst({ where: { id: req.params.id, tenantId: req.tenantId }, select: { clienteId: true } });
      if (prog?.clienteId) {
        const gate = await operativitaBloccataDaKyc(prisma, req.tenantId, prog.clienteId)
          .catch(() => ({ bloccato: false, stato: null, sbloccatoDaOverride: false }));
        if (gate.bloccato) {
          return reply.code(409).send({
            errore: `Fatturazione bloccata dal KYC: la pratica del cliente è in stato «${gate.stato}», non approvata. Approvala (scheda cliente → Compliance KYC) o registra uno sblocco motivato.`,
          });
        }
      }
    }
    try {
      // La numerazione dentro l'adapter non gira in Serializable: con due
      // emissioni concorrenti l'indice UNIQUE della numerazione può alzare
      // P2002 — si ritenta e il secondo tentativo rilegge il progressivo
      // già scritto dall'altro. InMemoryApp non solleva mai P2002, il retry
      // per lei è un no-op.
      const fattura: any = await riprovaSuConflitto(
        // `async`: il port dichiara `unknown | Promise<unknown>`, il retry vuole una Promise
        async () =>
          await app.emettiFattura({
            progettoId: req.params.id,
            ...req.body,
          }),
        3,
        true,
      );

      await recordAudit({
        tenantId: req.tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_EMESSA',
        entita: fattura.numero || `Fattura Progetto`,
        dettagli: `Fattura ${fattura.numero || ''} emessa per importo €${((fattura.totaleDocumentoCentesimi || 0) / 100).toFixed(2)} da scheda progetto`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore emissione fattura progetto' });
    }
  });

  // ─── REGISTRO FATTURE (OPENSTAMANAGER ENGINE) ──────────────────────
  server.get('/invoices', async (req, reply) => {
    const tenantId = req.tenantId;
    const paginazione = leggiPaginazione(req.query);
    if (paginazione.paginata && 'errore' in paginazione) {
      return reply.code(400).send({ errore: paginazione.errore });
    }

    try {
      const include = {
        righe: {
          include: { moduloProgetto: true, articolo: true },
          orderBy: { ordine: 'asc' as const },
        },
        progetto: { include: { cliente: true } },
        cliente: true,
        scadenzeIncasso: {
          include: { registrazioniRegistrate: true },
          orderBy: { numeroRata: 'asc' as const },
        },
        contoAccredito: true,
      };

      if (!paginazione.paginata) {
        const fatture = await prisma.fattura.findMany({
          where: { tenantId },
          include,
          orderBy: { numeroProgressivoSerie: 'desc' },
        });
        return reply.send(fatture);
      }

      const { page, limit, search, sortBy, sortOrder, stato, skip } = paginazione.parametri;
      const campo = campoOrdinamento(sortBy, ['numeroProgressivoSerie', 'data', 'stato', 'totaleDocumentoCentesimi', 'createdAt'] as const, 'numeroProgressivoSerie');
      if (!campo) return reply.code(400).send({ errore: 'Campo di ordinamento fatture non valido' });
      const statiConsentiti = ['bozza', 'emessa', 'incassata', 'annullata'] as const;
      if (stato && !statiConsentiti.includes(stato as typeof statiConsentiti[number])) {
        return reply.code(400).send({ errore: 'Stato fattura non valido' });
      }
      const where = {
        tenantId,
        ...(stato ? { stato: stato as typeof statiConsentiti[number] } : {}),
        ...(search ? {
          OR: [
            { numero: { contains: search, mode: 'insensitive' as const } },
            { cliente: { nome: { contains: search, mode: 'insensitive' as const } } },
          ],
        } : {}),
      };
      const [fatture, totale, emesso, incassato, sospeso, noteCredito] = await Promise.all([
        prisma.fattura.findMany({ where, include, skip, take: limit, orderBy: { [campo]: sortOrder } }),
        prisma.fattura.count({ where }),
        prisma.fattura.aggregate({
          where: { ...where, tipoDocumento: 'fattura', stato: { not: 'bozza' } },
          _sum: { totaleDocumentoCentesimi: true },
        }),
        prisma.fattura.aggregate({
          where: { ...where, tipoDocumento: 'fattura', stato: 'incassata' },
          _sum: { totaleDocumentoCentesimi: true },
        }),
        prisma.fattura.aggregate({
          where: { ...where, tipoDocumento: 'fattura', stato: 'emessa' },
          _sum: { totaleDocumentoCentesimi: true },
        }),
        prisma.fattura.aggregate({
          where: { ...where, tipoDocumento: 'nota_credito' },
          _sum: { totaleDocumentoCentesimi: true },
        }),
      ]);
      return reply.send({
        data: fatture,
        meta: creaMetaPaginazione(page, limit, totale),
        riepilogo: {
          totaleEmessoCentesimi: emesso._sum.totaleDocumentoCentesimi ?? 0,
          totaleIncassatoCentesimi: incassato._sum.totaleDocumentoCentesimi ?? 0,
          totaleSospesoCentesimi: sospeso._sum.totaleDocumentoCentesimi ?? 0,
          totaleNoteCreditoCentesimi: noteCredito._sum.totaleDocumentoCentesimi ?? 0,
        },
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get('/fatture', async (req, reply) => {
    const tenantId = req.tenantId;
    const paginazione = leggiPaginazione(req.query);
    if (paginazione.paginata && 'errore' in paginazione) {
      return reply.code(400).send({ errore: paginazione.errore });
    }
    try {
      const include = {
        righe: {
          include: { moduloProgetto: true, articolo: true },
          orderBy: { ordine: 'asc' as const },
        },
        progetto: { include: { cliente: true } },
        cliente: true,
        scadenzeIncasso: {
          include: { registrazioniRegistrate: true },
          orderBy: { numeroRata: 'asc' as const },
        },
        contoAccredito: true,
      };
      // Retrocompatibile: senza parametri di paginazione la rotta ritorna l'array come
      // prima. Con ?page/?limit ritorna { data, meta }: il default limit=50 evita di
      // spedire l'intero registro (include profondo su ogni riga) quando cresce.
      if (!paginazione.paginata) {
        const fatture = await prisma.fattura.findMany({
          where: { tenantId },
          include,
          orderBy: { numeroProgressivoSerie: 'desc' },
        });
        return reply.send(fatture);
      }

      const { page, limit, skip, search, stato, tipo } = paginazione.parametri;
      const where: Prisma.FatturaWhereInput = { tenantId };
      // Filtri di ricerca: testo su numero documento o nome cliente, più stato e tipo
      // documento quando indicati. Tutti opzionali: assenti = nessun vincolo aggiuntivo.
      if (search) {
        where.OR = [
          { numero: { contains: search, mode: 'insensitive' } },
          { cliente: { nome: { contains: search, mode: 'insensitive' } } },
        ];
      }
      if (stato) where.stato = stato as Prisma.FatturaWhereInput['stato'];
      if (tipo) where.tipoDocumento = tipo as Prisma.FatturaWhereInput['tipoDocumento'];
      const [fatture, totale] = await Promise.all([
        prisma.fattura.findMany({
          where,
          include,
          orderBy: { numeroProgressivoSerie: 'desc' },
          skip,
          take: limit,
        }),
        prisma.fattura.count({ where }),
      ]);
      return reply.send({ data: fatture, meta: creaMetaPaginazione(page, limit, totale) });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
          fatturaOrigine: true,
          noteCredito: true,
          auditLogFatture: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });
      return reply.send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura dettaglio fattura' });
    }
  });
}
