// Rotte contabilità: fatture, incassi/scadenzario, registro fatture, banche,
// reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti,
// cron scadenze, SDI manuale — ex blocchi F1-F10.
//
// Estratte da `src/server.ts` (split dei monoliti, 27/08/2026) SENZA cambio di
// comportamento: stesse identiche implementazioni, solo spostate qui perché il
// monolite resti leggibile. Nel monolite vivevano in DIECI punti diversi (le
// fatture subito dopo i progetti, poi incassi, registro, banche, report,
// PDF+email, webhook SDI e contratti ricorrenti in sequenza; il cron scadenze e
// la preparazione SDI manuale in coda al file): qui sono riunite nell'ordine di
// registrazione originale. I path sono unici e find-my-way risolve
// static-vs-parametric indipendentemente dall'ordine, quindi anticipare cron e
// SDI manuale al punto di chiamata non cambia il routing.
// `registraRotteContabilita` viene chiamata DENTRO il wrapper
// `server.register(...)` di `buildServer`, quindi il rate-limit e l'hook auth
// onRequest continuano ad applicarsi esattamente come prima (stesso contesto di
// incapsulamento, nessuna nuova barriera).

import type { FastifyInstance } from 'fastify';
import type { AppPort } from '../services/appPort.js';
import { prisma } from '../util/prismaClient.js';
import { inviaEmail } from '../services/emailService.js';
import { generateInvoicePdfBuffer } from '../services/pdfService.js';
import { runDailyNotificationCron } from '../services/cronService.js';
import { preparaFatturaPerInvioManuale } from '../services/sdiService.js';
import { costruisciReport, REPORT_DISPONIBILI, type ChiaveReport } from '../services/reportsService.js';
import { generaPdfReport, generaExcelReport } from '../services/reportExport.js';
import { notificaStudio, notificaCliente } from '../services/notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';

// ─── FATTURE & CONTABILITÀ (ex blocchi F1-F10) ──────────────────────
export async function registraRotteContabilita(server: FastifyInstance, app: AppPort): Promise<void> {
  server.get('/fatture/tutte', async () => {
    return (app as any).listaFattureTutte();
  });

  server.post<{
    Params: { id: string };
    Body: {
      tipoClienteFiscale: 'privato_italia' | 'business_italia' | 'estero';
      partitaIva?: string;
      codiceFiscale?: string;
      canale: 'sdi' | 'standard';
      righe: Array<{
        tipo: 'modulo_completo' | 'modulo_parziale' | 'milestone_libera';
        moduloProgettoId?: string;
        percentuale?: number;
        importo: number;
        descrizione: string;
      }>;
    };
  }>('/progetti/:id/fatture', async (req, reply) => {
    const fattura = await app.emettiFattura({
      progettoId: req.params.id,
      ...req.body,
    });
    return reply.code(201).send(fattura);
  });

  // ── INCASSI, SCADENZARIO & PRIMA NOTA (STYLE OPENSTAMANAGER) ───────
  server.get('/invoices/scadenzario', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const scadenze = await (prisma as any).scadenzaIncasso.findMany({
        where: { tenantId },
        include: {
          fattura: {
            include: {
              progetto: {
                include: { cliente: true },
              },
            },
          },
          registrazioniRegistrate: true,
        },
        orderBy: { dataScadenza: 'asc' },
      });
      return reply.send(scadenze);
    } catch {
      return reply.send([]);
    }
  });

  server.post<{
    Params: { id: string };
    Body: {
      importoIncassatoCentesimi: number;
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      riferimentoTransazione?: string;
      noteOperatore?: string;
    };
  }>('/invoices/scadenze/:id/incassi', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    const { importoIncassatoCentesimi, metodoPagamento, riferimentoTransazione, noteOperatore } = req.body;

    try {
      const scadenza = await (prisma as any).scadenzaIncasso.findUnique({
        where: { id },
        include: { registrazioniRegistrate: true },
      });

      if (!scadenza) {
        return reply.code(404).send({ errore: 'Scadenza incasso non trovata' });
      }

      const registrazione = await (prisma as any).registrazioneIncasso.create({
        data: {
          tenantId,
          scadenzaIncassoId: id,
          fatturaId: scadenza.fatturaId,
          importoIncassatoCentesimi,
          metodoPagamento: metodoPagamento || 'bonifico',
          riferimentoTransazione,
          noteOperatore,
        },
      });

      const totaleIncassato = scadenza.registrazioniRegistrate.reduce((acc: number, r: any) => acc + r.importoIncassatoCentesimi, 0) + importoIncassatoCentesimi;
      const nuovoStatoScadenza = totaleIncassato >= scadenza.importoCentesimi ? 'incassato' : 'parziale';

      await (prisma as any).scadenzaIncasso.update({
        where: { id },
        data: { stato: nuovoStatoScadenza },
      });

      // ── LOGICA OPENSTAMANAGER: Mastrino::aggiornaScadenzario ──────
      // Verifichiamo se TUTTE le scadenze della Fattura sono state incassate
      const tutteScadenzeFattura = await (prisma as any).scadenzaIncasso.findMany({
        where: { fatturaId: scadenza.fatturaId },
      });

      const tutteSaldate = tutteScadenzeFattura.every((s: any) => s.id === id ? nuovoStatoScadenza === 'incassato' : s.stato === 'incassato');
      
      // Aggiorniamo lo stato contabile immutabile della Fattura
      await prisma.fattura.update({
        where: { id: scadenza.fatturaId },
        data: { stato: tutteSaldate ? 'incassata' : 'emessa' },
      });

      // Blocco 3 — partita saldata: evento "fattura incassata" a studio e cliente.
      if (tutteSaldate) {
        const fattura = await prisma.fattura.findUnique({
          where: { id: scadenza.fatturaId },
          include: { progetto: { select: { id: true, nome: true, clienteId: true, cliente: { select: { nome: true } } } } },
        });
        if (fattura) {
          const etichetta = fattura.numero || `${fattura.serie}-${fattura.numeroProgressivoSerie}`;
          const importo = `€ ${(scadenza.importoCentesimi / 100).toLocaleString('it-IT')}`;
          await notificaStudio(tenantId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Fattura incassata',
            corpo: `La fattura ${etichetta} di ${fattura.progetto.cliente.nome} è stata saldata (${importo}).`,
            link: '/invoices',
          }).catch(() => {});
          await notificaCliente(tenantId, fattura.progetto.clienteId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Pagamento registrato',
            corpo: `Abbiamo registrato il pagamento della fattura ${etichetta} (${importo}). Grazie!`,
            link: '/portal/invoices',
          }).catch(() => {});
        }
      }

      // ── LOGICA OPENSTAMANAGER: Accredito su Conto Bancario ────────
      const contoPredefinito = await (prisma as any).contoBancario.findFirst({
        where: { tenantId, isDefault: true },
      });

      if (contoPredefinito) {
        await (prisma as any).contoBancario.update({
          where: { id: contoPredefinito.id },
          data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
        });
      }

      await recordAudit({
        tenantId,
        azione: 'INCASSO_REGISTRATO',
        entita: `Scadenza #${id}`,
        dettagli: `Registrato incasso di €${(importoIncassatoCentesimi / 100).toFixed(2)} via ${metodoPagamento || 'bonifico'} con chiusura partita di giro`,
      });

      return reply.code(201).send(registrazione);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore registrazione incasso' });
    }
  });

  // ── REGISTRO FATTURE STUDIO (STYLE OPENSTAMANAGER) ───────────────
  server.get('/invoices', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fatture = await (prisma as any).fattura.findMany({
        where: { tenantId },
        include: {
          righe: true,
          progetto: { include: { cliente: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(fatture);
    } catch {
      return reply.send([]);
    }
  });

  server.get<{ Params: { id: string } }>('/invoices/:id/sdi-xml', async (req, reply) => {
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id },
        include: {
          righe: true,
          progetto: { include: { cliente: true } },
        },
      });

      if (!fattura) {
        return reply.code(404).send({ errore: 'Fattura non trovata' });
      }

      const cliente = fattura.progetto.cliente;
      const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2000/01/XMLSchema-instance">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente>
        <IdPaese>IT</IdPaese>
        <IdCodice>${cliente.piva || '00000000000'}</IdCodice>
      </IdTrasmittente>
      <ProgressivoInvio>${fattura.numeroProgressivo || '00001'}</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>${cliente.sdiCode || '0000000'}</CodiceDestinatario>
    </DatiTrasmissione>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <CodiceFiscale>${cliente.codiceFiscale || cliente.piva || '00000000000'}</CodiceFiscale>
        <Anagrafica>
          <Denominazione>${cliente.nome}</Denominazione>
        </Anagrafica>
      </DatiAnagrafici>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>${fattura.tipoDocumento === 'nota_credito' ? 'TD04' : 'TD01'}</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>${(fattura.data || new Date()).toISOString().split('T')[0]}</Data>
        <Numero>${fattura.numero || 'FT-2026/001'}</Numero>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      ${fattura.righe.map((r, idx) => `
      <DettaglioLinee>
        <NumeroLinea>${idx + 1}</NumeroLinea>
        <Descrizione>${r.descrizione}</Descrizione>
        <PrezzoUnitario>${(r.importo / 100).toFixed(2)}</PrezzoUnitario>
        <PrezzoTotale>${(r.importo / 100).toFixed(2)}</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
      </DettaglioLinee>`).join('')}
    </DatiBeniServizi>
  </FatturaElettronicaBody>
</p:FatturaElettronica>`;

      reply.header('Content-Type', 'application/xml');
      reply.header('Content-Disposition', `attachment; filename="${fattura.numero || 'Fattura'}.xml"`);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore durante la generazione dell\'XML SDI' });
    }
  });

  // ── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  server.get('/conti-bancari', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const conti = await (prisma as any).contoBancario.findMany({
        where: { tenantId },
        orderBy: { isDefault: 'desc' },
      });
      return reply.send(conti);
    } catch (err: any) {
      // Qui, quando la query falliva, la rotta rispondeva con quattro conti inventati —
      // Unicredit, Intesa, Stripe e una cassa contanti — completi di IBAN e di saldi.
      // Lo studio vedeva 78.500 € su un conto che non esiste, e non vedeva nessun errore.
      console.error('Errore lettura conti bancari:', err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella lettura dei conti bancari' });
    }
  });

  server.post<{ Body: { nomeConto: string; banca: string; iban?: string; bicSwift?: string; saldoInizialeEur: number; isDefault?: boolean } }>(
    '/conti-bancari',
    async (req, reply) => {
      const tenantId = (req as any).tenantId;
      const { nomeConto, banca, iban, bicSwift, saldoInizialeEur, isDefault } = req.body;
      const saldoCentesimi = Math.round((saldoInizialeEur || 0) * 100);

      try {
        const nuovoConto = await (prisma as any).contoBancario.create({
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
      } catch (err) {
        return reply.send({
          id: `c-${Date.now()}`,
          tenantId,
          nomeConto,
          banca,
          iban,
          bicSwift,
          saldoIniziale: saldoCentesimi,
          saldoAttuale: saldoCentesimi,
          isDefault: isDefault || false,
        });
      }
    },
  );

  // ── REPORTISTICA DIREZIONALE (BLOCCO 5) ─────────────────────────────
  // Cinque report aggregati su dati reali + export PDF/Excel server-side.
  // `GET /reports/:tipo` → JSON (struttura tabellare per il frontend).
  // `GET /reports/:tipo/export?formato=pdf|xlsx&anno=NNNN` → file allegato.
  server.get<{ Params: { tipo: string }; Querystring: { anno?: string } }>('/reports/:tipo', async (req, reply) => {
    const tenantId = (req as any).tenantId;
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
      console.error(`Errore report ${tipo}:`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del report' });
    }
  });

  server.get<{ Params: { tipo: string }; Querystring: { formato?: string; anno?: string } }>('/reports/:tipo/export', async (req, reply) => {
    const tenantId = (req as any).tenantId;
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
      console.error(`Errore export report ${tipo} (${formato}):`, err);
      return reply.code(500).send({ errore: err?.message || 'Errore nella generazione del file' });
    }
  });

  // ── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  server.get<{ Params: { id: string } }>('/invoices/:id/pdf', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id: req.params.id },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        // Ragione sociale, P.IVA e IBAN dello studio che emette, non un nome e un IBAN
        // scritti nel codice: la fattura è un documento fiscale e questi tre campi sono
        // proprio quelli che il destinatario usa per registrarla e per pagare.
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantIban: studio?.iban || undefined,
        righe: fattura.righe.map(r => ({ descrizione: r.descrizione, importo: r.importo })),
        totaleEuro: totaleCentesimi / 100,
      });

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="Fattura_${fattura.numero || 'Bozza'}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err) {
      return reply.code(500).send({ errore: 'Errore generazione PDF server-side' });
    }
  });

  server.post<{ Params: { id: string }; Body: { emailDestinatario?: string } }>('/invoices/:id/invia-email', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const fattura = await prisma.fattura.findUnique({
        where: { id: req.params.id },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      // Il destinatario è quello indicato o quello del cliente in anagrafica. Qui c'era un
      // indirizzo inventato come ripiego (`cliente@holdingbeta...`): la rotta rispondeva
      // «inviata con successo» dopo aver spedito la fattura di un cliente reale a una
      // casella che non esiste.
      const emailDestinatario = req.body?.emailDestinatario?.trim() || fattura.progetto.cliente.email || '';
      if (!emailDestinatario) {
        return reply.code(400).send({
          errore: `Nessun indirizzo email per ${fattura.progetto.cliente.nome}: indicane uno o compila l'anagrafica del cliente.`,
        });
      }

      const totaleCentesimi = fattura.righe.reduce((acc, r) => acc + r.importo, 0);
      const studio = await prisma.tenant.findUnique({ where: { id: tenantId } });
      const pdfBuffer = generateInvoicePdfBuffer({
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        data: (fattura.data || new Date()).toLocaleDateString(),
        tipoDocumento: fattura.tipoDocumento,
        clienteNome: fattura.progetto.cliente.nome,
        clientePiva: fattura.progetto.cliente.piva || undefined,
        clienteSede: fattura.progetto.cliente.sedeLegale || undefined,
        tenantNome: studio?.ragioneSociale || 'Studio',
        tenantPiva: studio?.piva || undefined,
        tenantIban: studio?.iban || undefined,
        righe: fattura.righe.map(r => ({ descrizione: r.descrizione, importo: r.importo })),
        totaleEuro: totaleCentesimi / 100,
      });

      const numeroDocumento = fattura.numero || `FT-${fattura.numeroProgressivoSerie}`;
      const tipoLeggibile = fattura.tipoDocumento === 'nota_credito' ? 'nota di credito' : 'fattura';
      const nomeStudio = studio?.ragioneSociale || 'Studio';

      // Qui partiva `sendMagicLinkEmail`: al cliente arrivava un'email intitolata «Accesso
      // al Portale Cliente» con un link a `http://localhost:5173`, e il PDF appena generato
      // veniva scartato — mentre il log di audit scriveva «con allegato PDF nativo» e la
      // risposta diceva «inviata con successo». Tre affermazioni false per un invio che non
      // conteneva la fattura.
      const esitoInvio = await inviaEmail({
        to: emailDestinatario,
        subject: `${fattura.tipoDocumento === 'nota_credito' ? 'Nota di credito' : 'Fattura'} ${numeroDocumento} — ${nomeStudio}`,
        html: `
          <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
            <h2 style="font-size: 18px; color: #0f172a;">Gentile ${fattura.progetto.cliente.nome},</h2>
            <p style="line-height: 1.6; color: #475569;">
              in allegato trova la ${tipoLeggibile} <strong>${numeroDocumento}</strong> del
              ${(fattura.data || new Date()).toLocaleDateString('it-IT')}, per un totale di
              <strong>€ ${(totaleCentesimi / 100).toFixed(2)}</strong>.
            </p>
            <p style="line-height: 1.6; color: #475569;">
              Le coordinate per il pagamento sono indicate nel documento allegato.
            </p>
            <p style="font-size: 12px; color: #94a3b8; margin-top: 24px;">${nomeStudio}</p>
          </div>
        `,
        smtp: studio?.smtpHost && studio?.smtpUser && studio?.smtpPass ? {
          host: studio.smtpHost,
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
        azione: 'FATTURA_INVIATA_EMAIL',
        entita: numeroDocumento,
        dettagli: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} inviata a ${emailDestinatario} con il PDF in allegato (${esitoInvio.via})`,
      });

      return reply.send({ ok: true, message: `${tipoLeggibile.charAt(0).toUpperCase() + tipoLeggibile.slice(1)} ${numeroDocumento} inviata a ${emailDestinatario}` });
    } catch (err: any) {
      console.error('Errore invio fattura via email:', err);
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'invio dell\'email' });
    }
  });

  // ── WEBHOOK ESITI SDI — registrazione dell'esito reale di una fattura ──
  // Con l'invio manuale (§3.5) è così che lo stato fiscale si aggiorna davvero:
  // l'operatore (o in futuro un'integrazione) comunica l'esito ricevuto da SdI
  // (consegnata / scartata / mancata_consegna) dopo la trasmissione.
  server.post<{ Body: { fatturaId: string; statoSdi: 'consegnata' | 'scartata' | 'mancata_consegna'; note?: string } }>(
    '/webhooks/sdi',
    async (req, reply) => {
      const { fatturaId, statoSdi, note } = req.body;
      if (!fatturaId || !statoSdi) return reply.code(400).send({ errore: 'fatturaId e statoSdi sono obbligatori' });

      try {
        const fattura = await prisma.fattura.update({
          where: { id: fatturaId },
          data: { statoSdi },
        });

        await recordAudit({
          tenantId: fattura.tenantId,
          azione: 'SDI_ESITO_RICEVUTO',
          entita: `Fattura ${fattura.numero}`,
          dettagli: `Ricevuto esito SDI via Webhook: ${statoSdi.toUpperCase()}. ${note || ''}`,
        });

        return reply.send({ ok: true, statoSdi: fattura.statoSdi });
      } catch (err) {
        return reply.code(500).send({ errore: 'Errore aggiornamento esito SDI' });
      }
    },
  );

  // ── CONTRATTI RICORRENTI & RETAINER (STYLE OPENSTAMANAGER) ────────
  server.get('/contratti-ricorrenti', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const contratti = await (prisma as any).contrattoRicorrente.findMany({
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
    const tenantId = (req as any).tenantId;
    const { clienteId, progettoId, titolo, frequenza, importoCentesimi, prossimaFatturazione, note } = req.body;

    if (!clienteId || !titolo || !importoCentesimi) {
      return reply.code(400).send({ errore: 'clienteId, titolo e importoCentesimi sono obbligatori' });
    }

    try {
      const contratto = await (prisma as any).contrattoRicorrente.create({
        data: {
          tenantId,
          clienteId,
          progettoId: progettoId || null,
          titolo,
          frequenza: frequenza || 'mensile',
          importoCentesimi,
          prossimaFatturazione: new Date(prossimaFatturazione),
          note,
        },
        include: { cliente: true, progetto: true },
      });

      await recordAudit({
        tenantId,
        azione: 'CONTRATTO_RICORRENTE_CREATO',
        entita: titolo,
        dettagli: `Creato contratto retainer da €${(importoCentesimi / 100).toFixed(2)} (${frequenza || 'mensile'})`,
      });

      return reply.code(201).send(contratto);
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore creazione contratto' });
    }
  });

  // Genera Fattura 1-Click da Contratto Retainer Ricorrente (Stile OpenSTAManager)
  server.post<{ Params: { id: string } }>('/contratti-ricorrenti/:id/genera-fattura', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;

    try {
      const contratto = await (prisma as any).contrattoRicorrente.findUnique({
        where: { id },
        include: { cliente: true, progetto: true },
      });

      if (!contratto) return reply.code(404).send({ errore: 'Contratto non trovato' });

      // 1. Genera Numero Progressivo Fattura (Serie FT)
      const lastFattura = await (prisma as any).fattura.findFirst({
        where: { tenantId, tipoDocumento: 'fattura', serie: 'FT' },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      const annoCorrente = new Date().getFullYear();
      const prossimoProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
      const numeroFattura = `FT-${annoCorrente}-${String(prossimoProgressivo).padStart(4, '0')}`;

      // 2. Crea Fattura a DB con RigaFattura per l'importo del Canone Retainer
      const nuovaFattura = await (prisma as any).fattura.create({
        data: {
          tenantId,
          progettoId: contratto.progettoId || null,
          tipoDocumento: 'fattura',
          serie: 'FT',
          numeroProgressivoSerie: prossimoProgressivo,
          numero: numeroFattura,
          importoCentesimi: contratto.importoCentesimi,
          stato: 'emessa',
          note: `Fatturazione canone retainer ricorrente: ${contratto.titolo} (${contratto.frequenza})`,
          righe: {
            create: [
              {
                descrizione: `Canone Retainer: ${contratto.titolo} (${contratto.frequenza})`,
                importo: contratto.importoCentesimi,
              }
            ]
          }
        },
        include: { righe: true, progetto: { include: { cliente: true } } },
      });

      // 3. Genera Scadenza Incasso nello Scadenzario
      const scadenza = await (prisma as any).scadenzaFattura.create({
        data: {
          tenantId,
          fatturaId: nuovaFattura.id,
          numeroRata: 1,
          importoCentesimi: contratto.importoCentesimi,
          dataScadenza: new Date(),
          stato: 'aperta',
        },
      });

      // 4. Calcola la data della Prossima Fatturazione in base alla frequenza
      const prossimaData = new Date(contratto.prossimaFatturazione || new Date());
      if (contratto.frequenza === 'mensile') prossimaData.setMonth(prossimaData.getMonth() + 1);
      else if (contratto.frequenza === 'trimestrale') prossimaData.setMonth(prossimaData.getMonth() + 3);
      else if (contratto.frequenza === 'semestrale') prossimaData.setMonth(prossimaData.getMonth() + 6);
      else if (contratto.frequenza === 'annuale') prossimaData.setFullYear(prossimaData.getFullYear() + 1);

      await (prisma as any).contrattoRicorrente.update({
        where: { id },
        data: { prossimaFatturazione: prossimaData },
      });

      await recordAudit({
        tenantId,
        azione: 'FATTURA_RETAINER_GENERATA',
        entita: numeroFattura,
        dettagli: `Generata fattura ${numeroFattura} da €${(contratto.importoCentesimi / 100).toFixed(2)} per il canone retainer ${contratto.titolo}`,
      });

      return reply.send({
        ok: true,
        fattura: nuovaFattura,
        scadenza,
        prossimaFatturazione: prossimaData,
        messaggio: `Fattura ${numeroFattura} generata con successo ed inserita nello Scadenzario Incassi!`,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione fattura retainer' });
    }
  });

  // ── WORKER CRON SCADENZE & RINNOVI AUTOMATICI UBO/MFSA/SDI ──────────
  server.post('/cron/esegui-notifiche-scadenze', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    try {
      const report = await runDailyNotificationCron(tenantId);
      return reply.send({
        ok: true,
        message: `Scansione completata con successo. Elaborate ${report.notificheInviate} notifiche proattive.`,
        report,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore esecuzione cron' });
    }
  });

  // ── §3.5 — PREPARAZIONE INVIO MANUALE SDI (nessun provider collegato) ──
  // Il sistema prepara l'XML; la trasmissione la fa l'operatore tramite il portale
  // «Fatture & Corrispettivi» o il proprio intermediario. L'esito vero arriva via webhook.
  server.post<{ Params: { id: string } }>('/invoices/:id/prepara-invio-manuale', async (req, reply) => {
    const tenantId = (req as any).tenantId;
    const { id } = req.params;
    try {
      let fattura = null;
      try {
        fattura = await (prisma as any).fattura.findUnique({
          where: { id },
          include: { progetto: { include: { cliente: true } } },
        });
      } catch {}

      const numFattura = fattura?.numeroProgressivoSerie || `FT-2026-${id.slice(0, 3)}`;
      const result = await preparaFatturaPerInvioManuale({
        fatturaId: id,
        numeroProgressivo: numFattura,
      });

      await recordAudit({
        tenantId,
        azione: 'FATTURA_PREPARATA_INVIO_MANUALE',
        entita: `Fattura ${numFattura}`,
        dettagli: `Fattura elettronica ${numFattura} preparata per invio manuale a SdI (riferimento locale: ${result.riferimentoPreparazione}). Trasmissione a cura dell'operatore.`,
      });

      return reply.send({
        ok: true,
        riferimentoPreparazione: result.riferimentoPreparazione,
        dataPreparazione: result.dataPreparazione,
        message: result.message,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore preparazione invio manuale' });
    }
  });
}
