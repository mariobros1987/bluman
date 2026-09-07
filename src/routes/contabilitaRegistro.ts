// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte dei blocchi «COMPATIBILITÀ ROTTE PRECEDENTI» e «REGISTRO FATTURE
// (OPENSTAMANAGER ENGINE)». A differenza degli altri moduli estratti, questo
// blocco usa `app` (listaFattureTutte, emettiFattura).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';

export async function registraRotteContabilitaRegistro(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── COMPATIBILITÀ ROTTE PRECEDENTI ────────────────────────────────
  server.get('/fatture/tutte', async () => {
    return (app as any).listaFattureTutte();
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
    try {
      const fattura: any = await app.emettiFattura({
        progettoId: req.params.id,
        ...req.body,
      });

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
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
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
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get('/fatture', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
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
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
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
