// Modulo estratto da contabilita.ts (split meccanico, zero cambi di comportamento):
// rotte del blocco «GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER». Il parametro
// `app` resta in firma per uniformità con gli altri moduli rotte, anche se questo
// blocco non lo usa.

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { inviaEmail } from '../services/emailService.js';
import { generateInvoicePdfBuffer } from '../services/pdfService.js';
import { recordAudit } from '../util/serverHelpers.js';

export async function registraRotteContabilitaPdfEmail(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  server.get<{ Params: { id: string } }>('/invoices/:id/pdf', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          righe: true,
          cliente: true,
          progetto: { include: { cliente: true } },
          contoAccredito: true,
          scadenzeIncasso: true,
        },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const cliente = fattura.cliente || fattura.progetto?.cliente;
      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });

      const totaleCentesimi = fattura.totaleDocumentoCentesimi || fattura.righe.reduce((acc, r) => acc + r.importo, 0);

      const pdfBuffer = await generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString('it-IT'),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: cliente?.nome || 'Cliente',
        clientePiva: cliente?.piva || undefined,
        clienteCodiceFiscale: cliente?.codiceFiscale || undefined,
        clienteSede: cliente?.sedeLegale || undefined,
        clienteSdiCode: cliente?.sdiCode || undefined,
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantCodiceFiscale: studio?.codiceFiscale || studio?.piva || undefined,
        tenantSede: studio?.sedeLegale || undefined,
        tenantIban: fattura.contoAccredito?.iban || studio?.iban || undefined,
        righe: fattura.righe.map((r) => ({
          descrizione: r.descrizione,
          quantita: r.quantita,
          unitaMisura: r.unitaMisura,
          prezzoUnitarioCent: r.prezzoUnitarioCent,
          aliquotaIva: r.aliquotaIva,
          importo: r.totaleRigaCentesimi || r.importo,
        })),
        totaleImponibileEuro: (fattura.totaleImponibileCentesimi || 0) / 100,
        totaleCassaEuro: (fattura.totaleCassaCentesimi || 0) / 100,
        totaleIvaEuro: (fattura.totaleIvaCentesimi || 0) / 100,
        totaleRitenutaEuro: (fattura.totaleRitenutaCentesimi || 0) / 100,
        totaleBolloEuro: (fattura.totaleBolloCentesimi || 0) / 100,
        totaleEuro: totaleCentesimi / 100,
        nettoAPagareEuro: (fattura.nettoAPagareCentesimi || totaleCentesimi) / 100,
        condizionePagamento: fattura.condizionePagamento,
        scadenze: fattura.scadenzeIncasso.map((s) => ({
          numeroRata: s.numeroRata,
          importoEuro: s.importoCentesimi / 100,
          dataScadenza: s.dataScadenza.toLocaleDateString('it-IT'),
        })),
        note: fattura.note || undefined,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="Fattura_${fattura.numero || 'Bozza'}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore generazione PDF server-side' });
    }
  });

  server.post<{ Params: { id: string }; Body: { emailDestinatario?: string } }>('/invoices/:id/invia-email', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id: req.params.id, tenantId },
        include: {
          righe: true,
          cliente: true,
          progetto: { include: { cliente: true } },
          contoAccredito: true,
          scadenzeIncasso: true,
        },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const cliente = fattura.cliente || fattura.progetto?.cliente;
      const emailDestinatario = req.body?.emailDestinatario?.trim() || cliente?.email || '';
      if (!emailDestinatario) {
        return reply.code(400).send({
          errore: `Nessun indirizzo email per ${cliente?.nome || 'il cliente'}: indicane uno o compila l'anagrafica.`,
        });
      }

      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const totaleCentesimi = fattura.totaleDocumentoCentesimi || fattura.righe.reduce((acc, r) => acc + r.importo, 0);

      const pdfBuffer = await generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString('it-IT'),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: cliente?.nome || 'Cliente',
        clientePiva: cliente?.piva || undefined,
        clienteCodiceFiscale: cliente?.codiceFiscale || undefined,
        clienteSede: cliente?.sedeLegale || undefined,
        clienteSdiCode: cliente?.sdiCode || undefined,
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantCodiceFiscale: studio?.codiceFiscale || studio?.piva || undefined,
        tenantSede: studio?.sedeLegale || undefined,
        tenantIban: fattura.contoAccredito?.iban || studio?.iban || undefined,
        righe: fattura.righe.map((r) => ({
          descrizione: r.descrizione,
          quantita: r.quantita,
          unitaMisura: r.unitaMisura,
          prezzoUnitarioCent: r.prezzoUnitarioCent,
          aliquotaIva: r.aliquotaIva,
          importo: r.totaleRigaCentesimi || r.importo,
        })),
        totaleImponibileEuro: (fattura.totaleImponibileCentesimi || 0) / 100,
        totaleCassaEuro: (fattura.totaleCassaCentesimi || 0) / 100,
        totaleIvaEuro: (fattura.totaleIvaCentesimi || 0) / 100,
        totaleRitenutaEuro: (fattura.totaleRitenutaCentesimi || 0) / 100,
        totaleBolloEuro: (fattura.totaleBolloCentesimi || 0) / 100,
        totaleEuro: totaleCentesimi / 100,
        nettoAPagareEuro: (fattura.nettoAPagareCentesimi || totaleCentesimi) / 100,
        condizionePagamento: fattura.condizionePagamento,
        scadenze: fattura.scadenzeIncasso.map((s) => ({
          numeroRata: s.numeroRata,
          importoEuro: s.importoCentesimi / 100,
          dataScadenza: s.dataScadenza.toLocaleDateString('it-IT'),
        })),
        note: fattura.note || undefined,
      });

      const numeroDocumento = fattura.numero || `FT-${fattura.numeroProgressivoSerie}`;
      const tipoLeggibile = fattura.tipoDocumento === 'nota_credito' ? 'nota di credito' : 'fattura';
      const nomeStudio = studio?.ragioneSociale || 'Studio';

      const esitoInvio = await inviaEmail({
        to: emailDestinatario,
        subject: `${fattura.tipoDocumento === 'nota_credito' ? 'Nota di credito' : 'Fattura'} ${numeroDocumento} — ${nomeStudio}`,
        html: `
          <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
            <h2 style="font-size: 18px; color: #0f172a;">Gentile ${cliente?.nome},</h2>
            <p style="line-height: 1.6; color: #475569;">
              in allegato trova la ${tipoLeggibile} <strong>${numeroDocumento}</strong> del
              ${(fattura.data || new Date()).toLocaleDateString('it-IT')}, per un totale di
              <strong>€ ${(totaleCentesimi / 100).toFixed(2)}</strong>.
            </p>
            <p style="line-height: 1.6; color: #475569;">
              Le coordinate bancarie e il piano rate sono indicati nel documento allegato.
            </p>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">${nomeStudio}</p>
          </div>
        `,
        smtp: studio?.smtpHost && studio?.smtpUser && studio?.smtpPass ? {
          host: studio.smtpHost,
          servername: studio.smtpServername || undefined,
          port: studio.smtpPort || 465,
          secure: studio.smtpSecure ?? true,
          user: studio.smtpUser,
          pass: studio.smtpPass,
        } : undefined,
        fromEmail: studio?.smtpFromEmail || studio?.smtpUser || undefined,
        fromName: studio?.smtpFromName || nomeStudio,
        allegati: [{
          filename: `${numeroDocumento}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
        etichetta: 'fattura',
      });

      if (!esitoInvio.ok) {
        return reply.code(502).send({
          errore: `La ${tipoLeggibile} ${numeroDocumento} non è stata inviata a ${emailDestinatario}: ${esitoInvio.errore}`,
        });
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_INVIATA_EMAIL',
        entita: numeroDocumento,
        dettagli: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} inviata a ${emailDestinatario} con il PDF in allegato (${esitoInvio.via})`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, message: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} ${numeroDocumento} inviata a ${emailDestinatario}` });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'invio dell\'email' });
    }
  });
}
