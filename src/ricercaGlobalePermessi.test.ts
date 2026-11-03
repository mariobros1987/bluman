import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Step 1.5 (A2) — la ricerca globale rispetta la Matrice Permessi.
 *
 * /search è fuori dalla mappa RBAC (team e calendario sono di tutto lo staff), e fino al 02/11
 * restituiva fatture, clienti, documenti, progetti e contratti a chiunque fosse autenticato:
 * un collaboratore_esterno con invoices/clients 'denied' li leggeva dalla barra di ricerca.
 * Ora i gruppi dei moduli negati non compaiono e le loro query non partono nemmeno.
 */

const stato = vi.hoisted(() => ({
  matrice: {} as Record<string, 'denied' | 'read' | 'write'>,
  interrogati: [] as string[],
}));

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const RUOLI: Record<string, string> = { 'usr-esterno': 'collaboratore_esterno', 'usr-advisor': 'advisor', 'usr-super': 'super_admin' };
  const riga = (modello: string, valore: Record<string, unknown>) => ({
    findMany: async () => { stato.interrogati.push(modello); return [valore]; },
  });
  const adesso = new Date('2026-11-02T10:00:00Z');
  const finto: any = {
    user: {
      findFirst: async (args: any) => {
        const ruolo = RUOLI[args?.where?.id];
        return ruolo ? { ruolo, stato: 'attivo', sessionVersion: 0 } : null;
      },
      findMany: async () => { stato.interrogati.push('user'); return [{ id: 'u1', nome: 'Rossi Team', ruolo: 'advisor', email: 'r@studio.example' }]; },
    },
    permessoModulo: {
      findUnique: async (args: any) => {
        const livello = stato.matrice[args?.where?.tenantId_userId_moduloChiave?.moduloChiave];
        return livello ? { livello } : null;
      },
    },
    cliente: riga('cliente', { id: 'c1', nome: 'Rossi Srl', piva: null, email: null }),
    progetto: riga('progetto', { id: 'p1', nome: 'Rossi progetto', numeroContratto: null, cliente: { nome: 'Rossi Srl' } }),
    fattura: riga('fattura', { id: 'f1', numero: 'ROSSI-1', serie: 'A', numeroProgressivoSerie: 1, progetto: null }),
    documento: riga('documento', { id: 'd1', fileUrl: '/uploads/rossi.pdf', progetto: null }),
    eventoCalendario: riga('eventoCalendario', { id: 'e1', titolo: 'Rossi call', dataInizio: adesso, progetto: null }),
    contrattoRicorrente: riga('contrattoRicorrente', { id: 'r1', titolo: 'Rossi retainer', cliente: { nome: 'Rossi Srl' } }),
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

async function cerca(userId: string, ruolo: string) {
  const server = buildServer(new InMemoryApp()) as any;
  const tok = signJwt({ userId, tenantId: TENANT, email: `${userId}@studio.example`, ruolo, sessionVersion: 0 } as any);
  const res = await server.inject({ method: 'GET', url: '/search?q=rossi', headers: { authorization: `Bearer ${tok}` } });
  await server.close();
  expect(res.statusCode).toBe(200);
  return (res.json().gruppi as Array<{ tipo: string }>).map((g) => g.tipo);
}

beforeEach(() => {
  stato.matrice = {};
  stato.interrogati = [];
});

describe('GET /search — gruppi filtrati dalla Matrice Permessi', () => {
  it('collaboratore_esterno senza righe di matrice: niente fatture né clienti, e niente query su di loro', async () => {
    // Default esterno: projects write, documents read, clients/invoices/retainers denied.
    const tipi = await cerca('usr-esterno', 'collaboratore_esterno');
    expect(tipi).not.toContain('fatture');
    expect(tipi).not.toContain('clienti');
    expect(tipi).not.toContain('contratti');
    expect(tipi).toEqual(expect.arrayContaining(['progetti', 'documenti', 'utenti', 'eventi']));
    expect(stato.interrogati).not.toContain('fattura');
    expect(stato.interrogati).not.toContain('cliente');
    expect(stato.interrogati).not.toContain('contrattoRicorrente');
  });

  it('advisor: tutti i gruppi', async () => {
    const tipi = await cerca('usr-advisor', 'advisor');
    expect(tipi.sort()).toEqual(['clienti', 'contratti', 'documenti', 'eventi', 'fatture', 'progetti', 'utenti']);
  });

  it('una riga di matrice che concede invoices "read" a un esterno fa comparire le fatture', async () => {
    stato.matrice = { invoices: 'read' };
    const tipi = await cerca('usr-esterno', 'collaboratore_esterno');
    expect(tipi).toContain('fatture');
    expect(tipi).not.toContain('clienti');
  });

  it('una riga "denied" vale anche per l\'advisor; team e calendario restano', async () => {
    stato.matrice = { projects: 'denied', documents: 'denied' };
    const tipi = await cerca('usr-advisor', 'advisor');
    expect(tipi).not.toContain('progetti');
    expect(tipi).not.toContain('documenti');
    expect(tipi).toEqual(expect.arrayContaining(['utenti', 'eventi', 'fatture']));
  });

  it('super_admin vede tutto, qualunque cosa dica la matrice', async () => {
    stato.matrice = { invoices: 'denied', clients: 'denied' };
    const tipi = await cerca('usr-super', 'super_admin');
    expect(tipi).toEqual(expect.arrayContaining(['clienti', 'fatture']));
  });
});
