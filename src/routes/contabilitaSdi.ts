// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotta del blocco «GENERATORE SDI XML CONFORME FATTURAPA 1.2». Il parametro
// `app` resta in firma per uniformità con gli altri moduli rotte, anche se
// questo blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { generaFatturaElettronicaXml } from '../services/sdiXmlGenerator.js';
import { costruisciDatiFatturaSdi } from '../services/mappaturaFatturaSdi.js';
import { campiAnagraficaMancanti, messaggioAnagraficaIncompleta } from '../domain/anagraficaStudio.js';
import { recordAudit } from '../util/serverHelpers.js';

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

      // §7 — il confine decide se il documento si può comporre: l'anagrafica dello studio è la
      // materia prima del blocco `CedentePrestatore`, e quando un campo mancava il generatore lo
      // riempiva con un valore inventato (P.IVA «00000000000», denominazione «Studio Advisory»,
      // regime «RF01»). Si rifiuta **prima**, nominando i campi — la stessa forma del rifiuto che
      // `statoIngressoWhatsapp` usa per il canale («non configurato — mancano …»). Elenco e
      // messaggio vivono in `src/domain/anagraficaStudio.ts`, gli stessi che la guida in-app mostra.
      const mancanti = campiAnagraficaMancanti(studio as unknown as Record<string, unknown> | null);
      if (mancanti.length) {
        return reply.code(409).send({ errore: messaggioAnagraficaIncompleta(mancanti), mancanti });
      }

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

  // ─── RIPRESENTAZIONE A SDI DOPO UNO SCARTO (W1 — scarto tecnico) ────
  // SdI consente di ritrasmettere il documento corretto entro 5 giorni dallo scarto. Qui non
  // c'è un provider collegato: si «riapre» la fattura scartata riportando statoSdi a `n_a`, così
  // non è più un vicolo cieco — l'operatore riscarica l'XML e lo ritrasmette dal portale AdE.
  // Per uno scarto di CONTENUTO va invece emessa una NC e riemessa la fattura corretta (l'atto
  // emesso è immutabile): quella strada usa la rotta nota-credito + una nuova fattura.
  server.post<{ Params: { id: string } }>('/invoices/:id/ripresenta-sdi', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
        select: { id: true, numero: true, statoSdi: true },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });
      if (fattura.statoSdi !== 'scartata') {
        return reply.code(409).send({ errore: 'La ripresentazione a SdI vale solo per una fattura scartata.' });
      }
      await prisma.fattura.update({ where: { id }, data: { statoSdi: 'n_a', esitoSdiDettagli: null } });
      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'SDI_RIPRESENTAZIONE',
        entita: `Fattura ${fattura.numero || id.slice(0, 8)}`,
        dettagli: 'Fattura riaperta per ritrasmissione a SdI dopo scarto tecnico (riscaricare l\'XML e ritrasmettere).',
        ipAddress: req.ip,
      });
      return reply.send({
        ok: true,
        message:
          'Fattura pronta per la ritrasmissione: scarica di nuovo l\'XML e trasmettilo tramite il portale «Fatture & Corrispettivi» o l\'intermediario.',
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore ripresentazione SdI' });
    }
  });
}
