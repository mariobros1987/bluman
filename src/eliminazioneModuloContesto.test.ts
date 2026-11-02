/**
 * DELETE /progetti/:id/moduli/:moduloId — la transazione porta il contesto del tenant (A10).
 *
 * L'eliminazione del modulo è una `$transaction` interattiva: senza `conContestoInTransazione`
 * le query dentro `tx` girano su una connessione dove `app.current_tenant_id` non è impostato e,
 * col ruolo `bluman_app`, la RLS non lascia cancellare nulla. Il finto registra l'ordine delle
 * operazioni sulla transazione: il `set_config` del tenant deve venire prima di ogni delete.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stato = {
  eventi: [] as string[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const registra = (nome: string) => async () => {
    stato.eventi.push(nome);
    return { count: 0 };
  };
  const tx: any = {
    $executeRaw: async (_sql: TemplateStringsArray, ...valori: unknown[]) => {
      stato.eventi.push(`set_config:${valori[0]}`);
      return 1;
    },
    accessoRisorsa: { deleteMany: registra('accessoRisorsa.deleteMany') },
    passaggioProgetto: { deleteMany: registra('passaggioProgetto.deleteMany') },
    microvoceProgetto: { deleteMany: registra('microvoceProgetto.deleteMany') },
    moduloProgettoDipendenza: { deleteMany: registra('moduloProgettoDipendenza.deleteMany') },
    moduloProgetto: { delete: registra('moduloProgetto.delete') },
  };
  const finto: any = {
    moduloProgetto: {
      findFirst: async () => ({
        id: 'mod-1',
        nome: 'Costituzione',
        microvoci: [{ id: 'mv-1', oreConsuntivate: 0, nome: 'Atto' }],
      }),
    },
    fatturaRiga: { count: async () => 0 },
    $transaction: async (fn: any) => fn(tx),
    $executeRaw: async () => 1,
    auditLog: { create: async (args: any) => { stato.audit.push(args.data); return {}; } },
    user: {
      findUnique: async () => ({ ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }),
      findFirst: async () => ({ ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }),
    },
    permessoModulo: { findUnique: async () => null },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

const STUDIO_2 = '00000000-0000-0000-0000-000000000002';
const TOKEN = signJwt({
  userId: 'usr-advisor',
  tenantId: STUDIO_2,
  email: 'advisor@studio.example',
  ruolo: 'advisor',
  sessionVersion: 0,
});

beforeEach(() => {
  stato.eventi.length = 0;
  stato.audit.length = 0;
});

describe('DELETE /progetti/:id/moduli/:moduloId — contesto tenant nella transazione (A10)', () => {
  it('imposta il tenant della richiesta prima di ogni delete', async () => {
    const res = await buildServer(new InMemoryApp()).inject({
      method: 'DELETE',
      url: '/progetti/prg-1/moduli/mod-1',
      headers: { authorization: `Bearer ${TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(stato.eventi[0]).toBe(`set_config:${STUDIO_2}`);
    expect(stato.eventi).toContain('moduloProgetto.delete');
    expect(stato.audit.some((a) => a.azione === 'MODULO_ELIMINATO')).toBe(true);
  });
});
