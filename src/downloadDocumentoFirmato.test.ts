import { describe, it, expect, beforeEach, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';
const CLIENTE_ID = 'cli-test-1';

const stato = {
  documentoPortale: null as any,
  copiaFirmata: null as any,
  firmaPortale: null as any,
  documentiStudio: [] as any[],
  copieFirmateStudio: [] as any[],
  firmeStudio: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    user: {
      findFirst: async (args: any) => ({
        id: args?.where?.id || 'usr-adv',
        tenantId: TENANT,
        ruolo: 'advisor',
        stato: 'attivo',
        sessionVersion: 0,
      }),
    },
    cliente: {
      findFirst: async (args: any) => ({
        id: args?.where?.id || CLIENTE_ID,
        sessionVersion: 0,
      }),
    },
    documento: {
      findFirst: async (args: any) => {
        if (args?.where?.tipo === 'firmato') {
          return stato.copiaFirmata;
        }
        return stato.documentoPortale;
      },
      findMany: async (args: any) => {
        if (args?.where?.tipo === 'firmato') {
          return stato.copieFirmateStudio;
        }
        return stato.documentiStudio;
      },
    },
    progetto: {
      findFirst: async () => ({ id: 'proj-1', clienteId: CLIENTE_ID }),
    },
    firmaElettronica: {
      findFirst: async () => stato.firmaPortale,
      findMany: async () => stato.firmeStudio,
    },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

function tokenCliente() {
  return signJwt({
    userId: `client-${CLIENTE_ID}`,
    tenantId: TENANT,
    email: 'cliente@test.local',
    ruolo: 'cliente',
    sessionVersion: 0,
  });
}

function tokenAdvisor() {
  return signJwt({
    userId: 'usr-adv',
    tenantId: TENANT,
    email: 'advisor@studio.local',
    ruolo: 'advisor',
    sessionVersion: 0,
  });
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

describe('Download e Lettura Documento Firmato Esatto', () => {
  beforeEach(() => {
    stato.documentoPortale = {
      id: 'doc-1',
      statoDoc: 'firmato',
      tipo: 'generato',
      fileUrl: 'https://storage.example/contratto-bozza.pdf',
      filePdfUrl: 'https://storage.example/contratto-bozza.pdf',
      fileDocxUrl: 'https://storage.example/contratto-bozza.docx',
      statoScansione: 'pulito',
      versione: 1,
      microvoceProgetto: { nome: 'Incarico Professionale' },
      progetto: { nome: 'Consulenza 2026' },
    };
    stato.copiaFirmata = {
      fileUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
      filePdfUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
    };
    stato.firmaPortale = {
      fileFirmatoUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
    };
    stato.documentiStudio = [
      {
        id: 'doc-1',
        tipo: 'generato',
        statoDoc: 'firmato',
        fileUrl: 'https://storage.example/contratto-bozza.pdf',
        filePdfUrl: 'https://storage.example/contratto-bozza.pdf',
        fileDocxUrl: 'https://storage.example/contratto-bozza.docx',
        versione: 1,
        createdAt: new Date(),
        caricatoDa: { nome: 'Advisor' },
        categoriaDoc: 'contratti',
        statoScansione: 'pulito',
        livelloFirmaRichiesto: 'ses',
        pubblicatoAt: new Date(),
        documentoPadreId: null,
        isArchiviato: false,
        archiviatoAt: null,
        microvoceProgetto: { nome: 'Incarico' },
        richiesteModifica: [],
      },
    ];
    stato.copieFirmateStudio = [
      {
        documentoPadreId: 'doc-1',
        fileUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
        filePdfUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
      },
    ];
    stato.firmeStudio = [
      {
        riferimentoId: 'doc-1',
        firmatoAt: new Date(),
        signatureId: 'BLU-SES-1234',
        tipoFirma: 'fea_otp',
        valoreLegale: 'ses',
        fileFirmatoUrl: 'https://storage.example/contratto-firmato-sigillo.pdf',
        standard: 'eIDAS-SES',
      },
    ];
  });

  it('GET /portal/documenti/:id/download restituisce la copia firmata quando il documento è firmato', async () => {
    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'GET',
      url: '/portal/documenti/doc-1/download',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toContain('contratto-firmato-sigillo.pdf');
    expect(body.filename).toBe('contratto-firmato-sigillo.pdf');
  });

  it('GET /portal/documenti/:id/download restituisce la bozza master se il documento è ancora in bozza/non firmato', async () => {
    stato.documentoPortale.statoDoc = 'pubblicato';
    stato.copiaFirmata = null;
    stato.firmaPortale = null;

    const server = serverConToken(tokenCliente());
    const res = await server.inject({
      method: 'GET',
      url: '/portal/documenti/doc-1/download',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toContain('contratto-bozza.pdf');
    expect(body.filename).not.toContain('firmato');
  });

  it('GET /documenti per lo studio fornisce il file firmato per i documenti firmati', async () => {
    const server = serverConToken(tokenAdvisor());
    const res = await server.inject({
      method: 'GET',
      url: '/documenti?progettoId=proj-1',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.documenti).toHaveLength(1);
    const doc = body.documenti[0];
    expect(doc.firmato).toBe(true);
    expect(doc.fileUrl).toContain('contratto-firmato-sigillo.pdf');
    expect(doc.filePdfUrl).toContain('contratto-firmato-sigillo.pdf');
    expect(doc.fileFirmatoUrl).toContain('contratto-firmato-sigillo.pdf');
    expect(doc.fileBozzaUrl).toContain('contratto-bozza.pdf');
  });
});
