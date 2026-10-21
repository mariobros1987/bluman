/**
 * Rotte KYC — la guardia di forma dei corpi.
 *
 * Queste rotte non avevano test propri: i servizi (anomalie, conservazione, segnalazione) sì,
 * ma il bordo no. Qui si fissa una cosa sola, e per ogni rotta: **un corpo di forma sbagliata
 * si ferma al 400 prima di toccare il database**. La seconda garanzia è che le regole di
 * contenuto dell'handler restino dove sono, con i loro messaggi: un esito fuori elenco, una
 * motivazione corta o una data illeggibile non devono diventare il messaggio generico di zod.
 *
 * Non si prova il percorso felice: richiederebbe di simulare fascicoli, soggetti, storage e
 * catena di compliance, e lo stesso comportamento è già coperto dai test dei servizi di dominio.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildServer } from './server.js';
import { InMemoryApp } from './adapters/inMemoryApp.js';
import { prisma } from './util/prismaClient.js';
import { signJwt } from './util/jwt.js';

const TENANT_TEST = '00000000-0000-0000-0000-000000000001';

const TOKEN_ADVISOR = signJwt({
  userId: 'u-advisor',
  tenantId: TENANT_TEST,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
  sessionVersion: 0,
});

vi.spyOn(prisma.user as any, 'findFirst').mockImplementation(async (args: any) => {
  if (args?.select?.id) return args.where.id === 'mlro-ok' ? { id: 'mlro-ok' } : null;
  return { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 };
});
vi.spyOn(prisma.cliente as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.tenant as any, 'findUnique').mockResolvedValue(null); // nessuna riga → modulo attivo
vi.spyOn(prisma.tenantComplianceSettings as any, 'findUnique').mockResolvedValue({ mlroUserId: 'u-advisor' });
vi.spyOn(prisma.fascicoloKyc as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.screeningKyc as any, 'findFirst').mockResolvedValue(null);
vi.spyOn(prisma.soggettoKyc as any, 'findFirst').mockResolvedValue(null);

function server() {
  const s = buildServer(new InMemoryApp());
  const injectOriginale = s.inject.bind(s);
  (s as any).inject = (opts: any) =>
    injectOriginale({ ...opts, headers: { authorization: `Bearer ${TOKEN_ADVISOR}`, ...opts?.headers } });
  return s;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('PUT /kyc/:id/soggetto', () => {
  it('un campo del tipo sbagliato si ferma al bordo, senza arrivare a Prisma', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/kyc/f-1/soggetto',
      payload: { denominazione: { non: 'un testo' } },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.fascicoloKyc.findFirst).not.toHaveBeenCalled();
  });

  it('un corpo di forma giusta passa lo schema e arriva alla ricerca del fascicolo', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/kyc/f-1/soggetto',
      payload: { denominazione: 'Mario Rossi', tipo: 'persona_fisica' },
    });
    expect(res.statusCode).toBe(404); // fascicolo inesistente nella simulazione
    expect(res.json().errore).toMatch(/Fascicolo non trovato/i);
  });
});

describe('POST /kyc/:id/titolare-effettivo', () => {
  it('la percentuale come oggetto viene rifiutata (numero o stringa numerica)', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/kyc/f-1/titolare-effettivo',
      payload: { denominazione: 'Bianchi Spa', percentuale: { valore: 40 } },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /kyc/:id/screening', () => {
  it('un tipo fuori elenco conserva il messaggio dell’handler', async () => {
    // Il fascicolo esiste (altrimenti il 404 arriverebbe prima), ma il tipo no: la regola di
    // contenuto resta quella dell'handler, non un enum di zod con un messaggio diverso.
    vi.mocked(prisma.fascicoloKyc.findFirst).mockResolvedValueOnce({ id: 'f-1', soggettoId: null } as any);
    const res = await server().inject({ method: 'POST', url: '/kyc/f-1/screening', payload: { tipo: 'inventato' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Tipo screening non valido/i);
  });

  it('un allegato con un tipo sbagliato non arriva all’upload', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/kyc/f-1/screening',
      payload: { tipo: 'pep', allegatoContentBase64: 42 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /kyc/:id/screening/:sid/risolvi', () => {
  it('un esito fuori elenco resta il 400 dell’handler', async () => {
    const res = await server().inject({
      method: 'PATCH',
      url: '/kyc/f-1/screening/s-1/risolvi',
      payload: { esito: 'va_bene_cosi', notaRisoluzione: 'Nota sufficientemente lunga' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/falso_positivo/);
  });

  it('una motivazione corta resta il 400 dell’handler', async () => {
    const res = await server().inject({
      method: 'PATCH',
      url: '/kyc/f-1/screening/s-1/risolvi',
      payload: { esito: 'falso_positivo', notaRisoluzione: 'corta' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/almeno 10 caratteri/i);
  });
});

describe('POST /kyc/:id/anomalie', () => {
  it('una descrizione non testuale si ferma al bordo', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/kyc/f-1/anomalie',
      payload: { tipo: 'match_pep', descrizione: ['non', 'un', 'testo'] },
    });
    expect(res.statusCode).toBe(400);
    expect(prisma.fascicoloKyc.findFirst).not.toHaveBeenCalled();
  });
});

describe('POST /kyc/:id/retention/proroga', () => {
  it('una data illeggibile resta il 400 dell’handler', async () => {
    const res = await server().inject({
      method: 'POST',
      url: '/kyc/f-1/retention/proroga',
      payload: { prorogaAl: 'non-una-data', motivo: 'Motivo sufficientemente lungo' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toMatch(/Data di proroga non valida/i);
  });
});
