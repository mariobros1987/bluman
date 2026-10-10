/**
 * Voce 8-bis — la credenziale della copia off-site e lo stato che ne dà conto.
 *
 * Questi test presidiano le due regole su cui poggia tutta la voce, e sono le stesse che si
 * rompono in silenzio se qualcuno «semplifica» il modulo:
 *
 * 1. **Un token senza `refresh_token` si rifiuta.** L'access token di Dropbox dura poche ore e
 *    rclone lo rinnova solo col refresh: accettarlo scriverebbe una configurazione che funziona
 *    fino a sera e poi smette senza avvisare — cioè esattamente il guasto da cui ci si difende.
 * 2. **Ciò che non si è potuto leggere vale `sconosciuto`, mai `ok`.** Un file di stato assente,
 *    illeggibile o malformato non è un backup riuscito: è un'informazione che manca, e fingerla
 *    verde è il modo in cui un guasto silenzioso diventa invisibile.
 *
 * Le cartelle sono iniettate dai parametri d'ambiente in una directory temporanea: il modulo le
 * rilegge a ogni chiamata proprio per questo, e una suite che scrivesse in `/app/backup-config`
 * non sarebbe eseguibile fuori dal container.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NOME_FILE_BACKUP,
  NOME_FILE_CONFIG,
  NOME_FILE_VERIFICA,
  NOME_REMOTE_RCLONE,
  cartellaConfigurazione,
  cartellaStato,
  componiConfigRclone,
  destinazioneBackup,
  leggiConfigurazione,
  leggiStato,
  rimuoviTokenRclone,
  scriviTokenRclone,
  statoPerTitolare,
  validaTokenRclone,
} from './services/backupOffSite.js';

/**
 * Il JSON che stampa `rclone authorize dropbox`, con valori inventati: i token veri hanno la
 * forma `sl.…` e non hanno niente da fare in un repository (regola 6). La forma però è quella
 * reale, campi compresi — un test su una forma inventata non proverebbe niente.
 */
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
  const dir = mkdtempSync(join(tmpdir(), 'bluman-backup-'));
  CARTELLE_CREATE.push(dir);
  return dir;
}

const AMBIENTE = ['BLUMAN_BACKUP_CONFIG_DIR', 'BLUMAN_BACKUP_STATO_DIR', 'BLUMAN_BACKUP_RCLONE_REMOTE'] as const;
const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE) ambienteOriginale.set(chiave, process.env[chiave]);

/** Le due cartelle di ogni test: separate, come sul VPS, così una scrittura nell'una non
 *  maschera una lettura mancante nell'altra. */
let configDir = '';
let statoDir = '';

beforeEach(() => {
  configDir = cartellaTemporanea();
  statoDir = cartellaTemporanea();
  process.env.BLUMAN_BACKUP_CONFIG_DIR = configDir;
  process.env.BLUMAN_BACKUP_STATO_DIR = statoDir;
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

describe('validaTokenRclone — cosa si accetta e cosa no', () => {
  it('accetta il JSON di `rclone authorize dropbox`', () => {
    const esito = validaTokenRclone(tokenDiProva());
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    // Il token viene riscritto, non conservato com'è arrivato: così il file ha una forma sola.
    expect(JSON.parse(esito.token)).toMatchObject({
      access_token: 'valore-finto-access',
      refresh_token: 'valore-finto-refresh',
    });
  });

  it('accetta il token circondato da spazi o andate a capo', () => {
    // Chi incolla da un terminale si porta dietro la riga vuota: rifiutarla sarebbe pedanteria.
    const esito = validaTokenRclone(`\n  ${tokenDiProva()}  \n`);
    expect(esito.ok).toBe(true);
  });

  it('rifiuta il vuoto e ciò che non è una stringa', () => {
    for (const valore of ['', '   ', undefined, null, 42, {}, ['x']]) {
      const esito = validaTokenRclone(valore);
      expect(esito.ok).toBe(false);
      if (esito.ok) return;
      expect(esito.errore).toMatch(/rclone authorize dropbox/);
    }
  });

  it('rifiuta un token senza `refresh_token`, e dice cosa succederebbe', () => {
    // È il rifiuto più importante del modulo: senza refresh la copia parte, funziona poche ore
    // e poi smette in silenzio. Meglio dirlo mentre l'operatore è ancora davanti al modulo.
    const senzaRefresh = JSON.stringify({ access_token: 'valore-finto-access', token_type: 'bearer' });
    const esito = validaTokenRclone(senzaRefresh);
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toContain('refresh_token');
    expect(esito.errore).toMatch(/senza avvisare|si fermerebbe/i);
  });

  it('rifiuta un token senza `access_token`', () => {
    const esito = validaTokenRclone(JSON.stringify({ refresh_token: 'valore-finto-refresh' }));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toContain('access_token');
  });

  it('rifiuta un `access_token` che non è una stringa', () => {
    const esito = validaTokenRclone(JSON.stringify({ access_token: { annidato: true }, refresh_token: 'x' }));
    expect(esito.ok).toBe(false);
  });

  it('rifiuta un testo che non è JSON', () => {
    const esito = validaTokenRclone('valore-finto-access');
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toMatch(/JSON valido/);
  });

  it('rifiuta un array, che è JSON valido ma non un token', () => {
    const esito = validaTokenRclone(JSON.stringify(['valore-finto-access', 'valore-finto-refresh']));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toMatch(/oggetto/);
  });

  it('rifiuta una configurazione rclone incollata per intero', () => {
    // Accettarla scriverebbe un file che rclone legge ma che non contiene nessuna credenziale:
    // la copia non partirebbe e il modulo direbbe «configurato» (regola 7).
    const configIntera = [
      '[dropbox]',
      'type = dropbox',
      `token = ${tokenDiProva()}`,
      '',
      '[altro]',
      'type = s3',
    ].join('\n');
    const esito = validaTokenRclone(configIntera);
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toMatch(/configurazione rclone/i);
  });

  it('rifiuta un testo troppo lungo: un token ne ha poche centinaia di caratteri', () => {
    const esito = validaTokenRclone('x'.repeat(5000));
    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toMatch(/troppo lungo/i);
  });
});

describe('componiConfigRclone — la forma che rclone si aspetta', () => {
  it('scrive una sezione sola, col remote che lo script del backup cerca', () => {
    const config = componiConfigRclone(tokenDiProva());
    const righe = config.split('\n');
    expect(righe[0]).toBe(`[${NOME_REMOTE_RCLONE}]`);
    expect(righe[1]).toBe('type = dropbox');
    expect(righe[2]?.startsWith('token = {')).toBe(true);
    // Il nome del remote non è un dettaglio: `backup-vps.sh` controlla che la sezione esista
    // prima di chiamare rclone, e se i due nomi divergessero il backup direbbe «credenziale
    // assente» pur essendoci.
    expect(config).toContain(`[${NOME_REMOTE_RCLONE}]`);
  });
});

describe('la cartella della credenziale', () => {
  it('una cartella assente non è «configurato»: è «non disponibile qui»', () => {
    process.env.BLUMAN_BACKUP_CONFIG_DIR = join(configDir, 'non-esiste');
    const config = leggiConfigurazione();
    expect(config.cartellaDisponibile).toBe(false);
    expect(config.configurato).toBe(false);
    expect(config.configuratoIl).toBeNull();
  });

  it('scriviTokenRclone non crea la cartella: fallisce e lo spiega', () => {
    // Creandola, su Railway si scriverebbe un file dentro il container — che nessun backup
    // legge — e l'interfaccia direbbe «configurato» (regola 7).
    const inesistente = join(configDir, 'non-esiste');
    process.env.BLUMAN_BACKUP_CONFIG_DIR = inesistente;

    expect(() => scriviTokenRclone(componiConfigRclone(tokenDiProva()))).toThrow(/non esiste su questo backend/);
    expect(existsSync(inesistente)).toBe(false);
  });

  it('salva la credenziale e la rilegge, con la data di salvataggio dal `mtime`', () => {
    scriviTokenRclone(componiConfigRclone(tokenDiProva()));

    const config = leggiConfigurazione();
    expect(config.configurato).toBe(true);
    expect(config.cartellaDisponibile).toBe(true);
    expect(config.percorso).toBe(join(configDir, NOME_FILE_CONFIG));
    expect(config.configuratoIl).not.toBeNull();
    // Una data leggibile e recente: senza il `mtime` servirebbe un terzo file di metadati,
    // cioè un'altra cosa da tenere allineata.
    const quando = Date.parse(config.configuratoIl!);
    expect(Number.isFinite(quando)).toBe(true);
    expect(Date.now() - quando).toBeLessThan(60_000);
  });

  it('il file scritto è esattamente la configurazione composta, senza righe in più', () => {
    // Una riga in più — un'altra sezione, un commento — è una configurazione che nessuno ha
    // chiesto: il file lo legge rclone alle 03:17 e nessuno lo rilegge a mano.
    const config = componiConfigRclone(tokenDiProva());
    scriviTokenRclone(config);
    const scritto = readFileSync(join(configDir, NOME_FILE_CONFIG), 'utf8');
    expect(scritto).toBe(config);
    expect(scritto.split('\n').filter(r => r && !r.startsWith('token = '))).toEqual([
      `[${NOME_REMOTE_RCLONE}]`,
      'type = dropbox',
    ]);
    const tokenScritto = scritto.split('token = ')[1] ?? '';
    expect(JSON.parse(tokenScritto)).toMatchObject({ refresh_token: 'valore-finto-refresh' });
  });

  it.runIf(process.platform !== 'win32')('la credenziale non è leggibile da tutti (0640)', () => {
    // Su Windows i bit POSIX di `chmod` non esistono; il caso vale sul VPS, dove il file sta
    // nella cartella 0750 di uid 1000 e non deve finire leggibile da altri utenti.
    scriviTokenRclone(componiConfigRclone(tokenDiProva()));
    expect(statSync(join(configDir, NOME_FILE_CONFIG)).mode & 0o777).toBe(0o640);
  });

  it('la destinazione si legge dall’ambiente, e senza di essa è `null`', () => {
    expect(destinazioneBackup()).toBeNull();
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';
    expect(destinazioneBackup()).toBe('dropbox:bluman-backup');
    // Spazi e stringa vuota valgono «non impostata»: `' '` non è una destinazione.
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = '   ';
    expect(destinazioneBackup()).toBeNull();
  });

  it('disattivare rimuove il file, e la destinazione nel `.env` resta', () => {
    scriviTokenRclone(componiConfigRclone(tokenDiProva()));
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';

    expect(rimuoviTokenRclone()).toBe(true);
    expect(existsSync(join(configDir, NOME_FILE_CONFIG))).toBe(false);
    expect(leggiConfigurazione().configurato).toBe(false);
    expect(destinazioneBackup()).toBe('dropbox:bluman-backup');
    // Rimuovere due volte non è un errore: è la stessa cosa già fatta.
    expect(rimuoviTokenRclone()).toBe(false);
  });
});

describe('leggiStato — l’evidenza, che non si inventa', () => {
  it('cartella assente: non disponibile, tutto sconosciuto', () => {
    process.env.BLUMAN_BACKUP_STATO_DIR = join(statoDir, 'non-esiste');
    const stato = leggiStato();
    expect(stato.disponibile).toBe(false);
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.backup.copiaOffSite).toBe('sconosciuto');
    expect(stato.verifica.stato).toBe('unknown');
  });

  it('un file malformato è «sconosciuto», mai «ok»', () => {
    writeFileSync(join(statoDir, NOME_FILE_BACKUP), '{ questo non è JSON');
    writeFileSync(join(statoDir, NOME_FILE_VERIFICA), '');

    const stato = leggiStato();
    expect(stato.disponibile).toBe(true);
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.verifica.stato).toBe('unknown');
    expect(stato.backup.dettaglio).toMatch(/nessuna informazione/);
  });

  it('un esito inventato non passa per valido', () => {
    // Il file lo scrive uno script bash: se un giorno cambiasse vocabolario, un valore non
    // riconosciuto deve degradare a «sconosciuto», non essere mostrato com'è.
    writeFileSync(join(statoDir, NOME_FILE_BACKUP), JSON.stringify({
      esito: 'fortunato',
      copiaOffSite: 'forse',
      quando: '2026-10-10T03:17:00.000Z',
      byte: 'molti',
    }));
    writeFileSync(join(statoDir, NOME_FILE_VERIFICA), JSON.stringify({ stato: 'boh', ore: 'dieci' }));

    const stato = leggiStato();
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.backup.copiaOffSite).toBe('sconosciuto');
    expect(stato.backup.byte).toBeNull();
    expect(stato.verifica.stato).toBe('unknown');
    expect(stato.verifica.ore).toBeNull();
    // La data invece si conserva: è un dato, non un verdetto.
    expect(stato.backup.quando).toBe('2026-10-10T03:17:00.000Z');
  });

  it('un JSON che è un array non è uno stato', () => {
    writeFileSync(join(statoDir, NOME_FILE_BACKUP), JSON.stringify(['ok']));
    writeFileSync(join(statoDir, NOME_FILE_VERIFICA), JSON.stringify(['ok']));
    const stato = leggiStato();
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.verifica.stato).toBe('unknown');
  });

  it('legge i due file che gli script depositano', () => {
    writeFileSync(join(statoDir, NOME_FILE_BACKUP), JSON.stringify({
      esito: 'ok',
      quando: '2026-10-10T03:17:00.000Z',
      file: 'bluman-2026-10-10.sql.gz.enc',
      byte: 123456,
      copiaOffSite: 'fallita',
      dettaglio: 'rclone non ha copiato 1 artefatto su 3',
    }));
    writeFileSync(join(statoDir, NOME_FILE_VERIFICA), JSON.stringify({
      stato: 'fail',
      quando: '2026-10-10T08:00:00.000Z',
      ore: 29.5,
      file: 'bluman-2026-10-09.sql.gz.enc',
      dettaglio: 'la copia più recente sul remoto ha 29 ore',
    }));

    const stato = leggiStato();
    expect(stato.backup).toMatchObject({
      esito: 'ok',
      copiaOffSite: 'fallita',
      file: 'bluman-2026-10-10.sql.gz.enc',
      byte: 123456,
    });
    expect(stato.verifica).toMatchObject({
      stato: 'fail',
      ore: 29.5,
      file: 'bluman-2026-10-09.sql.gz.enc',
    });
  });

  it('un file mancante non cancella l’altro', () => {
    // I due file li scrivono due script diversi, a due ore di distanza: capitare in mezzo è
    // normale, e il verdetto deve restare su ciò che c'è.
    writeFileSync(join(statoDir, NOME_FILE_VERIFICA), JSON.stringify({ stato: 'ok', ore: 3.5, dettaglio: 'la copia c’è' }));
    const stato = leggiStato();
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.verifica.stato).toBe('ok');
  });
});

describe('statoPerTitolare — la freschezza senza i segreti', () => {
  it('non contiene nient’altro che i due esiti e il fatto che la copia sia configurata', () => {
    const stato = statoPerTitolare();
    expect(Object.keys(stato).sort()).toEqual(['backup', 'copiaConfigurata', 'disponibile', 'verifica']);
  });

  it('la copia è «configurata» solo se ci sono sia la credenziale sia la destinazione', () => {
    // Solo la destinazione nel `.env` non autentica niente; solo la credenziale non sa dove
    // andare. Il titolare deve vedere «non configurata» finché non valgono tutte e due.
    scriviTokenRclone(componiConfigRclone(tokenDiProva()));
    expect(statoPerTitolare().copiaConfigurata).toBe(false);

    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';
    expect(statoPerTitolare().copiaConfigurata).toBe(true);

    rimuoviTokenRclone();
    expect(statoPerTitolare().copiaConfigurata).toBe(false);
  });

  it('non porta con sé né il token né il percorso delle cartelle', () => {
    scriviTokenRclone(componiConfigRclone(tokenDiProva()));
    process.env.BLUMAN_BACKUP_RCLONE_REMOTE = 'dropbox:bluman-backup';
    writeFileSync(join(statoDir, NOME_FILE_BACKUP), JSON.stringify({ esito: 'ok', quando: new Date().toISOString() }));

    const serializzato = JSON.stringify(statoPerTitolare());
    expect(serializzato).not.toContain('valore-finto-access');
    expect(serializzato).not.toContain('valore-finto-refresh');
    expect(serializzato).not.toContain(cartellaConfigurazione());
    expect(serializzato).not.toContain(cartellaStato());
  });
});

describe('le letture non lasciano residui', () => {
  it('leggere lo stato non crea le cartelle che non ci sono', () => {
    const inesistente = join(statoDir, 'non-esiste');
    process.env.BLUMAN_BACKUP_STATO_DIR = inesistente;
    leggiStato();
    leggiConfigurazione();
    expect(existsSync(inesistente)).toBe(false);
  });

  it('una cartella di stato esiste ma è vuota: disponibile, ma senza verdetti', () => {
    // È il caso del primo avvio: i montaggi ci sono, nessuno script ha ancora girato.
    mkdirSync(join(statoDir, 'vuota'));
    process.env.BLUMAN_BACKUP_STATO_DIR = join(statoDir, 'vuota');
    const stato = leggiStato();
    expect(stato.disponibile).toBe(true);
    expect(stato.backup.esito).toBe('sconosciuto');
    expect(stato.verifica.stato).toBe('unknown');
  });
});
