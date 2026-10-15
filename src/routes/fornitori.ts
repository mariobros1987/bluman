// Rotte Fornitori e Ciclo Passivo (Fatture d'Acquisto / Ricevute, Import XML SDI, Pagamento e Prima Nota).

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import {
  CreaFornitoreSchema,
  AggiornaFornitoreSchema,
  RegistraFatturaRicevutaSchema,
  PagaFatturaRicevutaSchema,
} from '../schemas/fornitori.schema.js';
import { parseXmlFatturaPassiva } from '../services/fatturaPassivaParser.js';
import { creaMovimentoConSaldo } from '../services/primaNotaMovimento.js';

export async function registraRotteFornitori(server: FastifyInstance): Promise<void> {
  // ─── ANAGRAFICA FORNITORI ──────────────────────────────────────────

  // GET /fornitori — Lista fornitori con conteggio fatture
  server.get('/fornitori', async (req, reply) => {
    const tenantId = req.tenantId as string;
    req.log.info({ tenantId, userId: req.userId }, 'GET /fornitori');
    try {
      const fornitori = await prisma.fornitore.findMany({
        where: { tenantId },
        include: {
          _count: {
            select: { fattureRicevute: true },
          },
        },
        orderBy: { ragioneSociale: 'asc' },
      });
      return reply.send(fornitori);
    } catch (err: any) {
      req.log.error({ tenantId, err: err?.message }, 'GET /fornitori — errore DB');
      return reply.code(500).send({ errore: err?.message || 'Errore recupero lista fornitori' });
    }
  });

  // GET /fornitori/:id — Dettaglio fornitore con fatture ricevute
  server.get<{ Params: { id: string } }>('/fornitori/:id', async (req, reply) => {
    const tenantId = req.tenantId as string;
    req.log.info({ tenantId, fornitoreId: req.params.id }, 'GET /fornitori/:id');
    try {
      const fornitore = await prisma.fornitore.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          fattureRicevute: {
            orderBy: { data: 'desc' },
          },
        },
      });
      if (!fornitore) {
        return reply.code(404).send({ errore: 'Fornitore non trovato' });
      }
      return reply.send(fornitore);
    } catch (err: any) {
      req.log.error({ tenantId, fornitoreId: req.params.id, err: err?.message }, 'GET /fornitori/:id — errore DB');
      return reply.code(500).send({ errore: err?.message || 'Errore recupero fornitore' });
    }
  });

  // POST /fornitori — Crea nuovo fornitore
  server.post<{ Body: any }>('/fornitori', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = CreaFornitoreSchema.safeParse(req.body);
    if (!parseResult.success) {
      const msg = parseResult.error.issues[0]?.message || 'Dati fornitore non validi';
      req.log.warn({ tenantId, issues: parseResult.error.issues }, 'POST /fornitori — validazione fallita');
      return reply.code(400).send({ errore: msg });
    }

    try {
      const fornitore = await prisma.fornitore.create({
        data: {
          tenantId,
          ...parseResult.data,
        },
      });

      req.log.info({ tenantId, fornitoreId: fornitore.id, ragioneSociale: fornitore.ragioneSociale }, 'POST /fornitori — fornitore creato');

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FORNITORE_CREATO',
        entita: fornitore.ragioneSociale,
        dettagli: `Creato fornitore ${fornitore.ragioneSociale} (P.IVA: ${fornitore.partitaIva || 'N/D'})`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(fornitore);
    } catch (err: any) {
      req.log.error({ tenantId, err: err?.message }, 'POST /fornitori — errore DB');
      return reply.code(500).send({ errore: err?.message || 'Errore creazione fornitore' });
    }
  });

  // PUT /fornitori/:id — Aggiorna fornitore
  server.put<{ Params: { id: string }; Body: any }>('/fornitori/:id', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = AggiornaFornitoreSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati modifica non validi' });
    }

    try {
      const esistente = await prisma.fornitore.findFirst({
        where: { id: req.params.id, tenantId },
      });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Fornitore non trovato' });
      }

      const aggiornato = await prisma.fornitore.update({
        where: { id: req.params.id },
        data: parseResult.data,
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FORNITORE_AGGIORNATO',
        entita: aggiornato.ragioneSociale,
        dettagli: `Aggiornato fornitore ${aggiornato.ragioneSociale}`,
        ipAddress: req.ip,
      });

      return reply.send(aggiornato);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore aggiornamento fornitore' });
    }
  });

  // DELETE /fornitori/:id — Elimina fornitore se privo di fatture
  server.delete<{ Params: { id: string } }>('/fornitori/:id', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const esistente = await prisma.fornitore.findFirst({
        where: { id: req.params.id, tenantId },
        include: { _count: { select: { fattureRicevute: true } } },
      });
      if (!esistente) {
        return reply.code(404).send({ errore: 'Fornitore non trovato' });
      }

      if (esistente._count.fattureRicevute > 0) {
        return reply.code(409).send({
          errore: 'Impossibile eliminare il fornitore: sono presenti fatture d’acquisto registrate a suo nome.',
        });
      }

      await prisma.fornitore.delete({ where: { id: req.params.id } });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FORNITORE_ELIMINATO',
        entita: esistente.ragioneSociale,
        dettagli: `Eliminato fornitore ${esistente.ragioneSociale}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, messaggio: 'Fornitore eliminato con successo' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore eliminazione fornitore' });
    }
  });

  // ─── FATTURE RICEVUTE / PASSIVE ────────────────────────────────────

  // GET /fatture-ricevute — Elenco fatture d'acquisto
  server.get('/fatture-ricevute', async (req, reply) => {
    const tenantId = req.tenantId as string;
    req.log.info({ tenantId }, 'GET /fatture-ricevute');
    try {
      const fatture = await prisma.fatturaRicevuta.findMany({
        where: { tenantId },
        include: {
          fornitore: true,
          movimentiPrimaNota: true,
        },
        orderBy: { data: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      req.log.error({ tenantId, err: err?.message }, 'GET /fatture-ricevute — errore DB');
      return reply.code(500).send({ errore: err?.message || 'Errore recupero fatture passive' });
    }
  });

  // POST /fatture-ricevute — Registra nuova fattura d'acquisto
  server.post<{ Body: any }>('/fatture-ricevute', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = RegistraFatturaRicevutaSchema.safeParse(req.body);
    if (!parseResult.success) {
      const msg = parseResult.error.issues[0]?.message || 'Dati fattura passiva non validi';
      req.log.warn({ tenantId, issues: parseResult.error.issues }, 'POST /fatture-ricevute — validazione fallita');
      return reply.code(400).send({ errore: msg });
    }

    const {
      fornitoreId,
      numero,
      data,
      imponibileCentesimi,
      ivaCentesimi,
      totaleCentesimi,
      esigibilitaIva,
      pagata,
      dataPagamento,
      xmlSdiRaw,
      registraMovimentoPrimaNota,
      contoBancarioId,
      metodoPagamento,
      riferimentoTransazione,
    } = parseResult.data;

    try {
      const fornitore = await prisma.fornitore.findFirst({
        where: { id: fornitoreId, tenantId },
      });
      if (!fornitore) {
        return reply.code(404).send({ errore: 'Fornitore non trovato per questo tenant' });
      }

      const fatturaRicevuta = await prisma.fatturaRicevuta.create({
        data: {
          tenantId,
          fornitoreId,
          numero,
          data,
          imponibileCentesimi,
          ivaCentesimi,
          totaleCentesimi,
          esigibilitaIva: esigibilitaIva || 'immediata',
          pagata: !!pagata,
          dataPagamento: pagata ? dataPagamento || new Date() : null,
          xmlSdiRaw,
        },
        include: { fornitore: true },
      });

      // Se pagata e richiesto, registriamo l'uscita in Prima Nota — e con essa il saldo del conto
      // (`services/primaNotaMovimento.ts`): un pagamento che non muove il saldo lascia il conto
      // pieno di denaro che è uscito.
      if (pagata && registraMovimentoPrimaNota) {
        await creaMovimentoConSaldo(prisma, {
          data: {
            tenantId,
            fatturaRicevutaId: fatturaRicevuta.id,
            fornitoreId: fornitore.id,
            contoBancarioId: contoBancarioId || null,
            data: dataPagamento || new Date(),
            tipo: 'uscita',
            categoria: 'pagamento_fornitore',
            descrizione: `Pagamento fattura passiva n. ${numero} (${fornitore.ragioneSociale})`,
            importoCentesimi: totaleCentesimi,
            metodoPagamento: metodoPagamento || 'bonifico',
            riferimentoTransazione,
          },
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_PASSIVA_REGISTRATA',
        entita: `FT-PASS-${numero}`,
        dettagli: `Registrata fattura passiva ${numero} di €${(totaleCentesimi / 100).toFixed(2)} da ${fornitore.ragioneSociale}`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(fatturaRicevuta);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore registrazione fattura passiva' });
    }
  });

  // POST /fatture-ricevute/import-xml — Importa e analizza XML SDI passivo
  server.post<{ Body: { xmlContent: string } }>('/fatture-ricevute/import-xml', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const xmlContent = req.body?.xmlContent?.trim();
    if (!xmlContent) {
      return reply.code(400).send({ errore: 'Contenuto XML mancante' });
    }

    try {
      const datiEstratti = parseXmlFatturaPassiva(xmlContent);

      // Cerchiamo se il fornitore esiste già per P.IVA o Ragione Sociale
      let fornitore = null;
      if (datiEstratti.fornitore.partitaIva) {
        fornitore = await prisma.fornitore.findFirst({
          where: { tenantId, partitaIva: datiEstratti.fornitore.partitaIva },
        });
      }
      if (!fornitore && datiEstratti.fornitore.codiceFiscale) {
        fornitore = await prisma.fornitore.findFirst({
          where: { tenantId, codiceFiscale: datiEstratti.fornitore.codiceFiscale },
        });
      }
      if (!fornitore) {
        fornitore = await prisma.fornitore.findFirst({
          where: { tenantId, ragioneSociale: { equals: datiEstratti.fornitore.ragioneSociale, mode: 'insensitive' } },
        });
      }

      // Se il fornitore non esiste, lo creiamo in automatico
      if (!fornitore) {
        fornitore = await prisma.fornitore.create({
          data: {
            tenantId,
            ragioneSociale: datiEstratti.fornitore.ragioneSociale,
            partitaIva: datiEstratti.fornitore.partitaIva || null,
            codiceFiscale: datiEstratti.fornitore.codiceFiscale || null,
            indirizzo: datiEstratti.fornitore.indirizzo || null,
            cap: datiEstratti.fornitore.cap || null,
            citta: datiEstratti.fornitore.citta || null,
            nazione: datiEstratti.fornitore.nazione || 'IT',
            pec: datiEstratti.fornitore.pec || null,
          },
        });
      }

      // Creiamo la fattura ricevuta collegata
      const fatturaRicevuta = await prisma.fatturaRicevuta.create({
        data: {
          tenantId,
          fornitoreId: fornitore.id,
          numero: datiEstratti.documento.numero,
          data: new Date(datiEstratti.documento.data),
          imponibileCentesimi: datiEstratti.documento.imponibileCentesimi,
          ivaCentesimi: datiEstratti.documento.ivaCentesimi,
          totaleCentesimi: datiEstratti.documento.totaleCentesimi,
          esigibilitaIva: datiEstratti.documento.esigibilitaIva || 'immediata',
          pagata: false,
          xmlSdiRaw: xmlContent,
        },
        include: { fornitore: true },
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'XML_SDI_PASSIVO_IMPORTATO',
        entita: `XML-${fatturaRicevuta.numero}`,
        dettagli: `Importata fattura passiva ${fatturaRicevuta.numero} (€${(fatturaRicevuta.totaleCentesimi / 100).toFixed(2)}) da XML SDI per ${fornitore.ragioneSociale}`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(fatturaRicevuta);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore importazione XML fattura passiva' });
    }
  });

  // POST /fatture-ricevute/:id/paga — Salda fattura passiva e scrive movimento in Prima Nota
  server.post<{ Params: { id: string }; Body: any }>('/fatture-ricevute/:id/paga', async (req, reply) => {
    const tenantId = req.tenantId as string;
    const parseResult = PagaFatturaRicevutaSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati pagamento non validi' });
    }

    const { contoBancarioId, dataPagamento, metodoPagamento, riferimentoTransazione, note } = parseResult.data;

    try {
      const fattura = await prisma.fatturaRicevuta.findFirst({
        where: { id: req.params.id, tenantId },
        include: { fornitore: true },
      });
      if (!fattura) {
        return reply.code(404).send({ errore: 'Fattura passiva non trovata' });
      }

      if (fattura.pagata) {
        return reply.code(409).send({ errore: 'Fattura passiva già saldata' });
      }

      // 1. Aggiorniamo stato fattura passiva
      const aggiornata = await prisma.fatturaRicevuta.update({
        where: { id: req.params.id },
        data: {
          pagata: true,
          dataPagamento,
        },
        include: { fornitore: true },
      });

      // 2. Creiamo registrazione di uscita in Prima Nota, e insieme muoviamo il saldo del conto
      const movimentoPrimaNota = await creaMovimentoConSaldo(prisma, {
        data: {
          tenantId,
          fatturaRicevutaId: fattura.id,
          fornitoreId: fattura.fornitoreId,
          contoBancarioId: contoBancarioId || null,
          data: dataPagamento,
          tipo: 'uscita',
          categoria: 'pagamento_fornitore',
          descrizione: `Saldo fattura passiva n. ${fattura.numero} (${fattura.fornitore.ragioneSociale})`,
          importoCentesimi: fattura.totaleCentesimi,
          metodoPagamento,
          riferimentoTransazione,
          note,
        },
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_PASSIVA_SALDATA',
        entita: `FT-PASS-${fattura.numero}`,
        dettagli: `Saldata fattura passiva ${fattura.numero} (€${(fattura.totaleCentesimi / 100).toFixed(2)}) con movimento Prima Nota ${movimentoPrimaNota.id}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        fattura: aggiornata,
        movimentoPrimaNota,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore registrazione pagamento fattura passiva' });
    }
  });
}
