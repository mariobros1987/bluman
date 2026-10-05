/**
 * L'abbinamento fra messaggi e micro-voci: le due regole che possono sbagliare in silenzio.
 *
 * I test qui sotto non provano una rotta — provano le **decisioni**, che è dove questa feature può
 * fare danno. Un messaggio abbinato alla micro-voce sbagliata, o un contesto che continua ad
 * abbinare quando non dovrebbe più, non produce un errore da nessuna parte: produce un fascicolo
 * che dice il falso, che è esattamente la classe di guasto per cui la feature esiste.
 *
 * Tre gruppi:
 *   1. la **validità** di un contesto armato — è la regola più facile da sbagliare, e il rinnovo
 *      per attività è proprio ciò che la rende non ovvia (senza un tetto assoluto, una chat che
 *      scrive tutti i giorni non scade mai);
 *   2. l'**abbinamento** dentro una transazione di ingestion, con un finto `tx` esplicito — non
 *      serve nessun database: la funzione prende il `tx` e lo usa;
 *   3. il **payload** del link per micro-voce, e la convivenza con quello per pratica, che non deve
 *      cambiare significato: i link già spediti sono capacità in mano ai clienti.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stato: {
  microvoce: any;
  comunicazione: any;
  abbinamenti: any[];
  contesti: any[];
  upsert: any[];
  cancellati: number;
} = { microvoce: null, comunicazione: null, abbinamenti: [], contesti: [], upsert: [], cancellati: 1 };

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    microvoceProgetto: { findFirst: async () => stato.microvoce },
    comunicazioneProgetto: { findFirst: async () => stato.comunicazione },
    comunicazioneMicrovoce: {
      upsert: async (args: any) => { stato.upsert.push(args); return {}; },
      findMany: async () => stato.abbinamenti,
      deleteMany: async () => ({ count: stato.cancellati }),
    },
    contestoMicrovoceChat: {
      upsert: async (args: any) => { stato.upsert.push(args); return {}; },
      findMany: async () => stato.contesti,
      deleteMany: async () => ({ count: stato.cancellati }),
      update: async () => ({}),
    },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

// Solo il tipo, e con un `import type`: si cancella alla compilazione, quindi non fa caricare il
// modulo vero prima che il finto sia in piedi.
import type { TxAbbinamento } from './services/comunicazioniMicrovoci.js';

const {
  ORE_TETTO_CONTESTO,
  abbinaAlContesto,
  abbinaManuale,
  contestoAncoraValido,
  rimuoviAbbinamento,
} = await import('./services/comunicazioniMicrovoci.js');
const { creaPayloadCollegamento, creaPayloadMicrovoce, progettoIdDaPayloadCollegamento, microvoceIdDaPayloadCollegamento } =
  await import('./util/webhookSecurity.js');

const TENANT = '00000000-0000-4000-8000-000000000001';
const PROGETTO = '00000000-0000-4000-8000-0000000000a1';
const ALTRA_PRATICA = '00000000-0000-4000-8000-0000000000a2';
const MICROVOCE = '00000000-0000-4000-8000-0000000000b1';
const MASTER = 'master-segreto-di-prova';

beforeEach(() => {
  stato.microvoce = null;
  stato.comunicazione = null;
  stato.abbinamenti = [];
  stato.contesti = [];
  stato.upsert = [];
  stato.cancellati = 1;
});

describe('validità di un contesto armato', () => {
  const adesso = new Date('2026-10-05T12:00:00Z');
  const oreFa = (n: number) => new Date(adesso.getTime() - n * 3_600_000);
  const oreDopo = (n: number) => new Date(adesso.getTime() + n * 3_600_000);

  it('un contesto appena armato vale', () => {
    expect(contestoAncoraValido(adesso, oreDopo(24), adesso)).toBe(true);
  });

  it('scade quando nessuno ci scrive dentro per ventiquattro ore', () => {
    expect(contestoAncoraValido(oreFa(48), oreFa(1), adesso)).toBe(false);
    // Il confine esatto è chiuso: alla scadenza il contesto non vale più.
    expect(contestoAncoraValido(oreFa(48), adesso, adesso)).toBe(false);
  });

  it('ma non sopravvive oltre il tetto assoluto, nemmeno se rinnovato ieri', () => {
    // È il caso che il rinnovo da solo non copre, ed è la ragione per cui il tetto esiste: una chat
    // che scrive ogni giorno non fa mai scadere il contesto per inattività, e senza tetto resterebbe
    // etichettata per sempre — anche dopo che la conversazione è scivolata su altro.
    expect(contestoAncoraValido(oreFa(ORE_TETTO_CONTESTO + 1), oreDopo(24), adesso)).toBe(false);
    expect(contestoAncoraValido(oreFa(ORE_TETTO_CONTESTO), oreDopo(24), adesso)).toBe(false);
    expect(contestoAncoraValido(oreFa(ORE_TETTO_CONTESTO - 1), oreDopo(24), adesso)).toBe(true);
  });

  it('una riga senza scadenza non vale per sempre: il tetto vale comunque', () => {
    // `scade_at` nullable per costruzione: la lettura non deve trattare «nessuna scadenza» come
    // «nessun limite», o un dato incompleto diventerebbe un contesto eterno.
    expect(contestoAncoraValido(oreFa(1), null, adesso)).toBe(true);
    expect(contestoAncoraValido(oreFa(ORE_TETTO_CONTESTO + 1), null, adesso)).toBe(false);
  });
});

describe('abbinaAlContesto', () => {
  /** Un `tx` finto con un solo contesto armato: la funzione prende il `tx`, quindi non serve il DB. */
  const tx = (contesto: Record<string, unknown> | null) => {
    const aggiornamenti: any[] = [];
    const abbinamenti: any[] = [];
    const finto = {
      contestoMicrovoceChat: {
        findUnique: async () => contesto,
        update: async (args: any) => { aggiornamenti.push(args); return {}; },
      },
      comunicazioneMicrovoce: {
        upsert: async (args: any) => { abbinamenti.push(args); return {}; },
      },
    };
    return { tx: finto as unknown as TxAbbinamento, aggiornamenti, abbinamenti };
  };

  const contestoValido = {
    progettoId: PROGETTO,
    microvoceProgettoId: MICROVOCE,
    armatoAt: new Date(),
    scadeAt: new Date(Date.now() + 3_600_000),
  };

  it('abbina e rinnova, dichiarando l\'origine', async () => {
    const { tx: finto, aggiornamenti, abbinamenti } = tx(contestoValido);

    const esito = await abbinaAlContesto(finto, TENANT, 'telegram', '99', PROGETTO, 'com-1');

    expect(esito).toBe(MICROVOCE);
    expect(abbinamenti[0].create).toMatchObject({
      tenantId: TENANT, comunicazioneId: 'com-1', microvoceProgettoId: MICROVOCE, origine: 'contesto',
    });
    expect(aggiornamenti).toHaveLength(1);
  });

  it('non abbina se la micro-voce è di un\'altra pratica', async () => {
    const { tx: finto, aggiornamenti, abbinamenti } = tx({ ...contestoValido, progettoId: ALTRA_PRATICA });

    expect(await abbinaAlContesto(finto, TENANT, 'signal', '+39335', PROGETTO, 'com-1')).toBeNull();
    expect(abbinamenti).toHaveLength(0);
    // Nemmeno il rinnovo: un contesto che non vale per questo messaggio non è stato «usato».
    expect(aggiornamenti).toHaveLength(0);
  });

  it('non abbina un contesto scaduto, e non lo rinnova', async () => {
    const { tx: finto, aggiornamenti, abbinamenti } = tx({
      ...contestoValido,
      scadeAt: new Date(Date.now() - 1000),
    });

    expect(await abbinaAlContesto(finto, TENANT, 'whatsapp', '39335', PROGETTO, 'com-1')).toBeNull();
    expect(abbinamenti).toHaveLength(0);
    expect(aggiornamenti).toHaveLength(0);
  });

  it('non abbina se non c\'è nessun contesto armato', async () => {
    const { tx: finto, abbinamenti } = tx(null);

    expect(await abbinaAlContesto(finto, TENANT, 'telegram', '99', PROGETTO, 'com-1')).toBeNull();
    expect(abbinamenti).toHaveLength(0);
  });
});

describe('abbinaManuale e rimuoviAbbinamento', () => {
  it('rifiuta una micro-voce di un\'altra pratica', async () => {
    stato.comunicazione = { id: 'com-1' };
    stato.microvoce = null; // la risalita microvoce → modulo → progetto non la trova in questa pratica

    const esito = await abbinaManuale(TENANT, PROGETTO, 'com-1', MICROVOCE);

    expect(esito).toEqual({ ok: false, motivo: 'microvoce_non_trovata' });
    expect(stato.upsert).toHaveLength(0);
  });

  it('rifiuta un messaggio di un\'altra pratica, senza nemmeno guardare la micro-voce', async () => {
    stato.comunicazione = null;

    const esito = await abbinaManuale(TENANT, PROGETTO, 'com-di-un-altra', MICROVOCE);

    expect(esito).toEqual({ ok: false, motivo: 'comunicazione_non_trovata' });
    expect(stato.upsert).toHaveLength(0);
  });

  it('abbinare due volte non è un errore, e l\'origine diventa quella dell\'operatore', async () => {
    stato.comunicazione = { id: 'com-1' };
    stato.microvoce = { id: MICROVOCE, nome: 'Costituzione', moduloProgettoId: 'mod-1', moduloProgetto: { progettoId: PROGETTO } };

    const esito = await abbinaManuale(TENANT, PROGETTO, 'com-1', MICROVOCE);

    expect(esito).toEqual({ ok: true, microvoceId: MICROVOCE });
    // `upsert` e non `create`: il doppio clic non deve fallire. E l'`update` riscrive l'origine,
    // perché da qui il legame è dell'operatore e non più dedotto dal contesto.
    expect(stato.upsert[0].create.origine).toBe('manuale');
    expect(stato.upsert[0].update).toEqual({ origine: 'manuale' });
  });

  it('togliere un abbinamento che non c\'è risponde «non c\'era», non un errore', async () => {
    stato.comunicazione = { id: 'com-1' };
    stato.cancellati = 0;

    expect(await rimuoviAbbinamento(TENANT, PROGETTO, 'com-1', MICROVOCE)).toBe(false);
  });

  it('non tocca un messaggio di un\'altra pratica', async () => {
    stato.comunicazione = null;

    expect(await rimuoviAbbinamento(TENANT, PROGETTO, 'com-di-un-altra', MICROVOCE)).toBe(false);
  });
});

describe('payload del link per micro-voce', () => {
  it('si compone, si scioglie, e sta nei 64 caratteri di Telegram', () => {
    const payload = creaPayloadMicrovoce(TENANT, MICROVOCE, MASTER);

    expect(payload.startsWith('z')).toBe(true);
    expect(microvoceIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(MICROVOCE);
    expect(payload.length).toBeLessThanOrEqual(64);
  });

  it('un MAC manomesso non si scioglie', () => {
    const payload = creaPayloadMicrovoce(TENANT, MICROVOCE, MASTER);
    const [id, mac] = payload.slice(1).split('_') as [string, string];
    // Si cambia il primo carattere in modo deterministico: sostituire l'ultimo con una lettera
    // fissa lascerebbe il payload intatto una volta su sessantaquattro.
    const manomesso = `z${id}_${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;

    expect(microvoceIdDaPayloadCollegamento(manomesso, TENANT, MASTER)).toBeNull();
  });

  it('il link di un altro studio non si scioglie, anche con lo stesso master secret', () => {
    const ALTRO_TENANT = '00000000-0000-4000-8000-0000000000ff';
    const payload = creaPayloadMicrovoce(ALTRO_TENANT, MICROVOCE, MASTER);

    expect(microvoceIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBeNull();
  });

  it('i due payload non sono interscambiabili, nemmeno con lo stesso segreto', () => {
    // I domini MAC sono distinti: un payload di pratica non vale come micro-voce e viceversa. Senza
    // il dominio separato, la firma coprirebbe la stessa stringa e un link varrebbe per l'altro.
    const diPratica = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);
    const diMicrovoce = creaPayloadMicrovoce(TENANT, MICROVOCE, MASTER);

    expect(microvoceIdDaPayloadCollegamento(diPratica, TENANT, MASTER)).toBeNull();
    expect(progettoIdDaPayloadCollegamento(diMicrovoce, TENANT, MASTER)).toBeNull();
  });

  it('la forma di oggi resta valida: i link già spediti continuano a funzionare', () => {
    // La regressione da non introdurre. Il payload di pratica è identico a prima — stessa forma,
    // stesso MAC — e il prefisso `z` sta fuori dall'alfabeto esadecimale che apre quei payload,
    // quindi non li confonde.
    const payload = creaPayloadCollegamento(TENANT, PROGETTO, MASTER);

    expect(payload).toHaveLength(55);
    expect(progettoIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBe(PROGETTO);
    // E non viene nemmeno scambiato per un payload di micro-voce.
    expect(microvoceIdDaPayloadCollegamento(payload, TENANT, MASTER)).toBeNull();
  });

  it('rifiuta di firmare un identificativo che non è un UUID', () => {
    expect(() => creaPayloadMicrovoce(TENANT, 'non-un-uuid', MASTER)).toThrow();
    expect(() => creaPayloadMicrovoce('non-un-uuid', MICROVOCE, MASTER)).toThrow();
  });
});
