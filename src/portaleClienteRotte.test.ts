// Portale cliente: le rotte che la sessione del cliente può usare, e i dati dello studio che il
// portale riceve per la lettera d'incarico.
//
// Due difetti trovati provando il portale il 27/11: le rotte dei documenti KYC non erano
// nell'elenco del cliente (403 sempre, anche a modulo attivo), e il portale non riceveva
// l'anagrafica dello studio, quindi la lettera stampava una controparte scritta nel frontend.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rottaConsentitaAlCliente } from './util/authorization.js';

const stato = vi.hoisted(() => ({
  moduli: { moduliConcessi: [] as string[], moduliDisattivati: [] as string[] },
  tenant: null as any,
}));

vi.mock('./util/prismaClient.js', () => {
  const prisma: any = {
    user: { findFirst: async () => null, findUnique: async () => null },
    cliente: {
      findFirst: async (a: any) => (a?.select?.sessionVersion ? { sessionVersion: 0 } : { id: 'cli-03', nome: 'Belfort' }),
    },
    tenant: {
      findUnique: async () => ({ id: 't-1', ...stato.moduli }),
      findFirst: async () => stato.tenant,
    },
    permessoModulo: { findUnique: async () => null },
    auditLog: { create: async () => ({}) },
    fascicoloKyc: { findFirst: async () => null },
    fattura: {
      findMany: async () => [
        { id: 'f-1', numero: 'FT-1', tipoDocumento: 'fattura', data: new Date('2099-01-01'), stato: 'emessa', progettoId: 'p-1', progetto: { id: 'p-1', nome: 'P' },
          righe: [{ importo: 12200 }], scadenzeIncasso: [{ dataScadenza: new Date('2000-01-31'), importoCentesimi: 12200 }] },
        { id: 'f-2', numero: 'FT-2', tipoDocumento: 'fattura', data: new Date('2099-01-01'), stato: 'emessa', progettoId: 'p-1', progetto: { id: 'p-1', nome: 'P' },
          righe: [{ importo: 5000 }], scadenzeIncasso: [{ dataScadenza: new Date('2100-01-31'), importoCentesimi: 5000 }] },
      ],
    },
  };
  return {
    attivaContestoTenant: () => {},
    conContestoInTransazione: async (_tx: any, fn: any) => fn(),
    contestoTenant: { run: (_c: unknown, fn: () => unknown) => fn() },
    prisma,
    prismaAmministrativo: () => prisma,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function comeCliente(url: string) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId: 'client-cli-03', tenantId: TENANT, email: 'jp@belfort.example', ruolo: 'cliente' as any, sessionVersion: 0 });
  const res = await server.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  return res;
}

beforeEach(() => {
  stato.moduli = { moduliConcessi: [], moduliDisattivati: [] };
  stato.tenant = {
    ragioneSociale: 'Bluecode Advisory Malta Ltd', leadAdvisorNome: null, leadAdvisorEmail: null,
    telefono: '+356 0000', email: 'studio@example.com', sedeLegale: 'Tower Road, Sliema', sedeOperativa: null,
    piva: 'MT1234', codiceFiscale: null, iban: 'MT00TEST', giurisdizione: 'Malta', logoUrl: null,
  };
});

describe('rotte del portale consentite al cliente', () => {
  it('i documenti KYC del proprio fascicolo sono nell elenco', () => {
    expect(rottaConsentitaAlCliente('GET', '/portal/kyc/documenti')).toBe(true);
    expect(rottaConsentitaAlCliente('POST', '/portal/kyc/documento')).toBe(true);
    // Le rotte KYC dello studio restano chiuse.
    expect(rottaConsentitaAlCliente('GET', '/kyc/coda')).toBe(false);
  });

  it('a modulo KYC spento il cliente riceve «modulo non attivo», non un 403', async () => {
    const res = await comeCliente('/portal/kyc/documenti');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ moduloAttivo: false, praticaAttiva: false, documenti: [] });
  });
});

describe('GET /portal/contatti — l anagrafica dello studio per la lettera', () => {
  it('arriva dal database, con i campi vuoti come stringa vuota e non inventati', async () => {
    const res = await comeCliente('/portal/contatti');
    expect(res.statusCode).toBe(200);
    expect(res.json().anagrafica).toEqual({
      ragioneSociale: 'Bluecode Advisory Malta Ltd', piva: 'MT1234', codiceFiscale: '', sedeLegale: 'Tower Road, Sliema',
      sedeOperativa: '', giurisdizione: 'Malta', iban: 'MT00TEST', email: 'studio@example.com', telefono: '+356 0000',
      leadAdvisor: '', logoUrl: '',
    });
  });
});

describe('GET /portal/fatture — la rata scaduta la segnala il server', () => {
  it('scadenza passata → scaduta; scadenza futura → no', async () => {
    // Date lontane da oggi in tutte e due le direzioni: la prova non dipende dal giorno in cui gira.
    const res = await comeCliente('/portal/fatture');
    expect(res.statusCode).toBe(200);
    const [passata, futura] = res.json().fatture;
    expect(passata.prossimaScadenza.scaduta).toBe(true);
    expect(futura.prossimaScadenza.scaduta).toBe(false);
  });
});
