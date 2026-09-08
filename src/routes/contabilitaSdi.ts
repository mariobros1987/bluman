// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotta del blocco «GENERATORE SDI XML CONFORME FATTURAPA 1.2». Il parametro
// `app` resta in firma per uniformità con gli altri moduli rotte, anche se
// questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { generaFatturaElettronicaXml } from '../services/sdiXmlGenerator.js';
import { costruisciDatiFatturaSdi } from '../services/mappaturaFatturaSdi.js';

export async function registraRotteContabilitaSdi(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── GENERATORE SDI XML CONFORME FATTURAPA 1.2 ────────────────────
  server.get<{ Params: { id: string } }>('/invoices/:id/sdi-xml', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
        include: {
          righe: true,
          cliente: true,
          progetto: { include: { cliente: true } },
          contoAccredito: true,
          fatturaOrigine: true,
        },
      });

      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const cliente = fattura.cliente || fattura.progetto?.cliente;

      if (!cliente) return reply.code(400).send({ errore: 'Cliente non associato alla fattura' });

      // La mappatura vive in src/services/mappaturaFatturaSdi.ts perché il fascicolo ZIP
      // per il commercialista deve produrre lo STESSO XML di questa rotta. Il riepilogo IVA
      // era cablato qui su un'unica riga al 22%: ora si raggruppa per (aliquota, natura)
      // dalle righe reali, quindi una parcella esente non dichiara più imposta al 22%.
      const xmlString = generaFatturaElettronicaXml(
        costruisciDatiFatturaSdi({
          fattura,
          righe: fattura.righe,
          cliente,
          studio,
          ibanAccredito: fattura.contoAccredito?.iban,
          fatturaOrigineNumero: fattura.fatturaOrigine?.numero,
          fatturaOrigineData: fattura.fatturaOrigine?.data,
        }),
      );

      reply.header('Content-Type', 'application/xml');
      reply.header('Content-Disposition', `attachment; filename="${fattura.numero || 'Fattura'}.xml"`);
      return reply.send(xmlString);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore generazione XML SDI' });
    }
  });
}
