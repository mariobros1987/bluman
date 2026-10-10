/**
 * Voce 8-bis — le rotte della copia off-site del backup.
 *
 * Tre cose si presidiano qui, e sono quelle che si perdono per prime quando qualcuno tocca
 * queste rotte «per fare prima»:
 *
 * 1. **Il token non esce mai.** Né da `GET /admin/backup` né da `GET /tenant/backup`. Si legge
 *    solo *se* è stato salvato e *quando*, come per la password del responsabile (§23): una
 *    credenziale che torna al browser è una credenziale in una schermata condivisa.
 * 2. **La freschezza la vede solo chi è responsabile dello studio.** La rotta `/tenant/backup`
 *    sta dietro un guard di **ruolo**, non dietro la matrice permessi: `tenant` e `admin` sono
 *    deliberatamente fuori dalla mappa dei moduli (`src/util/rbacModuli.ts`), perché il modulo
 *    RBAC governa le rotte di dominio.
 * 3. **Un backend che non vede la cartella risponde 503, non 200.** Su Railway il file
 *    finirebbe dentro il container, nessun backup lo leggerebbe, e l'interfaccia direbbe
 *    «configurato» (regola 7): la stessa famiglia di guasto di `urlPubblica.ts`, dove una
 *    configurazione composta per il deployment sbagliato non produce un errore ma un silenzio.
 *
 * Il mock intercetta le sole letture su cui poggiano il guard di autenticazione dell'hook
 * (`user.findFirst`) e il registro (`user.findUnique`, `auditLog.create`); il resto delega al
 * client reale, come negli altri test di rotta. Nessun test tocca il database o la rete: le due
 * cartelle sono directory temporanee iniettate dai parametri d'ambiente.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Il registro delle azioni: si azzera a ogni test e si legge per verificare cosa c'è dentro. */
const stato = vi.hoisted(() => ({ audit: [] as any[] }));

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();

  const utenti: Record<string, { ruolo: string; stato: string; sessionVersion: number; nome: string; email: string }> = {
    'usr-advisor': { ruolo: 'advisor', stato: 'attivo', sessionVersion: 0, nome: 'Titolare', email: 'advisor@studio.example' },
    'usr-collaboratore': { ruolo: 'collaboratore_interno', stato: 'attivo', sessionVersion: 0, nome: 'Collaboratore', email: 'collaboratore@studio.example' },
    'usr-super': { ruolo: 'super_admin', stato: 'attivo', sessionVersion: 0, nome: 'Piattaforma', email: 'super@piattaforma.example' },
  };

  const sostituzioniUser = {
    // Guard di autenticazione dell'hook: chiede esattamente ruolo, stato e sessionVersion.
    findFirst: async (args: any) => {
      const guard = args?.select?.ruolo === true && args?.select?.stato === true && args?.select?.sessionVersion === true;
      const utente = utenti[args?.where?.id ?? ''];
      if (guard && utente) {
        return { ruolo: utente.ruolo, stato: utente.stato, sessionVersion: utente.sessionVersion };
      }
      return (reale.prisma as any).user.findFirst(args);
    },
    // `recordAudit` completa nome/email/ruolo da qui quando non li riceve.
    findUnique: async (args: any) => {
      const utente = utenti[args?.where?.id ?? ''];
      if (utente) return { nome: utente.nome, email: utente.email, ruolo: utente.ruolo };
      return (reale.prismaAmministrativo() as any).user.findUnique(args);
    },
  };

  const sostituzioniAudit = {
    create: async (args: any) => {
      stato.audit.push(args?.data);
      return args?.data;
    },
  };

  const conSostituzioni = (base: any) => new Proxy(base, {
    get(target, proprieta) {
      if (proprieta === 'user') {
        return new Proxy(target.user, {
          get(u, p) {
            const f = sostituzioniUser[p as keyof typeof sostituzioniUser];
            if (f) return f;
            const valore = Reflect.get(u, p, u);
            return typeof valore === 'function' ? valore.bind(u) : valore;
          },
        });
      }
      if (proprieta === 'auditLog') {
        return new Proxy(target.auditLog, {
          get(a, p) {
            const f = sostituzioniAudit[p as keyof typeof sostituzioniAudit];
            if (f) return f;
            const valore = Reflect.get(a, p, a);
            return typeof valore === 'function' ? valore.bind(a) : valore;
          },
        });
      }
      const valore = Reflect.get(target, proprieta, target);
      return typeof valore === 'function' ? valore.bind(target) : valore;
    },
  });

  return {
    ...reale,
    prisma: conSostituzioni(reale.prisma as any),
    prismaAmministrativo: () => conSostituzioni((reale.prismaAmministrativo as any)()),
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');
const { NOME_FILE_CONFIG } = await import('./services/backupOffSite.js');

const TENANT = '00000000-0000-0000-0000-000000000001';

const token = (ruolo: 'advisor' | 'collaboratore_interno' | 'super_admin') => {
  const userId = ruolo === 'super_admin' ? 'usr-super' : ruolo === 'advisor' ? 'usr-advisor' : 'usr-collaboratore';
  return signJwt({ userId, tenantId: TENANT, email: `${userId}@studio.example`, ruolo, sessionVersion: 0 });
};

const auth = (ruolo: 'advisor' | 'collaboratore_interno' | 'super_admin' = 'super_admin') => ({
  authorization: `Bearer ${token(ruolo)}`,
});

/** Il JSON di `rclone authorize dropbox`, con valori inventati ma nella forma reale. */
function tokenDiProva(): string {
  return JSON.stringify({
    access_token: 'valore-finto-access',
    token_type: 'bearer',
    expires_in: 14400,
    refresh_token: 'valore-finto-refresh',
    scope: 'files.content.write files.content.read',
    uid: '0000000',
    account_id: 'dbid:AAAA',
  });
}

const CARTELLE_CREATE: string[] = [];
function cartellaTemporanea(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bluman-backup-rotte-'));
  CARTELLE_CREATE.push(dir);
  return dir;
}

const AMBIENTE = ['BLUMAN_BACKUP_CONFIG_DIR', 'BLUMAN_BACKUP_STATO_DIR', 'BLUMAN_BACKUP_RCLONE_REMOTE'] as const;
const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE) ambienteOriginale.set(chiave, process.env[chiave]);

let configDir = '';
let statoDir = '';

const server = () => buildServer(new InMemoryApp()) as any;

beforeEach(() => {
  stato.audit = [];
  configDir = cartellaTemporanea();
  statoDir = cartellaTemporanea();
  process.env.BLUMAN_BACKUP_CONFIG_DIR = configDir;
  process.env.BLUMAN_BACKUP_STATO_DIR = statoDir;
  delete process.env.BLUMAN_BACKUP_RCLONE_REMOTE;
});

afterEach(() => {
  for (const chiave of AMBIENTE) delete process.env[chiave];
});

afterAll(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
  for (const dir of CARTELLE_CREATE) rmSync(dir, { recursive: true, force: true });
});

describe('voce 8-bis — GET /admin/backup', () => {
  it('senza token risponde 401: non è una pagina pubblica', async () => {
    const res = await server().inject({ method: 'GET', url: '/admin/backup' });
    expect(res.statusCode).toBe(401);
  });

  it('un collaboratore autenticato non vede la configurazione del backup', async () => {
    const res = await server().inject({ method: 'GET', url: '/admin/backup', headers: auth('collaboratore_interno') });
    expect(res.statusCode).toBe(403);
  });

  it('lo dice anche all’advisor: configurare il backup è del super admin', async () => {
    const res = await server().inject({ method: 'GET', url: '/admin/backup', headers: auth('advisor') });
    expect(res.statusCode).toBe(403);
  });

  it('il super admin vede i due percorsi e un «non configurato» onesto', async () => {
    const res = await server().inject({ method: 'GET', url: '/admin/backup', headers: auth() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.cartellaConfigurazione).toBe(configDir);
    expect(body.cartellaStato).toBe(statoDir);
    expect(body.configurazioneDisponibile).toBe(true);
    expect(body.statoDisponibile).toBe(true);
    expect(body.configurato).toBe(false);
    expect(body.configuratoIl).toBeNull();
    expect(body.destinazione).toBeNull();
    expect(body.backup.esito).toBe('sconosciuto');
    expect(body.verifica.stato).toBe('unknown');
  });

  it('su un backend che non monta la cartella lo dichiara invece di fingere', async () => {
    process.env.BLUMAN_BACKUP_CONFIG_DIR = join(configDir, 'non-esiste');
    process.env.BLUMAN_BACKUP_STATO_DIR = join(statoDir, 'non-esiste');

    const res = await server().inject({ method: 'GET', url: '/admin/backup', headers: auth() });
    const body = res.json();
    expect(body.configurazioneDisponibile).toBe(false);
    expect(body.statoDisponibile).toBe(false);
  });

  it('la risposta non contiene mai il token, nemmeno quando è configurato', async () => {
    await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });

    const res = await server().inject({ method: 'GET', url: '/admin/backup', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().configurato).toBe(true);
    expect(res.body).not.toContain('valore-finto-access');
    expect(res.body).not.toContain('valore-finto-refresh');
    expect(res.body).not.toContain('refresh_token');
  });
});

describe('voce 8-bis — PUT /admin/backup/token', () => {
  it('salva la credenziale e risponde 200 dicendo quando è stata salvata', async () => {
    const res = await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.configurato).toBe(true);
    expect(body.configuratoIl).not.toBeNull();
    // Il messaggio dice cosa aspettarsi: la copia parte col prossimo backup, la verifica dal
    // monitor. Senza questo, «salvato» lascerebbe credere che la copia sia già fatta.
    expect(body.messaggio).toMatch(/prossimo backup/i);
    expect(body.messaggio).toMatch(/monitor/i);

    const scritto = readFileSync(join(configDir, NOME_FILE_CONFIG), 'utf8');
    expect(scritto).toContain('type = dropbox');
    expect(scritto).toContain('valore-finto-refresh');
    // E il token non torna indietro nel corpo della risposta.
    expect(res.body).not.toContain('valore-finto-access');
    expect(res.body).not.toContain('valore-finto-refresh');
  });

  it.runIf(process.platform !== 'win32')('il file della credenziale è scritto 0640', async () => {
    await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });
    expect(statSync(join(configDir, NOME_FILE_CONFIG)).mode & 0o777).toBe(0o640);
  });

  it('un token senza `refresh_token` viene rifiutato e non scrive niente', async () => {
    const res = await server().inject({
      method: 'PUT',
      url: '/admin/backup/token',
      headers: auth(),
      payload: { token: JSON.stringify({ access_token: 'valore-finto-access' }) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('refresh_token');
    expect(existsSync(join(configDir, NOME_FILE_CONFIG))).toBe(false);
  });

  it('corpo assente o vuoto: 400 con l’istruzione, non 500', async () => {
    for (const payload of [{}, { token: '' }, { token: '   ' }]) {
      const res = await server().inject({ method: 'PUT', url: '/admin/backup/token', headers: auth(), payload });
      expect(res.statusCode).toBe(400);
      expect(res.json().errore).toMatch(/rclone authorize dropbox/);
    }
  });

  it('dove la cartella non c’è risponde 503, non 200: è il caso di Railway', async () => {
    // Se rispondesse 200 si scriverebbe un file dentro il container, nessun backup lo
    // leggerebbe, e l'interfaccia direbbe «configurato» (regola 7).
    process.env.BLUMAN_BACKUP_CONFIG_DIR = join(configDir, 'non-esiste');

    const res = await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().errore).toMatch(/si configura dal server che esegue i backup/);
    expect(existsSync(join(configDir, 'non-esiste'))).toBe(false);
  });

  it('il registro annota l’atto e non il contenuto', async () => {
    await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });

    const voci = stato.audit.filter(v => v?.azione === 'BACKUP_CREDENZIALE_SALVATA');
    expect(voci).toHaveLength(1);
    expect(voci[0].entita).toBe('Copia off-site del backup');
    // Il dettaglio racconta cosa è successo; il token non c'entra e non deve entrare in un
    // registro che si legge e si esporta.
    expect(JSON.stringify(voci[0])).not.toContain('valore-finto-access');
    expect(JSON.stringify(voci[0])).not.toContain('valore-finto-refresh');
  });

  it('sostituire la credenziale non richiede di disattivare prima', async () => {
    const prima = tokenDiProva();
    await server().inject({ method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: prima } });

    const altro = JSON.stringify({
      access_token: 'valore-finto-access-2',
      refresh_token: 'valore-finto-refresh-2',
    });
    const res = await server().inject({ method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: altro } });

    expect(res.statusCode).toBe(200);
    const scritto = readFileSync(join(configDir, NOME_FILE_CONFIG), 'utf8');
    expect(scritto).toContain('valore-finto-refresh-2');
    expect(scritto).not.toContain('valore-finto-refresh"');
  });

  it('resta riservata: un advisor non può salvare una credenziale', async () => {
    const res = await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth('advisor'), payload: { token: tokenDiProva() },
    });
    expect(res.statusCode).toBe(403);
    expect(existsSync(join(configDir, NOME_FILE_CONFIG))).toBe(false);
  });
});

describe('voce 8-bis — DELETE /admin/backup/token', () => {
  it('disattiva la copia rimuovendo il file, e lo annota', async () => {
    await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });

    const res = await server().inject({ method: 'DELETE', url: '/admin/backup/token', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, configurato: false, rimosso: true });
    expect(existsSync(join(configDir, NOME_FILE_CONFIG))).toBe(false);
    expect(stato.audit.some(v => v?.azione === 'BACKUP_CREDENZIALE_RIMOSSA')).toBe(true);
  });

  it('disattivare quando non c’è niente da disattivare non è un errore', async () => {
    const res = await server().inject({ method: 'DELETE', url: '/admin/backup/token', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().rimosso).toBe(false);
  });

  it('resta riservata al super admin', async () => {
    const res = await server().inject({ method: 'DELETE', url: '/admin/backup/token', headers: auth('advisor') });
    expect(res.statusCode).toBe(403);
  });
});

describe('voce 8-bis — GET /tenant/backup', () => {
  it('il titolare vede la freschezza, e nient’altro', async () => {
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';

    const res = await server().inject({ method: 'GET', url: '/tenant/backup', headers: auth('advisor') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['backup', 'copiaConfigurata', 'disponibile', 'verifica']);
    expect(body.copiaConfigurata).toBe(false);
    expect(body.disponibile).toBe(true);
  });

  it('non porta con sé né il token né il percorso delle cartelle', async () => {
    await server().inject({
      method: 'PUT', url: '/admin/backup/token', headers: auth(), payload: { token: tokenDiProva() },
    });
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';

    const res = await server().inject({ method: 'GET', url: '/tenant/backup', headers: auth('advisor') });
    expect(res.json().copiaConfigurata).toBe(true);
    expect(res.body).not.toContain('valore-finto-access');
    expect(res.body).not.toContain('valore-finto-refresh');
    expect(res.body).not.toContain(configDir);
    expect(res.body).not.toContain(statoDir);
  });

  it('un collaboratore non ha questa informazione: 403, non un riquadro vuoto', async () => {
    const res = await server().inject({ method: 'GET', url: '/tenant/backup', headers: auth('collaboratore_interno') });
    expect(res.statusCode).toBe(403);
  });

  it('senza token: 401', async () => {
    const res = await server().inject({ method: 'GET', url: '/tenant/backup' });
    expect(res.statusCode).toBe(401);
  });

  it('il super admin la vede (non ha uno studio proprio, ma amministra la piattaforma)', async () => {
    const res = await server().inject({ method: 'GET', url: '/tenant/backup', headers: auth() });
    expect(res.statusCode).toBe(200);
  });

  it('un backup fallito arriva al titolare come tale, con il suo dettaglio', async () => {
    writeFileSync(join(statoDir, 'backup.json'), JSON.stringify({
      esito: 'fallito',
      quando: new Date().toISOString(),
      dettaglio: 'il dump del database non è stato completato',
    }));

    const res = await server().inject({ method: 'GET', url: '/tenant/backup', headers: auth('advisor') });
    const body = res.json();
    expect(body.backup.esito).toBe('fallito');
    expect(body.backup.dettaglio).toMatch(/dump del database/);
  });
});
