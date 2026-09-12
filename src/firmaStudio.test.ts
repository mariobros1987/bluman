/**
 * Test suite per l'apposizione della firma dello studio/operatore sui documenti del fascicolo.
 * Copre:
 * - Protezione rotte (401 non autenticato, 403 ruolo cliente)
 * - Richiesta OTP FEA per lo studio (email e whatsapp)
 * - Le 4 modalità di firma:
 *   1. grafometrica (SES · art. 20 CAD)
 *   2. fea_otp (FEA con codice monouso OTP a 6 cifre)
 *   3. qualificata_esterna (FEQ CAdES/PAdES)
 *   4. manuale_scansionata (SES copia cartacea controfirmata)
 * - Integrazione nei metadati di GET /documenti (firmatoDaStudio, firmaStudio)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-99';
const DOC_ID = 'doc-test-1';
const CODICE_OTP = '654321';
const GRAFOMETRICA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const stato = {
  documento: null as any,
  documentiCreati: [] as any[],
  documentiAggiornati: [] as any[],
  firmeCreate: [] as any[],
  firmeAggiornate: [] as any[],
  otpCreati: [] as any[],
  otpAggiornati: [] as any[],
  otp: null as any,
  audit: [] as any[],
  upload: [] as string[],
  userAdvisor: {
    id: 'usr-advisor',
    tenantId: TENANT_STUDIO,
    nome: 'Avv. Mario Rossi',
    email: 'mario.rossi@studiobluman.it',
    ruolo: 'advisor',
    stato: 'attivo',
    sessionVersion: 0,
  },
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    tenant: {
      findUnique: async () => ({
        id: TENANT_STUDIO,
        ragioneSociale: 'Studio Legale BluMan',
        waPhoneId: 'wa-id',
        waAccessToken: 'wa-token',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'smtp-user',
        smtpPass: 'smtp-pass',
      }),
    },
    progetto: {
      findFirst: async () => ({ id: 'proj-1', clienteId: CLIENTE_ID, nome: 'Operazione Holding' }),
    },
    documento: {
      findFirst: async (args: any) => {
        if (args?.where?.tipo === 'firmato' || args?.where?.documentoPadreId) return null;
        return stato.documento;
      },
      findMany: async () => (stato.documento ? [stato.documento] : []),
      create: async (args: any) => {
        stato.documentiCreati.push(args.data);
        return { ...args.data, id: `doc-created-${stato.documentiCreati.length}` };
      },
      update: async (args: any) => {
        stato.documentiAggiornati.push(args);
        return { ...stato.documento, ...args.data };
      },
    },
    user: {
      findUnique: async (args: any) => {
        if (args?.where?.id === 'usr-advisor') return stato.userAdvisor;
        return null;
      },
      findFirst: async (args: any) => {
        if (args?.where?.id === 'usr-advisor') return stato.userAdvisor;
        return null;
      },
    },
    cliente: {
      findUnique: async (args: any) => ({ id: CLIENTE_ID, sessionVersion: 0 }),
      findFirst: async (args: any) => ({ id: CLIENTE_ID, sessionVersion: 0 }),
    },
    codiceOtp: {
      findFirst: async () => stato.otp,
      create: async (args: any) => {
        stato.otpCreati.push(args.data);
        const obj = { ...args.data, id: `otp-${Date.now()}` };
        stato.otp = obj;
        return obj;
      },
      update: async (args: any) => {
        stato.otpAggiornati.push(args);
        if (stato.otp) Object.assign(stato.otp, args.data);
        return { ...stato.otp, ...args.data };
      },
    },
    firmaElettronica: {
      findFirst: async () => stato.firmeCreate[0] || null,
      findMany: async () => stato.firmeCreate,
      create: async (args: any) => {
        stato.firmeCreate.push(args.data);
        return { ...args.data, id: `firma-${Date.now()}` };
      },
      update: async (args: any) => {
        stato.firmeAggiornate.push(args);
        return { ...args.data };
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

vi.mock('./services/storageService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string) => {
      stato.upload.push(filename);
      return { ok: true, url: `https://storage.example/${filename}`, name: filename, size: '2 KB' };
    },
    rifirmaUrlUpload: (url: string | null) => url,
  };
});

// Mock email invio
vi.mock('./services/emailService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./services/emailService.js')>();
  return {
    ...reale,
    sendOtpSecurityEmail: async () => ({ ok: true }),
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt, hashCodiceOtp } = await import('./util/jwt.js');

function tokenAdvisor() {
  return signJwt({
    userId: 'usr-advisor',
    tenantId: TENANT_STUDIO,
    email: 'mario.rossi@studiobluman.it',
    ruolo: 'advisor',
    sessionVersion: 0,
  });
}

function tokenCliente() {
  return signJwt({
    userId: `client-${CLIENTE_ID}`,
    tenantId: TENANT_STUDIO,
    email: 'cliente@committente.it',
    ruolo: 'cliente',
    sessionVersion: 0,
  });
}

function serverConToken(token?: string) {
  const server = buildServer(new InMemoryApp());
  return {
    inject: (opts: any) => {
      const headers = { ...(opts.headers || {}) };
      if (token) headers.authorization = `Bearer ${token}`;
      return server.inject({ ...opts, headers });
    },
  };
}

beforeEach(() => {
  stato.documentiCreati.length = 0;
  stato.documentiAggiornati.length = 0;
  stato.firmeCreate.length = 0;
  stato.firmeAggiornate.length = 0;
  stato.otpCreati.length = 0;
  stato.otpAggiornati.length = 0;
  stato.audit.length = 0;
  stato.upload.length = 0;
  stato.otp = null;
  stato.documento = {
    id: DOC_ID,
    tenantId: TENANT_STUDIO,
    progettoId: 'proj-1',
    microvoceProgettoId: 'mv-1',
    tipo: 'compilato',
    fileUrl: 'https://storage.example/contratto.pdf',
    filePdfUrl: 'https://storage.example/contratto.pdf',
    formatoOrigine: 'pdf',
    statoDoc: 'pubblicato',
    versione: 1,
    contenutoBlocchiJson: [
      { tipo: 'titolo', testo: 'MANDATO PROFESSIONALE' },
      {
        tipo: 'firma',
        slotColonne: {
          studio: { etichetta: 'Lo Studio' },
          cliente: { etichetta: 'Il Cliente' },
        },
      },
    ],
    progetto: { id: 'proj-1', clienteId: CLIENTE_ID, nome: 'Operazione Holding' },
    microvoceProgetto: { id: 'mv-1', nome: 'Lettera di Incarico' },
  };
});

describe('🏛️ Firma Studio & Professionista — Route Tests', () => {
  it('rifiuta richieste non autenticate con 401', async () => {
    const server = serverConToken();
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: { modalita: 'grafometrica', firmaGrafometricaPng: GRAFOMETRICA },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rifiuta l’accesso di un token cliente con 403', async () => {
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: { modalita: 'grafometrica', firmaGrafometricaPng: GRAFOMETRICA },
    });
    expect(res.statusCode).toBe(403);
  });

  it('richiede con successo un codice OTP per la FEA dello studio', async () => {
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/richiedi-otp-studio`,
      payload: { canale: 'email' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.canale).toBe('email');
    expect(body.recapitoMascherato).toContain('@');
    expect(stato.otpCreati).toHaveLength(1);
    expect(stato.otpCreati[0].ambito).toBe('documento_vault_studio');
  });

  it('appone la firma SES grafometrica dello studio e crea la copia firmata', async () => {
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: {
        modalita: 'grafometrica',
        firmaGrafometricaPng: GRAFOMETRICA,
        ruoloDichiarato: 'Senior Tax Advisor',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.firma.valoreLegale).toBe('ses');
    expect(body.firma.firmatarioNome).toBe('Avv. Mario Rossi');
    expect(body.firma.firmatarioRuolo).toBe('Senior Tax Advisor');

    expect(stato.firmeCreate).toHaveLength(1);
    expect(stato.firmeCreate[0].tipoFirma).toBe('studio');
    expect(stato.audit).toHaveLength(1);
    expect(stato.audit[0].azione).toBe('DOCUMENTO_FIRMATO_STUDIO');
  });

  it('appone la firma FEA con verifica codice OTP valido', async () => {
    // Prepara riga OTP valida nel mock
    stato.otp = {
      id: 'otp-session-1',
      tenantId: TENANT_STUDIO,
      clienteId: CLIENTE_ID,
      ambito: 'documento_vault_studio',
      riferimentoId: DOC_ID,
      codiceHash: hashCodiceOtp(CODICE_OTP, CLIENTE_ID),
      scadenza: new Date(Date.now() + 10 * 60 * 1000),
      tentativi: 0,
      usatoAt: null,
      canale: 'email',
      target: 'mario.rossi@studiobluman.it',
      targetDichiarato: false,
      targetAnagrafica: null,
      ipRichiesta: '127.0.0.1',
    };

    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: {
        modalita: 'fea_otp',
        otp: CODICE_OTP,
        firmaGrafometricaPng: GRAFOMETRICA,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.firma.valoreLegale).toBe('fea');
    expect(stato.firmeCreate[0].standard).toContain('eIDAS / FEA');
    expect(stato.otpAggiornati.some((u) => u.data.usatoAt instanceof Date)).toBe(true);
  });

  it('rifiuta la firma FEA se l’OTP è errato', async () => {
    stato.otp = {
      id: 'otp-session-1',
      tenantId: TENANT_STUDIO,
      clienteId: CLIENTE_ID,
      ambito: 'documento_vault_studio',
      riferimentoId: DOC_ID,
      codiceHash: hashCodiceOtp('999999', CLIENTE_ID),
      scadenza: new Date(Date.now() + 10 * 60 * 1000),
      tentativi: 0,
      usatoAt: null,
    };

    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: {
        modalita: 'fea_otp',
        otp: '000000',
        firmaGrafometricaPng: GRAFOMETRICA,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('Codice non corretto');
  });

  it('appone la firma FEQ Qualificata Esterna caricando file firmato .p7m', async () => {
    const server = serverConToken(tokenAdvisor());
    const dummyP7mBase64 = Buffer.from([0x30, 0x82, 0x01, 0x20, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]).toString('base64');
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: {
        modalita: 'qualificata_esterna',
        filename: 'contratto_firmato.pdf.p7m',
        contentBase64: dummyP7mBase64,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.firma.valoreLegale).toBe('feq');
    expect(body.firma.tipoFirma).toBe('qualificata_esterna');
    expect(stato.firmeCreate[0].fileFirmatoUrl).toContain('contratto_firmato');
  });

  it('appone la firma Cartacea Scansionata caricando file pdf', async () => {
    const server = serverConToken(tokenAdvisor());
    const dummyPdfBase64 = Buffer.from('%PDF-1.4 dummy content').toString('base64');
    const res = await server.inject({
      method: 'POST',
      url: `/documenti/${DOC_ID}/firma-studio`,
      payload: {
        modalita: 'manuale_scansionata',
        filename: 'contratto_scansione.pdf',
        contentBase64: dummyPdfBase64,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.firma.tipoFirma).toBe('manuale_scansionata');
  });

  it('GET /documenti espone firmatoDaStudio e firmaStudio', async () => {
    stato.firmeCreate.push({
      id: 'f-studio-1',
      tenantId: TENANT_STUDIO,
      clienteId: CLIENTE_ID,
      signatureId: 'BLU-STD-2026-TEST',
      tipoFirma: 'studio',
      ambito: 'documento_vault',
      riferimentoId: DOC_ID,
      firmatarioNome: 'Avv. Mario Rossi',
      firmatarioRuolo: 'Senior Tax Advisor',
      firmatoAt: new Date(),
      valoreLegale: 'ses',
      standard: 'eIDAS / SES',
      canaleVerificato: 'Sessione Studio Verificata (art. 20 CAD)',
    });

    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'GET',
      url: `/documenti?progettoId=proj-1`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.documenti).toHaveLength(1);
    const doc = body.documenti[0];
    expect(doc.firmatoDaStudio).toBe(true);
    expect(doc.firmaStudio).toBeTruthy();
    expect(doc.firmaStudio.signatureId).toBe('BLU-STD-2026-TEST');
    expect(doc.firmaStudio.firmatarioNome).toBe('Avv. Mario Rossi');
  });
});
