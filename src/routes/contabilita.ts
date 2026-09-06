// Rotte contabilità: fatture, incassi/scadenzario, registro fatture, banche,
// reportistica, generatore PDF+email, webhook esiti SDI, contratti ricorrenti,
// cron scadenze, SDI manuale, Prima Nota e importatori sorgente (OpenSTAManager Engine).

import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import type { AppPort } from '../services/appPort.js';
import {
  prisma,
  conContestoInTransazione,
  riprovaSuConflitto,
} from '../util/prismaClient.js';
import {
  calcolaTotaliFattura,
  generaPianoScadenze,
  assertFatturaModificabile,
  formattaNumeroDocumento,
  type RigaFatturaInput,
  type OpzioniCalcoloFattura,
} from '../services/fatturaEngine.js';
import { recordAudit } from '../util/serverHelpers.js';
import { registraRotteContabilitaContiReport } from './contabilitaContiReport.js';
import { registraRotteContabilitaContratti } from './contabilitaContratti.js';
import { registraRotteContabilitaCron } from './contabilitaCron.js';
import { registraRotteContabilitaPdfEmail } from './contabilitaPdfEmail.js';
import { registraRotteContabilitaPrimaNota } from './contabilitaPrimaNota.js';
import { registraRotteContabilitaScadenzario } from './contabilitaScadenzario.js';
import { registraRotteContabilitaSdi } from './contabilitaSdi.js';
import { registraRotteContabilitaWebhookSdi } from './contabilitaWebhookSdi.js';

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
      const fattura: any = await app.emettiFattura({
        progettoId: req.params.id,
        ...req.body,
      });

      await recordAudit({
        tenantId: req.tenantId,
        userId: req.userId,
        ruolo: req.ruolo,
        azione: 'FATTURA_EMESSA',
        entita: fattura.numero || `Fattura Progetto`,
        dettagli: `Fattura ${fattura.numero || ''} emessa per importo €${((fattura.totaleDocumentoCentesimi || 0) / 100).toFixed(2)} da scheda progetto`,
        ipAddress: req.ip,
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
  await registraRotteContabilitaScadenzario(server, app);

  // ─── PRIMA NOTA INTEGRATA A DATABASE (ZERO LOCALSTORAGE) ───────────
  await registraRotteContabilitaPrimaNota(server, app);

  // ─── GENERATORE SDI XML CONFORME FATTURAPA 1.2 ────────────────────
  await registraRotteContabilitaSdi(server, app);

  // ─── MODULO BANCHE & CONTI CORRENTI STUDIO ─────────────────────────
  await registraRotteContabilitaContiReport(server, app);

  // ─── GENERATORE PDF SERVER-SIDE & EMAIL NODEMAILER ──────────────────
  await registraRotteContabilitaPdfEmail(server, app);

  // ─── WEBHOOK ESITI SDI ─────────────────────────────────────────────
  await registraRotteContabilitaWebhookSdi(server, app);

  // ─── CONTRATTI RICORRENTI & RETAINER ───────────────────────────────
  await registraRotteContabilitaContratti(server, app);

  // ─── CRON & PREPARAZIONE SDI MANUALE ───────────────────────────────
  await registraRotteContabilitaCron(server, app);
}
