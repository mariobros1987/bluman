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
      const email = args?.where?.email;
      if (stato.utente && (id === stato.utente.id || email === stato.utente.email)) {
        return { ...stato.utente };
      }
      if (id === 'usr-super_admin') {
        return {
          id: 'usr-super_admin',
          tenantId: null,
          ruolo: 'super_admin',
          stato: 'attivo',
          sessionVersion: 0,
        };
      }
      // Il collaboratore serve ai test dell'estensione: l'hook di sessione legge la riga
      // utente a ogni richiesta, e senza di essa la risposta sarebbe 401 (sessione non
      // risolvibile) invece del 403 di ruolo che il test vuole osservare.
      if (id === 'usr-collab') {
        return {
          id: 'usr-collab',
          tenantId: TENANT,
          ruolo: 'collaboratore_interno',
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

    // Simula emissione preToken a 2 minuti (porta il marcatore `pre_totp`, come il login reale)
    const preToken = signJwt({
      userId: 'usr-super_admin',
      tenantId: TENANT,
      email: 'admin@studio.it',
      ruolo: 'super_admin',
      sessionVersion: 0,
      scopo: 'pre_totp',
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

  it('il preToken NON è accettato come sessione su una rotta protetta (niente bypass 2FA)', async () => {
    // Un pre-token (scopo: pre_totp) presentato come Bearer deve essere rifiutato dall'hook onRequest:
    // vale solo per /auth/totp/verifica, non è una sessione. Senza il marcatore era usabile come token pieno.
    const preToken = signJwt({
      userId: 'usr-super_admin', tenantId: TENANT, email: 'admin@studio.it', ruolo: 'super_admin', sessionVersion: 0, scopo: 'pre_totp',
    }, 2);
    const res = await server.inject({
      method: 'POST',
      url: '/auth/totp/disabilita',
      headers: { authorization: `Bearer ${preToken}` },
      payload: { password: 'qualsiasi' },
    });
    expect(res.statusCode).toBe(401);
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

  it('POST /auth/login salta il 2FA se l\'indirizzo IP è già registrato come fidato', async () => {
    stato.utente.totpAbilitato = true;
    stato.utente.totpSecret = 'qualcosa';
    stato.utente.totpIpFidati = ['127.0.0.1'];

    // Login da 127.0.0.1 (IP fidato) -> accesso diretto con token
    const resIpFidato = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@studio.it',
        password: 'PasswordSicura123!',
      },
    });

    expect(resIpFidato.statusCode).toBe(200);
    const bodyFidato = JSON.parse(resIpFidato.payload);
    expect(bodyFidato.token).toBeDefined();
    expect(bodyFidato.totpRequired).toBeUndefined();

    // Login da nuovo IP -> richiede TOTP step 2
    stato.utente.totpIpFidati = ['192.168.1.50']; // 127.0.0.1 non è nell'elenco
    const resNuovoIp = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@studio.it',
        password: 'PasswordSicura123!',
      },
    });

    expect(resNuovoIp.statusCode).toBe(200);
    const bodyNuovoIp = JSON.parse(resNuovoIp.payload);
    expect(bodyNuovoIp.totpRequired).toBe(true);
    expect(bodyNuovoIp.preToken).toBeDefined();
  });

  it('POST /auth/totp/dimentica-ip svuota gli IP fidati memorizzati', async () => {
    stato.utente.totpAbilitato = true;
    stato.utente.totpIpFidati = ['127.0.0.1', '10.0.0.1'];

    const res = await server.inject({
      method: 'POST',
      url: '/auth/totp/dimentica-ip',
      headers: { authorization: `Bearer ${tokenAdmin()}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.ok).toBe(true);
    expect(stato.utente.totpIpFidati).toEqual([]);
  });
});

// §6.1 esteso — il 2FA TOTP non è più solo del super_admin: l'advisor gestisce i fascicoli
// di tutti i clienti dello studio ed è lo stesso profilo a rischio. Questo blocco presidia
// che le rotte accettino l'advisor e continuino a rifiutare i collaboratori.
describe('§6.1 — TOTP per advisor (estensione)', () => {
  let server: any;

  function tokenAdvisor() {
    return signJwt({
      userId: 'usr-advisor',
      tenantId: TENANT,
      email: 'advisor@studio.it',
      ruolo: 'advisor',
      sessionVersion: 0,
    });
  }

  function tokenCollaboratore() {
    return signJwt({
      userId: 'usr-collab',
      tenantId: TENANT,
      email: 'collab@studio.it',
      ruolo: 'collaboratore_interno',
      sessionVersion: 0,
    });
  }

  beforeEach(async () => {
    stato.update = [];
    stato.utente = {
      id: 'usr-advisor',
      email: 'advisor@studio.it',
      nome: 'Advisor Studio',
      ruolo: 'advisor',
      stato: 'attivo',
      sessionVersion: 0,
      passwordHash: hashPassword('PasswordSicura123!'),
      totpSecret: null,
      totpAbilitato: false,
      totpBackupCodes: [],
    };
    server = await buildServer(new InMemoryApp());
  });

  it("l'advisor può attivare e confermare il TOTP", async () => {
    const resAttiva = await server.inject({
      method: 'POST',
      url: '/auth/totp/attiva',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
    });
    expect(resAttiva.statusCode).toBe(200);
    const { segreto } = JSON.parse(resAttiva.payload);

    const resConferma = await server.inject({
      method: 'POST',
      url: '/auth/totp/conferma',
      headers: { authorization: `Bearer ${tokenAdvisor()}` },
      payload: { codiceTotp: calcolaTotp(segreto) },
    });
    expect(resConferma.statusCode).toBe(200);
    expect(stato.utente.totpAbilitato).toBe(true);
  });

  it('il collaboratore interno resta fuori: 403 su attiva e stato', async () => {
    for (const url of ['/auth/totp/attiva', '/auth/totp/stato', '/auth/totp/dimentica-ip']) {
      const res = await server.inject({
        method: url === '/auth/totp/stato' ? 'GET' : 'POST',
        url,
        headers: { authorization: `Bearer ${tokenCollaboratore()}` },
      });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it("il login dell'advisor con TOTP attivo passa dallo step-2 con preToken", async () => {
    stato.utente.totpAbilitato = true;
    stato.utente.totpSecret = 'segreto-finto';
    stato.utente.totpIpFidati = [];

    const res = await server.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'advisor@studio.it', password: 'PasswordSicura123!' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totpRequired).toBe(true);
    expect(body.preToken).toBeDefined();
  });
});

