// Rotte del modulo KYC/AML §5.5 (Fase 5.5.1 — motore + stati). Il fascicolo di adeguata verifica
// è un processo INTERNO allo studio: il ruolo `cliente` non vi accede (come l'archivio §37). Il
// livello di verifica lo decide il motore puro `kycEngine`, non l'operatore.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { StatoKyc } from '@prisma/client';
import { prisma } from '../util/prismaClient.js';
import { calcolaRischioKyc } from '../domain/kycEngine.js';
import { transizioneKycConGate, puoApprovareRafforzata, valutaApprovazione, motivoRifiutoApprovazione } from '../services/kycCaseService.js';
import {
  ApprovazioneMassivaSchema,
  SoggettoKycSchema,
  TitolareEffettivoSchema,
  DepositoRegistroTeSchema,
  ValutazioneRischioKycSchema,
  DocumentoIdentitaKycSchema,
  ScreeningKycSchema,
  RisoluzioneScreeningSchema,
  AnomaliaKycSchema,
  DecisioneAnomaliaSchema,
  TrasmissioneFiauSchema,
  EsitoRetentionSchema,
  ProrogaRetentionSchema,
} from '../schemas/kyc.schema.js';
import type { TipoAnomaliaKyc, DecisioneMlro } from '../domain/anomalieKyc.js';
import { registraComplianceEvent } from '../services/complianceEventLog.js';
import { moduloKycAttivo } from '../util/guardiaModuli.js';
import { calcolaTitolariEffettivi, scadenzaVariazioneTe } from '../domain/catenaControllo.js';
import { livelloComplessivo, prossimaRevisione, assessmentCompleto, type LivelloRischioK3 } from '../domain/calcoloRischio.js';
import { screeningBloccaApprovazione, motivoBloccoScreening } from '../domain/screeningKyc.js';
import { apriAnomalia, decidiAnomalia } from '../services/anomalieService.js';
import { preparaSegnalazione, registraTrasmissione } from '../services/segnalazioneFiauService.js';
import { generaDossierStrPdf } from '../services/segnalazioneFiauPdf.js';
import type { DatiFascicoloPerDossier, DossierStr } from '../domain/segnalazioneFiau.js';
import { registraEsitoRetention, prorogaRetention, type EsitoRetentionValore } from '../services/retentionService.js';
import { costruisciReportFascicolo } from '../domain/reportFascicolo.js';
import { generaReportFascicoloPdf } from '../services/fascicoloReportPdf.js';
import { uploadDocumento, rifirmaUrlUpload } from '../services/storageService.js';
import { createHash } from 'node:crypto';
import { recordAudit } from '../util/serverHelpers.js';

// Soglia di default per la verifica rafforzata: €15.000 (D.Lgs. 231/2007, operazioni occasionali).
// Configurabile per tenant in una fase successiva; qui è la base.
const SOGLIA_KYC_DEFAULT_CENT = 1_500_000;

export async function registraRotteKyc(server: FastifyInstance): Promise<void> {
  const vietatoAlCliente = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (req.ruolo === 'cliente') {
      reply.code(403).send({ errore: 'Il fascicolo KYC è riservato allo studio.' });
      return true;
    }
    return false;
  };
  // Modulo Compliance/KYC spento per lo studio → 403 (attivazione modulo per-studio).
  const moduloSpento = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    if (!(await moduloKycAttivo(req.tenantId))) {
      reply.code(403).send({ errore: 'Il modulo Compliance/KYC non è attivo per questo studio.' });
      return true;
    }
    return false;
  };

  // Fascicolo corrente + storico + documenti + override di un cliente.
  server.get<{ Params: { clienteId: string } }>('/clienti/:clienteId/kyc', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const fascicolo = await prisma.fascicoloKyc.findFirst({
      where: { tenantId: req.tenantId, clienteId: req.params.clienteId },
      orderBy: { createdAt: 'desc' },
      include: { storico: { orderBy: { createdAt: 'desc' } }, documenti: true, overrideLog: true, soggetto: true },
    });
    return reply.send({ fascicolo });
  });

  // Crea/aggiorna il SoggettoKyc (Party) del fascicolo dal lato STUDIO. Prima il soggetto principale
  // si popolava solo se il cliente caricava dal portale (portale.ts): senza, catena TE/screening/
  // dossier/report restavano «n/d» (rilievo audit §02). Ora l'operatore può crearlo/modificarlo.
  const TIPI_SOGGETTO = ['persona_fisica', 'persona_giuridica'];
  server.put<{ Params: { id: string } }>('/kyc/:id/soggetto', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = SoggettoKycSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati del soggetto non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true, clienteId: true, soggettoId: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    if (!b.denominazione || String(b.denominazione).trim().length < 2) return reply.code(400).send({ errore: 'Denominazione del soggetto obbligatoria.' });
    const dati = {
      tipo: (TIPI_SOGGETTO.includes(b.tipo ?? '') ? b.tipo : 'persona_fisica') as 'persona_fisica' | 'persona_giuridica',
      denominazione: String(b.denominazione).trim().slice(0, 200),
      codiceFiscale: b.codiceFiscale ? String(b.codiceFiscale).trim().slice(0, 40) : null,
      partitaIva: b.partitaIva ? String(b.partitaIva).trim().slice(0, 40) : null,
      luogoNascita: b.luogoNascita ? String(b.luogoNascita).trim().slice(0, 120) : null,
      dataNascita: b.dataNascita ? String(b.dataNascita).trim().slice(0, 20) : null,
      paeseResidenza: b.paeseResidenza ? String(b.paeseResidenza).trim().slice(0, 80) : null,
      indirizzo: b.indirizzo ? String(b.indirizzo).trim().slice(0, 300) : null,
    };
    let soggetto;
    if (fasc.soggettoId) {
      soggetto = await prisma.soggettoKyc.update({ where: { id: fasc.soggettoId }, data: dati });
    } else {
      soggetto = await prisma.soggettoKyc.create({ data: { tenantId, clienteId: fasc.clienteId, ...dati } });
      await prisma.fascicoloKyc.update({ where: { id }, data: { soggettoId: soggetto.id } });
    }
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_SOGGETTO_AGGIORNATO', entita: `Fascicolo ${id}`, dettagli: `Soggetto ${dati.denominazione}`, ipAddress: req.ip });
    return reply.send({ ok: true, soggetto });
  });

  // Crea/rinnova un fascicolo calcolando livello, rischio e scadenza dal motore puro.
  server.post<{
    Params: { clienteId: string };
    Body: {
      tipoCliente?: string; pep?: boolean; paeseResidenza?: string; paesiAltoRischio?: string[];
      valoreOperazioneCent?: number; sogliaOperazioneCent?: number;
      senzaPresenzaFisica?: boolean; identificatoConSpidOCie?: boolean;
    };
  }>('/clienti/:clienteId/kyc', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    const tenantId = req.tenantId;
    const { clienteId } = req.params;
    const b = req.body || {};
    if (await moduloSpento(req, reply)) return;
    const cliente = await prisma.cliente.findFirst({ where: { id: clienteId, tenantId }, select: { id: true, tipo: true } });
    if (!cliente) return reply.code(404).send({ errore: 'Cliente non trovato' });

    const esito = calcolaRischioKyc({
      tipoCliente: b.tipoCliente ?? cliente.tipo,
      pep: b.pep,
      paeseResidenza: b.paeseResidenza,
      paesiAltoRischio: b.paesiAltoRischio ?? [],
      valoreOperazioneCent: b.valoreOperazioneCent,
      sogliaOperazioneCent: b.sogliaOperazioneCent ?? SOGLIA_KYC_DEFAULT_CENT,
      senzaPresenzaFisica: b.senzaPresenzaFisica,
      identificatoConSpidOCie: b.identificatoConSpidOCie,
    });

    const fascicolo = await prisma.fascicoloKyc.create({
      data: {
        tenantId,
        clienteId,
        stato: 'in_raccolta',
        livelloVerifica: esito.livelloVerifica,
        rischioCalcolato: esito.rischioCalcolato,
        punteggioRischio: esito.punteggioRischio,
        pep: b.pep ?? false,
        paeseResidenza: b.paeseResidenza ?? null,
        storico: {
          create: {
            tenantId,
            statoNuovo: 'in_raccolta',
            attoreUserId: req.userId ?? 'sistema',
            motivazione: `Creato dal motore: ${esito.livelloVerifica} — ${esito.motivazioni.join('; ')}`,
          },
        },
      },
      include: { storico: true },
    });
    // Apertura pratica: primo anello della catena di compliance (spec §8.10).
    await registraComplianceEvent(prisma, {
      tenantId,
      tipo: 'KYC_PRATICA_APERTA',
      attoreUserId: req.userId ?? null,
      payload: { fascicoloId: fascicolo.id, clienteId, livelloVerifica: esito.livelloVerifica, rischio: esito.rischioCalcolato },
    });
    await recordAudit({
      tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_FASCICOLO_CREATO',
      entita: `Cliente ${clienteId}`,
      dettagli: `Livello ${esito.livelloVerifica}, rischio ${esito.rischioCalcolato} (punteggio ${esito.punteggioRischio})`,
      ipAddress: req.ip,
    });
    return reply.send({ ok: true, fascicolo, esito });
  });

  // Transizione di stato (spec v0.2 §8): la macchina a stati valida il passo, il gate MLRO copre il
  // rischio alto, e ogni cambio scrive storico + ComplianceEvent (via il service).
  const STATI_V02 = ['bozza', 'in_raccolta', 'in_verifica', 'in_attesa_approvazione', 'approvato', 'respinto', 'sospeso', 'in_revisione', 'chiuso'];
  server.patch<{ Params: { id: string }; Body: { stato: string; motivazione?: string } }>(
    '/kyc/:id/stato',
    async (req, reply) => {
      if (vietatoAlCliente(req, reply)) return;
      const tenantId = req.tenantId;
      const { id } = req.params;
      const { stato, motivazione } = req.body || {};
      if (await moduloSpento(req, reply)) return;
      if (!STATI_V02.includes(stato)) return reply.code(400).send({ errore: 'Stato non valido' });

      const fascicolo = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId } });
      if (!fascicolo) return reply.code(404).send({ errore: 'Fascicolo non trovato' });

      // Gate §8.2 (profilo regolatorio), §8.3 (MLRO) e §8.4 (screening) vivono in un posto solo:
      // `transizioneKycConGate`, la stessa porta che usa l'approvazione massiva della coda.
      const settings = await prisma.tenantComplianceSettings.findUnique({
        where: { tenantId },
        select: { mlroUserId: true, retentionYears: true, regulatoryProfile: true },
      });

      const esito = await transizioneKycConGate(prisma, {
        tenantId, fascicoloId: id, nuovoStato: stato, attoreUserId: req.userId, ruolo: req.ruolo, motivazione,
        settings: {
          regulatoryProfile: settings?.regulatoryProfile ?? null,
          mlroUserId: settings?.mlroUserId ?? null,
          retentionYears: settings?.retentionYears ?? 5,
        },
      });

      if (esito.esito === 'non_trovato') return reply.code(404).send({ errore: 'Fascicolo non trovato' });
      if (esito.esito === 'stato_ignoto') return reply.code(400).send({ errore: `Stato non riconosciuto: ${esito.valore}` });
      if (esito.esito === 'transizione_non_valida') return reply.code(409).send({ errore: `Transizione non ammessa: ${esito.da} → ${esito.a}` });
      if (esito.esito === 'profilo_mancante') {
        return reply.code(409).send({
          errore: 'Per approvare una pratica KYC configura almeno il profilo regolatorio in Impostazioni → Compliance & AML (§8.2). La nomina dell’MLRO è consigliata ma non blocca.',
        });
      }
      if (esito.esito === 'serve_mlro') return reply.code(403).send({ errore: 'Approvazione di una pratica ad alto rischio riservata all’MLRO o a un ruolo superiore.' });
      if (esito.esito === 'screening_bloccante') return reply.code(409).send({ errore: esito.motivo || 'Approvazione bloccata: screening con un match non risolto.' });

      await recordAudit({
        tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STATO_AGGIORNATO',
        entita: `Fascicolo ${id}`,
        dettagli: `${fascicolo.stato} -> ${stato}${motivazione ? ` (${motivazione})` : ''}`,
        ipAddress: req.ip,
      });
      return reply.send({ ok: true, fascicolo: esito.fascicolo });
    },
  );

  // Coda KYC — la vista aggregata che mancava: i pannelli erano per-fascicolo, quindi approvare
  // dieci pratiche voleva dire aprire dieci schede cliente. Qui si vede cosa attende, PERCHÉ non è
  // ancora approvabile (gli stessi motivi dei gate: `valutaApprovazione`) e si approva in blocco.
  //
  // Gli stati sono quelli aperti: una pratica approvata, respinta o chiusa non attende nulla.
  // Restano dentro anche i due stati legacy v0.1 (`in_attesa_revisione`, `scaduto`) per i
  // vecchi record, che la macchina a stati normalizza.
  const STATI_IN_CODA: StatoKyc[] = [
    'bozza', 'in_raccolta', 'in_verifica', 'in_attesa_approvazione',
    'in_revisione', 'sospeso', 'in_attesa_revisione', 'scaduto',
  ];

  server.get('/kyc/coda', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;

    const settings = await prisma.tenantComplianceSettings.findUnique({
      where: { tenantId },
      select: { mlroUserId: true, regulatoryProfile: true },
    });
    const profiloConfigurato = !!settings?.regulatoryProfile;
    const puoRafforzata = puoApprovareRafforzata(req.ruolo, req.userId, settings?.mlroUserId);

    // Tetto esplicito: la coda è una lista di lavoro, non un'esportazione. 300 pratiche aperte
    // sono già un caso da guardare, non da scorrere in una tabella.
    const fascicoli = await prisma.fascicoloKyc.findMany({
      where: { tenantId, stato: { in: STATI_IN_CODA } },
      orderBy: [{ punteggioRischio: 'desc' }, { createdAt: 'asc' }],
      take: 300,
      select: {
        id: true, stato: true, livelloVerifica: true, rischioCalcolato: true, punteggioRischio: true,
        dataScadenza: true, createdAt: true, updatedAt: true,
        cliente: { select: { id: true, nome: true, tipo: true } },
        soggetto: { select: { denominazione: true } },
        screenings: { select: { tipo: true, esito: true, dataScreening: true, createdAt: true } },
        anomalie: { where: { stato: 'aperta' }, select: { id: true } },
      },
    });

    const righe = fascicoli.map((f) => {
      const screeningBloccante = screeningBloccaApprovazione(f.screenings);
      const { approvabile, motivi } = valutaApprovazione({
        stato: f.stato,
        rischio: f.rischioCalcolato,
        profiloConfigurato,
        puoApprovareRafforzata: puoRafforzata,
        screeningNonRisolto: screeningBloccante,
      });
      return {
        id: f.id,
        stato: f.stato,
        livelloVerifica: f.livelloVerifica,
        rischio: f.rischioCalcolato,
        punteggioRischio: f.punteggioRischio,
        dataScadenza: f.dataScadenza,
        aggiornatoIl: f.updatedAt,
        cliente: f.cliente,
        soggetto: f.soggetto?.denominazione ?? null,
        screeningBloccante,
        anomalieAperte: f.anomalie.length,
        approvabile,
        motivi,
      };
    });

    // Le approvabili in cima: sono quelle su cui si può agire oggi; il resto resta visibile
    // con il motivo, che è l'informazione che serve per sbloccarle.
    righe.sort((a, b) => Number(b.approvabile) - Number(a.approvabile) || b.punteggioRischio - a.punteggioRischio);

    return reply.send({
      fascicoli: righe,
      totale: righe.length,
      profiloConfigurato,
      puoApprovareRafforzata: puoRafforzata,
    });
  });

  // Approvazione massiva. Una pratica alla volta, di proposito: ogni transizione scrive storico e
  // ComplianceEvent, e un rifiuto su una non deve annullare le altre. La risposta dice, per ogni
  // id, se è passata o perché no — un esito parziale mai silenzioso.
  server.post('/kyc/coda/approva', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const tenantId = req.tenantId;

    const parse = ApprovazioneMassivaSchema.safeParse(req.body || {});
    if (!parse.success) {
      return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Richiesta non valida.' });
    }
    const { ids, motivazione } = parse.data;

    const settings = await prisma.tenantComplianceSettings.findUnique({
      where: { tenantId },
      select: { mlroUserId: true, retentionYears: true, regulatoryProfile: true },
    });
    const gate = {
      regulatoryProfile: settings?.regulatoryProfile ?? null,
      mlroUserId: settings?.mlroUserId ?? null,
      retentionYears: settings?.retentionYears ?? 5,
    };

    const approvati: string[] = [];
    const rifiutati: Array<{ id: string; motivo: string }> = [];

    for (const id of ids) {
      const esito = await transizioneKycConGate(prisma, {
        tenantId, fascicoloId: id, nuovoStato: 'approvato',
        attoreUserId: req.userId, ruolo: req.ruolo, motivazione, settings: gate,
      });
      if (esito.esito === 'ok') {
        approvati.push(id);
        await recordAudit({
          tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STATO_AGGIORNATO',
          entita: `Fascicolo ${id}`,
          dettagli: `Approvazione dalla coda${motivazione ? ` (${motivazione})` : ''}`,
          ipAddress: req.ip,
        });
      } else {
        rifiutati.push({ id, motivo: motivoRifiutoApprovazione(esito) });
      }
    }

    return reply.send({ ok: true, approvati: approvati.length, rifiutati });
  });

  // Sblocco motivato (§8, OverrideKyc): l'admin dello studio forza l'operatività a valle nonostante
  // il KYC non approvato, lasciando una motivazione. Vale GIORNI_VALIDITA_OVERRIDE giorni (kycGate).
  server.post<{ Params: { id: string }; Body: { motivazione?: string; azioneSbloccata?: string } }>(
    '/kyc/:id/override',
    async (req, reply) => {
      if (vietatoAlCliente(req, reply)) return;
      if (await moduloSpento(req, reply)) return;
      if (req.ruolo !== 'advisor' && req.ruolo !== 'super_admin') {
        return reply.code(403).send({ errore: 'Lo sblocco motivato è riservato al responsabile dello studio.' });
      }
      const { id } = req.params;
      const motivazione = (req.body?.motivazione || '').trim();
      if (motivazione.length < 10) {
        return reply.code(400).send({ errore: 'La motivazione dello sblocco è obbligatoria (almeno 10 caratteri).' });
      }
      const fascicolo = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId: req.tenantId }, select: { id: true } });
      if (!fascicolo) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
      const azioneSbloccata = (req.body?.azioneSbloccata || 'operativita').slice(0, 60);
      await prisma.overrideKyc.create({
        data: { tenantId: req.tenantId, fascicoloId: id, attoreUserId: req.userId ?? 'sistema', azioneSbloccata, motivazione },
      });
      await registraComplianceEvent(prisma, {
        tenantId: req.tenantId, tipo: 'KYC_OVERRIDE', attoreUserId: req.userId ?? null,
        payload: { fascicoloId: id, azioneSbloccata },
      });
      await recordAudit({
        tenantId: req.tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_OVERRIDE',
        entita: `Fascicolo ${id}`, dettagli: `Sblocco ${azioneSbloccata}: ${motivazione}`, ipAddress: req.ip,
      });
      return reply.send({ ok: true });
    },
  );

  // ── K2 — titolare effettivo, catena di controllo, deposito al registro ──────────────
  server.get<{ Params: { id: string } }>('/kyc/:id/titolare-effettivo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true, soggettoId: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const [titolari, legami, deposito, settings] = await Promise.all([
      prisma.titolareEffettivo.findMany({ where: { tenantId, fascicoloId: id }, include: { soggetto: true } }),
      prisma.legameControllo.findMany({ where: { tenantId, fascicoloId: id } }),
      prisma.depositoRegistroTe.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { createdAt: 'desc' } }),
      prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { sogliaTitolareEffettivo: true } }),
    ]);
    const soglia = settings?.sogliaTitolareEffettivo ?? 25;
    const catena = fasc.soggettoId
      ? calcolaTitolariEffettivi(legami.map((l) => ({ daId: l.daId, aId: l.aId, percentuale: l.percentuale == null ? null : Number(l.percentuale) })), fasc.soggettoId, soglia)
      : [];
    return reply.send({ titolari, legami, deposito, catena, soglia });
  });

  server.post<{ Params: { id: string } }>('/kyc/:id/titolare-effettivo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = TitolareEffettivoSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati del titolare effettivo non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    if (!b.denominazione || String(b.denominazione).trim().length < 2) return reply.code(400).send({ errore: 'Denominazione del titolare effettivo obbligatoria.' });
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const soggetto = await prisma.soggettoKyc.create({
      data: { tenantId, tipo: b.tipo === 'persona_giuridica' ? 'persona_giuridica' : 'persona_fisica', denominazione: String(b.denominazione).slice(0, 200), codiceFiscale: b.codiceFiscale || null, paeseResidenza: b.paeseResidenza || null },
    });
    const te = await prisma.titolareEffettivo.create({
      data: { tenantId, fascicoloId: id, soggettoId: soggetto.id, criterio: ['proprieta', 'controllo', 'altro'].includes(b.criterio ?? '') ? b.criterio as string : 'proprieta', percentuale: b.percentuale != null && Number.isFinite(Number(b.percentuale)) ? Number(b.percentuale) : null, fonte: b.fonte === 'registro_camerale' ? 'registro_camerale' : 'autodichiarazione', note: b.note || null },
      include: { soggetto: true },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_TE_AGGIUNTO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, soggettoId: soggetto.id, criterio: te.criterio } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_TE_AGGIUNTO', entita: `Fascicolo ${id}`, dettagli: `TE ${soggetto.denominazione} (${te.criterio})`, ipAddress: req.ip });
    return reply.send({ ok: true, titolare: te });
  });

  // K2_ROUTES_PLACEHOLDER

  server.post<{ Params: { id: string }; Body: { daId?: string; aId?: string; percentuale?: number; note?: string } }>('/kyc/:id/legame-controllo', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId; const b = req.body || {};
    if (!b.daId || !b.aId) return reply.code(400).send({ errore: 'daId e aId (soggetti) sono obbligatori.' });
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const legame = await prisma.legameControllo.create({
      data: { tenantId, fascicoloId: id, daId: b.daId, aId: b.aId, percentuale: b.percentuale != null && Number.isFinite(Number(b.percentuale)) ? Number(b.percentuale) : null, note: b.note || null },
    });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_LEGAME_AGGIUNTO', entita: `Fascicolo ${id}`, dettagli: `${b.daId} → ${b.aId}`, ipAddress: req.ip });
    return reply.send({ ok: true, legame });
  });

  server.put<{ Params: { id: string } }>('/kyc/:id/deposito-registro', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = DepositoRegistroTeSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati del deposito non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    // §5.2 — se lo studio segnala una variazione, la scadenza del deposito è a 14 giorni.
    const scadenza = b.dataVariazione ? scadenzaVariazioneTe(new Date(b.dataVariazione)) : (b.scadenza ? new Date(b.scadenza) : null);
    const dati = {
      stato: ['da_depositare', 'depositato', 'in_ritardo'].includes(b.stato ?? '') ? b.stato as string : 'da_depositare',
      dataDeposito: b.dataDeposito ? new Date(b.dataDeposito) : null,
      scadenza,
      riferimento: b.riferimento || null,
      note: b.note || null,
    };
    const esistente = await prisma.depositoRegistroTe.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { createdAt: 'desc' }, select: { id: true } });
    const deposito = esistente
      ? await prisma.depositoRegistroTe.update({ where: { id: esistente.id }, data: dati })
      : await prisma.depositoRegistroTe.create({ data: { tenantId, fascicoloId: id, ...dati } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_DEPOSITO_TE', entita: `Fascicolo ${id}`, dettagli: `stato ${dati.stato}${scadenza ? `, scad ${scadenza.toISOString().slice(0, 10)}` : ''}`, ipAddress: req.ip });
    return reply.send({ ok: true, deposito });
  });

  // ── K3 — valutazione del rischio a 4 pilastri (spec §6) ─────────────────────────────
  server.get<{ Params: { id: string } }>('/kyc/:id/rischio', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const valutazioni = await prisma.riskAssessment.findMany({ where: { tenantId, fascicoloId: id }, orderBy: { versione: 'desc' } });
    return reply.send({ corrente: valutazioni[0] ?? null, storico: valutazioni });
  });

  server.post<{ Params: { id: string } }>('/kyc/:id/rischio', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = ValutazioneRischioKycSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Valutazione del rischio non valida.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    // §6/§14 — ogni pilastro va motivato (dati + giudizio), come per il business risk di studio.
    // Senza le quattro motivazioni la valutazione non si salva (prima si accettava incompleta).
    const motivazioni = { cliente: b.clienteMotivazione, geografia: b.geografiaMotivazione, prodotto: b.prodottoMotivazione, canale: b.canaleMotivazione };
    if (!assessmentCompleto(motivazioni)) {
      return reply.code(400).send({ errore: 'Ogni pilastro di rischio (cliente, geografia, prodotto, canale) richiede una motivazione (§6).' });
    }
    const liv = (v: unknown): LivelloRischioK3 => (v === 'medio' || v === 'alto' ? v : 'basso');
    const pilastri = { cliente: liv(b.clienteLivello), geografia: liv(b.geografiaLivello), prodotto: liv(b.prodottoLivello), canale: liv(b.canaleLivello) };
    const complessivo = livelloComplessivo(pilastri);
    const ultima = await prisma.riskAssessment.findFirst({ where: { tenantId, fascicoloId: id }, orderBy: { versione: 'desc' }, select: { versione: true } });
    const ora = new Date();
    const assessment = await prisma.riskAssessment.create({
      data: {
        tenantId, fascicoloId: id,
        clienteLivello: pilastri.cliente, clienteMotivazione: b.clienteMotivazione || null,
        geografiaLivello: pilastri.geografia, geografiaMotivazione: b.geografiaMotivazione || null,
        prodottoLivello: pilastri.prodotto, prodottoMotivazione: b.prodottoMotivazione || null,
        canaleLivello: pilastri.canale, canaleMotivazione: b.canaleMotivazione || null,
        livelloComplessivo: complessivo, motivazioneComplessiva: b.motivazioneComplessiva || null,
        versione: (ultima?.versione ?? 0) + 1, prossimaRevisione: prossimaRevisione(ora, complessivo),
        attoreUserId: req.userId ?? null,
      },
    });
    // Riflette il rischio sul fascicolo: rischio alto → verifica rafforzata (scelta del titolare, §8.3).
    await prisma.fascicoloKyc.update({
      where: { id },
      data: { rischioCalcolato: complessivo, ...(complessivo === 'alto' ? { livelloVerifica: 'rafforzata' } : {}) },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_RISCHIO_VALUTATO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, complessivo, versione: assessment.versione } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_RISCHIO_VALUTATO', entita: `Fascicolo ${id}`, dettagli: `Rischio ${complessivo} (v${assessment.versione})`, ipAddress: req.ip });
    return reply.send({ ok: true, assessment, complessivo });
  });

  // ── K6 — documenti d'identità del soggetto KYC (upload sicuro, cifrato/firmato in storage) ──
  server.get<{ Params: { soggettoId: string } }>('/kyc/soggetto/:soggettoId/documenti', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { soggettoId } = req.params; const tenantId = req.tenantId;
    const sog = await prisma.soggettoKyc.findFirst({ where: { id: soggettoId, tenantId }, select: { id: true } });
    if (!sog) return reply.code(404).send({ errore: 'Soggetto non trovato' });
    const documenti = await prisma.documentoIdentita.findMany({ where: { tenantId, soggettoId }, orderBy: { createdAt: 'desc' } });
    return reply.send({ documenti: documenti.map((d) => ({ ...d, urlStorage: rifirmaUrlUpload(d.urlStorage) })) });
  });

  server.post<{ Params: { soggettoId: string } }>('/kyc/soggetto/:soggettoId/documento', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = DocumentoIdentitaKycSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati del documento non validi.' });
    const { soggettoId } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const sog = await prisma.soggettoKyc.findFirst({ where: { id: soggettoId, tenantId }, select: { id: true } });
    if (!sog) return reply.code(404).send({ errore: 'Soggetto non trovato' });
    if (!b.contentBase64 || !b.filename) return reply.code(400).send({ errore: 'File (contentBase64) e nome file obbligatori.' });
    let url: string;
    try {
      const res = await uploadDocumento(String(b.filename), String(b.contentBase64), tenantId);
      if (!res.ok || !res.url) return reply.code(400).send({ errore: 'Upload non riuscito.' });
      url = res.url;
    } catch (e: any) {
      return reply.code(400).send({ errore: e?.message || 'File non ammesso.' });
    }
    const hash = createHash('sha256').update(Buffer.from(String(b.contentBase64), 'base64')).digest('hex');
    const doc = await prisma.documentoIdentita.create({
      data: {
        tenantId, soggettoId,
        tipo: ['carta_identita', 'passaporto', 'permesso_soggiorno', 'altro'].includes(b.tipo ?? '') ? b.tipo as string : 'altro',
        numero: b.numero || null, emittente: b.emittente || null,
        scadenza: b.scadenza ? new Date(b.scadenza) : null,
        urlStorage: url, hashSha256: hash, esitoVerifica: null,
      },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_DOCUMENTO_CARICATO', attoreUserId: req.userId ?? null, payload: { soggettoId, tipo: doc.tipo, hash } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_DOCUMENTO_CARICATO', entita: `Soggetto ${soggettoId}`, dettagli: `Documento ${doc.tipo}`, ipAddress: req.ip });
    return reply.send({ ok: true, documento: { ...doc, urlStorage: rifirmaUrlUpload(doc.urlStorage) } });
  });

  // ── K5 — screening PEP / sanzioni / media negativi (processo MANUALE, spec §5.1.5/§8.4/§10) ──
  // Le due liste sono `as const`: il tipo inferito è quello che la colonna Prisma accetta
  // (enum), e la guardia lo restituisce senza cast sparsi. Un valore fuori elenco non entra.
  const TIPI_SCREENING = ['sanzioni', 'pep', 'media_negativi'] as const;
  const ESITI_SCREENING = ['nessun_match', 'match_da_valutare', 'match_confermato', 'falso_positivo'] as const;
  const isTipoScreening = (v: unknown): v is (typeof TIPI_SCREENING)[number] =>
    typeof v === 'string' && (TIPI_SCREENING as readonly string[]).includes(v);
  const isEsitoScreening = (v: unknown): v is (typeof ESITI_SCREENING)[number] =>
    typeof v === 'string' && (ESITI_SCREENING as readonly string[]).includes(v);

  server.get<{ Params: { id: string } }>('/kyc/:id/screening', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const screenings = await prisma.screeningKyc.findMany({ where: { tenantId, fascicoloId: id }, orderBy: { dataScreening: 'desc' } });
    return reply.send({
      screenings: screenings.map((s) => ({ ...s, allegatoUrl: s.allegatoUrl ? rifirmaUrlUpload(s.allegatoUrl) : null })),
      bloccaApprovazione: screeningBloccaApprovazione(screenings),
      motivoBlocco: motivoBloccoScreening(screenings) || null,
    });
  });

  server.post<{ Params: { id: string } }>('/kyc/:id/screening', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = ScreeningKycSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati dello screening non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true, soggettoId: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    if (!isTipoScreening(b.tipo)) return reply.code(400).send({ errore: 'Tipo screening non valido (sanzioni | pep | media_negativi).' });
    const esito = isEsitoScreening(b.esito) ? b.esito : 'nessun_match';
    // Allegato opzionale dell'esito (spec §10: processo manuale con allegato), cifrato in storage come K6.
    let allegatoUrl: string | null = null;
    if (b.allegatoContentBase64 && b.allegatoFilename) {
      try {
        const res = await uploadDocumento(String(b.allegatoFilename), String(b.allegatoContentBase64), tenantId);
        if (!res.ok || !res.url) return reply.code(400).send({ errore: 'Upload allegato non riuscito.' });
        allegatoUrl = res.url;
      } catch (e: any) {
        return reply.code(400).send({ errore: e?.message || 'Allegato non ammesso.' });
      }
    }
    const screening = await prisma.screeningKyc.create({
      data: {
        tenantId, fascicoloId: id, soggettoId: fasc.soggettoId ?? null,
        tipo: b.tipo, esito, fonte: b.fonte || 'manuale',
        matchDettagli: b.matchDettagli || null, allegatoUrl, attoreUserId: req.userId ?? null,
      },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_SCREENING_REGISTRATO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, screeningTipo: screening.tipo, esito: screening.esito } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_SCREENING_REGISTRATO', entita: `Fascicolo ${id}`, dettagli: `Screening ${screening.tipo}: ${screening.esito}`, ipAddress: req.ip });
    return reply.send({ ok: true, screening: { ...screening, allegatoUrl: screening.allegatoUrl ? rifirmaUrlUpload(screening.allegatoUrl) : null } });
  });

  server.patch<{ Params: { id: string; sid: string } }>('/kyc/:id/screening/:sid/risolvi', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = RisoluzioneScreeningSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati della risoluzione non validi.' });
    const { id, sid } = req.params; const tenantId = req.tenantId; const b = parse.data;
    // Le due chiusure di un match: falso_positivo (scartato dopo esame) o match_confermato (vero → non si approva).
    if (b.esito !== 'falso_positivo' && b.esito !== 'match_confermato') {
      return reply.code(400).send({ errore: "Esito di risoluzione valido: 'falso_positivo' o 'match_confermato'." });
    }
    if (!b.notaRisoluzione || String(b.notaRisoluzione).trim().length < 10) {
      return reply.code(400).send({ errore: 'Motivazione della risoluzione obbligatoria (almeno 10 caratteri).' });
    }
    const esistente = await prisma.screeningKyc.findFirst({ where: { id: sid, tenantId, fascicoloId: id }, select: { id: true } });
    if (!esistente) return reply.code(404).send({ errore: 'Screening non trovato' });
    const aggiornato = await prisma.screeningKyc.update({
      where: { id: sid },
      data: { esito: b.esito, notaRisoluzione: String(b.notaRisoluzione).trim(), risoltoDa: req.userId ?? null, risoltoIl: new Date() },
    });
    await registraComplianceEvent(prisma, { tenantId, tipo: 'KYC_SCREENING_MATCH_RISOLTO', attoreUserId: req.userId ?? null, payload: { fascicoloId: id, screeningId: sid, esito: aggiornato.esito } });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_SCREENING_MATCH_RISOLTO', entita: `Fascicolo ${id}`, dettagli: `Screening ${aggiornato.tipo} risolto: ${aggiornato.esito}`, ipAddress: req.ip });
    return reply.send({ ok: true, screening: { ...aggiornato, allegatoUrl: aggiornato.allegatoUrl ? rifirmaUrlUpload(aggiornato.allegatoUrl) : null } });
  });

  // ── K8a — anomalie / segnalazioni interne e decisioni MLRO (spec §5.3) ──────────────────
  const TIPI_ANOMALIA = ['match_sanzioni', 'match_pep', 'operazione_sospetta', 'documento_incongruente', 'rischio_elevato', 'altro'];
  const DECISIONI_MLRO = ['nessuna_azione', 'monitoraggio_rafforzato', 'segnalazione_fiau', 'chiusura_rapporto'];

  // Gate MLRO (§8.3, come l'approvazione rafforzata): advisor/super_admin, oppure l'utente nominato
  // MLRO nel tenant (K0). La decisione su un'anomalia è un atto riservato.
  const puoDecidereMlro = async (req: FastifyRequest): Promise<boolean> => {
    if (req.ruolo === 'advisor' || req.ruolo === 'super_admin') return true;
    const s = await prisma.tenantComplianceSettings.findUnique({ where: { tenantId: req.tenantId }, select: { mlroUserId: true } });
    return !!req.userId && req.userId === s?.mlroUserId;
  };

  server.get<{ Params: { id: string } }>('/kyc/:id/anomalie', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const anomalie = await prisma.anomaliaKyc.findMany({
      where: { tenantId, fascicoloId: id },
      orderBy: { createdAt: 'desc' },
      include: { decisioni: { orderBy: { createdAt: 'desc' } } },
    });
    return reply.send({ anomalie });
  });

  server.post<{ Params: { id: string } }>('/kyc/:id/anomalie', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = AnomaliaKycSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati dell’anomalia non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    if (!TIPI_ANOMALIA.includes(b.tipo ?? '')) return reply.code(400).send({ errore: 'Tipo anomalia non valido.' });
    if (!b.descrizione || String(b.descrizione).trim().length < 3) return reply.code(400).send({ errore: 'Descrizione obbligatoria.' });
    const anomalia = await apriAnomalia(prisma, { tenantId, fascicoloId: id, tipo: b.tipo as TipoAnomaliaKyc, descrizione: String(b.descrizione).trim(), rilevataDa: req.userId ?? null });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_ANOMALIA_APERTA', entita: `Fascicolo ${id}`, dettagli: `Anomalia ${b.tipo}`, ipAddress: req.ip });
    return reply.send({ ok: true, anomalia });
  });

  server.post<{ Params: { aid: string } }>('/kyc/anomalie/:aid/decisione', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const parse = DecisioneAnomaliaSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati della decisione non validi.' });
    const { aid } = req.params; const tenantId = req.tenantId; const b = parse.data;
    if (!DECISIONI_MLRO.includes(b.decisione ?? '')) return reply.code(400).send({ errore: 'Decisione non valida.' });
    if (!b.motivazione || String(b.motivazione).trim().length < 10) return reply.code(400).send({ errore: 'Motivazione obbligatoria (almeno 10 caratteri).' });
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'La decisione su un’anomalia è riservata all’MLRO o a un ruolo superiore.' });
    const esito = await decidiAnomalia(prisma, { tenantId, anomaliaId: aid, decisione: b.decisione as DecisioneMlro, motivazione: String(b.motivazione).trim(), decisaDa: req.userId ?? null });
    if (esito.esito === 'non_trovata') return reply.code(404).send({ errore: 'Anomalia non trovata' });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_MLRO_DECISIONE', entita: `Anomalia ${aid}`, dettagli: `Decisione ${b.decisione}`, ipAddress: req.ip });
    return reply.send({ ok: true, anomalia: esito.anomalia });
  });

  // ── K8b — segnalazione operazione sospetta (STR) / dossier goAML (spec §5.3/§10) ─────────
  // Coda naturale di un'anomalia decisa `segnalazione_fiau` (K8a). Il sistema PREPARA il dossier e
  // REGISTRA riferimento e timestamp goAML dopo l'invio manuale dell'MLRO; NON trasmette. Tutte le
  // rotte sono riservate all'MLRO/admin (§5.3: fascicolo anomalie con permessi separati; §8.3).

  // Carica dal fascicolo i dati per il dossier (soggetto, TE, rischio corrente, screening, studio+MLRO).
  const caricaDatiDossier = async (
    tenantId: string,
    anomalia: { tipo: string; descrizione: string; createdAt: Date; fascicoloId: string; decisioni: Array<{ decisione: string; motivazione: string; createdAt: Date }> },
  ): Promise<DatiFascicoloPerDossier | null> => {
    const fasc = await prisma.fascicoloKyc.findFirst({
      where: { id: anomalia.fascicoloId, tenantId },
      include: {
        soggetto: true,
        titolariEffettivi: { include: { soggetto: true } },
        riskAssessments: { orderBy: { versione: 'desc' }, take: 1 },
        screenings: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!fasc) return null;
    const [tenant, settings] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { ragioneSociale: true, piva: true } }),
      prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { mlroUserId: true } }),
    ]);
    const r = fasc.riskAssessments[0] ?? null;
    const dec = anomalia.decisioni[0] ?? null;
    return {
      studio: { ragioneSociale: tenant?.ragioneSociale ?? null, partitaIva: tenant?.piva ?? null, mlroUserId: settings?.mlroUserId ?? null },
      soggetto: fasc.soggetto ? { denominazione: fasc.soggetto.denominazione, tipo: fasc.soggetto.tipo, codiceFiscale: fasc.soggetto.codiceFiscale } : null,
      fascicolo: { paeseResidenza: fasc.paeseResidenza, pep: fasc.pep },
      titolariEffettivi: fasc.titolariEffettivi.map((t) => ({ criterio: t.criterio, percentuale: t.percentuale, fonte: t.fonte, soggetto: t.soggetto ? { denominazione: t.soggetto.denominazione } : null })),
      rischio: r
        ? { livelloComplessivo: r.livelloComplessivo, clienteLivello: r.clienteLivello, geografiaLivello: r.geografiaLivello, prodottoLivello: r.prodottoLivello, canaleLivello: r.canaleLivello, motivazioneComplessiva: r.motivazioneComplessiva }
        : null,
      screening: fasc.screenings.map((s) => ({ tipo: s.tipo, esito: s.esito, dataScreening: s.dataScreening, matchDettagli: s.matchDettagli, notaRisoluzione: s.notaRisoluzione })),
      anomalia: { tipo: anomalia.tipo, descrizione: anomalia.descrizione, createdAt: anomalia.createdAt },
      decisione: dec ? { decisione: dec.decisione, motivazione: dec.motivazione, createdAt: dec.createdAt } : null,
    };
  };

  // Elenco delle segnalazioni di un fascicolo (riservato MLRO/admin).
  server.get<{ Params: { id: string } }>('/kyc/:id/segnalazioni', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'Le segnalazioni FIAU sono riservate all’MLRO o a un ruolo superiore.' });
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({ where: { id, tenantId }, select: { id: true } });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const segnalazioni = await prisma.segnalazioneFiau.findMany({
      where: { tenantId, fascicoloId: id },
      orderBy: { createdAt: 'desc' },
      include: { anomalia: { select: { tipo: true, descrizione: true } } },
    });
    return reply.send({ segnalazioni });
  });

  // Prepara (o riprepara) la segnalazione da un'anomalia segnalata_fiau: congela il dossier.
  server.post<{ Params: { aid: string } }>('/kyc/anomalie/:aid/segnalazione', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'La preparazione di una segnalazione FIAU è riservata all’MLRO o a un ruolo superiore.' });
    const { aid } = req.params; const tenantId = req.tenantId;
    const anomalia = await prisma.anomaliaKyc.findFirst({
      where: { id: aid, tenantId },
      include: { decisioni: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!anomalia) return reply.code(404).send({ errore: 'Anomalia non trovata' });
    const dati = await caricaDatiDossier(tenantId, anomalia);
    if (!dati) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const esito = await preparaSegnalazione(prisma, { tenantId, anomalia: { id: anomalia.id, stato: anomalia.stato, fascicoloId: anomalia.fascicoloId }, dati, preparataDa: req.userId ?? null });
    if (esito.esito === 'non_segnalabile') return reply.code(409).send({ errore: 'L’anomalia non è in stato «segnalata FIAU»: prima l’MLRO deve deciderne la segnalazione.' });
    if (esito.esito === 'gia_trasmessa') return reply.code(409).send({ errore: 'La segnalazione è già stata trasmessa: non si riprepara.' });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STR_PREPARATA', entita: `Anomalia ${aid}`, dettagli: `Segnalazione ${esito.segnalazione.id}`, ipAddress: req.ip });
    return reply.send({ ok: true, segnalazione: esito.segnalazione, dossier: esito.dossier });
  });

  // Dossier PDF della segnalazione (riservato MLRO/admin): documento che l'MLRO usa sul portale FIAU.
  server.get<{ Params: { sid: string } }>('/kyc/segnalazioni/:sid/dossier.pdf', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'Il dossier di segnalazione FIAU è riservato all’MLRO o a un ruolo superiore.' });
    const { sid } = req.params; const tenantId = req.tenantId;
    const s = await prisma.segnalazioneFiau.findFirst({ where: { id: sid, tenantId } });
    if (!s) return reply.code(404).send({ errore: 'Segnalazione non trovata' });
    const pdf = await generaDossierStrPdf(s.datiPreparatiJson as unknown as DossierStr, {
      riferimentoGoaml: s.riferimentoGoaml,
      trasmessaAt: s.trasmessaAt ? s.trasmessaAt.toISOString() : null,
    });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STR_DOSSIER_SCARICATO', entita: `Segnalazione ${sid}`, dettagli: 'Export PDF', ipAddress: req.ip });
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `attachment; filename="STR-${sid}.pdf"`)
      .send(pdf);
  });

  // Registra l'invio manuale: riferimento e timestamp goAML rilasciati dal portale FIAU.
  server.post<{ Params: { sid: string } }>('/kyc/segnalazioni/:sid/trasmissione', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'La registrazione dell’invio FIAU è riservata all’MLRO o a un ruolo superiore.' });
    const parse = TrasmissioneFiauSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati della trasmissione non validi.' });
    const { sid } = req.params; const tenantId = req.tenantId; const b = parse.data;
    if (!b.riferimentoGoaml || String(b.riferimentoGoaml).trim().length < 3) return reply.code(400).send({ errore: 'Riferimento goAML obbligatorio (rilasciato dal portale FIAU dopo l’invio).' });
    const esito = await registraTrasmissione(prisma, { tenantId, segnalazioneId: sid, riferimentoGoaml: String(b.riferimentoGoaml), trasmessaDa: req.userId ?? null });
    if (esito.esito === 'non_trovata') return reply.code(404).send({ errore: 'Segnalazione non trovata' });
    if (esito.esito === 'gia_trasmessa') return reply.code(409).send({ errore: 'La segnalazione risulta già trasmessa.' });
    if (esito.esito === 'riferimento_non_valido') return reply.code(400).send({ errore: 'Riferimento goAML non valido.' });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_STR_TRASMESSA', entita: `Segnalazione ${sid}`, dettagli: `Riferimento ${String(b.riferimentoGoaml).trim()}`, ipAddress: req.ip });
    return reply.send({ ok: true, segnalazione: esito.segnalazione });
  });

  // ── K9 — conservazione/retention (spec §5.4/§8.9) ──────────────────────────────────────
  // Atti dell'MLRO a scadenza raggiunta. Riservati MLRO/admin come le altre decisioni riservate.
  const ESITI_RETENTION = ['cancellato', 'anonimizzato'];

  // Conclude la conservazione: cancellazione (etichetta) o anonimizzazione reale del PII.
  server.post<{ Params: { id: string } }>('/kyc/:id/retention/esito', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'La conclusione della conservazione è riservata all’MLRO o a un ruolo superiore.' });
    const parse = EsitoRetentionSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati dell’esito di conservazione non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    if (!ESITI_RETENTION.includes(b.esito ?? '')) return reply.code(400).send({ errore: 'Esito non valido (cancellato | anonimizzato).' });
    const esito = await registraEsitoRetention(prisma, { tenantId, fascicoloId: id, esito: b.esito as EsitoRetentionValore, motivazione: b.motivazione ? String(b.motivazione).trim() : null, decisoDa: req.userId ?? null });
    if (esito.esito === 'non_trovato') return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    if (esito.esito === 'gia_conclusa') return reply.code(409).send({ errore: 'La conservazione di questo fascicolo è già stata conclusa.' });
    if (esito.esito === 'non_scaduta') return reply.code(409).send({ errore: 'La conservazione non è ancora scaduta: nessuna cancellazione o anonimizzazione prima della scadenza (§8.9).' });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_RETENTION_ESITO', entita: `Fascicolo ${id}`, dettagli: `Esito ${b.esito}`, ipAddress: req.ip });
    return reply.send({ ok: true, fascicolo: esito.fascicolo });
  });

  // Proroga la conservazione (sposta la scadenza più avanti, mai indietro).
  server.post<{ Params: { id: string } }>('/kyc/:id/retention/proroga', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    if (!(await puoDecidereMlro(req))) return reply.code(403).send({ errore: 'La proroga della conservazione è riservata all’MLRO o a un ruolo superiore.' });
    const parse = ProrogaRetentionSchema.safeParse(req.body || {});
    if (!parse.success) return reply.code(400).send({ errore: parse.error.issues[0]?.message || 'Dati della proroga non validi.' });
    const { id } = req.params; const tenantId = req.tenantId; const b = parse.data;
    const prorogaAl = b.prorogaAl ? new Date(String(b.prorogaAl)) : null;
    if (!prorogaAl || Number.isNaN(prorogaAl.getTime())) return reply.code(400).send({ errore: 'Data di proroga non valida.' });
    if (!b.motivo || String(b.motivo).trim().length < 10) return reply.code(400).send({ errore: 'Motivazione della proroga obbligatoria (almeno 10 caratteri).' });
    const esito = await prorogaRetention(prisma, { tenantId, fascicoloId: id, prorogaAl, motivo: String(b.motivo).trim(), decisoDa: req.userId ?? null });
    if (esito.esito === 'non_trovato') return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    if (esito.esito === 'gia_conclusa') return reply.code(409).send({ errore: 'La conservazione è già stata conclusa: non si proroga.' });
    if (esito.esito === 'non_in_conservazione') return reply.code(409).send({ errore: 'Il fascicolo non è in conservazione (va prima chiuso).' });
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_RETENTION_PROROGA', entita: `Fascicolo ${id}`, dettagli: `Proroga al ${prorogaAl.toISOString().slice(0, 10)}`, ipAddress: req.ip });
    return reply.send({ ok: true, fascicolo: esito.fascicolo });
  });

  // ── K9/§5.5 — report riassuntivo del fascicolo per ispezione (PDF) ──────────────────────────
  // Documento interno riservato allo studio (mai al cliente): tutto lo stato di adeguata verifica di
  // un cliente in un unico PDF da consegnare all'ispettore. Lettura ai ruoli interni.
  server.get<{ Params: { id: string } }>('/kyc/:id/report.pdf', async (req, reply) => {
    if (vietatoAlCliente(req, reply)) return;
    if (await moduloSpento(req, reply)) return;
    const { id } = req.params; const tenantId = req.tenantId;
    const fasc = await prisma.fascicoloKyc.findFirst({
      where: { id, tenantId },
      include: {
        soggetto: true,
        titolariEffettivi: { include: { soggetto: true } },
        riskAssessments: { orderBy: { versione: 'desc' }, take: 1 },
        screenings: { orderBy: { createdAt: 'desc' } },
        anomalie: { orderBy: { createdAt: 'desc' }, include: { decisioni: { orderBy: { createdAt: 'desc' }, take: 1 } } },
        segnalazioniFiau: { orderBy: { createdAt: 'desc' } },
        storico: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!fasc) return reply.code(404).send({ errore: 'Fascicolo non trovato' });
    const [tenant, settings] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { ragioneSociale: true, piva: true } }),
      prisma.tenantComplianceSettings.findUnique({ where: { tenantId }, select: { mlroUserId: true } }),
    ]);
    const r = fasc.riskAssessments[0] ?? null;
    const report = costruisciReportFascicolo({
      studio: { ragioneSociale: tenant?.ragioneSociale ?? null, partitaIva: tenant?.piva ?? null, mlroUserId: settings?.mlroUserId ?? null },
      fascicolo: {
        stato: fasc.stato, livelloVerifica: fasc.livelloVerifica, rischioCalcolato: fasc.rischioCalcolato,
        dataVerifica: fasc.dataVerifica, dataScadenza: fasc.dataScadenza,
        chiusoAt: fasc.chiusoAt, retentionScadenza: fasc.retentionScadenza, retentionEsito: fasc.retentionEsito,
        paeseResidenza: fasc.paeseResidenza, pep: fasc.pep,
      },
      soggetto: fasc.soggetto ? { denominazione: fasc.soggetto.denominazione, tipo: fasc.soggetto.tipo, codiceFiscale: fasc.soggetto.codiceFiscale } : null,
      titolariEffettivi: fasc.titolariEffettivi.map((t) => ({ criterio: t.criterio, percentuale: t.percentuale, fonte: t.fonte, soggetto: t.soggetto ? { denominazione: t.soggetto.denominazione } : null })),
      rischio: r ? { livelloComplessivo: r.livelloComplessivo, clienteLivello: r.clienteLivello, geografiaLivello: r.geografiaLivello, prodottoLivello: r.prodottoLivello, canaleLivello: r.canaleLivello, motivazioneComplessiva: r.motivazioneComplessiva } : null,
      screening: fasc.screenings.map((s) => ({ tipo: s.tipo, esito: s.esito, dataScreening: s.dataScreening, matchDettagli: s.matchDettagli, notaRisoluzione: s.notaRisoluzione })),
      anomalie: fasc.anomalie.map((a) => ({ tipo: a.tipo, descrizione: a.descrizione, stato: a.stato, decisioni: a.decisioni.map((d) => ({ decisione: d.decisione, motivazione: d.motivazione })) })),
      segnalazioni: fasc.segnalazioniFiau.map((s) => ({ stato: s.stato, riferimentoGoaml: s.riferimentoGoaml, trasmessaAt: s.trasmessaAt })),
      storico: fasc.storico.map((s) => ({ statoPrecedente: s.statoPrecedente, statoNuovo: s.statoNuovo, motivazione: s.motivazione, createdAt: s.createdAt })),
    }, new Date().toISOString());
    const pdf = await generaReportFascicoloPdf(report);
    await recordAudit({ tenantId, userId: req.userId, ruolo: req.ruolo, azione: 'KYC_REPORT_FASCICOLO', entita: `Fascicolo ${id}`, dettagli: 'Export report PDF', ipAddress: req.ip });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `attachment; filename="report-kyc-${id}.pdf"`).send(pdf);
  });
}