// Rotte Solleciti di Pagamento, Calcolo Interessi di Mora ex D.Lgs. 231/2002 e Diffide.

import type { FastifyInstance } from 'fastify';
import { prisma } from '../util/prismaClient.js';
import { recordAudit } from '../util/serverHelpers.js';
import { inviaEmail } from '../services/emailService.js';
import { inviaTestoWhatsapp } from '../services/whatsappService.js';
import {
  calcolaInteressiMora,
  generaTestoSollecito,
  type LivelloSollecito,
} from '../services/sollecitiEngine.js';
import { InviaSollecitoSchema } from '../schemas/solleciti.schema.js';

export async function registraRotteSolleciti(server: FastifyInstance): Promise<void> {
  // GET /invoices/solleciti/insoluti — Lista partite aperte scadute con calcolo mora live
  server.get('/invoices/solleciti/insoluti', async (req, reply) => {
    const tenantId = req.tenantId as string;
    try {
      const oggi = new Date();

      // Cerchiamo le scadenze non ancora saldate
      const scadenze = await prisma.scadenzaIncasso.findMany({
        where: {
          tenantId,
          stato: { in: ['in_attesa', 'parziale', 'scaduto'] },
          fattura: {
            stato: { not: 'bozza' },
          },
        },
        include: {
          fattura: {
            include: { cliente: true, contoAccredito: true },
          },
          registrazioniRegistrate: true,
        },
        orderBy: { dataScadenza: 'asc' },
      });

      const risultato = scadenze.map((s) => {
        const importoIncassato = s.registrazioniRegistrate.reduce(
          (acc, r) => acc + r.importoIncassatoCentesimi,
          0,
        );
        const capitaleResiduo = Math.max(0, s.importoCentesimi - importoIncassato);
        const mora = calcolaInteressiMora(capitaleResiduo, s.dataScadenza, oggi);

        return {
          id: s.id,
          fatturaId: s.fatturaId,
          numeroFattura: s.fattura.numero,
          numeroRata: s.numeroRata,
          clienteId: s.fattura.clienteId,
          clienteNome: s.fattura.cliente.nome,
          clienteEmail: s.fattura.cliente.email,
          clientePiva: s.fattura.cliente.piva,
          dataEmissione: s.fattura.data,
          dataScadenza: s.dataScadenza,
          importoRataCent: s.importoCentesimi,
          importoIncassatoCent: importoIncassato,
          capitaleResiduoCent: capitaleResiduo,
          stato: s.stato,
          isScaduta: s.dataScadenza < oggi && capitaleResiduo > 0,
          calcoloMora: mora,
        };
      });

      return reply.send(risultato);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore recupero scadenze insolute' });
    }
  });

  // POST /invoices/scadenze/:id/anteprima-sollecito — Genera bozza testo sollecito con calcolo mora
  server.post<{ Params: { id: string }; Body: { livello?: LivelloSollecito; saggioInteresse?: number } }>(
    '/invoices/scadenze/:id/anteprima-sollecito',
    async (req, reply) => {
      const tenantId = req.tenantId as string;
      const { livello = '1_avviso_bonario', saggioInteresse } = req.body || {};

      try {
        const scadenza = await prisma.scadenzaIncasso.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            fattura: {
              include: { cliente: true, contoAccredito: true },
            },
            registrazioniRegistrate: true,
          },
        });

        if (!scadenza) {
          return reply.code(404).send({ errore: 'Scadenza non trovata' });
        }

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

        const importoIncassato = scadenza.registrazioniRegistrate.reduce(
          (acc, r) => acc + r.importoIncassatoCentesimi,
          0,
        );
        const capitaleResiduo = Math.max(0, scadenza.importoCentesimi - importoIncassato);

        const sollecito = generaTestoSollecito({
          livello,
          clienteNome: scadenza.fattura.cliente.nome,
          clienteEmail: scadenza.fattura.cliente.email,
          numeroFattura: scadenza.fattura.numero || `FT-${scadenza.fatturaId.slice(0, 8)}`,
          dataEmissione: scadenza.fattura.data || new Date(),
          dataScadenza: scadenza.dataScadenza,
          numeroRata: scadenza.numeroRata,
          importoCapitaleCent: capitaleResiduo,
          ibanStudio: scadenza.fattura.contoAccredito?.iban || null,
          studioNome: tenant?.ragioneSociale || 'Studio Professionale BluMan',
          saggioInteresse,
        });

        return reply.send({
          scadenzaId: scadenza.id,
          clienteEmail: scadenza.fattura.cliente.email,
          sollecito,
        });
      } catch (err: any) {
        return reply.code(500).send({ errore: err?.message || 'Errore generazione anteprima sollecito' });
      }
    },
  );

  // POST /invoices/scadenze/:id/invia-sollecito — Invia formalmente sollecito/diffida via email
  server.post<{ Params: { id: string }; Body: any }>(
    '/invoices/scadenze/:id/invia-sollecito',
    async (req, reply) => {
      const tenantId = req.tenantId as string;
      const parseResult = InviaSollecitoSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.code(400).send({ errore: parseResult.error.issues[0]?.message || 'Dati sollecito non validi' });
      }

      const {
        livello,
        canale = 'email',
        emailDestinatario,
        telefonoDestinatario,
        oggettoPersonalizzato,
        testoPersonalizzato,
        saggioInteresse,
      } = parseResult.data;

      try {
        const scadenza = await prisma.scadenzaIncasso.findFirst({
          where: { id: req.params.id, tenantId },
          include: {
            fattura: {
              include: { cliente: true, contoAccredito: true },
            },
            registrazioniRegistrate: true,
          },
        });

        if (!scadenza) {
          return reply.code(404).send({ errore: 'Scadenza non trovata' });
        }

        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        const destinatario = emailDestinatario || scadenza.fattura.cliente.email;

        if ((canale === 'email' || canale === 'entrambi') && !destinatario) {
          return reply.code(400).send({
            errore: "Nessun indirizzo email specificato né presente nell'anagrafica del cliente.",
          });
        }

        const importoIncassato = scadenza.registrazioniRegistrate.reduce(
          (acc, r) => acc + r.importoIncassatoCentesimi,
          0,
        );
        const capitaleResiduo = Math.max(0, scadenza.importoCentesimi - importoIncassato);

        const sollecitoDefault = generaTestoSollecito({
          livello,
          clienteNome: scadenza.fattura.cliente.nome,
          clienteEmail: destinatario,
          numeroFattura: scadenza.fattura.numero || `FT-${scadenza.fatturaId.slice(0, 8)}`,
          dataEmissione: scadenza.fattura.data || new Date(),
          dataScadenza: scadenza.dataScadenza,
          numeroRata: scadenza.numeroRata,
          importoCapitaleCent: capitaleResiduo,
          ibanStudio: scadenza.fattura.contoAccredito?.iban || null,
          studioNome: tenant?.ragioneSociale || 'Studio Professionale BluMan',
          saggioInteresse,
        });

        const oggettoFinale = oggettoPersonalizzato || sollecitoDefault.oggettoEmail;
        const testoFinale = testoPersonalizzato || sollecitoDefault.corpoTesto;
        const canaliInviati: string[] = [];

        // 1. Invio Email se richiesto
        if (canale === 'email' || canale === 'entrambi') {
          if (!destinatario) {
            return reply.code(400).send({
              errore: "Nessun indirizzo email specificato né presente nell'anagrafica del cliente.",
            });
          }
          await inviaEmail({
            to: destinatario,
            subject: oggettoFinale,
            html: `<pre style="font-family: sans-serif; white-space: pre-wrap; font-size: 14px; line-height: 1.5;">${testoFinale}</pre>`,
          });
          canaliInviati.push(`Email a ${destinatario}`);
        }

        // 2. Invio WhatsApp se richiesto
        if (canale === 'whatsapp' || canale === 'entrambi') {
          const referenti = scadenza.fattura.cliente.referentiJson as any;
          const telefono = telefonoDestinatario ||
            (Array.isArray(referenti) ? referenti[0]?.telefono || referenti[0]?.whatsapp : referenti?.telefono || referenti?.whatsapp);

          if (!telefono) {
            return reply.code(400).send({
              errore: "Nessun numero di telefono/WhatsApp specificato né presente nell'anagrafica del cliente.",
            });
          }

          const waCred = {
            waPhoneId: tenant?.waPhoneId || null,
            waAccessToken: tenant?.waAccessToken || null,
          };

          const esitoWa = await inviaTestoWhatsapp(waCred, telefono, testoFinale);
          if (!esitoWa.ok) {
            console.warn(`[SOLLECITI WA WARN] Invio WhatsApp non riuscito: ${esitoWa.errore}`);
            // Se il canale era solo WhatsApp, restituisci errore parlante
            if (canale === 'whatsapp') {
              return reply.code(400).send({ errore: esitoWa.errore || 'Errore invio WhatsApp' });
            }
          } else {
            canaliInviati.push(`WhatsApp a ${telefono}`);
          }
        }

        // Aggiorniamo stato scadenza se non ancora marcata come scaduta
        await prisma.scadenzaIncasso.update({
          where: { id: scadenza.id },
          data: { stato: 'scaduto' },
        });

        const canaliStr = canaliInviati.join(' e ') || 'Canale specificato';

        await recordAudit({
          tenantId,
          userId: req.userId,
          ruolo: req.ruolo,
          azione: 'SOLLECITO_PAGAMENTO_INVIATO',
          entita: `SOLLECITO-FT-${scadenza.fattura.numero}-RATA-${scadenza.numeroRata}`,
          dettagli: `Inviato sollecito (${livello}) via ${canaliStr} per rata n. ${scadenza.numeroRata} di €${(capitaleResiduo / 100).toFixed(2)} (totale con mora: €${(sollecitoDefault.calcoloMora.totaleDovutoCent / 100).toFixed(2)})`,
          ipAddress: req.ip,
        });

        return reply.send({
          ok: true,
          messaggio: `Sollecito inviato con successo via ${canaliStr}`,
          calcoloMora: sollecitoDefault.calcoloMora,
        });
      } catch (err: any) {
        return reply.code(500).send({ errore: err?.message || 'Errore invio sollecito' });
      }
    },
  );
}
