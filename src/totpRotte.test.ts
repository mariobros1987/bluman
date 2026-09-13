import { describe, it, expect, beforeEach, vi } from 'vitest';
import { hashPassword } from './util/password.js';
import { calcolaTotp } from './util/totp.js';

const TENANT = '00000000-0000-0000-0000-000000000001';

const stato: {
  utente: any;
  update: any[];
} = {
  utente: null,
  update: [],
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const utente = {
    findUnique: async (args: any) => {
      if (stato.utente && (args?.where?.id === stato.utente.id || args?.where?.email === stato.utente.email)) {
        return { ...stato.utente };
      }
      return null;
    },
    findFirst: async (args: any) => {
      const id = args?.where?.id;
      if (id === 'usr-super_admin') {
        return {
          id: 'usr-super_admin',
          tenantId: null,
          ruolo: 'super_admin',
          stato: 'attivo',
          sessionVersion: 0,
        };
      }
      return null;
    },
    update: async (args: any) => {
      stato.update.push(args);
      if (stato.utente && args?.where?.id === stato.utente.id) {
        Object.assign(stato.utente, args.data);
        return { ...stato.utente };
      }
      return args.data;
    },
  };

  const finto: any = {
    user: utente,
    auditLog: { create: async () => ({}) },
  };

  return {
    ...reale,
    prisma: finto,
    prismaAmministrativo: () => finto,
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

function tokenAdmin() {
  return signJwt({
    userId: 'usr-super_admin',
    tenantId: TENANT,
    email: 'admin@studio.it',
    ruolo: 'super_admin',
    sessionVersion: 0,
  });
}

describe('§6.1 — Rotte HTTP TOTP 2FA End-to-End', () => {
  let server: any;

  beforeEach(async () => {
    stato.update = [];
    stato.utente = {
      id: 'usr-super_admin',
      email: 'admin@studio.it',
      nome: 'Super Admin',
      ruolo: 'super_admin',
      stato: 'attivo',
      sessionVersion: 0,
      passwordHash: hashPassword('PasswordSicura123!'),
      totpSecret: null,
      totpAbilitato: false,
      totpBackupCodes: [],
    };

    server = await buildServer(new InMemoryApp());
  });

  it('GET /auth/totp/stato restituisce totpAbilitato false se non ancora configurato', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/auth/totp/stato',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.totpAbilitato).toBe(false);
  });

  it('POST /auth/totp/attiva genera segreto e backup codes senza errori Prisma', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/auth/totp/attiva',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(body.segreto).toBeDefined();
    expect(body.qrUrl).toBeDefined();
    expect(body.backupCodes).toHaveLength(8);

    expect(stato.utente.totpSecret).toBeDefined();
    expect(stato.utente.totpAbilitato).toBe(false);
    expect(stato.utente.totpBackupCodes).toHaveLength(8);
  });

  it('POST /auth/totp/conferma attiva il 2FA con codice corretto e rifiuta codice errato', async () => {
    // 1. Attiva
    const resAttiva = await server.inject({
      method: 'POST',
      url: '/auth/totp/attiva',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });
    expect(resAttiva.statusCode).toBe(200);
    const { segreto } = JSON.parse(resAttiva.payload);

    // 2. Prova conferma con codice errato
    const resErrata = await server.inject({
      method: 'POST',
      url: '/auth/totp/conferma',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { codiceTotp: '000000' },
    });
    expect(resErrata.statusCode).toBe(400);

    // 3. Prova conferma con codice corretto
    const codiceValido = calcolaTotp(segreto);
    const resCorretta = await server.inject({
      method: 'POST',
      url: '/auth/totp/conferma',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { codiceTotp: codiceValido },
    });
    expect(resCorretta.statusCode).toBe(200);
    expect(stato.utente.totpAbilitato).toBe(true);

    // 4. Verifica stato ora true
    const resStato = await server.inject({
      method: 'GET',
      url: '/auth/totp/stato',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });
    expect(resStato.statusCode).toBe(200);
    expect(JSON.parse(resStato.payload).totpAbilitato).toBe(true);
  });

  it('POST /auth/totp/verifica permette lo step-2 del login senza Authorization header', async () => {
    // Configura TOTP abilitato
    const resAttiva = await server.inject({
      method: 'POST',
      url: '/auth/totp/attiva',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });
    const { segreto, backupCodes } = JSON.parse(resAttiva.payload);
    const codiceValido = calcolaTotp(segreto);
    await server.inject({
      method: 'POST',
      url: '/auth/totp/conferma',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { codiceTotp: codiceValido },
    });

    // Simula emissione preToken a 2 minuti
    const preToken = signJwt({
      userId: 'usr-super_admin',
      tenantId: TENANT,
      email: 'admin@studio.it',
      ruolo: 'super_admin',
      sessionVersion: 0,
    }, 2);

    // Chiamata pubblica a /auth/totp/verifica con preToken + codice
    const resVerifica = await server.inject({
      method: 'POST',
      url: '/auth/totp/verifica',
      payload: {
        preToken,
        codiceTotp: calcolaTotp(segreto),
      },
    });

    expect(resVerifica.statusCode).toBe(200);
    const bodyVerifica = JSON.parse(resVerifica.payload);
    expect(bodyVerifica.ok).toBe(true);
    expect(bodyVerifica.token).toBeDefined();

    // Verifica anche con backup code
    const resBackup = await server.inject({
      method: 'POST',
      url: '/auth/totp/verifica',
      payload: {
        preToken,
        codiceTotp: backupCodes[0],
      },
    });
    expect(resBackup.statusCode).toBe(200);
    expect(stato.utente.totpBackupCodes).toHaveLength(7); // Uno consumato
  });

  it('POST /auth/totp/disabilita richiede la password corretta', async () => {
    // Password errata rifiutata
    const resErrata = await server.inject({
      method: 'POST',
      url: '/auth/totp/disabilita',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { password: 'PasswordSbagliata!' },
    });
    expect(resErrata.statusCode).toBe(409); // non abilitato ancora

    // Abilita prima
    stato.utente.totpAbilitato = true;
    stato.utente.totpSecret = 'qualcosa';

    const resErrata2 = await server.inject({
      method: 'POST',
      url: '/auth/totp/disabilita',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { password: 'PasswordSbagliata!' },
    });
    expect(resErrata2.statusCode).toBe(401);

    // Password giusta
    const resGiusta = await server.inject({
      method: 'POST',
      url: '/auth/totp/disabilita',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
      payload: { password: 'PasswordSicura123!' },
    });
    expect(resGiusta.statusCode).toBe(200);
    expect(stato.utente.totpAbilitato).toBe(false);
    expect(stato.utente.totpSecret).toBeNull();
  });
});
