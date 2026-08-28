/**
 * Punto 2 piano gap — verbale di firma automatico.
 *
 * Tre livelli di copertura:
 * 1. Il builder puro del PDF (`services/verbaleFirma.ts`): contenuto certificativo —
 *    sezione OTP presente solo se un codice è stato usato davvero, IP mancante scritto
 *    come "non registrato", grafometrica incorporata solo se decodificabile.
 * 2. I guard che proteggono il verbale nel fascicolo: atto certificativo, quindi niente
 *    richieste di modifica (409) e niente eliminazione (409) — come i documenti firmati.
 * 3. Il flusso completo di firma (verify-otp-and-sign su modulo completato): il verbale
 *    viene generato, caricato come Documento tipo 'verbale_firma' e collegato alla firma;
 *    se la generazione fallisce, la firma resta comunque valida.
 *
 * Il client Prisma è mockato (come in archiviazioneDocumentiFirmati.test.ts) e con lui
 * l'upload su storage: il verbale non deve scrivere file né toccare Supabase nei test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Stato restituito dal finto client, riscritto da ogni test prima dell'uso. */
const stato = {
  cliente: null as any,
  modulo: null as any,
  otp: null as any,
  firmaEsistente: null as any,
  progetto: null as any,
  documento: null as any,
  uploadFails: false,
  // Registri per asserire cosa il server ha scritto davvero.
  upload: [] as string[],
  uploadContenuti: [] as string[],
  firmeCreate: [] as any[],
  firmeAggiornate: [] as any[],
  documentiCreati: [] as any[],
  otpAggiornati: [] as any[],
  richiesteModificaCreate: [] as any[],
  notifiche: [] as any[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const finto: any = {
    cliente: { findFirst: async () => stato.cliente },
    documento: {
      findFirst: async () => stato.documento,
      create: async (args: any) => {
        stato.documentiCreati.push(args.data);
        return { ...args.data, id: 'doc-verbale-1' };
      },
      update: async (args: any) => ({ ...stato.documento, ...args.data }),
      updateMany: async () => ({ count: 0 }),
      delete: async () => stato.documento,
    },
    moduloProgetto: { findFirst: async () => stato.modulo },
    progetto: {
      findFirst: async () => stato.progetto,
      update: async (args: any) => ({ ...stato.progetto, ...args.data }),
    },
    codiceOtp: {
      findFirst: async () => stato.otp,
      update: async (args: any) => {
        stato.otpAggiornati.push(args);
        return { ...stato.otp, ...args.data };
      },
      count: async () => 0,
    },
    firmaElettronica: {
      findFirst: async () => stato.firmaEsistente,
      create: async (args: any) => {
        stato.firmeCreate.push(args.data);
        return { ...args.data, id: 'firma-1' };
      },
      update: async (args: any) => {
        stato.firmeAggiornate.push(args);
        return { ...args.data };
      },
      count: async () => 0,
    },
    richiestaModificaDocumento: {
      create: async (args: any) => {
        stato.richiesteModificaCreate.push(args.data);
        return { ...args.data, id: 'rm-1' };
      },
      deleteMany: async () => ({ count: 0 }),
    },
    user: { findMany: async () => [] },
    notifica: {
      create: async (args: any) => {
        stato.notifiche.push(args.data);
        return { id: `not-${stato.notifiche.length}`, ...args.data };
      },
    },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : Promise.all(fn)),
  };

  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// L'upload del verbale non deve toccare né Supabase né il filesystem locale.
vi.mock('./services/storageService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string, contentBase64: string) => {
      if (stato.uploadFails) throw new Error('storage irraggiungibile (simulato)');
      stato.upload.push(filename);
      stato.uploadContenuti.push(contentBase64);
      return { ok: true, url: `https://storage.example/${filename}`, name: filename, size: '1 KB' };
    },
  };
});

// Importati dopo `vi.mock`: `server.js` risolve i moduli mockati al proprio import.
const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt, hashCodiceOtp } = await import('./util/jwt.js');
const { generaPdfVerbaleFirma, descrizioneTipoFirma } = await import('./services/verbaleFirma.js');

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-42';
const CODICE_OTP = '123456';

function tokenCliente() {
  return signJwt({
    userId: `client-${CLIENTE_ID}`,
    tenantId: TENANT_STUDIO,
    email: 'cliente@esempio.it',
    ruolo: 'cliente',
  });
}

function tokenAdvisor() {
  return signJwt({ userId: 'usr-advisor', tenantId: TENANT_STUDIO, email: 'advisor@studio.example', ruolo: 'advisor' });
}

function tokenSuperAdmin() {
  return signJwt({ userId: 'usr-super', tenantId: TENANT_STUDIO, email: 'super@studio.example', ruolo: 'super_admin' });
}

function serverConToken(token: string | null) {
  const server = buildServer(new InMemoryApp());
  const injectOriginale = server.inject.bind(server);
  (server as any).inject = (opts: any) =>
    injectOriginale({
      ...opts,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(opts?.headers || {}) },
    });
  return server;
}

/**
 * pdfkit scrive il testo come stringhe esadecimali dentro array `TJ` con
 * kerning (es. `<56> 50 <657262...>`): nel dump grezzo del file le frasi non
 * compaiono letteralmente. Concatenando le stringhe esadecimali in ordine si
 * ricostruisce il testo leggibile (font standard → i byte sono latin1).
 */
function testoPdf(pdf: Buffer): string {
  const grezzo = pdf.toString('latin1');
  const parti: string[] = [];
  for (const m of grezzo.matchAll(/<([0-9a-fA-F]+)>/g)) {
    parti.push(Buffer.from(m[1] ?? '', 'hex').toString('latin1'));
  }
  return parti.join('');
}

/** 1x1 PNG valido in data URL: la grafometrica minima incorporabile. */
const PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function datiVerbaleBase(overrides: Record<string, unknown> = {}) {
  return {
    signatureId: 'SIGILLO-SES-TEST-0001',
    tipoFirma: 'fea_otp',
    standard: 'Firma Elettronica Semplice (SES) · art. 20 CAD — eIDAS UE 910/2014 art. 3 n. 10',
    documentoTitolo: 'Lettera di incarico 2026',
    documentoHash: 'a'.repeat(64),
    firmatarioNome: 'Mario Rossi',
    firmatarioRuolo: null,
    clienteNome: 'Rossi Costruzioni SRL',
    canaleVerificato: 'Codice OTP monouso consegnato via email a ma***o@esempio.it, recapito da scheda anagrafica',
    timestampIso: '2026-08-27T10:30:00.000Z',
    ipAddress: '93.41.10.5',
    userAgent: 'Mozilla/5.0 (Test)',
    sha256Digest: 'b'.repeat(64),
    ...overrides,
  };
}

function otpAperto(ambito: string, riferimentoId: string | null) {
  return {
    id: 'otp-1',
    clienteId: CLIENTE_ID,
    ambito,
    riferimentoId,
    codiceHash: hashCodiceOtp(CODICE_OTP, CLIENTE_ID),
    scadenza: new Date(Date.now() + 300_000),
    tentativi: 0,
    reinvii: 0,
    canale: 'email',
    target: 'mario@esempio.it',
    targetDichiarato: false,
    targetAnagrafica: null,
    ipRichiesta: null,
    ultimoInvioAt: new Date('2026-08-27T10:25:00.000Z'),
    usatoAt: null,
  };
}

beforeEach(() => {
  stato.cliente = null;
  stato.modulo = null;
  stato.otp = null;
  stato.firmaEsistente = null;
  stato.progetto = null;
  stato.documento = null;
  stato.uploadFails = false;
  stato.upload = [];
  stato.uploadContenuti = [];
  stato.firmeCreate = [];
  stato.firmeAggiornate = [];
  stato.documentiCreati = [];
  stato.otpAggiornati = [];
  stato.richiesteModificaCreate = [];
  stato.notifiche = [];
  stato.audit = [];
});

/* ------------------------------------------------------------------ */
/* 1. Builder puro del PDF                                             */
/* ------------------------------------------------------------------ */

describe('Punto 2 — descrizioneTipoFirma', () => {
  it('traduce i tre tipi tecnici in descrizioni leggibili', () => {
    expect(descrizioneTipoFirma('fea_otp')).toBe('Firma Elettronica Semplice con codice OTP monouso verificato · art. 20 CAD');
    expect(descrizioneTipoFirma('manuale_scansionata')).toBe(
      'Sottoscrizione autografa su carta, scansionata e ricaricata dal firmatario',
    );
    expect(descrizioneTipoFirma('qualificata_esterna')).toBe(
      'Firma Elettronica Qualificata (QES) apposta con provider esterno',
    );
  });

  it('un tipo sconosciuto passa invariato: nessuna etichetta inventata', () => {
    expect(descrizioneTipoFirma('tipo_misterioso')).toBe('tipo_misterioso');
  });
});

describe('Punto 2 — generaPdfVerbaleFirma (contenuto certificativo)', () => {
  it('FEA con OTP: il verbale contiene il sigillo, la sezione OTP e il recapito mascherato', async () => {
    const pdf = await generaPdfVerbaleFirma(
      datiVerbaleBase({
        otp: {
          canale: 'email',
          target: 'mario@esempio.it',
          targetDichiarato: false,
          targetAnagrafica: null,
          ultimoInvioAt: new Date('2026-08-27T10:25:00.000Z'),
          usatoAt: new Date('2026-08-27T10:30:00.000Z'),
        },
      }) satisfies any,
    );
    const testo = testoPdf(pdf); // compress: false → il contenuto è ispezionabile
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(testo).toContain('Verbale di firma elettronica');
    expect(testo).toContain('SIGILLO-SES-TEST-0001');
    expect(testo).toContain('Lettera di incarico 2026');
    expect(testo).toContain('a'.repeat(64));
    expect(testo).toContain('93.41.10.5');
    expect(testo).toContain('VERIFICA CON CODICE OTP MONOUSO');
    expect(testo).toContain('ma***o@esempio.it'); // recapito mai in chiaro nel verbale
    expect(testo).toContain('b'.repeat(64));
  });

  it('manuale_scansionata senza OTP: la sezione OTP è omessa, non lasciata vuota', async () => {
    const pdf = await generaPdfVerbaleFirma(
      datiVerbaleBase({ tipoFirma: 'manuale_scansionata', otp: null }) satisfies any,
    );
    const testo = testoPdf(pdf);
    expect(testo).toContain('Sottoscrizione autografa su carta');
    expect(testo).not.toContain('VERIFICA CON CODICE OTP MONOUSO');
  });

  it('qualificata_esterna con file ricaricato: espone anche l\'impronta del file', async () => {
    const pdf = await generaPdfVerbaleFirma(
      datiVerbaleBase({
        tipoFirma: 'qualificata_esterna',
        otp: null,
        fileFirmatoHash: 'c'.repeat(64),
      }) satisfies any,
    );
    const testo = testoPdf(pdf);
    expect(testo).toContain('Firma Elettronica Qualificata (QES)');
    expect(testo).toContain('Impronta SHA-256 del file ricaricato');
    expect(testo).toContain('c'.repeat(64));
  });

  it('IP e user agent mancanti: scritto "non registrato", mai un valore inventato', async () => {
    const pdf = await generaPdfVerbaleFirma(
      datiVerbaleBase({ ipAddress: null, userAgent: null }) satisfies any,
    );
    const testo = testoPdf(pdf);
    expect(testo).toContain('non registrato');
    expect(testo).not.toContain('127.0.0.1');
  });

  it('grafometrica valida incorporata; data URL non immagine ignorato senza far fallire il verbale', async () => {
    const conFirma = await generaPdfVerbaleFirma(
      datiVerbaleBase({ firmaGrafometricaPng: PNG_1X1 }) satisfies any,
    );
    expect(testoPdf(conFirma)).toContain('FIRMA GRAFOMETRICA');

    const conScarto = await generaPdfVerbaleFirma(
      datiVerbaleBase({ firmaGrafometricaPng: 'data:image/svg+xml;base64,non-un-png' }) satisfies any,
    );
    const testo = testoPdf(conScarto);
    expect(testo).not.toContain('FIRMA GRAFOMETRICA');
    expect(testo).toContain('Verbale di firma elettronica'); // il verbale si genera comunque
  });
});

/* ------------------------------------------------------------------ */
/* 2. Guard: il verbale è un atto certificativo                        */
/* ------------------------------------------------------------------ */

describe('Punto 2 — verbale non eliminabile (DELETE /documenti/:id)', () => {
  function verbaleBase() {
    return {
      id: 'doc-v1',
      tenantId: TENANT_STUDIO,
      fileUrl: 'verbale_firma_EIDAS.pdf',
      statoDoc: 'pubblicato',
      tipo: 'verbale_firma',
    };
  }

  it('rifiuta con 409 l\'advisor: il verbale si può solo archiviare', async () => {
    stato.documento = verbaleBase();
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-v1' });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toBe(
      'Il verbale di firma è un atto certificativo: non può essere eliminato, solo archiviato.',
    );
  });

  it('rifiuta con 409 anche il super_admin', async () => {
    stato.documento = verbaleBase();
    const server = serverConToken(tokenSuperAdmin());
    const res = await server.inject({ method: 'DELETE', url: '/documenti/doc-v1' });
    expect(res.statusCode).toBe(409);
  });
});

describe('Punto 2 — verbale non modificabile (POST /portal/documenti/:id/richiesta-modifica)', () => {
  it('la richiesta del cliente è respinta con 409: nessuna revisione su un atto certificativo', async () => {
    stato.documento = {
      id: 'doc-v1',
      tenantId: TENANT_STUDIO,
      fileUrl: 'verbale_firma_EIDAS.pdf',
      statoDoc: 'pubblicato',
      tipo: 'verbale_firma',
      progetto: { id: 'proj-1', nome: 'Progetto Alfa' },
      microvoceProgetto: null,
      caricatoDaUser: null,
    };
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: '/portal/documenti/doc-v1/richiesta-modifica',
      payload: { commento: 'Vorrei cambiare la data riportata nel verbale.' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().errore).toBe(
      'Il verbale di firma è un atto certificativo: non è modificabile e non accetta richieste di revisione.',
    );
    expect(stato.richiesteModificaCreate).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Flusso di firma: il verbale nasce insieme alla firma             */
/* ------------------------------------------------------------------ */

function preparaModuloCompletato() {
  stato.cliente = { nome: 'Rossi Costruzioni SRL' };
  stato.modulo = {
    id: 'mod-1',
    nome: 'Adempimenti IVA',
    categoria: 'fiscale',
    prezzo: 1200,
    stato: 'done',
    progettoId: 'proj-1',
    progetto: { nome: 'Progetto Alfa' },
    microvoci: [
      { nome: 'Liquidazione IVA', stato: 'done' },
      { nome: 'Registrazione fatture', stato: 'done' },
    ],
  };
  stato.firmaEsistente = null;
  stato.otp = otpAperto('modulo_completato', 'mod-1');
}

describe('Punto 2 — verify-otp-and-sign genera il verbale di firma', () => {
  it('firma su modulo completato: verbale creato, collegato alla firma, notificato al cliente', async () => {
    preparaModuloCompletato();
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: CODICE_OTP, ambito: 'modulo_completato', riferimentoId: 'mod-1' },
    });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.ok).toBe(true);

    // La firma è registrata col suo tipo e l'OTP consumato.
    expect(stato.firmeCreate).toHaveLength(1);
    const firma = stato.firmeCreate[0];
    expect(firma.tipoFirma).toBe('fea_otp');
    expect(firma.ambito).toBe('modulo_completato');
    expect(firma.codiceOtpId).toBe('otp-1');
    expect(firma.firmatoAt).toBeInstanceOf(Date);

    // Il PDF del verbale è caricato nello storage col nome della firma.
    expect(stato.upload).toHaveLength(1);
    expect(stato.upload[0]).toBe(`verbale_firma_${firma.signatureId}.pdf`);

    // Il verbale è un Documento pubblicato, nel progetto del modulo, senza autore umano.
    expect(stato.documentiCreati).toHaveLength(1);
    const verbale = stato.documentiCreati[0];
    expect(verbale.tipo).toBe('verbale_firma');
    expect(verbale.progettoId).toBe('proj-1');
    expect(verbale.microvoceProgettoId).toBeNull();
    expect(verbale.caricatoDa).toBeNull();
    expect(verbale.statoDoc).toBe('pubblicato');
    expect(verbale.fileUrl).toBe(`https://storage.example/${stato.upload[0]}`);

    // La firma è collegata al suo verbale (risalita nei due sensi).
    expect(stato.firmeAggiornate).toHaveLength(1);
    expect(stato.firmeAggiornate[0].where).toEqual({ id: 'firma-1' });
    expect(stato.firmeAggiornate[0].data.verbaleDocumentoId).toBe('doc-verbale-1');

    // Audit di sistema per la generazione, notifiche al cliente per firma e verbale.
    const auditVerbale = stato.audit.find(a => a.azione === 'VERBALE_FIRMA_GENERATO');
    expect(auditVerbale).toBeTruthy();
    expect(auditVerbale.userId).toBe('usr-system'); // operazione di sistema, non di un utente
    expect(stato.audit.some(a => a.azione === 'FIRMA_SES_APPOSTA')).toBe(true);
    expect(stato.notifiche.some(n => n.tipoEvento === 'firma_apposta' && n.destinatarioTipo === 'cliente')).toBe(true);
    const notificaVerbale = stato.notifiche.find(n => n.tipoEvento === 'verbale_disponibile');
    expect(notificaVerbale).toBeTruthy();
    expect(notificaVerbale.destinatarioClienteId).toBe(CLIENTE_ID);
    expect(notificaVerbale.link).toBe('/portal/documents');
  });

  it('il flusso OTP non dichiara mai "avanzata": DB, audit, verbale e notifiche dicono SES', async () => {
    preparaModuloCompletato();
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: CODICE_OTP, ambito: 'modulo_completato', riferimentoId: 'mod-1' },
    });
    expect(res.statusCode).toBe(200);

    // DB: lo standard e il signatureId della firma dichiarano SES, non FEA.
    const firma = stato.firmeCreate[0];
    expect(firma.standard).not.toMatch(/avanzata|advanced/i);
    expect(firma.signatureId).toMatch(/^SIGILLO-SES-/);

    // Audit: la nuova azione FIRMA_SES_APPOSTA sostituisce FIRMA_FEA_APPOSTA.
    const auditFirma = stato.audit.find(a => a.azione === 'FIRMA_SES_APPOSTA');
    expect(auditFirma).toBeTruthy();
    expect(auditFirma.dettagli).not.toMatch(/avanzata|advanced/i);
    expect(stato.audit.some(a => a.azione === 'FIRMA_FEA_APPOSTA')).toBe(false);

    // Verbale PDF: l'atto certificativo non contiene tracce di firma avanzata.
    expect(stato.uploadContenuti).toHaveLength(1);
    const contenutoVerbale = stato.uploadContenuti[0] ?? '';
    const testo = testoPdf(Buffer.from(contenutoVerbale, 'base64'));
    expect(testo).not.toMatch(/avanzata|advanced/i);
    expect(testo).toContain('Firma Elettronica Semplice');

    // Notifiche a studio e cliente coerenti con le etichette del portale.
    expect(stato.notifiche.length).toBeGreaterThan(0);
    for (const n of stato.notifiche) {
      expect(n.corpo).not.toMatch(/avanzata|advanced/i);
    }
  });

  it('engagement letter senza progetto agganciato: il verbale va nell\'ultimo progetto del cliente', async () => {
    stato.cliente = { nome: 'Rossi Costruzioni SRL' };
    stato.progetto = { id: 'proj-fallback', stato: 'in_progress', createdAt: new Date() };
    stato.otp = otpAperto('engagement_letter', null);
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: CODICE_OTP, ambito: 'engagement_letter', documentoHash: 'ab'.repeat(32) },
    });
    expect(res.statusCode).toBe(200);
    expect(stato.documentiCreati).toHaveLength(1);
    expect(stato.documentiCreati[0].tipo).toBe('verbale_firma');
    expect(stato.documentiCreati[0].progettoId).toBe('proj-fallback');
  });

  it('se il generatione del verbale fallisce (storage giù) la firma resta valida', async () => {
    preparaModuloCompletato();
    stato.uploadFails = true;
    const spia = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const server = serverConToken(tokenCliente());
      const res = await server.inject({
        method: 'POST',
        url: '/portal/verify-otp-and-sign',
        payload: { otp: CODICE_OTP, ambito: 'modulo_completato', riferimentoId: 'mod-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      // La firma c'è; il verbale no, e nessun collegamento è stato scritto.
      expect(stato.firmeCreate).toHaveLength(1);
      expect(stato.documentiCreati).toHaveLength(0);
      expect(stato.firmeAggiornate).toHaveLength(0);
    } finally {
      spia.mockRestore();
    }
  });

  it('senza codice OTP pendente la firma è rifiutata e nessun verbale è generato', async () => {
    preparaModuloCompletato();
    stato.otp = null;
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: '/portal/verify-otp-and-sign',
      payload: { otp: CODICE_OTP, ambito: 'modulo_completato', riferimentoId: 'mod-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().ok).toBe(false);
    expect(stato.firmeCreate).toHaveLength(0);
    expect(stato.documentiCreati).toHaveLength(0);
  });
});
