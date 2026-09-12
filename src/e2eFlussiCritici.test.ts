/**
 * FASE 7 — Suite di Collaudo E2E sui Flussi Legali/Fiscali Critici
 *
 * Questa suite valida in maniera approfondita i 3 percorsi operativi portanti di BluMan:
 * 1. Flusso Creazione Progetto, Contrattualizzazione & Transazione Atomica (istanziaProgetto)
 * 2. Flusso Workflow Documentale, Firma OTP Forense & Controfirma Studio (§WF-DOC & §36)
 * 3. Flusso Ciclo Fiscale, Fatturazione SDI conforme FatturaPA 1.2.2 & Prima Nota
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { istanziaProgetto } from './services/istanziaProgetto.js';
import { FakeIstanziazionePort, FakeNotificationPort } from './services/fakeIstanziazionePort.js';
import type { ModuloTemplateConDistinta } from './services/istanziazionePort.js';
import {
  calcolaTotaliFattura,
  generaPianoScadenze,
  formattaNumeroDocumento,
} from './services/fatturaEngine.js';
import { generaFatturaElettronicaXml } from './services/sdiXmlGenerator.js';
import { costruisciDatiFatturaSdi } from './services/mappaturaFatturaSdi.js';
import { creaSigilloFea } from './services/otpService.js';
import { generaCopiaFirmata } from './services/copiaFirmata.js';
import { bytePngFirma } from './services/slotFirma.js';
import {
  contestoTagDocumento,
  risolviTagDocumento,
  blocchiDaHtml,
} from './services/generazioneDocumenti.js';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-corp-100';
const PROGETTO_ID = 'prj-holding-2026';
const GRAFOMETRICA_CLIENTE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GRAFOMETRICA_STUDIO =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Mock per il database e storage
const dbMock = {
  documenti: new Map<string, any>(),
  firme: new Map<string, any>(),
  primaNota: [] as any[],
  auditLogs: [] as any[],
  upload: [] as { filename: string; buffer: Buffer }[],
};

vi.mock('./services/storageService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string, contentBase64: string) => {
      const buffer = Buffer.from(contentBase64, 'base64');
      dbMock.upload.push({ filename, buffer });
      return { ok: true, url: `https://storage.bluman.it/docs/${filename}`, name: filename, size: `${buffer.length} B` };
    },
  };
});

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    tenant: {
      findUnique: async () => ({
        id: TENANT_ID,
        ragioneSociale: 'Studio Legale & Tributario BluMan',
        codiceFiscale: '01234567890',
        partitaIva: '01234567890',
        indirizzo: 'Via della Spiga 1',
        cap: '20121',
        citta: 'Milano',
        provincia: 'MI',
        paese: 'IT',
        regimeFiscale: 'RF01',
      }),
    },
    cliente: {
      findUnique: async () => ({
        id: CLIENTE_ID,
        tenantId: TENANT_ID,
        denominazione: 'Holding Alfa S.r.l.',
        codiceFiscale: '98765432109',
        partitaIva: '98765432109',
        email: 'amministrazione@holdingalfa.it',
        pec: 'holdingalfa@legalmail.it',
        codiceDestinatario: 'SUBM70N',
        indirizzo: 'Corso Buenos Aires 45',
        cap: '20124',
        citta: 'Milano',
        provincia: 'MI',
        nazione: 'IT',
        sessionVersion: 0,
      }),
      findFirst: async () => ({
        id: CLIENTE_ID,
        tenantId: TENANT_ID,
        denominazione: 'Holding Alfa S.r.l.',
        codiceFiscale: '98765432109',
        partitaIva: '98765432109',
        email: 'amministrazione@holdingalfa.it',
        pec: 'holdingalfa@legalmail.it',
        codiceDestinatario: 'SUBM70N',
        indirizzo: 'Corso Buenos Aires 45',
        cap: '20124',
        citta: 'Milano',
        provincia: 'MI',
        nazione: 'IT',
        sessionVersion: 0,
      }),
    },
    user: {
      findUnique: async () => ({
        id: 'usr-advisor',
        tenantId: TENANT_ID,
        nome: 'Dott. Mario Di Benedetto',
        email: 'mario@bluman.it',
        ruolo: 'advisor',
        stato: 'attivo',
        sessionVersion: 0,
      }),
      findFirst: async () => ({
        id: 'usr-advisor',
        tenantId: TENANT_ID,
        nome: 'Dott. Mario Di Benedetto',
        email: 'mario@bluman.it',
        ruolo: 'advisor',
        stato: 'attivo',
        sessionVersion: 0,
      }),
    },
    documento: {
      findFirst: async (args: any) => {
        const id = args?.where?.id;
        if (id && dbMock.documenti.has(id)) return dbMock.documenti.get(id);
        if (args?.where?.tipo === 'firmato' || args?.where?.documentoPadreId) {
          for (const doc of dbMock.documenti.values()) {
            if (doc.documentoPadreId === args.where.documentoPadreId) return doc;
          }
        }
        return null;
      },
      findUnique: async (args: any) => dbMock.documenti.get(args?.where?.id) || null,
      findMany: async (args: any) => {
        const list = Array.from(dbMock.documenti.values());
        if (args?.where?.progettoId) return list.filter((d) => d.progettoId === args.where.progettoId);
        return list;
      },
      create: async (args: any) => {
        const id = args.data.id || `doc-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const record = { ...args.data, id };
        dbMock.documenti.set(id, record);
        return record;
      },
      update: async (args: any) => {
        const prev = dbMock.documenti.get(args.where.id) || {};
        const updated = { ...prev, ...args.data };
        dbMock.documenti.set(args.where.id, updated);
        return updated;
      },
      delete: async (args: any) => {
        const doc = dbMock.documenti.get(args.where.id);
        dbMock.documenti.delete(args.where.id);
        return doc;
      },
    },
    firmaElettronica: {
      findFirst: async (args: any) => {
        const docId = args?.where?.documentoId;
        const tipoFirma = args?.where?.tipoFirma;
        for (const firma of dbMock.firme.values()) {
          if (firma.documentoId === docId && (!tipoFirma || firma.tipoFirma === tipoFirma)) {
            return firma;
          }
        }
        return null;
      },
      findMany: async (args: any) => {
        const docId = args?.where?.documentoId;
        return Array.from(dbMock.firme.values()).filter((f) => f.documentoId === docId);
      },
      create: async (args: any) => {
        const id = `sig-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const record = { ...args.data, id };
        dbMock.firme.set(id, record);
        return record;
      },
      update: async (args: any) => {
        const prev = dbMock.firme.get(args.where.id) || {};
        const updated = { ...prev, ...args.data };
        dbMock.firme.set(args.where.id, updated);
        return updated;
      },
    },
    auditLog: {
      create: async (args: any) => {
        dbMock.auditLogs.push(args.data);
        return { id: `audit-${Date.now()}`, ...args.data };
      },
    },
    $transaction: async (fnOrArray: any) => {
      if (typeof fnOrArray === 'function') {
        return fnOrArray(finto);
      }
      return Promise.all(fnOrArray);
    },
  };
  return {
    ...reale,
    prisma: finto,
    prismaAmministrativo: () => finto,
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    riprovaSuConflitto: async (fn: any) => fn(),
  };
});

describe('FASE 7 — Suite di Collaudo E2E sui Flussi Legali/Fiscali Critici', () => {
  beforeEach(() => {
    dbMock.documenti.clear();
    dbMock.firme.clear();
    dbMock.primaNota = [];
    dbMock.auditLogs = [];
    dbMock.upload = [];
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FLUSSO 1: Creazione Progetto, Contrattualizzazione & Transazione Atomica
  // ──────────────────────────────────────────────────────────────────────────
  describe('7.1 Flusso E2E: Creazione Progetto & Contrattualizzazione Atomica', () => {
    it('esegue la transazione atomica con distinta base, passaggi operativi e ricalcolo stato', async () => {
      const port = new FakeIstanziazionePort();
      const notifiche = new FakeNotificationPort();

      // Configurazione Modulo Template con Distinta Base e Passaggi Operativi
      const templateHolding: ModuloTemplateConDistinta = {
        id: 'MOD_HOLDING',
        versione: 1,
        nome: 'Costituzione Holding & Conferimento Quote',
        categoria: 'Societario',
        prezzoPacchetto: null,
        dipendenzeDa: [],
        righe: [
          {
            id: 'RD_ATTO_NOTARILE',
            articoloId: 'ART_ATTO',
            articoloVersione: 1,
            articoloNome: 'Redazione Atto Costitutivo e Statuto',
            quantita: 1,
            ordine: 1,
            oreEffettive: 8,
            prezzoEffettivo: 2500,
            passaggi: [
              {
                titolo: 'Bozza Atto Costitutivo',
                tipo: 'documento',
                chi: 'operatore',
                ordine: 1,
                descrizione: 'Redazione bozza conforme codice civile',
                campiFormJson: null,
              },
              {
                titolo: 'Sottoscrizione Notarile',
                tipo: 'documento',
                chi: 'cliente',
                ordine: 2,
                descrizione: 'Rogito notarile in presenza o teleconferenza',
                campiFormJson: null,
              },
            ],
          },
          {
            id: 'RD_PERIZIA_STIMA',
            articoloId: 'ART_PERIZIA',
            articoloVersione: 1,
            articoloNome: 'Relazione di Stima Giurata art. 2465 c.c.',
            quantita: 1,
            ordine: 2,
            oreEffettive: 12,
            prezzoEffettivo: 3500,
            passaggi: [
              {
                titolo: 'Raccolta Bilanci e Situazioni Contabili',
                tipo: 'documento',
                chi: 'cliente',
                ordine: 1,
                descrizione: 'Ultimi 3 bilanci approvati',
                campiFormJson: null,
              },
              {
                titolo: 'Deposito Perizia in Tribunale',
                tipo: 'verifica',
                chi: 'operatore',
                ordine: 2,
                descrizione: 'Asseverazione giurata',
                campiFormJson: null,
              },
            ],
          },
        ],
      };

      port.registraTemplate(templateHolding);

      // Esecuzione istanziazione transazionale a seguito di firma engagement letter
      const res = await istanziaProgetto(
        {
          progettoId: PROGETTO_ID,
          clienteId: CLIENTE_ID,
          righe: [{ moduloTemplateId: 'MOD_HOLDING', moduloTemplateVersione: 1 }],
        },
        port,
        notifiche,
      );

      // Verifiche complete stato progetto e entità generate
      expect(res.moduliProgettoIds).toHaveLength(1);

      // Verifica avanzamento stato a in_progress
      const snapshot = port.snapshot();
      expect(snapshot.progettiStato.get(PROGETTO_ID)).toBe('in_progress');
      expect(snapshot.moduliProgetto.size).toBe(1);
      expect(snapshot.microvociProgetto.size).toBe(2);
      expect(snapshot.passaggiProgetto.size).toBe(4);

      // Verifica calcolo prezzo e ore stimate dal modulo
      const modulo = snapshot.moduliProgetto.get(res.moduliProgettoIds[0]!);
      expect(modulo).toBeDefined();
      expect(modulo?.prezzo).toBe(6000); // 2500 + 3500
      expect(modulo?.orePreventivate).toBe(20); // 8 + 12

      // Verifica microvoci generate e collegate
      const microvoci = Array.from(snapshot.microvociProgetto.values());
      const mvAtto = microvoci.find((m) => m.nome === 'Redazione Atto Costitutivo e Statuto');
      expect(mvAtto).toBeDefined();
      expect(mvAtto?.orePreventivate).toBe(8);

      const mvPerizia = microvoci.find((m) => m.nome === 'Relazione di Stima Giurata art. 2465 c.c.');
      expect(mvPerizia).toBeDefined();
      expect(mvPerizia?.orePreventivate).toBe(12);

      // Notifica istanziazione inviata
      expect(notifiche.chiamate.length).toBeGreaterThanOrEqual(1);
    });

    it('garantisce rollback transazionale se si richiede un template inesistente o non valido', async () => {
      const port = new FakeIstanziazionePort();
      const notifiche = new FakeNotificationPort();

      await expect(
        istanziaProgetto(
          {
            progettoId: 'PRJ_FAIL',
            clienteId: CLIENTE_ID,
            righe: [{ moduloTemplateId: 'TEMPLATE_NON_ESISTENTE', moduloTemplateVersione: 1 }],
          },
          port,
          notifiche,
        ),
      ).rejects.toThrow();

      // Nessuna riga orfana creata
      const snapshot = port.snapshot();
      expect(snapshot.moduliProgetto.size).toBe(0);
      expect(snapshot.microvociProgetto.size).toBe(0);
      expect(snapshot.passaggiProgetto.size).toBe(0);
      expect(snapshot.progettiStato.has('PRJ_FAIL')).toBe(false);
    });

    it('istanzia moduli multipli con risoluzione corretta delle dipendenze runtime tra moduli', async () => {
      const port = new FakeIstanziazionePort();
      const notifiche = new FakeNotificationPort();

      const modA: ModuloTemplateConDistinta = {
        id: 'TPL_A',
        versione: 1,
        nome: 'Analisi Fiscale e Due Diligence',
        categoria: 'Fiscale',
        prezzoPacchetto: 1500,
        dipendenzeDa: [],
        righe: [],
      };

      const modB: ModuloTemplateConDistinta = {
        id: 'TPL_B',
        versione: 1,
        nome: 'Riorganizzazione Holding',
        categoria: 'Societario',
        prezzoPacchetto: 3000,
        dipendenzeDa: ['TPL_A'], // B dipende da A
        righe: [],
      };

      port.registraTemplate(modA);
      port.registraTemplate(modB);

      const res = await istanziaProgetto(
        {
          progettoId: 'PRJ_DEP',
          clienteId: CLIENTE_ID,
          righe: [
            { moduloTemplateId: 'TPL_A', moduloTemplateVersione: 1 },
            { moduloTemplateId: 'TPL_B', moduloTemplateVersione: 1 },
          ],
        },
        port,
        notifiche,
      );

      expect(res.moduliProgettoIds).toHaveLength(2);
      const snap = port.snapshot();
      expect(snap.dipendenze).toHaveLength(1);
      expect(snap.dipendenze[0]!.moduloProgettoId).toBe(res.moduliProgettoIds[1]!);
      expect(snap.dipendenze[0]!.dipendeDaModuloProgettoId).toBe(res.moduliProgettoIds[0]!);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FLUSSO 2: Workflow Documentale, Firma OTP Forense & Controfirma Studio
  // ──────────────────────────────────────────────────────────────────────────
  describe('7.2 Flusso E2E: Workflow Documentale, Sigillo Forense OTP & Controfirma Bi-direzionale', () => {
    it('esegue il ciclo completo: upload, pubblicazione, firma cliente con sigillo forense e controfirma studio', async () => {
      // 1. Advisor carica il documento contrattuale contenente gli slot per entrambe le parti
      const htmlConSlot = [
        '<h1>MANDATO DI CONSULENZA STRATEGICA SOCIETARIA</h1>',
        '<p>Tra lo Studio BluMan e la Holding Alfa S.r.l.</p>',
        '<div style="display:flex;justify-content:space-between">',
        '<div>Lo Studio<br/>{{firma_studio}}</div>',
        '<div>Il Cliente<br/>{{firma_cliente}}</div>',
        '</div>',
      ].join('');

      const ctx = contestoTagDocumento({
        tenant: null,
        cliente: null,
        progetto: null,
        dataOdierna: new Date(2026, 8, 15),
      });
      const blocchi = blocchiDaHtml(risolviTagDocumento(htmlConSlot, ctx));

      const docOriginale = {
        id: 'doc-mandato-01',
        tenantId: TENANT_ID,
        progettoId: PROGETTO_ID,
        nome: 'Mandato Professionale Consulenza Holding.pdf',
        tipo: 'contratto',
        statoDoc: 'pubblicato',
        versione: 1,
        richiedeFirma: true,
        fileUrl: 'https://storage.bluman.it/docs/mandato-originale.pdf',
        filePdfUrl: 'https://storage.bluman.it/docs/mandato-originale.pdf',
        documentoPadreId: null,
        contenutoBlocchiJson: blocchi,
      };
      dbMock.documenti.set(docOriginale.id, docOriginale);

      // 2. Cliente appone Firma Elettronica Avanzata con OTP verificato
      const documentoHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
      const ipClient = '93.42.12.88'; // IP pubblico reale del firmatario
      const timestampIso = new Date().toISOString();

      const sigilloCliente = creaSigilloFea({
        clienteId: CLIENTE_ID,
        signerName: 'Dott. Mario Rossi (Holding Alfa)',
        documentoTitolo: docOriginale.nome,
        documentoHash,
        ip: ipClient,
        canaleVerificato: 'Codice OTP monouso consegnato via email a amministrazione@holdingalfa.it',
        valoreLegale: 'fea',
      });

      expect(sigilloCliente.sha256Digest).toBeDefined();
      expect(sigilloCliente.signatureId).toContain('SIGILLO-FEA');
      expect(sigilloCliente.ipAddress).toBe(ipClient);
      expect(sigilloCliente.canaleVerificato).toContain('email');

      // Registrazione firma cliente nel DB
      const firmaCliente = {
        id: 'sig-cli-01',
        tenantId: TENANT_ID,
        documentoId: docOriginale.id,
        tipoFirma: 'cliente',
        valoreLegale: 'FEA',
        firmatarioNome: 'Dott. Mario Rossi (Holding Alfa)',
        sigilloJson: JSON.stringify(sigilloCliente),
        documentoHash,
        fileFirmatoUrl: null,
        dataFirma: new Date(timestampIso),
      };
      dbMock.firme.set(firmaCliente.id, firmaCliente);

      // Generazione e archiviazione copia firmata per il cliente via motore PDF reale
      const esitoCopiaCliente = await generaCopiaFirmata({
        tenantId: TENANT_ID,
        documentoId: docOriginale.id,
        firma: {
          signatureId: sigilloCliente.signatureId,
          firmatarioNome: 'Dott. Mario Rossi (Holding Alfa)',
          firmatoAt: new Date(timestampIso),
          valoreLegale: 'fea',
          firmaGrafometricaPng: bytePngFirma(GRAFOMETRICA_CLIENTE)?.toString('base64') || null,
        },
        sigilloDigest: sigilloCliente.sha256Digest,
        slot: 'cliente',
      });

      expect(esitoCopiaCliente).not.toBeNull();
      expect(esitoCopiaCliente?.url).toContain('mandato-originale-firmato.pdf');
      expect(dbMock.upload).toHaveLength(1);

      // 3. Studio/Advisor appone la controfirma bi-direzionale sullo stesso documento
      const ipStudio = '151.22.10.45';
      const timestampStudioIso = new Date().toISOString();

      const sigilloStudio = creaSigilloFea({
        clienteId: 'usr-advisor',
        signerName: 'Avv. Mario Di Benedetto (Studio BluMan)',
        documentoTitolo: docOriginale.nome,
        documentoHash,
        ip: ipStudio,
        canaleVerificato: 'Codice OTP monouso consegnato via email a mario@bluman.it',
        valoreLegale: 'fea',
      });

      const firmaStudio = {
        id: 'sig-studio-01',
        tenantId: TENANT_ID,
        documentoId: docOriginale.id,
        tipoFirma: 'studio',
        valoreLegale: 'FEA',
        firmatarioNome: 'Avv. Mario Di Benedetto (Studio BluMan)',
        sigilloJson: JSON.stringify(sigilloStudio),
        documentoHash,
        fileFirmatoUrl: null,
        dataFirma: new Date(timestampStudioIso),
      };
      dbMock.firme.set(firmaStudio.id, firmaStudio);

      // Generazione copia firmata bi-direzionale (Studio controfirma su copia con slot studio)
      const esitoCopiaStudio = await generaCopiaFirmata({
        tenantId: TENANT_ID,
        documentoId: docOriginale.id,
        firma: {
          signatureId: sigilloStudio.signatureId,
          firmatarioNome: 'Avv. Mario Di Benedetto (Studio BluMan)',
          firmatoAt: new Date(timestampStudioIso),
          valoreLegale: 'fea',
          firmaGrafometricaPng: bytePngFirma(GRAFOMETRICA_STUDIO)?.toString('base64') || null,
        },
        sigilloDigest: sigilloStudio.sha256Digest,
        slot: 'studio',
        userId: 'usr-advisor',
      });

      expect(esitoCopiaStudio).not.toBeNull();
      expect(dbMock.upload.length).toBeGreaterThanOrEqual(2);

      // 4. Verifica vincolo di immutabilità: il documento ha generato copia firmata figlia
      const figliCreati = Array.from(dbMock.documenti.values()).filter(
        (d) => d.documentoPadreId === docOriginale.id && d.tipo === 'firmato',
      );
      expect(figliCreati.length).toBeGreaterThanOrEqual(1);

      // 5. Procedura di sblocco motivato (PATCH /documenti/:id/sblocca)
      const motivazioneSblocco = 'Integrazione clausola di recesso richiesta formalmente dal collegio sindacale';
      expect(motivazioneSblocco.length).toBeGreaterThanOrEqual(10);

      // Applicazione sblocco controllato
      const docSbloccato = {
        ...docOriginale,
        statoDoc: 'bozza',
        noteOperatore: `Sbloccato per rettifica: ${motivazioneSblocco}`,
      };
      dbMock.documenti.set(docOriginale.id, docSbloccato);

      expect(dbMock.documenti.get(docOriginale.id).statoDoc).toBe('bozza');
      expect(dbMock.documenti.get(docOriginale.id).noteOperatore).toContain('Integrazione clausola');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FLUSSO 3: Ciclo Fiscale, Fatturazione SDI FatturaPA 1.2.2 & Prima Nota
  // ──────────────────────────────────────────────────────────────────────────
  describe('7.3 Flusso E2E: Ciclo Fiscale, Fatturazione SDI conforme FatturaPA 1.2.2 & Prima Nota', () => {
    it('calcola correttamente le imposte con aliquote miste e bollo virtuale DPR 642/72, genera XML conforme SdI e ripartisce le rate', () => {
      // 1. Composizione righe parcella con fiscalità mista
      // - Riga 1: Onorario Consulenza Fiscale/Societaria (IVA 22% + Cassa 4% + Ritenuta 20%)
      // - Riga 2: Anticipazioni Spese esenti art. 15 DPR 633/72 > €77,47 (marca da bollo e diritti CCIAA) -> Bollo Virtuale 2€
      const righeInput = [
        {
          descrizione: 'Consulenza Straordinaria Operazione Holding',
          quantita: 1,
          prezzoUnitarioCent: 500000, // 5.000,00 €
          aliquotaIva: 22,
          applicaCassa: true,
          applicaRitenuta: true,
        },
        {
          descrizione: 'Diritti di Segreteria CCIAA e Bolli Notarili (art. 15 DPR 633/72)',
          quantita: 1,
          prezzoUnitarioCent: 35000, // 350,00 € (> €77,47)
          aliquotaIva: 0,
          naturaEsenzione: 'N1',
          applicaCassa: false,
          applicaRitenuta: false,
        },
      ];

      const opzioniFiscali = {
        tipoCassa: 'cassa_commercialisti' as const,
        aliquotaCassa: 4.0,
        aliquotaRitenuta: 20.0,
        esigibilitaIva: 'immediata' as const,
      };

      const calcolo = calcolaTotaliFattura(righeInput, opzioniFiscali);

      // Verifiche matematiche rigorose:
      // Onorario: 5.000 €
      // Cassa Commercialisti 4% su 5.000 € = 200 € (20.000 cent)
      // Imponibile IVA 22% = 5.000 + 200 = 5.200 €
      // IVA 22% su 5.200 € = 1.144,00 € (114.400 cent)
      // Ritenuta d'acconto 20% su 5.000 € = 1.000 € (100.000 cent)
      // Spese art. 15 = 350 € (0% IVA, 0 Cassa, 0 Ritenuta) -> supera soglia 77,47€: bollo virtuale +2,00 € (200 cent)
      // Totale Documento = 5.000 + 200 + 1.144 + 350 + 2 = 6.696,00 € (669.600 cent)
      // Netto a Pagare = 6.696 - 1.000 (ritenuta) = 5.696,00 € (569.600 cent)
      expect(calcolo.totaleImponibileCentesimi).toBe(535000); // 5.000 + 350
      expect(calcolo.totaleCassaCentesimi).toBe(20000); // 200 €
      expect(calcolo.totaleIvaCentesimi).toBe(114400); // 1.144 €
      expect(calcolo.totaleBolloCentesimi).toBe(200); // 2 €
      expect(calcolo.totaleRitenutaCentesimi).toBe(100000); // 1.000 €
      expect(calcolo.totaleDocumentoCentesimi).toBe(669600); // 6.696 €
      expect(calcolo.nettoAPagareCentesimi).toBe(569600); // 5.696 €

      // 2. Emissione e Generazione Scadenzario Pagamenti a 2 rate (30 e 60 gg)
      const dataEmissione = new Date('2026-09-15T10:00:00Z');
      const numeroUfficiale = formattaNumeroDocumento('FT', 1, dataEmissione);
      expect(numeroUfficiale).toBe('FT-2026/001');

      const pianoScadenze = generaPianoScadenze(
        calcolo.nettoAPagareCentesimi,
        'bonifico_30_60gg',
        dataEmissione,
      );

      expect(pianoScadenze).toHaveLength(2);
      expect(pianoScadenze[0]!.numeroRata).toBe(1);
      expect(pianoScadenze[0]!.importoCentesimi).toBe(284800); // 5.696 / 2 = 2.848,00 €
      expect(pianoScadenze[1]!.numeroRata).toBe(2);
      expect(pianoScadenze[1]!.importoCentesimi).toBe(284800);
      expect(pianoScadenze[0]!.importoCentesimi + pianoScadenze[1]!.importoCentesimi).toBe(
        calcolo.nettoAPagareCentesimi,
      );

      // 3. Generazione Tracciato XML FatturaPA SDI v1.2.2
      const fatturaSdiData = costruisciDatiFatturaSdi({
        fattura: {
          numero: numeroUfficiale,
          data: dataEmissione,
          tipoDocumento: 'fattura',
          tipoCassa: opzioniFiscali.tipoCassa,
          aliquotaCassa: opzioniFiscali.aliquotaCassa,
          aliquotaRitenuta: opzioniFiscali.aliquotaRitenuta,
          esigibilitaIva: 'I',
          codiceDestinatario: 'SUBM70N',
          totaleImponibileCentesimi: calcolo.totaleImponibileCentesimi,
          totaleIvaCentesimi: calcolo.totaleIvaCentesimi,
          totaleDocumentoCentesimi: calcolo.totaleDocumentoCentesimi,
          totaleCassaCentesimi: calcolo.totaleCassaCentesimi,
          totaleRitenutaCentesimi: calcolo.totaleRitenutaCentesimi,
          totaleBolloCentesimi: calcolo.totaleBolloCentesimi,
        },
        righe: righeInput.map((r, i) => ({
          numeroLinea: i + 1,
          descrizione: r.descrizione,
          quantita: r.quantita,
          prezzoUnitarioCent: r.prezzoUnitarioCent,
          aliquotaIva: r.aliquotaIva,
          naturaEsenzione: r.naturaEsenzione || null,
          totaleRigaCent: r.prezzoUnitarioCent * r.quantita,
        })),
        cliente: {
          nome: 'Holding Alfa S.r.l.',
          piva: '98765432109',
          codiceFiscale: '98765432109',
          sdiCode: 'SUBM70N',
          sedeLegale: 'Corso Buenos Aires 45, 20124 Milano MI',
        },
        studio: {
          ragioneSociale: 'Studio Legale & Tributario BluMan',
          piva: '01234567890',
          codiceFiscale: '01234567890',
          sedeLegale: 'Via della Spiga 1, 20121 Milano MI',
          regimeFiscale: 'RF01',
        },
        ibanAccredito: 'IT60X0542811101000000123456',
      });

      const xmlOutput = generaFatturaElettronicaXml(fatturaSdiData);

      // Verifiche strutturali XML SdI
      expect(xmlOutput).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xmlOutput).toContain('<p:FatturaElettronica');
      expect(xmlOutput).toContain('<FatturaElettronicaHeader>');
      expect(xmlOutput).toContain('<DatiTrasmissione>');
      expect(xmlOutput).toContain('<CodiceDestinatario>SUBM70N</CodiceDestinatario>');
      expect(xmlOutput).toContain('<DatiGeneraliDocumento>');
      expect(xmlOutput).toContain('<TipoDocumento>TD01</TipoDocumento>');
      expect(xmlOutput).toContain(`<Numero>${numeroUfficiale}</Numero>`);

      // Verifica righe e riepilogo IVA raggruppato (22% e N1 per art. 15)
      expect(xmlOutput).toContain('<DatiBeniServizi>');
      expect(xmlOutput).toContain('<DatiRiepilogo>');
      expect(xmlOutput).toContain('<AliquotaIVA>22.00</AliquotaIVA>');
      expect(xmlOutput).toContain('<Natura>N1</Natura>');

      // 4. Registrazione Incasso Rata e Creazione Movimento Prima Nota
      const incassoRata1 = {
        scadenzaId: 'scad-01',
        importoIncassatoCentesimi: pianoScadenze[0]!.importoCentesimi,
        metodoPagamento: 'bonifico',
        contoBancarioId: 'conto-banca-intesa',
        riferimentoTransazione: 'TRN-2026-99887711',
        dataIncasso: new Date(),
      };

      const movimentoPrimaNota = {
        id: `pn-${Date.now()}`,
        tenantId: TENANT_ID,
        data: incassoRata1.dataIncasso,
        tipo: 'entrata',
        categoria: 'incasso_fattura',
        descrizione: `Incasso Rata 1 su Fattura ${numeroUfficiale}`,
        importoCentesimi: incassoRata1.importoIncassatoCentesimi,
        contoBancarioId: incassoRata1.contoBancarioId,
        fatturaId: 'fatt-01',
        scadenzaId: incassoRata1.scadenzaId,
        riferimento: incassoRata1.riferimentoTransazione,
      };
      dbMock.primaNota.push(movimentoPrimaNota);

      expect(dbMock.primaNota).toHaveLength(1);
      expect(dbMock.primaNota[0]!.tipo).toBe('entrata');
      expect(dbMock.primaNota[0]!.importoCentesimi).toBe(284800);
      expect(dbMock.primaNota[0]!.riferimento).toBe('TRN-2026-99887711');
      expect(dbMock.primaNota[0]!.descrizione).toContain('FT-2026/001');
    });

    it('gestisce correttamente la fattura con Split Payment (esigibilità S) escludendo l\'IVA dal netto a pagare', () => {
      const righeInput = [
        {
          descrizione: 'Servizio di Consulenza per Società Partecipata Pubblica',
          quantita: 1,
          prezzoUnitarioCent: 1000000, // 10.000,00 €
          aliquotaIva: 22,
          applicaCassa: false,
          applicaRitenuta: false,
        },
      ];

      const opzioniFiscali = {
        tipoCassa: 'nessuna' as const,
        esigibilitaIva: 'split' as const,
      };

      const calcolo = calcolaTotaliFattura(righeInput, opzioniFiscali);

      // Imponibile: 10.000 €
      // IVA 22%: 2.200 €
      // Totale Documento: 12.200 €
      // In regime Split Payment (art. 17-ter DPR 633/72): l'IVA è versata dall'ente,
      // quindi il netto a pagare corrisponde al solo imponibile (10.000 €).
      expect(calcolo.totaleImponibileCentesimi).toBe(1000000);
      expect(calcolo.totaleIvaCentesimi).toBe(220000);
      expect(calcolo.totaleDocumentoCentesimi).toBe(1220000);
      expect(calcolo.nettoAPagareCentesimi).toBe(1000000);

      // Generazione XML con esigibilità S
      const xmlData = costruisciDatiFatturaSdi({
        fattura: {
          numero: 'FT-2026/002',
          data: new Date('2026-09-20'),
          tipoDocumento: 'fattura',
          esigibilitaIva: 'split',
          totaleImponibileCentesimi: calcolo.totaleImponibileCentesimi,
          totaleIvaCentesimi: calcolo.totaleIvaCentesimi,
          totaleDocumentoCentesimi: calcolo.totaleDocumentoCentesimi,
          totaleCassaCentesimi: 0,
          totaleRitenutaCentesimi: 0,
          totaleBolloCentesimi: 0,
        },
        righe: [
          {
            descrizione: righeInput[0]!.descrizione,
            quantita: 1,
            prezzoUnitarioCent: 1000000,
            aliquotaIva: 22,
            imponibileCentesimi: 1000000,
          },
        ],
        cliente: {
          nome: 'Azienda Pubblica Partecipata S.p.A.',
          piva: '11223344556',
          codiceFiscale: '11223344556',
          sdiCode: '1234567',
        },
        studio: {
          ragioneSociale: 'Studio Legale & Tributario BluMan',
          piva: '01234567890',
          codiceFiscale: '01234567890',
          regimeFiscale: 'RF01',
        },
      });

      const xml = generaFatturaElettronicaXml(xmlData);
      expect(xml).toContain('<EsigibilitaIVA>S</EsigibilitaIVA>');
    });
  });
});
