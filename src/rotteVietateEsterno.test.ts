/**
 * A2 — le rotte fuori matrice (KYC, fornitori, fatture ricevute, liquidazione IVA, fascicolo del
 * commercialista, firme) non passavano dal RBAC per modulo: un collaboratore_esterno con un JWT
 * valido le chiamava. L'hook di server.ts ora le chiude a quel ruolo; per il collaboratore
 * interno non cambia nulla, quindi qui si verifica solo che l'hook non lo fermi.
 */
import { describe, it, expect, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    user: {
      // Verifica di sessione in server.ts: l'id del token porta il ruolo.
      findFirst: async (args: any) => {
        const id: string = args?.where?.id ?? '';
        const ruolo = id.replace(/^usr-/, '');
        return { id, tenantId: TENANT, ruolo, stato: 'attivo', sessionVersion: 0 };
      },
    },
    permessoModulo: { findUnique: async () => null },
    $transaction: async (fn: any) => fn(finto),
    $executeRaw: async () => ({}),
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const MESSAGGIO = /non è accessibile ai collaboratori esterni/;

/** Una rotta GET reale per ciascun prefisso vietato. */
const ROTTE = [
  '/kyc/coda',
  '/fornitori',
  '/fatture-ricevute',
  '/liquidazione-iva',
  '/contabilita/anteprima-fascicolo-commercialista',
  '/contabilita/export-fascicolo-commercialista',
  '/firme',
];

function chiama(ruolo: 'collaboratore_esterno' | 'collaboratore_interno', url: string) {
  const token = signJwt({ userId: `usr-${ruolo}`, tenantId: TENANT, email: `${ruolo}@studio.example`, ruolo, sessionVersion: 0 });
  return (buildServer(new InMemoryApp()) as any).inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
}

function errore(res: any): string {
  try {
    return String(res.json()?.errore ?? '');
  } catch {
    return '';
  }
}

describe('A2 — rotte fuori matrice vietate al collaboratore esterno', () => {
  it.each(ROTTE)('collaboratore_esterno su %s → 403', async (url) => {
    const res = await chiama('collaboratore_esterno', url);
    expect(res.statusCode).toBe(403);
    expect(errore(res)).toMatch(MESSAGGIO);
  });

  it.each(ROTTE)('collaboratore_interno su %s → non fermato dall’hook', async (url) => {
    const res = await chiama('collaboratore_interno', url);
    // Il gestore può rispondere come vuole (qui il database è un finto vuoto): conta che non sia
    // il rifiuto per ruolo esterno.
    expect(errore(res)).not.toMatch(MESSAGGIO);
  });
});
