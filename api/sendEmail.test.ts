/**
 * §35 — la funzione di relay non è un endpoint pubblico.
 *
 * `api/send-email.ts` esisteva per aggirare le porte SMTP bloccate dalla rete di Railway, ma
 * era raggiungibile da qualunque browser (`Access-Control-Allow-Origin: *`) e ricadeva su
 * `process.env.SMTP_PASS` quando la richiesta non portava una password: chiunque conoscesse
 * l'URL poteva spedire email a nome dello studio senza conoscerne le credenziali.
 *
 * Questi test presidiano le tre condizioni che lo rendono un relay e non un open proxy:
 * il segreto condiviso `x-bluman-relay`, l'assenza di intestazioni CORS, e il fatto che le
 * credenziali d'ambiente restino inaccessibili alle chiamate non autorizzate. Più il
 * contratto delle risposte: nessun successo inventato, nessun destinatario di ripiego.
 *
 * Il file sta qui e non in `src/` perché `tsconfig.json` limita il programma a `src` con
 * `rootDir: src`: importare `../api/send-email.js` da un test in `src` sarebbe un errore di
 * compilazione, non una scelta di stile.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * Opzioni con cui il relay ha costruito il trasporto: serve a verificare che il nome dichiarato
 * per il certificato arrivi fino a nodemailer, invece di fermarsi al corpo della richiesta.
 * Senza il finto, questi scenari aprirebbero una connessione SMTP vera.
 */
const trasporti: any[] = [];

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (opzioni: any) => {
      trasporti.push(opzioni);
      return { sendMail: async () => ({ messageId: 'finto' }), verify: async () => true };
    },
  },
}));

/** Non è una credenziale: è il valore con cui questo test finge di essere il backend. */
const SEGRETO = 'segreto-relay-di-prova';

/**
 * `SEGRETO_RELAY` viene letto all'import del modulo, quindi ogni scenario ricarica il
 * gestore con l'ambiente che gli serve.
 */
async function caricaGestore(opzioni: { segreto?: string } = {}): Promise<any> {
  vi.resetModules();
  if (opzioni.segreto) process.env.EMAIL_RELAY_SECRET = opzioni.segreto;
  else delete process.env.EMAIL_RELAY_SECRET;
  const modulo: any = await import('./send-email.js');
  return modulo.default;
}

/** Il minimo che il gestore usa di `res`, con quello che ha scritto a disposizione del test. */
function rispostaFinta() {
  const stato = {
    codice: 0,
    corpo: null as any,
    intestazioni: {} as Record<string, string>,
  };
  const res: any = {
    setHeader(nome: string, valore: string) {
      stato.intestazioni[nome] = valore;
    },
    status(codice: number) {
      stato.codice = codice;
      return res;
    },
    json(corpo: any) {
      stato.corpo = corpo;
      return res;
    },
  };
  return { res, stato };
}

function richiesta(opzioni: { method?: string; headers?: Record<string, string>; body?: any }) {
  return {
    method: opzioni.method || 'POST',
    headers: opzioni.headers || {},
    body: opzioni.body,
  };
}

/**
 * Se la macchina che esegue i test ha le variabili SMTP impostate, lo scenario «credenziali
 * mancanti» proverebbe una connessione vera. Vanno via, e tornano al loro posto alla fine.
 */
const AMBIENTE_DA_SVUOTARE = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_RELAY_SECRET'] as const;
const ambienteOriginale = new Map<string, string | undefined>();
for (const chiave of AMBIENTE_DA_SVUOTARE) ambienteOriginale.set(chiave, process.env[chiave]);

beforeEach(() => {
  trasporti.length = 0;
  for (const chiave of AMBIENTE_DA_SVUOTARE) delete process.env[chiave];
});

afterAll(() => {
  for (const [chiave, valore] of ambienteOriginale) {
    if (valore === undefined) delete process.env[chiave];
    else process.env[chiave] = valore;
  }
});

/** Corpo valido per un invio: serve per isolare il controllo che si sta verificando. */
const CORPO_VALIDO = {
  action: 'send-message',
  smtpHost: 'smtp.esempio.test',
  smtpPort: 465,
  smtpUser: 'studio@esempio.test',
  smtpPass: 'password-di-prova',
  to: 'cliente@esempio.test',
  subject: 'Documenti',
  html: '<p>Buongiorno.</p>',
};

describe('§35 — il segreto condiviso x-bluman-relay', () => {
  it('senza intestazione la chiamata è respinta con 401', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(richiesta({ body: CORPO_VALIDO }), res);

    expect(stato.codice).toBe(401);
    expect(stato.corpo.success).toBe(false);
    expect(stato.corpo.errore).toMatch(/non autorizzato/i);
  });

  it('con un segreto diverso è respinta allo stesso modo', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(richiesta({ headers: { 'x-bluman-relay': 'segreto-sbagliato' }, body: CORPO_VALIDO }), res);

    expect(stato.codice).toBe(401);
  });

  it('un metodo diverso da POST risponde 405', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(richiesta({ method: 'GET', headers: { 'x-bluman-relay': SEGRETO } }), res);

    expect(stato.codice).toBe(405);
  });

  it('non imposta nessuna intestazione CORS: il browser non deve poterla chiamare', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(richiesta({ body: CORPO_VALIDO }), res);

    const nomi = Object.keys(stato.intestazioni).map(n => n.toLowerCase());
    expect(nomi.some(n => n.startsWith('access-control-'))).toBe(false);
    expect(stato.intestazioni['Cache-Control']).toBe('no-store');
  });
});

describe('§35 — le credenziali d\'ambiente non sono a disposizione di chi passa', () => {
  it('senza EMAIL_RELAY_SECRET configurato l\'endpoint è disattivato (fail-closed)', async () => {
    // Audit §06: senza il segreto il relay NON processa affatto (503), invece di lasciar passare la
    // richiesta col rischio open-relay/SSRF. A maggior ragione non ripiega su process.env.SMTP_PASS.
    process.env.SMTP_HOST = 'smtp.esempio.test';
    process.env.SMTP_USER = 'studio@esempio.test';
    process.env.SMTP_PASS = 'password-di-ambiente-di-prova';
    const gestore = await caricaGestore();
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({ body: { action: 'send-message', to: 'estraneo@esempio.test', subject: 'x', html: '<p>x</p>' } }),
      res,
    );

    expect(stato.codice).toBe(503);
  });

  it('senza credenziali né in richiesta né in ambiente risponde 400 col motivo', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({
        headers: { 'x-bluman-relay': SEGRETO },
        body: { action: 'send-message', to: 'cliente@esempio.test', subject: 'x', html: '<p>x</p>' },
      }),
      res,
    );

    expect(stato.codice).toBe(400);
    expect(stato.corpo.errore).toMatch(/credenziali smtp mancanti/i);
  });
});

describe('§35 — il contratto delle risposte', () => {
  it('un destinatario non valido non diventa la casella dello studio', async () => {
    // Il ripiego `to || effectiveUser` spediva allo studio la comunicazione destinata al
    // cliente, e rispondeva «recapitata».
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({ headers: { 'x-bluman-relay': SEGRETO }, body: { ...CORPO_VALIDO, to: '' } }),
      res,
    );

    expect(stato.codice).toBe(400);
    expect(stato.corpo.errore).toMatch(/destinatario/i);
  });

  it('senza corpo HTML non spedisce un messaggio vuoto', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({ headers: { 'x-bluman-relay': SEGRETO }, body: { ...CORPO_VALIDO, html: '' } }),
      res,
    );

    expect(stato.codice).toBe(400);
    expect(stato.corpo.errore).toMatch(/corpo del messaggio/i);
  });

  it('le vecchie azioni non esistono più: `test-imap` risponde 400, non un test riuscito', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({ headers: { 'x-bluman-relay': SEGRETO }, body: { action: 'test-imap' } }),
      res,
    );

    expect(stato.codice).toBe(400);
    expect(stato.corpo.errore).toMatch(/non supportata/i);
  });

  it('`fetch-imap-inbound` senza credenziali risponde 400, non una casella vuota', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({ headers: { 'x-bluman-relay': SEGRETO }, body: { action: 'fetch-imap-inbound' } }),
      res,
    );

    expect(stato.codice).toBe(400);
    expect(stato.corpo.success).toBe(false);
    expect(stato.corpo.emails).toEqual([]);
    expect(stato.corpo.errore).toMatch(/non configurata/i);
  });
});

describe('§35 — il nome dichiarato per il certificato non si perde nel relay', () => {
  it('`smtpServername` arriva a nodemailer come `tls.servername`', async () => {
    // Il relay è la strada normale degli invii in produzione: se il nome si fermasse qui, la
    // correzione funzionerebbe solo sul ripiego SMTP diretto, cioè quasi mai.
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(
      richiesta({
        headers: { 'x-bluman-relay': SEGRETO },
        body: { ...CORPO_VALIDO, smtpServername: 'authsmtp.certificato.test' },
      }),
      res,
    );

    expect(stato.codice).toBe(200);
    expect(trasporti).toHaveLength(1);
    expect(trasporti[0].host).toBe('smtp.esempio.test');
    expect(trasporti[0].tls.servername).toBe('authsmtp.certificato.test');
    // §3.4 — il nome cambia il confronto, non lo elimina.
    expect(trasporti[0].tls.rejectUnauthorized).toBe(true);
  });

  it('senza `smtpServername` il certificato si verifica contro l\'host, come di norma', async () => {
    const gestore = await caricaGestore({ segreto: SEGRETO });
    const { res, stato } = rispostaFinta();

    await gestore(richiesta({ headers: { 'x-bluman-relay': SEGRETO }, body: CORPO_VALIDO }), res);

    expect(stato.codice).toBe(200);
    expect(trasporti[0].tls).not.toHaveProperty('servername');
    expect(trasporti[0].tls.rejectUnauthorized).toBe(true);
  });
});
