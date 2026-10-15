// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte dei blocchi «MODULO BANCHE & CONTI CORRENTI STUDIO» e «REPORTISTICA
// DIREZIONALE». Il parametro `app` resta in firma per uniformità con gli altri
// moduli rotte, anche se questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { saldoContoCentesimi } from '../domain/saldoConto.js';
import { costruisciReport, REPORT_DISPONIBILI, type ChiaveReport } from '../services/reportsService.js';
import { generaPdfReport, generaExcelReport } from '../services/reportExport.js';

export async function registraRotteContabilitaContiReport(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  server.get('/conti-bancari', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const conti = await prisma.contoBancario.findMany({
        where: { tenantId },
        orderBy: { isDefault: 'desc' },
      });

      // Il saldo si **ricava** dai movimenti (`domain/saldoConto.ts`): è la regola che il manuale
      // (§07) già dichiarava e che la colonna `saldoAttuale` imitava a mano. Qui la copia viene
      // verificata a ogni lettura, ed è l'unico posto che può accorgersi che un percorso di
      // scrittura l'ha dimenticata — cioè che il conto dice il falso. I movimenti sono la verità:
      // è il loro totale che si risponde, non quello memorizzato.
      const sommePerConto = await prisma.movimentoPrimaNota.groupBy({
        by: ['contoBancarioId', 'tipo'],
        where: { tenantId, contoBancarioId: { not: null } },
        _sum: { importoCentesimi: true },
      });

      const conSaldo = conti.map((conto) => {
        const movimenti = sommePerConto
          .filter((s) => s.contoBancarioId === conto.id)
          .map((s) => ({ tipo: s.tipo, importoCentesimi: s._sum.importoCentesimi ?? 0 }));
        const saldoCalcolato = saldoContoCentesimi(conto.saldoIniziale, movimenti);
        return { conto, saldoCalcolato, memorizzato: conto.saldoAttuale };
      });

      const divergenti = conSaldo.filter((c) => c.saldoCalcolato !== c.memorizzato);
      for (const d of divergenti) {
        try {
          await prisma.contoBancario.update({
            where: { id: d.conto.id },
            data: { saldoAttuale: d.saldoCalcolato },
          });
          await recordAudit({
            tenantId,
            userId: req.userId,
            ruolo: req.ruolo,
            azione: 'SALDO_CONTO_RICONCILIATO',
            entita: d.conto.nomeConto,
            dettagli:
              `Saldo del conto riportato ai movimenti: da €${(d.memorizzato / 100).toFixed(2)} ` +
              `a €${(d.saldoCalcolato / 100).toFixed(2)} (differenza di €${((d.saldoCalcolato - d.memorizzato) / 100).toFixed(2)})`,
            ipAddress: req.ip,
          });
        } catch {
          // La riparazione è manutenzione, la lettura è il servizio: se la copia non si aggiorna,
          // la pagina mostra comunque il saldo vero e il prossimo accesso ci riprova. Far fallire
          // la lettura per non essere riusciti ad aggiornare una copia nasconderebbe il numero
          // giusto, che è l'unica cosa che l'operatore è venuto a vedere.
        }
      }

      return reply.send(conSaldo.map((c) => ({ ...c.conto, saldoAttuale: c.saldoCalcolato })));
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura conti bancari' });
    }
  });

  server.post<{ Body: { nomeConto: string; banca: string; iban?: string; bicSwift?: string; saldoInizialeEur: number; isDefault?: boolean } }>(
    '/conti-bancari',
    async (req, reply) => {
      const tenantId = req.tenantId;
      const { nomeConto, banca, iban, bicSwift, saldoInizialeEur, isDefault } = req.body;
      const saldoCentesimi = Math.round((saldoInizialeEur || 0) * 100);

      try {
        const nuovoConto = await prisma.contoBancario.create({
          data: {
            tenantId,
            nomeConto,
            banca,
            iban,
            bicSwift,
            saldoIniziale: saldoCentesimi,
            saldoAttuale: saldoCentesimi,
            isDefault: isDefault || false,
          },
        });
        return reply.send(nuovoConto);
      } catch (err: any) {
        return reply.code(500).send({ errore: err?.message || 'Errore salvataggio conto bancario' });
      }
    },
  );

  // ─── REPORTISTICA DIREZIONALE ───────────────────────────────────────
  server.get<{ Params: { tipo: string }; Querystring: { anno?: string } }>('/reports/:tipo', async (req, reply) => {
    const tenantId = req.tenantId;
    const { tipo } = req.params;
    if (!REPORT_DISPONIBILI.includes(tipo as ChiaveReport)) {
      return reply.code(404).send({ errore: `Report "${tipo}" non disponibile. Disponibili: ${REPORT_DISPONIBILI.join(', ')}` });
    }
    const anno = req.query.anno ? Number(req.query.anno) : undefined;
    if (req.query.anno !== undefined && (!Number.isFinite(anno) || (anno as number) < 2000 || (anno as number) > 2100)) {
      return reply.code(400).send({ errore: 'Parametro anno non valido' });
    }
    try {
      const report = await costruisciReport(tenantId, tipo as ChiaveReport, anno);
      return reply.send(report);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del report' });
    }
  });

  server.get<{ Params: { tipo: string }; Querystring: { formato?: string; anno?: string } }>('/reports/:tipo/export', async (req, reply) => {
    const tenantId = req.tenantId;
    const { tipo } = req.params;
    if (!REPORT_DISPONIBILI.includes(tipo as ChiaveReport)) {
      return reply.code(404).send({ errore: `Report "${tipo}" non disponibile` });
    }
    const formato = (req.query.formato || 'pdf').toLowerCase();
    if (formato !== 'pdf' && formato !== 'xlsx') {
      return reply.code(400).send({ errore: 'Formato non valido: usare pdf o xlsx' });
    }
    const anno = req.query.anno ? Number(req.query.anno) : undefined;
    if (req.query.anno !== undefined && (!Number.isFinite(anno) || (anno as number) < 2000 || (anno as number) > 2100)) {
      return reply.code(400).send({ errore: 'Parametro anno non valido' });
    }
    try {
      const report = await costruisciReport(tenantId, tipo as ChiaveReport, anno);
      const suffissoAnno = anno ? `_${anno}` : '';
      if (formato === 'pdf') {
        const buffer = await generaPdfReport(report);
        reply.header('Content-Type', 'application/pdf');
        reply.header('Content-Disposition', `attachment; filename="${report.chiave}${suffissoAnno}.pdf"`);
        return reply.send(buffer);
      }
      const buffer = await generaExcelReport(report);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      reply.header('Content-Disposition', `attachment; filename="${report.chiave}${suffissoAnno}.xlsx"`);
      return reply.send(buffer);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del file' });
    }
  });
}
