// Rotte contabilità: fatture, incassi/scadenzario, registro fatture, banche,
// reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti,
// cron scadenze, SDI manuale, Prima Nota e importatori sorgente (OpenSTAManager Engine).

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppPort } from '../services/appPort.js';
import { prisma, conContestoInTransazione, riprovaSuConflitto } from '../util/prismaClient.js';
import { inviaEmail } from '../services/emailService.js';
import { generateInvoicePdfBuffer } from '../services/pdfService.js';
import { runDailyNotificationCron } from '../services/cronService.js';
import { preparaFatturaPerInvioManuale } from '../services/sdiService.js';
import { generaFatturaElettronicaXml } from '../services/sdiXmlGenerator.js';
import {
  calcolaTotaliFattura,
  generaPianoScadenze,
  assertFatturaModificabile,
  formattaNumeroDocumento,
  type RigaFatturaInput,
  type OpzioniCalcoloFattura,
} from '../services/fatturaEngine.js';
import { costruisciReport, REPORT_DISPONIBILI, type ChiaveReport } from '../services/reportsService.js';
import { generaPdfReport, generaExcelReport } from '../services/reportExport.js';
import { notificaStudio, notificaCliente } from '../services/notificheService.js';
import { recordAudit } from '../util/serverHelpers.js';
import { TransizioneNonValidaError } from '../adapters/appErrors.js';

export async function registraRotteContabilita(server: FastifyInstance, app: AppPort): Promise<void> {
  // ─── COMPATIBILITÀ ROTTE PRECEDENTI ────────────────────────────────
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
    try {
      const fattura = await app.emettiFattura({
        progettoId: req.params.id,
        ...req.body,
      });
      return reply.code(201).send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore emissione fattura progetto' });
    }
  });

  // ─── REGISTRO FATTURE (OPENSTAMANAGER ENGINE) ──────────────────────
  server.get('/invoices', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get('/fatture', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const fatture = await prisma.fattura.findMany({
        where: { tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
        },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      return reply.send(fatture);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura registro fatture' });
    }
  });

  server.get<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
        include: {
          righe: {
            include: { moduloProgetto: true, articolo: true },
            orderBy: { ordine: 'asc' },
          },
          progetto: { include: { cliente: true } },
          cliente: true,
          scadenzeIncasso: {
            include: { registrazioniRegistrate: true },
            orderBy: { numeroRata: 'asc' },
          },
          contoAccredito: true,
          fatturaOrigine: true,
          noteCredito: true,
          auditLogFatture: { orderBy: { createdAt: 'desc' } },
        },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });
      return reply.send(fattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore lettura dettaglio fattura' });
    }
  });

  // ─── CREAZIONE NUOVA FATTURA O BOZZA ───────────────────────────────
  server.post<{
    Body: {
      clienteId: string;
      progettoId?: string | null;
      preventivoId?: string | null;
      contrattoRicorrenteId?: string | null;
      tipoDocumento?: 'fattura' | 'nota_credito';
      serie?: string;
      condizionePagamento?: 'immediato' | 'bonifico_30gg' | 'bonifico_60gg' | 'bonifico_30_60gg' | 'bonifico_fine_mese' | 'personalizzato';
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      contoAccreditoId?: string | null;
      tipoCassa?: 'nessuna' | 'inps_gestione_separata' | 'cassa_commercialisti' | 'cassa_forense' | 'inarcassa';
      aliquotaCassa?: number;
      aliquotaRitenuta?: number;
      esigibilitaIva?: 'immediata' | 'differita' | 'split';
      righe: RigaFatturaInput[];
      note?: string | null;
      notePiePagina?: string | null;
      codiceDestinatario?: string | null;
      pecDestinatario?: string | null;
    };
  }>('/invoices', async (req, reply) => {
    const tenantId = req.tenantId;
    const body = req.body;

    if (!body.clienteId) {
      return reply.code(400).send({ errore: 'Il cliente è obbligatorio' });
    }
    if (!body.righe || !Array.isArray(body.righe) || body.righe.length === 0) {
      return reply.code(400).send({ errore: 'È richiesta almeno una riga prestazione/articolo' });
    }

    try {
      const cliente = await prisma.cliente.findFirst({
        where: { id: body.clienteId, tenantId },
      });
      if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });

      // Calcolo fiscale completo con OpenSTAManager Engine
      const opzioni: OpzioniCalcoloFattura = {
        tipoCassa: body.tipoCassa || 'nessuna',
        aliquotaCassa: body.aliquotaCassa,
        aliquotaRitenuta: body.aliquotaRitenuta,
        esigibilitaIva: body.esigibilitaIva || 'immediata',
      };
      const calcolo = calcolaTotaliFattura(body.righe, opzioni);

      const serie = body.serie || (body.tipoDocumento === 'nota_credito' ? 'NC' : 'FT');

      // Numerazione progressiva e creazione in un'unica transazione Serializable:
      // due richieste contemporanee che creano bozze nella stessa serie vengono
      // serializzate, così non possono leggere lo stesso "ultimo progressivo" e
      // assegnarlo a entrambe. In caso di conflitto la tx abortisce (P2034) e
      // `riprovaSuConflitto` rilancia con i progressivi aggiornati dell'altra.
      const nuovaFattura = await riprovaSuConflitto(() =>
        prisma.$transaction(
          async (tx) =>
            conContestoInTransazione(tx, async () => {
              const lastFattura = await tx.fattura.findFirst({
                where: { tenantId, serie },
                orderBy: { numeroProgressivoSerie: 'desc' },
              });
              const nextProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
              const numeroProvvisorio = `BOZZA-${serie}-${nextProgressivo}`;

              return tx.fattura.create({
                data: {
                  tenantId,
                  clienteId: cliente.id,
                  progettoId: body.progettoId || null,
                  preventivoId: body.preventivoId || null,
                  contrattoRicorrenteId: body.contrattoRicorrenteId || null,
                  tipoDocumento: body.tipoDocumento || 'fattura',
                  serie,
                  numeroProgressivoSerie: nextProgressivo,
                  numero: numeroProvvisorio,
                  data: new Date(),
                  stato: 'bozza',
                  tipoClienteFiscale: cliente.tipo === 'company' ? 'business_italia' : 'privato_italia',
                  partitaIva: cliente.piva || null,
                  codiceFiscale: cliente.codiceFiscale || null,
                  canale: 'sdi',
                  condizionePagamento: body.condizionePagamento || 'bonifico_30gg',
                  metodoPagamento: body.metodoPagamento || 'bonifico',
                  contoAccreditoId: body.contoAccreditoId || null,
                  tipoCassa: body.tipoCassa || 'nessuna',
                  aliquotaCassa: opzioni.aliquotaCassa || 0,
                  aliquotaRitenuta: opzioni.aliquotaRitenuta || 0,
                  esigibilitaIva: opzioni.esigibilitaIva || 'immediata',
                  totaleImponibileCentesimi: calcolo.totaleImponibileCentesimi,
                  totaleCassaCentesimi: calcolo.totaleCassaCentesimi,
                  totaleIvaCentesimi: calcolo.totaleIvaCentesimi,
                  totaleRitenutaCentesimi: calcolo.totaleRitenutaCentesimi,
                  totaleBolloCentesimi: calcolo.totaleBolloCentesimi,
                  totaleDocumentoCentesimi: calcolo.totaleDocumentoCentesimi,
                  nettoAPagareCentesimi: calcolo.nettoAPagareCentesimi,
                  note: body.note || null,
                  notePiePagina: body.notePiePagina || null,
                  codiceDestinatario: body.codiceDestinatario || cliente.sdiCode || '0000000',
                  pecDestinatario: body.pecDestinatario || null,
                  righe: {
                    create: calcolo.righe.map((r, idx) => ({
                      tenantId,
                      tipo: r.tipo || 'milestone_libera',
                      moduloProgettoId: r.moduloProgettoId || null,
                      articoloId: r.articoloId || null,
                      percentuale: r.percentuale || null,
                      importo: r.totaleRigaCentesimi,
                      descrizione: r.descrizione,
                      quantita: r.quantita,
                      unitaMisura: r.unitaMisura,
                      prezzoUnitarioCent: r.prezzoUnitarioCent,
                      scontoPercentuale: r.scontoPercentuale,
                      aliquotaIva: r.aliquotaIva,
                      naturaEsenzione: r.naturaEsenzione || null,
                      applicaCassa: r.applicaCassa,
                      applicaRitenuta: r.applicaRitenuta,
                      applicaBollo: r.applicaBollo,
                      imponibileCentesimi: r.imponibileCentesimi,
                      ivaCentesimi: r.ivaCentesimi,
                      totaleRigaCentesimi: r.totaleRigaCentesimi,
                      ordine: idx + 1,
                    })),
                  },
                },
                include: {
                  righe: true,
                  cliente: true,
                  progetto: true,
                },
              });
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_BOZZA_CREATA',
        entita: nuovaFattura.numero || `Bozza`,
        dettagli: `Creata bozza fattura per ${cliente.nome} di importo €${(calcolo.nettoAPagareCentesimi / 100).toFixed(2)}`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(nuovaFattura);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore creazione bozza fattura' });
    }
  });

  // ─── MODIFICA FATTURA IN BOZZA (CHECK IMMUTABILITÀ FISCALE) ────────
  server.put<{
    Params: { id: string };
    Body: {
      condizionePagamento?: 'immediato' | 'bonifico_30gg' | 'bonifico_60gg' | 'bonifico_30_60gg' | 'bonifico_fine_mese' | 'personalizzato';
      metodoPagamento?: 'bonifico' | 'carta' | 'assegno' | 'contanti' | 'stripe';
      contoAccreditoId?: string | null;
      tipoCassa?: 'nessuna' | 'inps_gestione_separata' | 'cassa_commercialisti' | 'cassa_forense' | 'inarcassa';
      aliquotaCassa?: number;
      aliquotaRitenuta?: number;
      esigibilitaIva?: 'immediata' | 'differita' | 'split';
      righe: RigaFatturaInput[];
      note?: string | null;
      notePiePagina?: string | null;
      codiceDestinatario?: string | null;
      pecDestinatario?: string | null;
    };
  }>('/invoices/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const body = req.body;

    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      // Guard di Immutabilità Fiscale
      assertFatturaModificabile(fattura.stato);

      const opzioni: OpzioniCalcoloFattura = {
        tipoCassa: body.tipoCassa !== undefined ? body.tipoCassa : (fattura.tipoCassa as any),
        aliquotaCassa: body.aliquotaCassa !== undefined ? body.aliquotaCassa : fattura.aliquotaCassa,
        aliquotaRitenuta: body.aliquotaRitenuta !== undefined ? body.aliquotaRitenuta : fattura.aliquotaRitenuta,
        esigibilitaIva: body.esigibilitaIva || (fattura.esigibilitaIva as any) || 'immediata',
      };
      const calcolo = calcolaTotaliFattura(body.righe, opzioni);

      // Elimina vecchie righe e inserisci le nuove in transazione
      await prisma.fatturaRiga.deleteMany({ where: { fatturaId: id } });

      const fatturaAggiornata = await prisma.fattura.update({
        where: { id },
        data: {
          condizionePagamento: body.condizionePagamento || fattura.condizionePagamento,
          metodoPagamento: body.metodoPagamento || fattura.metodoPagamento,
          contoAccreditoId: body.contoAccreditoId !== undefined ? body.contoAccreditoId : fattura.contoAccreditoId,
          tipoCassa: body.tipoCassa || fattura.tipoCassa,
          aliquotaCassa: opzioni.aliquotaCassa || 0,
          aliquotaRitenuta: opzioni.aliquotaRitenuta || 0,
          esigibilitaIva: opzioni.esigibilitaIva || 'immediata',
          totaleImponibileCentesimi: calcolo.totaleImponibileCentesimi,
          totaleCassaCentesimi: calcolo.totaleCassaCentesimi,
          totaleIvaCentesimi: calcolo.totaleIvaCentesimi,
          totaleRitenutaCentesimi: calcolo.totaleRitenutaCentesimi,
          totaleBolloCentesimi: calcolo.totaleBolloCentesimi,
          totaleDocumentoCentesimi: calcolo.totaleDocumentoCentesimi,
          nettoAPagareCentesimi: calcolo.nettoAPagareCentesimi,
          note: body.note !== undefined ? body.note : fattura.note,
          notePiePagina: body.notePiePagina !== undefined ? body.notePiePagina : fattura.notePiePagina,
          codiceDestinatario: body.codiceDestinatario !== undefined ? body.codiceDestinatario : fattura.codiceDestinatario,
          pecDestinatario: body.pecDestinatario !== undefined ? body.pecDestinatario : fattura.pecDestinatario,
          righe: {
            create: calcolo.righe.map((r, idx) => ({
              tenantId,
              tipo: r.tipo || 'milestone_libera',
              moduloProgettoId: r.moduloProgettoId || null,
              articoloId: r.articoloId || null,
              percentuale: r.percentuale || null,
              importo: r.totaleRigaCentesimi,
              descrizione: r.descrizione,
              quantita: r.quantita,
              unitaMisura: r.unitaMisura,
              prezzoUnitarioCent: r.prezzoUnitarioCent,
              scontoPercentuale: r.scontoPercentuale,
              aliquotaIva: r.aliquotaIva,
              naturaEsenzione: r.naturaEsenzione || null,
              applicaCassa: r.applicaCassa,
              applicaRitenuta: r.applicaRitenuta,
              applicaBollo: r.applicaBollo,
              imponibileCentesimi: r.imponibileCentesimi,
              ivaCentesimi: r.ivaCentesimi,
              totaleRigaCentesimi: r.totaleRigaCentesimi,
              ordine: idx + 1,
            })),
          },
        },
        include: { righe: true, cliente: true, progetto: true },
      });

      return reply.send(fatturaAggiornata);
    } catch (err: any) {
      return reply.code(400).send({ errore: err?.message || 'Errore modifica fattura' });
    }
  });

  // ─── ELIMINA FATTURA BOZZA ─────────────────────────────────────────
  server.delete<{ Params: { id: string } }>('/invoices/:id', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const fattura = await prisma.fattura.findFirst({
        where: { id, tenantId },
      });
      if (!fattura) return reply.code(404).send({ errore: 'Fattura non trovata' });

      // Non è consentito eliminare una fattura già emessa o incassata (solo nota di credito)
      assertFatturaModificabile(fattura.stato);

      await prisma.fattura.delete({ where: { id } });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_BOZZA_ELIMINATA',
        entita: fattura.numero || id,
        dettagli: `Eliminata bozza fattura ${fattura.numero}`,
        ipAddress: req.ip,
      });

      return reply.send({ ok: true, message: 'Bozza eliminata con successo' });
    } catch (err: any) {
      return reply.code(400).send({ errore: err?.message || 'Errore eliminazione bozza fattura' });
    }
  });

  // ─── EMISSIONE DEFINITIVA & GENERAZIONE SCADENZARIO RATE ───────────
  server.post<{ Params: { id: string } }>('/invoices/:id/emetti', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;

    try {
      const { fatturaEmessa, numeroUfficiale, rateCount, nettoAPagareCent } = await riprovaSuConflitto(() =>
        prisma.$transaction(
          async (tx) =>
            conContestoInTransazione(tx, async () => {
              const fattura = await tx.fattura.findFirst({
                where: { id, tenantId },
                include: { cliente: true, righe: true },
              });
              if (!fattura) throw new Error('Fattura non trovata');
              if (fattura.stato !== 'bozza') {
                throw new Error(`La fattura è già in stato '${fattura.stato}'`);
              }

              // Numerazione progressiva ufficiale atomica per serie (FT o NC)
              const dataEmissione = new Date();
              const lastEmessa = await tx.fattura.findFirst({
                where: { tenantId, serie: fattura.serie, stato: { not: 'bozza' } },
                orderBy: { numeroProgressivoSerie: 'desc' },
              });
              const progressivoSerie = (lastEmessa?.numeroProgressivoSerie || 0) + 1;
              const numeroUff = formattaNumeroDocumento(fattura.serie, progressivoSerie, dataEmissione);

              // Generazione piano scadenze nello Scadenzario
              const rateCalcolate = generaPianoScadenze(
                fattura.nettoAPagareCentesimi,
                fattura.condizionePagamento,
                dataEmissione
              );

              // Aggiornamento atomico stato fattura e generazione scadenze
              const aggiornata = await tx.fattura.update({
                where: { id },
                data: {
                  stato: 'emessa',
                  numeroProgressivoSerie: progressivoSerie,
                  numero: numeroUff,
                  data: dataEmissione,
                  scadenzeIncasso: {
                    create: rateCalcolate.map((r) => ({
                      tenantId,
                      numeroRata: r.numeroRata,
                      importoCentesimi: r.importoCentesimi,
                      dataScadenza: r.dataScadenza,
                      stato: 'in_attesa',
                      note: r.note,
                    })),
                  },
                  auditLogFatture: {
                    create: {
                      tenantId,
                      utenteId: req.userId || null,
                      azione: 'emissione',
                      dettagli: {
                        numero: numeroUff,
                        nettoAPagareCentesimi: fattura.nettoAPagareCentesimi,
                        rate: rateCalcolate.length,
                      },
                    },
                  },
                },
                include: {
                  righe: true,
                  cliente: true,
                  progetto: true,
                  scadenzeIncasso: true,
                },
              });

              return {
                fatturaEmessa: aggiornata,
                numeroUfficiale: numeroUff,
                rateCount: rateCalcolate.length,
                nettoAPagareCent: fattura.nettoAPagareCentesimi,
              };
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_EMESSA',
        entita: numeroUfficiale,
        dettagli: `Fattura ${numeroUfficiale} emessa definitivamente per €${(nettoAPagareCent / 100).toFixed(2)} con ${rateCount} rate generate nello scadenzario`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        fattura: fatturaEmessa,
        message: `Fattura ${numeroUfficiale} emessa con successo. Generate ${rateCount} rate nello scadenzario.`,
      });
    } catch (err: any) {
      if (err?.message === 'Fattura non trovata') {
        return reply.code(404).send({ errore: 'Fattura non trovata' });
      }
      if (err?.message?.includes('già in stato')) {
        return reply.code(400).send({ errore: err.message });
      }
      return reply.code(500).send({ errore: err?.message || 'Errore durante l\'emissione della fattura' });
    }
  });

  // ─── GENERAZIONE NOTA DI CREDITO (TD04) ────────────────────────────
  server.post<{
    Params: { id: string };
    Body: {
      motivo: 'errore_esposizione' | 'reso_merce' | 'sconto_post_fattura' | 'abbuono' | 'annullo_totale' | 'correzione_dati';
      note?: string;
    };
  }>('/invoices/:id/nota-credito', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { motivo, note } = req.body;

    try {
      const { notaCredito, numeroNC, numeroOrigine } = await riprovaSuConflitto(() =>
        prisma.$transaction(
          async (tx) =>
            conContestoInTransazione(tx, async () => {
              const fatturaOrigine = await tx.fattura.findFirst({
                where: { id, tenantId },
                include: { righe: true, cliente: true, scadenzeIncasso: { include: { registrazioniRegistrate: true } } },
              });
              if (!fatturaOrigine) throw new Error('Fattura origine non trovata');
              if (fatturaOrigine.stato === 'bozza' || fatturaOrigine.stato === 'annullata') {
                throw new Error('Impossibile emettere nota di credito per una fattura in bozza o già annullata');
              }

              const dataEmissione = new Date();
              const lastNC = await tx.fattura.findFirst({
                where: { tenantId, serie: 'NC', stato: { not: 'bozza' } },
                orderBy: { numeroProgressivoSerie: 'desc' },
              });
              const progressivoNC = (lastNC?.numeroProgressivoSerie || 0) + 1;
              const numNC = formattaNumeroDocumento('NC', progressivoNC, dataEmissione);

              // Crea Nota di Credito collegata (TD04)
              const nc = await tx.fattura.create({
                data: {
                  tenantId,
                  clienteId: fatturaOrigine.clienteId,
                  progettoId: fatturaOrigine.progettoId,
                  tipoDocumento: 'nota_credito',
                  serie: 'NC',
                  numeroProgressivoSerie: progressivoNC,
                  numero: numNC,
                  data: dataEmissione,
                  stato: 'emessa',
                  fatturaOrigineId: fatturaOrigine.id,
                  motivoNotaCredito: motivo || 'annullo_totale',
                  tipoClienteFiscale: fatturaOrigine.tipoClienteFiscale,
                  partitaIva: fatturaOrigine.partitaIva,
                  codiceFiscale: fatturaOrigine.codiceFiscale,
                  canale: fatturaOrigine.canale,
                  condizionePagamento: 'immediato',
                  metodoPagamento: fatturaOrigine.metodoPagamento,
                  contoAccreditoId: fatturaOrigine.contoAccreditoId,
                  tipoCassa: fatturaOrigine.tipoCassa,
                  aliquotaCassa: fatturaOrigine.aliquotaCassa,
                  aliquotaRitenuta: fatturaOrigine.aliquotaRitenuta,
                  esigibilitaIva: fatturaOrigine.esigibilitaIva,
                  totaleImponibileCentesimi: fatturaOrigine.totaleImponibileCentesimi,
                  totaleCassaCentesimi: fatturaOrigine.totaleCassaCentesimi,
                  totaleIvaCentesimi: fatturaOrigine.totaleIvaCentesimi,
                  totaleRitenutaCentesimi: fatturaOrigine.totaleRitenutaCentesimi,
                  totaleBolloCentesimi: fatturaOrigine.totaleBolloCentesimi,
                  totaleDocumentoCentesimi: fatturaOrigine.totaleDocumentoCentesimi,
                  nettoAPagareCentesimi: fatturaOrigine.nettoAPagareCentesimi,
                  note: note || `Storno totale a storno della fattura ${fatturaOrigine.numero}`,
                  righe: {
                    create: fatturaOrigine.righe.map((r, idx) => ({
                      tenantId,
                      tipo: r.tipo,
                      moduloProgettoId: r.moduloProgettoId,
                      articoloId: r.articoloId,
                      importo: r.importo,
                      descrizione: `Storno: ${r.descrizione}`,
                      quantita: r.quantita,
                      unitaMisura: r.unitaMisura,
                      prezzoUnitarioCent: r.prezzoUnitarioCent,
                      scontoPercentuale: r.scontoPercentuale,
                      aliquotaIva: r.aliquotaIva,
                      naturaEsenzione: r.naturaEsenzione,
                      applicaCassa: r.applicaCassa,
                      applicaRitenuta: r.applicaRitenuta,
                      applicaBollo: r.applicaBollo,
                      imponibileCentesimi: r.imponibileCentesimi,
                      ivaCentesimi: r.ivaCentesimi,
                      totaleRigaCentesimi: r.totaleRigaCentesimi,
                      ordine: idx + 1,
                    })),
                  },
                  auditLogFatture: {
                    create: {
                      tenantId,
                      utenteId: req.userId || null,
                      azione: 'nota_credito',
                      dettagli: {
                        fatturaOrigineId: fatturaOrigine.id,
                        numeroOrigine: fatturaOrigine.numero,
                        motivo,
                      },
                    },
                  },
                },
                include: { righe: true, cliente: true, progetto: true },
              });

              // Annulla o storno le scadenze non incassate della fattura origine
              await tx.scadenzaIncasso.updateMany({
                where: { fatturaId: fatturaOrigine.id, stato: 'in_attesa' },
                data: { stato: 'parziale', note: `Annullata per emissione Nota di Credito ${numNC}` },
              });

              // Se la fattura era già stata incassata, genera un movimento di uscita storno in Prima Nota
              const totaleIncassato = fatturaOrigine.scadenzeIncasso.flatMap((s) => s.registrazioniRegistrate).reduce((acc, r) => acc + r.importoIncassatoCentesimi, 0);
              if (totaleIncassato > 0) {
                await tx.movimentoPrimaNota.create({
                  data: {
                    tenantId,
                    contoBancarioId: fatturaOrigine.contoAccreditoId,
                    fatturaId: nc.id,
                    clienteId: fatturaOrigine.clienteId,
                    tipo: 'uscita',
                    categoria: 'altro',
                    descrizione: `Storno rimborso Nota di Credito ${numNC} su fattura ${fatturaOrigine.numero}`,
                    importoCentesimi: totaleIncassato,
                    metodoPagamento: fatturaOrigine.metodoPagamento,
                  },
                });
              }

              await tx.fattura.update({
                where: { id: fatturaOrigine.id },
                data: { stato: 'annullata' },
              });

              return {
                notaCredito: nc,
                numeroNC: numNC,
                numeroOrigine: fatturaOrigine.numero,
              };
            }),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'NOTA_CREDITO_EMESSA',
        entita: numeroNC,
        dettagli: `Emessa Nota di Credito ${numeroNC} a storno della fattura ${numeroOrigine}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        notaCredito,
        message: `Nota di credito ${numeroNC} emessa con successo a storno della fattura ${numeroOrigine}`,
      });
    } catch (err: any) {
      if (err?.message === 'Fattura origine non trovata') {
        return reply.code(404).send({ errore: 'Fattura origine non trovata' });
      }
      if (err?.message?.includes('Impossibile emettere nota di credito')) {
        return reply.code(400).send({ errore: err.message });
      }
      return reply.code(500).send({ errore: err?.message || 'Errore emissione nota di credito' });
    }
  });

  // ─── IMPORTATORI SORGENTE (PROGETTO, PREVENTIVO, RETAINER, TIMESHEET) ─
  server.post<{
    Body: {
      progettoId: string;
      moduliIds?: string[];
      percentuale?: number;
    };
  }>('/fatture/da-progetto', async (req, reply) => {
    const tenantId = req.tenantId;
    const { progettoId, moduliIds, percentuale } = req.body;

    try {
      const progetto = await prisma.progetto.findFirst({
        where: { id: progettoId, tenantId },
        include: { cliente: true, moduli: { include: { moduloTemplate: true } } },
      });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato' });

      const moduliDaFatturare = moduliIds && moduliIds.length > 0
        ? progetto.moduli.filter((m) => moduliIds.includes(m.id))
        : progetto.moduli;

      const perc = percentuale && percentuale > 0 ? Math.min(100, percentuale) : 100;

      const righeInput: RigaFatturaInput[] = moduliDaFatturare.map((m) => {
        const importoBase = m.moduloTemplate?.prezzoPacchetto || 50000;
        const importoCalcolato = Math.round(importoBase * (perc / 100));
        return {
          tipo: perc < 100 ? 'modulo_parziale' : 'modulo_completo',
          moduloProgettoId: m.id,
          percentuale: perc < 100 ? perc : null,
          descrizione: `${m.moduloTemplate?.nome || 'Modulo Progetto'}${perc < 100 ? ` (Avanzamento ${perc}%)` : ''}`,
          quantita: 1,
          unitaMisura: 'forfait',
          prezzoUnitarioCent: importoCalcolato,
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        };
      });

      return reply.send({
        ok: true,
        cliente: progetto.cliente,
        progettoId: progetto.id,
        righeSuggerite: righeInput,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore importazione da progetto' });
    }
  });

  server.post<{ Body: { preventivoId: string } }>('/fatture/da-preventivo', async (req, reply) => {
    const tenantId = req.tenantId;
    const { preventivoId } = req.body;

    try {
      const prev = await prisma.preventivo.findFirst({
        where: { id: preventivoId, tenantId },
        include: { cliente: true, progetto: true },
      });
      if (!prev) return reply.code(404).send({ errore: 'Preventivo non trovato' });

      const righeJson = Array.isArray(prev.righeJson) ? (prev.righeJson as any[]) : [];
      const righeSuggerite: RigaFatturaInput[] = [];

      for (const r of righeJson) {
        let nomeModulo = 'Modulo da Preventivo';
        if (r.moduloTemplateId) {
          const mod = await prisma.moduloTemplate.findUnique({ where: { id: r.moduloTemplateId } });
          if (mod) nomeModulo = mod.nome;
        }
        righeSuggerite.push({
          tipo: 'milestone_libera',
          descrizione: nomeModulo,
          quantita: 1,
          unitaMisura: 'forfait',
          prezzoUnitarioCent: r.prezzo || Math.round(prev.valoreTotale / Math.max(1, righeJson.length)),
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        });
      }

      if (righeSuggerite.length === 0) {
        righeSuggerite.push({
          tipo: 'milestone_libera',
          descrizione: `Prestazioni come da Preventivo #${prev.id.slice(0, 8)}`,
          quantita: 1,
          unitaMisura: 'forfait',
          prezzoUnitarioCent: prev.valoreTotale,
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        });
      }

      return reply.send({
        ok: true,
        cliente: prev.cliente,
        progettoId: prev.progettoId,
        preventivoId: prev.id,
        righeSuggerite,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore importazione da preventivo' });
    }
  });

  server.post<{ Body: { progettoId: string; operatoreId?: string; tariffaOrariaCent?: number } }>('/fatture/da-timesheet', async (req, reply) => {
    const tenantId = req.tenantId;
    const { progettoId, operatoreId, tariffaOrariaCent } = req.body;

    try {
      const progetto = await prisma.progetto.findFirst({
        where: { id: progettoId, tenantId },
        include: { cliente: true },
      });
      if (!progetto) return reply.code(404).send({ errore: 'Progetto non trovato' });

      const whereTimesheet: any = { tenantId, progettoId };
      if (operatoreId) whereTimesheet.userId = operatoreId;

      const ore = await prisma.oraTimesheet.findMany({
        where: whereTimesheet,
        include: { utente: true },
      });

      const tariffaCent = tariffaOrariaCent || 12000; // default 120 €/ora
      const totaleMinuti = ore.reduce((acc, o) => acc + o.minuti, 0);
      const oreTotali = parseFloat((totaleMinuti / 60).toFixed(2));

      const righeSuggerite: RigaFatturaInput[] = [
        {
          tipo: 'milestone_libera',
          descrizione: `Consulenza Oraria Progetto ${progetto.nome} (${oreTotali} ore consuntivate)`,
          quantita: oreTotali,
          unitaMisura: 'ore',
          prezzoUnitarioCent: tariffaCent,
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        },
      ];

      return reply.send({
        ok: true,
        cliente: progetto.cliente,
        progettoId: progetto.id,
        oreConsuntivate: oreTotali,
        righeSuggerite,
      });
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore importazione da timesheet' });
    }
  });

  // ─── SCADENZARIO & REGISTRAZIONE INCASSI CON PRIMA NOTA AUTOMATICA ──
  server.get('/invoices/scadenzario', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const scadenze = await prisma.scadenzaIncasso.findMany({
        where: { tenantId },
        include: {
          fattura: {
            include: {
              progetto: { include: { cliente: true } },
              cliente: true,
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
      contoBancarioId?: string;
      noteOperatore?: string;
    };
  }>('/invoices/scadenze/:id/incassi', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    const { importoIncassatoCentesimi, metodoPagamento, riferimentoTransazione, contoBancarioId, noteOperatore } = req.body;

    try {
      const scadenza = await prisma.scadenzaIncasso.findUnique({
        where: { id },
        include: {
          registrazioniRegistrate: true,
          fattura: { include: { cliente: true, progetto: { include: { cliente: true } } } },
        },
      });

      if (!scadenza) {
        return reply.code(404).send({ errore: 'Scadenza incasso non trovata' });
      }

      // 1. Registra l'incasso della rata
      const registrazione = await prisma.registrazioneIncasso.create({
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

      // 2. Aggiorna stato della rata
      const totaleIncassatoRata = scadenza.registrazioniRegistrate.reduce((acc, r) => acc + r.importoIncassatoCentesimi, 0) + importoIncassatoCentesimi;
      const nuovoStatoScadenza = totaleIncassatoRata >= scadenza.importoCentesimi ? 'incassato' : 'parziale';

      await prisma.scadenzaIncasso.update({
        where: { id },
        data: { stato: nuovoStatoScadenza },
      });

      // 3. Verifica se tutte le rate della fattura sono saldate
      const tutteScadenzeFattura = await prisma.scadenzaIncasso.findMany({
        where: { fatturaId: scadenza.fatturaId },
      });
      const tutteSaldate = tutteScadenzeFattura.every((s) => s.id === id ? nuovoStatoScadenza === 'incassato' : s.stato === 'incassato');

      await prisma.fattura.update({
        where: { id: scadenza.fatturaId },
        data: { stato: tutteSaldate ? 'incassata' : 'emessa' },
      });

      // 4. Generazione Movimento Automatico in Prima Nota (OpenSTAManager Engine)
      const targetContoId = contoBancarioId || scadenza.fattura.contoAccreditoId;
      await prisma.movimentoPrimaNota.create({
        data: {
          tenantId,
          contoBancarioId: targetContoId || null,
          fatturaId: scadenza.fatturaId,
          clienteId: scadenza.fattura.clienteId,
          tipo: 'entrata',
          categoria: 'incasso_fattura',
          descrizione: `Incasso rata #${scadenza.numeroRata} fattura ${scadenza.fattura.numero || scadenza.fatturaId}`,
          importoCentesimi: importoIncassatoCentesimi,
          metodoPagamento: metodoPagamento || 'bonifico',
          riferimentoTransazione: riferimentoTransazione || null,
          note: noteOperatore || null,
        },
      });

      // 5. Accredito Saldo Conto Bancario
      if (targetContoId) {
        await prisma.contoBancario.update({
          where: { id: targetContoId },
          data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
        });
      } else {
        const contoPredefinito = await prisma.contoBancario.findFirst({
          where: { tenantId, isDefault: true },
        });
        if (contoPredefinito) {
          await prisma.contoBancario.update({
            where: { id: contoPredefinito.id },
            data: { saldoAttuale: { increment: importoIncassatoCentesimi } },
          });
        }
      }

      // 6. Notifiche Studio e Cliente se saldata
      if (tutteSaldate) {
        const etichetta = scadenza.fattura.numero || `FT-${scadenza.fattura.numeroProgressivoSerie}`;
        const importo = `€ ${(scadenza.importoCentesimi / 100).toLocaleString('it-IT')}`;
        const nomeCliente = scadenza.fattura.cliente?.nome || scadenza.fattura.progetto?.cliente?.nome || 'Cliente';

        await notificaStudio(tenantId, {
          tipoEvento: 'fattura_incassata',
          oggetto: 'Fattura incassata',
          corpo: `La fattura ${etichetta} di ${nomeCliente} è stata saldata (${importo}).`,
          link: '/invoices',
        }).catch(() => {});

        if (scadenza.fattura.clienteId) {
          await notificaCliente(tenantId, scadenza.fattura.clienteId, {
            tipoEvento: 'fattura_incassata',
            oggetto: 'Pagamento registrato',
            corpo: `Abbiamo registrato il pagamento della fattura ${etichetta} (${importo}). Grazie!`,
            link: '/portal/invoices',
          }).catch(() => {});
        }
      }

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'INCASSO_REGISTRATO',
        entita: `Scadenza #${id}`,
        dettagli: `Registrato incasso di €${(importoIncassatoCentesimi / 100).toFixed(2)} via ${metodoPagamento || 'bonifico'} con scrittura automatica in Prima Nota`,
        ipAddress: req.ip,
      });

      return reply.code(201).send(registrazione);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore registrazione incasso' });
    }
  });

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
    const body = req.body;

    if (!body.descrizione || !body.importoCentesimi || body.importoCentesimi <= 0) {
      return reply.code(400).send({ errore: 'Descrizione e importo maggiori di 0 sono obbligatori' });
    }

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

      const xmlString = generaFatturaElettronicaXml({
        progressivoInvio: String(fattura.numeroProgressivoSerie || '1').padStart(5, '0'),
        codiceDestinatario: fattura.codiceDestinatario || cliente.sdiCode || '0000000',
        pecDestinatario: fattura.pecDestinatario,
        cedenteDenominazione: studio?.ragioneSociale || 'Studio Advisory',
        cedentePiva: studio?.piva,
        cedenteCodiceFiscale: studio?.codiceFiscale || studio?.piva,
        cedenteSedeIndirizzo: studio?.sedeLegale || 'Via Roma 1',
        cedenteRegimeFiscale: studio?.regimeFiscale || 'RF01',
        cessionarioDenominazione: cliente.nome,
        cessionarioPiva: cliente.piva,
        cessionarioCodiceFiscale: cliente.codiceFiscale,
        cessionarioIndirizzo: cliente.sedeLegale,
        tipoDocumento: fattura.tipoDocumento === 'nota_credito' ? 'TD04' : 'TD01',
        data: (fattura.data || new Date()).toISOString().split('T')[0] || '',
        numero: fattura.numero || `FT-${fattura.numeroProgressivoSerie}`,
        importoTotaleDocumento: (fattura.totaleDocumentoCentesimi || 0) / 100,
        tipoCassa: fattura.tipoCassa !== 'nessuna' ? 'TC22' : undefined,
        aliquotaCassa: fattura.aliquotaCassa || undefined,
        importoContributoCassa: fattura.totaleCassaCentesimi ? fattura.totaleCassaCentesimi / 100 : undefined,
        tipoRitenuta: 'RT01',
        importoRitenuta: fattura.totaleRitenutaCentesimi ? fattura.totaleRitenutaCentesimi / 100 : undefined,
        aliquotaRitenuta: fattura.aliquotaRitenuta || undefined,
        bolloVirtuale: (fattura.totaleBolloCentesimi || 0) > 0,
        importoBollo: (fattura.totaleBolloCentesimi || 0) / 100,
        linee: fattura.righe.map((r, idx) => ({
          numeroLinea: idx + 1,
          descrizione: r.descrizione,
          quantita: r.quantita,
          unitaMisura: r.unitaMisura,
          prezzoUnitario: (r.prezzoUnitarioCent || r.importo) / 100,
          prezzoTotale: (r.imponibileCentesimi || r.importo) / 100,
          aliquotaIva: r.aliquotaIva,
          natura: r.naturaEsenzione,
          ritenuta: r.applicaRitenuta,
        })),
        riepilogoIva: [
          {
            aliquotaIva: 22,
            imponibileImporto: (fattura.totaleImponibileCentesimi || 0) / 100,
            imposta: (fattura.totaleIvaCentesimi || 0) / 100,
            esigibilitaIva: (fattura.esigibilitaIva === 'split' ? 'S' : fattura.esigibilitaIva === 'differita' ? 'D' : 'I'),
          },
        ],
        fatturaCollegataNumero: fattura.fatturaOrigine?.numero,
        fatturaCollegataData: fattura.fatturaOrigine?.data ? fattura.fatturaOrigine.data.toISOString().split('T')[0] : undefined,
        iban: fattura.contoAccredito?.iban || studio?.iban,
      });

      reply.header('Content-Type', 'application/xml');
      reply.header('Content-Disposition', `attachment; filename="${fattura.numero || 'Fattura'}.xml"`);
      return reply.send(xmlString);
    } catch (err: any) {
      return reply.code(500).send({ errore: err?.message || 'Errore generazione XML SDI' });
    }
  });

  // ─── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  server.get('/conti-bancari', async (req, reply) => {
    const tenantId = req.tenantId;
    try {
      const conti = await prisma.contoBancario.findMany({
        where: { tenantId },
        orderBy: { isDefault: 'desc' },
      });
      return reply.send(conti);
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

  // ─── WEBHOOK ESITI SDI ─────────────────────────────────────────────
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
      } catch {
        return reply.code(500).send({ errore: 'Errore aggiornamento esito SDI' });
      }
    },
  );

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
    const { clienteId, progettoId, titolo, frequenza, importoCentesimi, prossimaFatturazione, note } = req.body;

    if (!clienteId || !titolo || !importoCentesimi) {
      return reply.code(400).send({ errore: 'clienteId, titolo e importoCentesimi sono obbligatori' });
    }

    try {
      const contratto = await prisma.contrattoRicorrente.create({
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

      const lastFattura = await prisma.fattura.findFirst({
        where: { tenantId, tipoDocumento: 'fattura', serie: 'FT', stato: { not: 'bozza' } },
        orderBy: { numeroProgressivoSerie: 'desc' },
      });
      const dataEmissione = new Date();
      const prossimoProgressivo = (lastFattura?.numeroProgressivoSerie || 0) + 1;
      const numeroFattura = formattaNumeroDocumento('FT', prossimoProgressivo, dataEmissione);

      const opzioni: OpzioniCalcoloFattura = {
        tipoCassa: 'nessuna',
        aliquotaIva: 22,
      } as any;
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

      const nuovaFattura = await prisma.fattura.create({
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

      // Calcola la data della Prossima Fatturazione
      const prossimaData = new Date(contratto.prossimaFatturazione || new Date());
      if (contratto.frequenza === 'mensile') prossimaData.setMonth(prossimaData.getMonth() + 1);
      else if (contratto.frequenza === 'trimestrale') prossimaData.setMonth(prossimaData.getMonth() + 3);
      else if (contratto.frequenza === 'semestrale') prossimaData.setMonth(prossimaData.getMonth() + 6);
      else if (contratto.frequenza === 'annuale') prossimaData.setFullYear(prossimaData.getFullYear() + 1);

      await prisma.contrattoRicorrente.update({
        where: { id },
        data: { prossimaFatturazione: prossimaData },
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_RETAINER_GENERATA',
        entita: numeroFattura,
        dettagli: `Generata fattura ${numeroFattura} da €${(calcolo.nettoAPagareCentesimi / 100).toFixed(2)} per il canone retainer ${contratto.titolo}`,
        ipAddress: req.ip,
      });

      return reply.send({
        ok: true,
        fattura: nuovaFattura,
        scadenza: nuovaFattura.scadenzeIncasso[0],
        prossimaFatturazione: prossimaData,
        messaggio: `Fattura ${numeroFattura} generata con successo ed inserita nello Scadenzario Incassi!`,
      });
    } catch (err) {
      return reply.code(500).send({ errore: err instanceof Error ? err.message : 'Errore generazione fattura retainer' });
    }
  });

  // ─── CRON & PREPARAZIONE SDI MANUALE ───────────────────────────────
  server.post('/cron/esegui-notifiche-scadenze', async (req, reply) => {
    const tenantId = req.tenantId;
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

  server.post<{ Params: { id: string } }>('/invoices/:id/prepara-invio-manuale', async (req, reply) => {
    const tenantId = req.tenantId;
    const { id } = req.params;
    try {
      let fattura = null;
      try {
        fattura = await prisma.fattura.findUnique({
          where: { id },
          include: { progetto: { include: { cliente: true } } },
        });
      } catch {}

      const numFattura = fattura?.numeroProgressivoSerie ? String(fattura.numeroProgressivoSerie) : `FT-2026-${id.slice(0, 3)}`;
      const result = await preparaFatturaPerInvioManuale({
        fatturaId: id,
        numeroProgressivo: numFattura,
      });

      await recordAudit({
        tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_PREPARATA_INVIO_MANUALE',
        entita: `Fattura ${numFattura}`,
        dettagli: `Fattura elettronica ${numFattura} preparata per invio manuale a SdI (riferimento locale: ${result.riferimentoPreparazione}). Trasmissione a cura dell'operatore.`,
        ipAddress: req.ip,
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
