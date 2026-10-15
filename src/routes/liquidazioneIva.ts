// Rotte Liquidazione IVA Periodica (LIPE), Calcolo Imposte & Prospetto F24.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import {
  determinaPeriodoFiscale,
  calcolaLiquidazioneIvaPeriodo,
} from '../services/lipeEngine.js';
import {
  CalcolaLipeQuerySchema,
  SalvaLipeSchema,
  MarcaVersataLipeSchema,
} from '../schemas/liquidazioneIva.schema.js';

export async function registraRotteLiquidazioneIva(server: FastifyInstance): Promise<void> {
  // GET /liquidazione-iva — Elenco liquidazioni registrate
  server.get('/liquidazione-iva', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const liquidazioni = await prisma.liquidazioneIva.findMany({
        where: { tenantId },
        orderBy: { periodo: 'desc' },
      });
      return reply.send(liquidazioni);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore recupero liquidazioni IVA' });
    }
  });

  // POST /liquidazione-iva/calcola — Calcolo live per un dato periodo
  server.post<{ Body: any }>('/liquidazione-iva/calcola', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = CalcolaLipeQuerySchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati periodo non validi' });
    }

    const { periodo, creditoPrecedenteCent } = parseResult.data;

    try {
      const periodoFiscale = determinaPeriodoFiscale(periodo);

      // 1. Query documenti attivi del periodo: fatture E note di credito. Le NC stornano
      //    l'IVA a debito e vanno incluse (con segno negativo, gestito dal motore), altrimenti
      //    si versa IVA su operazioni già annullate.
      const fattureAttive = await prisma.fattura.findMany({
        where: {
          tenantId,
          data: {
            gte: periodoFiscale.dataInizio,
            lte: periodoFiscale.dataFine,
          },
          tipoDocumento: { in: ['fattura', 'nota_credito'] },
        },
        select: {
          id: true,
          numero: true,
          totaleImponibileCentesimi: true,
          totaleIvaCentesimi: true,
          esigibilitaIva: true,
          stato: true,
          tipoDocumento: true,
        },
      });

      // 2. Query fatture passive del periodo
      const fatturePassive = await prisma.fatturaRicevuta.findMany({
        where: {
          tenantId,
          data: {
            gte: periodoFiscale.dataInizio,
            lte: periodoFiscale.dataFine,
          },
        },
        select: {
          imponibileCentesimi: true,
          ivaCentesimi: true,
        },
      });

      // 3. Calcolo LIPE deterministico
      const riepilogo = calcolaLiquidazioneIvaPeriodo(
        periodo,
        fattureAttive,
        fatturePassive,
        creditoPrecedenteCent || 0,
      );

      // 4. Verifichiamo se esiste già un record salvato a DB
      const salvata = await prisma.liquidazioneIva.findFirst({
        where: { tenantId, periodo: periodoFiscale.codicePeriodo },
      });

      return reply.send({
        ...riepilogo,
        registrazioneEsistente: salvata || null,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore calcolo liquidazione IVA' });
    }
  });

  // POST /liquidazione-iva/salva — Salva o aggiorna record LiquidazioneIva
  server.post<{ Body: any }>('/liquidazione-iva/salva', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = SalvaLipeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati non validi' });
    }

    const { periodo, creditoPrecedenteCent } = parseResult.data;

    try {
      const periodoFiscale = determinaPeriodoFiscale(periodo);

      const fattureAttive = await prisma.fattura.findMany({
        where: {
          tenantId,
          data: {
            gte: periodoFiscale.dataInizio,
            lte: periodoFiscale.dataFine,
          },
          tipoDocumento: { in: ['fattura', 'nota_credito'] },
        },
        select: {
          id: true,
          numero: true,
          totaleImponibileCentesimi: true,
          totaleIvaCentesimi: true,
          esigibilitaIva: true,
          stato: true,
          tipoDocumento: true,
        },
      });

      const fatturePassive = await prisma.fatturaRicevuta.findMany({
        where: {
          tenantId,
          data: {
            gte: periodoFiscale.dataInizio,
            lte: periodoFiscale.dataFine,
          },
        },
        select: {
          imponibileCentesimi: true,
          ivaCentesimi: true,
        },
      });

      const riepilogo = calcolaLiquidazioneIvaPeriodo(
        periodo,
        fattureAttive,
        fatturePassive,
        creditoPrecedenteCent || 0,
      );

      const salvata = await prisma.liquidazioneIva.upsert({
        where: {
          tenantId_periodo: {
            tenantId,
            periodo: periodoFiscale.codicePeriodo,
          },
        },
        create: {
          tenantId,
          periodo: periodoFiscale.codicePeriodo,
          ivaDebitoCentesimi: riepilogo.ivaDebitoCent,
          ivaCreditoCentesimi: riepilogo.ivaCreditoCent,
          saldoCentesimi: riepilogo.saldoIvaCent,
          versata: false,
        },
        update: {
          ivaDebitoCentesimi: riepilogo.ivaDebitoCent,
          ivaCreditoCentesimi: riepilogo.ivaCreditoCent,
          saldoCentesimi: riepilogo.saldoIvaCent,
        },
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'LIPE_SALVATA',
        entita: `LIPE-${periodoFiscale.codicePeriodo}`,
        dettagli: `Salvataggio liquidazione IVA periodo ${periodoFiscale.codicePeriodo}: Debito €${(riepilogo.ivaDebitoCent / 100).toFixed(2)}, Credito €${(riepilogo.ivaCreditoCent / 100).toFixed(2)}, Saldo €${(riepilogo.saldoIvaCent / 100).toFixed(2)}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        liquidazione: salvata,
        riepilogo,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore salvataggio liquidazione IVA' });
    }
  });

  // POST /liquidazione-iva/:periodo/marca-versata — Registra versamento F24
  server.post<{ Params: { periodo: string }; Body: any }>('/liquidazione-iva/:periodo/marca-versata', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const { periodo } = req.params;
    const parseResult = MarcaVersataLipeSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati versamento non validi' });
    }

    const { dataVersamento, contoBancarioId, registraPrimaNota, riferimentoTransazione, note } = parseResult.data;

    try {
      const periodoFiscale = determinaPeriodoFiscale(periodo);
      const lipe = await prisma.liquidazioneIva.findFirst({
        where: { tenantId, periodo: periodoFiscale.codicePeriodo },
      });

      if (!lipe) {
        return reply.code(404).send({ errore: 'Liquidazione IVA non trovata per questo periodo. Calcolala e salvala prima.' });
      }

      if (lipe.versata) {
        return reply.code(409).send({ errore: 'La liquidazione IVA per questo periodo risulta già versata.' });
      }

      const aggiornata = await prisma.liquidazioneIva.update({
        where: { id: lipe.id },
        data: {
          versata: true,
          dataVersamento,
        },
      });

      let movimentoPrimaNota = null;
      if (registraPrimaNota && lipe.saldoCentesimi > 0) {
        movimentoPrimaNota = await prisma.movimentoPrimaNota.create({
          data: {
            tenantId,
            contoBancarioId: contoBancarioId || null,
            data: dataVersamento,
            tipo: 'uscita',
            categoria: 'imposta_tasse',
            descrizione: `Versamento F24 IVA Periodo ${lipe.periodo}`,
            importoCentesimi: lipe.saldoCentesimi,
            metodoPagamento: 'bonifico',
            riferimentoTransazione: riferimentoTransazione || `F24-${lipe.periodo}`,
            note: note || 'Versamento imposta IVA periodica tramite F24',
          },
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'LIPE_VERSATA',
        entita: `LIPE-${lipe.periodo}`,
        dettagli: `Registrato versamento F24 IVA ${lipe.periodo} (€${(lipe.saldoCentesimi / 100).toFixed(2)})`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        liquidazione: aggiornata,
        movimentoPrimaNota,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore registrazione versamento LIPE' });
    }
  });
}
