// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «CONTRATTI RICORRENTI & RETAINER». Il parametro `app` resta in
// firma per uniformità con gli altri moduli rotte, anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppPort } from '../services/appPort.js';
import { prisma, conContestoInTransazione, riprovaSuConflitto } from '../util/prismaClient.js';
import {
  calcolaTotaliFattura,
  formattaNumeroDocumento,
  type RigaFatturaInput,
  type OpzioniCalcoloFattura,
} from '../services/fatturaEngine.js';
import { recordAudit } from '../util/serverHelpers.js';
import { CreaContrattoRicorrenteSchema } from '../schemas/contabilita.schema.js';

export async function registraRotteContabilitaContratti(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── CONTRATTI RICORRENTI & RETAINER ───────────────────────────────
  server.get('/contratti-ricorrenti', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const contratti = await prisma.contrattoRicorrente.findMany({
        where: { tenantId },
        include: { cliente: true, progetto: true },
        orderBy: { prossimaFatturazione: 'asc' },
      });
      return reply.send(contratti);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Body: {
      clienteId: string;
      progettoId?: string;
      titolo: string;
      frequenza?: 'mensile' | 'trimestrale' | 'semestrale' | 'annuale';
      importoCentesimi: number;
      prossimaFatturazione: string;
      note?: string;
    };
  }>('/contratti-ricorrenti', async (req, reply) => {
    const tenantId = req.tenantId;
    const parseResult = CreaContrattoRicorrenteSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'clienteId, titolo e importoCentesimi sono obbligatori' });
    }
    const { clienteId, progettoId, titolo, frequenza, importoCentesimi, prossimaFatturazione, note } = parseResult.data;

    try {
      const contratto = await prisma.contrattoRicorrente.create({
        data: {
          tenantId,
          clienteId,
          progettoId: progettoId || null,
          titolo,
          frequenza: frequenza || 'mensile',
          importoCentesimi,
          prossimaFatturazione: prossimaFatturazione || new Date(),
          note,
        },
        include: { cliente: true, progetto: true },
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'CONTRATTO_RICORRENTE_CREATO',
        entita: titolo,
        dettagli: `Creato contratto retainer da €${(importoCentesimi / 100).toFixed(2)} (${frequenza || 'mensile'})`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(contratto);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione contratto' });
    }
  });

  server.post<{ Params: { id: string } }>('/contratti-ricorrenti/:id/genera-fattura', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const contratto = await prisma.contrattoRicorrente.findUnique({
        where: { id },
        include: { cliente: true, progetto: true },
      });

      if (!contratto) return reply.code(404).send({ errore: 'Contratto non trovato' });

      const opzioni: OpzioniCalcoloFattura = {
        tipoCassa: 'nessuna',
      };
      const righeInput: RigaFatturaInput[] = [
        {
          tipo: 'milestone_libera',
          descrizione: `Canone Retainer: ${contratto.titolo} (${contratto.frequenza})`,
          quantita: 1,
          unitaMisura: 'canone',
          prezzoUnitarioCent: contratto.importoCentesimi,
          aliquotaIva: 22,
          applicaCassa: false,
          applicaRitenuta: false,
        },
      ];
      const calcolo = calcolaTotaliFattura(righeInput, opzioni);

      // Data della prossima fatturazione del canone: dipende solo dal contratto,
      // quindi si calcola prima della transazione e resta stabile tra i tentativi.
      const prossimaData = new Date(contratto.prossimaFatturazione || new Date());
      if (contratto.frequenza === 'mensile') prossimaData.setMonth(prossimaData.getMonth() + 1);
      else if (contratto.frequenza === 'trimestrale') prossimaData.setMonth(prossimaData.getMonth() + 3);
      else if (contratto.frequenza === 'semestrale') prossimaData.setMonth(prossimaData.getMonth() + 6);
      else if (contratto.frequenza === 'annuale') prossimaData.setFullYear(prossimaData.getFullYear() + 1);

      // Numerazione, creazione fattura e avanzamento del contratto in una sola
      // transazione Serializable: così un canone non può essere fatturato due
      // volte né saltato. Due richieste contemporanee che assegnano lo stesso
      // progressivo vengono serializzate da Postgres: una fallisce con P2034 e
      // `riprovaSuConflitto` la rilancia rileggendo i progressivi aggiornati.
      const nuovaFattura = await riprovaSuConflitto(() =>
        prisma.$transaction(
          async (tx) =>
            conContestoInTransazione(tx, async () => {
              const lastFattura = await tx.fattura.findFirst({
                where: { tenantId, tipoDocumento: 'fattura', serie: 'FT', stato: { not: 'bozza' } },
                orderBy: { numeroProgressivoSerie: 'desc' },
              });
              const dataEmissione = new Date();
              const prossimoProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
              const numeroFattura = formattaNumeroDocumento('FT', prossimoProgressivo, dataEmissione);

              const fatturaCreata = await tx.fattura.create({
                data: {
                  tenantId,
                  clienteId: contratto.clienteId,
                  progettoId: contratto.progettoId || null,
                  contrattoRicorrenteId: contratto.id,
                  tipoDocumento: 'fattura',
                  serie: 'FT',
                  numeroProgressivoSerie: prossimoProgressivo,
                  numero: numeroFattura,
                  data: dataEmissione,
                  tipoClienteFiscale: 'business_italia',
                  canale: 'standard',
                  stato: 'emessa',
                  totaleImponibileCentesimi: calcolo.totaleImponibileCentesimi,
                  totaleCassaCentesimi: calcolo.totaleCassaCentesimi,
                  totaleIvaCentesimi: calcolo.totaleIvaCentesimi,
                  totaleRitenutaCentesimi: calcolo.totaleRitenutaCentesimi,
                  totaleBolloCentesimi: calcolo.totaleBolloCentesimi,
                  totaleDocumentoCentesimi: calcolo.totaleDocumentoCentesimi,
                  nettoAPagareCentesimi: calcolo.nettoAPagareCentesimi,
                  righe: {
                    create: calcolo.righe.map((r, idx) => ({
                      tenantId,
                      tipo: r.tipo || 'milestone_libera',
                      descrizione: r.descrizione,
                      quantita: r.quantita,
                      unitaMisura: r.unitaMisura,
                      prezzoUnitarioCent: r.prezzoUnitarioCent,
                      scontoPercentuale: r.scontoPercentuale,
                      aliquotaIva: r.aliquotaIva,
                      imponibileCentesimi: r.imponibileCentesimi,
                      ivaCentesimi: r.ivaCentesimi,
                      totaleRigaCentesimi: r.totaleRigaCentesimi,
                      importo: r.totaleRigaCentesimi,
                      ordine: idx + 1,
                    })),
                  },
                  scadenzeIncasso: {
                    create: [
                      {
                        tenantId,
                        numeroRata: 1,
                        importoCentesimi: calcolo.nettoAPagareCentesimi,
                        dataScadenza: new Date(),
                        stato: 'in_attesa',
                        note: `Canone retainer ${contratto.titolo}`,
                      },
                    ],
                  },
                },
                include: { righe: true, progetto: { include: { cliente: true } }, scadenzeIncasso: true },
              });

              await tx.contrattoRicorrente.update({
                where: { id },
                data: { prossimaFatturazione: prossimaData },
              });

              return fatturaCreata;
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
        // `true`: ritenta anche sulla P2002 dell'indice UNIQUE della numerazione
        3,
        true,
      );

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_RETAINER_GENERATA',
        entita: nuovaFattura.numero || 'Fattura retainer',
        dettagli: `Generata fattura ${nuovaFattura.numero} da €${(calcolo.nettoAPagareCentesimi / 100).toFixed(2)} per il canone retainer ${contratto.titolo}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        fattura: nuovaFattura,
        scadenza: nuovaFattura.scadenzeIncasso[0],
        prossimaFatturazione: prossimaData,
        messaggio: `Fattura ${nuovaFattura.numero} generata con successo ed inserita nello Scadenzario Incassi!`,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione fattura retainer' });
    }
  });
}
