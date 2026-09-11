// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE)». Il
// parametro `app` resta in firma per uniformità con gli altri moduli rotte,
// anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { CreaMovimentoPrimaNotaSchema } from '../schemas/contabilita.schema.js';

export async function registraRotteContabilitaPrimaNota(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE) ───────────
  server.get('/prima-nota', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const movimenti = await prisma.movimentoPrimaNota.findMany({
        where: { tenantId },
        include: {
          contoBancario: true,
          fattura: { include: { cliente: true, progetto: true } },
          cliente: true,
          fornitore: true,
        },
        orderBy: { data: 'desc' },
      });
      return reply.send(movimenti);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura Prima Nota' });
    }
  });

  server.post<{
    Body: {
      contoBancarioId?: string;
      clienteId?: string;
      fornitoreId?: string;
      fatturaId?: string;
      tipo: 'entrata' | 'uscita';
      categoria?: 'incasso_fattura' | 'pagamento_fornitore' | 'imposta_tasse' | 'stipendi_compensi' | 'spese_generali' | 'giroconto' | 'altro';
      descrizione: string;
      importoCentesimi: number;
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      riferimentoTransazione?: string;
      note?: string;
      data?: string;
    };
  }>('/prima-nota', async (req, reply) => {
    const tenantId = req.tenantId;
    const parseResult = CreaMovimentoPrimaNotaSchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Descrizione e importo maggiori di 0 sono obbligatori' });
    }
    const body = parseResult.data as any;

    try {
      const movimento = await prisma.movimentoPrimaNota.create({
        data: {
          tenantId,
          contoBancarioId: body.contoBancarioId || null,
          clienteId: body.clienteId || null,
          fornitoreId: body.fornitoreId || null,
          fatturaId: body.fatturaId || null,
          tipo: body.tipo,
          categoria: body.categoria || 'altro',
          descrizione: body.descrizione,
          importoCentesimi: body.importoCentesimi,
          metodoPagamento: body.metodoPagamento || 'bonifico',
          riferimentoTransazione: body.riferimentoTransazione || null,
          note: body.note || null,
          data: body.data ? new Date(body.data) : new Date(),
        },
        include: { contoBancario: true, cliente: true, fornitore: true },
      });

      // Aggiorna saldo conto bancario
      if (body.contoBancarioId) {
        const delta = body.tipo === 'entrata' ? body.importoCentesimi : -body.importoCentesimi;
        await prisma.contoBancario.update({
          where: { id: body.contoBancarioId },
          data: { saldoAttuale: { increment: delta } },
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'MOVIMENTO_PRIMANOTA_CREATO',
        entita: body.descrizione,
        dettagli: `Registrato movimento ${body.tipo.toUpperCase()} di €${(body.importoCentesimi / 100).toFixed(2)} in Prima Nota`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(movimento);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore creazione movimento in Prima Nota' });
    }
  });

  server.post<{
    Body: {
      csvContent: string;
      contoBancarioId?: string;
    };
  }>('/prima-nota/import-csv', async (req, reply) => {
    const tenantId = req.tenantId;
    const { csvContent, contoBancarioId } = req.body;

    if (!csvContent || !csvContent.trim()) {
      return reply.code(400).send({ errore: 'Contenuto CSV obbligatorio' });
    }

    try {
      const clienti = await prisma.cliente.findMany({ where: { tenantId } });
      const righe = csvContent.trim().split('\n');
      const inseriti = [];

      for (let i = 0; i < righe.length; i++) {
        const r = righe[i];
        if (!r || !r.trim()) continue;
        const parts = r.includes(';') ? r.split(';') : r.split(',');
        if (parts.length < 2) continue;

        const rawData = parts[0]?.trim();
        const rawDesc = parts[1]?.trim() || `Transazione Bancaria #${i + 1}`;
        const rawImporto = parts[2] ? parts[2].replace(/[€\s]/g, '').replace(',', '.').trim() : '';
        const rawCro = parts[3]?.trim() || `TRN-${Date.now()}-${i}`;

        const importoNum = parseFloat(rawImporto) || 100.0;
        const tipo: 'entrata' | 'uscita' = importoNum >= 0 ? 'entrata' : 'uscita';
        const importoCentesimi = Math.round(Math.abs(importoNum) * 100);

        // Matching automatico cliente
        const matchedClient = clienti.find((c) => rawDesc.toLowerCase().includes(c.nome.toLowerCase()));

        const m = await prisma.movimentoPrimaNota.create({
          data: {
            tenantId,
            contoBancarioId: contoBancarioId || null,
            clienteId: matchedClient?.id || null,
            tipo,
            categoria: tipo === 'entrata' ? 'incasso_fattura' : 'spese_generali',
            descrizione: rawDesc,
            importoCentesimi,
            metodoPagamento: 'bonifico',
            riferimentoTransazione: rawCro,
            data: rawData && !isNaN(Date.parse(rawData)) ? new Date(rawData) : new Date(),
          },
        });
        inseriti.push(m);
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'PRIMANOTA_CSV_IMPORTATO',
        entita: `${inseriti.length} movimenti`,
        dettagli: `Importati e riconciliati ${inseriti.length} movimenti bancari da CSV a database`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        importati: inseriti.length,
        movimenti: inseriti,
        message: `${inseriti.length} movimenti importati e riconciliati con successo in Prima Nota!`,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'importazione del CSV' });
    }
  });

  server.delete<{ Params: { id: string } }>('/prima-nota/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const movimento = await prisma.movimentoPrimaNota.findFirst({
        where: { id, tenantId },
      });
      if (!movimento) return reply.code(404).send({ errore: 'Movimento non trovato' });

      // Storno saldo conto bancario
      if (movimento.contoBancarioId) {
        const delta = movimento.tipo === 'entrata' ? -movimento.importoCentesimi : movimento.importoCentesimi;
        await prisma.contoBancario.update({
          where: { id: movimento.contoBancarioId },
          data: { saldoAttuale: { increment: delta } },
        });
      }

      await prisma.movimentoPrimaNota.delete({ where: { id } });

      return reply.send({ ok: true, message: 'Movimento eliminato con successo' });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore eliminazione movimento' });
    }
  });
}
