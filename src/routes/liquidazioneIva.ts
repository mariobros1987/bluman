// Rotte Liquidazione IVA Periodica (LIPE), Calcolo Imposte & Prospetto F24.

import type { FastifyInstance } from 'fastify';
import { conContestoInTransazione, prisma } from '../util/prismaClient.js';
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
import { creaMovimentoConSaldo } from '../services/primaNotaMovimento.js';

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

      // Una liquidazione già versata non si ricalcola: l'upsert qui sotto ne riscriverebbe gli
      // importi, e resterebbe un versamento registrato per una cifra diversa da quella salvata
      // (segnalato dal revisore sulla #6: da due schede aperte poteva succedere).
      const esistente = await prisma.liquidazioneIva.findFirst({
        where: { tenantId, periodo: periodoFiscale.codicePeriodo },
        select: { versata: true },
      });
      if (esistente?.versata) {
        return reply.code(409).send({ errore: 'La liquidazione IVA di questo periodo è già versata: non si può ricalcolare.' });
      }

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

      // Segnare la liquidazione come versata e scrivere l'uscita in Prima Nota sono un atto solo.
      // Prima erano due scritture separate: se la seconda falliva restava una liquidazione
      // «versata» senza la sua uscita, e non più riprovabile (il controllo qui sopra la rifiuta).
      // Il passaggio è condizionato a `versata = false`: di due conferme insieme ne passa una.
      const esito = await prisma.$transaction(async (tx) =>
        conContestoInTransazione(tx, async () => {
          const segnate = await tx.liquidazioneIva.updateMany({
            where: { id: lipe.id, versata: false },
            data: { versata: true, dataVersamento },
          });
          if (segnate.count !== 1) return { giaVersata: true as const };

          let movimento = null;
          if (registraPrimaNota && lipe.saldoCentesimi > 0) {
            // Il versamento F24 è denaro che esce: movimento e saldo del conto insieme
            // (`services/primaNotaMovimento.ts`).
            movimento = await creaMovimentoConSaldo(tx, {
              data: {
                tenantId,
                contoBancarioId: contoBancarioId || null,
                data: dataVersamento,
                tipo: 'uscita',
                categoria: 'imposta_tasse',
                descrizione: `Versamento F24 IVA Periodo ${lipe.periodo}`,
                importoCentesimi: lipe.saldoCentesimi,
                metodoPagamento: 'bonifico',
                // Il riferimento è quello della quietanza, se l'operatore lo scrive: prima, vuoto,
                // diventava «F24-<periodo>», un numero di transazione che nessuna banca ha emesso.
                riferimentoTransazione: riferimentoTransazione?.trim() || null,
                note: note || 'Versamento imposta IVA periodica tramite F24',
              },
            });
          }
          const aggiornata = await tx.liquidazioneIva.findUnique({ where: { id: lipe.id } });
          return { giaVersata: false as const, aggiornata, movimento };
        }),
      );
      if (esito.giaVersata) {
        return reply.code(409).send({ errore: 'La liquidazione IVA per questo periodo risulta già versata.' });
      }
      const aggiornata = esito.aggiornata;
      const movimentoPrimaNota = esito.movimento;

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
