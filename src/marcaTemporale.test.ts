/**
 * Marca temporale RFC 3161 (adapter FreeTSA).
 *
 * Il fixture è una RISPOSTA VERA di FreeTSA, ottenuta il 17/10/2026 con la richiesta qui sotto
 * (stesso hash, stesso nonce). Serve a non tarare il parser sulle proprie assunzioni: se un
 * giorno il formato cambia, il test lo vede.
 *
 * I test non toccano la rete: l'invio è coperto con `fetch` finto. La prova dal vivo si fa
 * dalla scheda Impostazioni → Servizi esterni → «Verifica collegamento».
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RISPOSTA_FREETSA_20261017 } from './test-fixtures/freetsa.js';

const stato = vi.hoisted(() => ({ riga: null as any, aggiornamenti: [] as any[] }));

vi.mock('./util/prismaClient.js', () => ({
  prisma: {
    credenzialeServizioEsterno: {
      findUnique: vi.fn(async () => stato.riga),
    },
    firmaElettronica: {
      updateMany: vi.fn(async (args: any) => {
        stato.aggiornamenti.push(args);
        return { count: 1 };
      }),
    },
  },
  prismaAmministrativo: () => {
    throw new Error('prismaAmministrativo non è usato dall’adapter TSA');
  },
}));

const {
  TSA_PREDEFINITA,
  creaRichiestaMarcaTemporale,
  leggiRispostaMarcaTemporale,
  richiediMarcaTemporale,
  credenzialiTsa,
  marcaTemporaleFirma,
} = await import('./services/marcaTemporaleService.js');

/** Risposta reale di FreeTSA alla richiesta qui sotto (condivisa con il test `openssl`). */
const FIXTURE = RISPOSTA_FREETSA_20261017;

const HASH = Buffer.from(FIXTURE.hashHex, 'hex');
const NONCE = BigInt(FIXTURE.nonce);

/** TimeStampResp minima con stato 2 (rejected) e un motivo. */
function rispostaRifiutata(motivo: string): Buffer {
  const tlv = (tag: number, valore: Buffer): Buffer =>
    Buffer.concat([Buffer.from([tag, valore.length]), valore]);
  const utf8 = tlv(0x0c, Buffer.from(motivo, 'utf8'));
  const statusString = tlv(0x30, utf8);
  const statoInfo = tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([2])), statusString]));
  return tlv(0x30, statoInfo);
}

const fetchOriginale = globalThis.fetch;

beforeEach(() => {
  stato.riga = null;
  stato.aggiornamenti = [];
  globalThis.fetch = fetchOriginale;
});

afterEach(() => {
  globalThis.fetch = fetchOriginale;
});

describe('richiesta RFC 3161', () => {
  it('produce esattamente la richiesta che FreeTSA ha accettato nel fixture', () => {
    const { richiesta } = creaRichiestaMarcaTemporale(HASH, { nonce: NONCE });
    expect(richiesta.toString('base64')).toBe(FIXTURE.richiestaBase64);
  });

  it('rifiuta un’impronta che non è SHA-256 di 32 byte', () => {
    expect(() => creaRichiestaMarcaTemporale(Buffer.alloc(20))).toThrow(/32 byte/);
  });
});

describe('lettura della risposta', () => {
  it('legge la risposta reale di FreeTSA e verifica impronta e nonce', () => {
    const esito = leggiRispostaMarcaTemporale(Buffer.from(FIXTURE.rispostaBase64, 'base64'), {
      hash: HASH,
      nonce: NONCE,
      endpoint: TSA_PREDEFINITA,
    });

    expect(esito.ok).toBe(true);
    expect(esito.stato).toBe('granted');
    expect(esito.genTime).toBe('2026-10-17T15:51:26.000Z');
    expect(esito.policy).toBe('1.2.3.4.1');
    expect(esito.hashVerificato).toBe(true);
    expect(esito.errore).toBeNull();
    expect(esito.avviso).toMatch(/NON sono state validate/);
    expect(Buffer.from(esito.tokenBase64!, 'base64')[0]).toBe(0x30);
  });

  it('rifiuta un token che riguarda un’altra impronta', () => {
    const esito = leggiRispostaMarcaTemporale(Buffer.from(FIXTURE.rispostaBase64, 'base64'), {
      hash: Buffer.alloc(32, 1),
      nonce: NONCE,
      endpoint: TSA_PREDEFINITA,
    });

    expect(esito.ok).toBe(false);
    expect(esito.hashVerificato).toBe(false);
    expect(esito.errore).toMatch(/impronta diversa/);
  });

  it('rifiuta un token con un nonce diverso (risposta a un’altra richiesta)', () => {
    const esito = leggiRispostaMarcaTemporale(Buffer.from(FIXTURE.rispostaBase64, 'base64'), {
      hash: HASH,
      nonce: NONCE + 1n,
      endpoint: TSA_PREDEFINITA,
    });

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/nonce diverso/);
  });

  it('riporta il motivo quando la TSA rifiuta', () => {
    const esito = leggiRispostaMarcaTemporale(rispostaRifiutata('policy non soddisfatta'), {
      hash: HASH,
      nonce: NONCE,
      endpoint: TSA_PREDEFINITA,
    });

    expect(esito.ok).toBe(false);
    expect(esito.stato).toBe('rejected');
    expect(esito.errore).toContain('policy non soddisfatta');
  });
});

describe('invio', () => {
  it('non solleva su HTTP 500 e riporta il codice', async () => {
    globalThis.fetch = vi.fn(async () => new Response('errore interno', { status: 500 })) as any;
    const esito = await richiediMarcaTemporale(HASH);
    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/HTTP 500/);
  });

  it('non solleva quando la TSA non risponde entro il timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      const errore = new Error('aborted');
      errore.name = 'AbortError';
      throw errore;
    }) as any;
    const esito = await richiediMarcaTemporale(HASH, { timeoutMs: 2000 });
    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/nessuna risposta entro 2 secondi/);
  });

  it('rifiuta un indirizzo che non è http/https', async () => {
    const esito = await richiediMarcaTemporale(HASH, { endpoint: 'ftp://tsa.example' });
    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/https/);
  });
});

describe('credenziali dello studio', () => {
  it('senza configurazione usa FreeTSA, che è gratuita e non ha segreti', async () => {
    stato.riga = null;
    await expect(credenzialiTsa('tenant-1')).resolves.toEqual({
      endpoint: TSA_PREDEFINITA,
      username: null,
      segreto: null,
      timeoutMs: null,
    });
  });

  it('legge endpoint, utenza, segreto e timeout salvati per lo studio', async () => {
    stato.riga = {
      endpoint: 'https://tsa.fornitore.example',
      username: 'studio',
      segreto: 'segreto',
      extra: { timeoutMs: 5000 },
    };
    await expect(credenzialiTsa('tenant-1')).resolves.toEqual({
      endpoint: 'https://tsa.fornitore.example',
      username: 'studio',
      segreto: 'segreto',
      timeoutMs: 5000,
    });
  });
});

describe('marca temporale legata alla firma', () => {
  /**
   * La risposta reale ha impronta e nonce della richiesta del fixture; qui si sostituiscono
   * con quelli della richiesta ricevuta, lasciando intatto tutto il resto (TSTInfo, genTime,
   * policy, seriale). La firma CMS del token non è ricalcolata: l'adapter non la verifica,
   * ed è proprio uno dei limiti dichiarati. Il test copre il percorso che l'app usa davvero.
   */
  function rispostaPerLaRichiesta(init: any): Buffer {
    const corpo = Buffer.from(init.body as Uint8Array);
    // Layout fisso della TimeStampReq costruita qui: hash a 24..56, nonce a 58..66.
    const hash = corpo.subarray(24, 56);
    const nonce = corpo.subarray(58, 66);
    const risposta = Buffer.from(FIXTURE.rispostaBase64, 'base64');
    const indiceHash = risposta.indexOf(HASH);
    const indiceNonce = risposta.indexOf(
      Buffer.from(NONCE.toString(16).padStart(16, '0'), 'hex'),
    );
    if (indiceHash < 0 || indiceNonce < 0) throw new Error('Fixture di FreeTSA inattesa.');
    hash.copy(risposta, indiceHash);
    nonce.copy(risposta, indiceNonce);
    return risposta;
  }

  it('marca il digest del sigillo e conserva token e metadati nella firma', async () => {
    const sigillo = 'ab'.repeat(32);
    globalThis.fetch = vi.fn(async (_url: any, init: any) =>
      new Response(new Uint8Array(rispostaPerLaRichiesta(init)), { status: 200 }),
    ) as any;

    const esito = await marcaTemporaleFirma('tenant-1', { id: 'firma-1', sigilloDigest: sigillo });

    expect(esito.ok).toBe(true);
    // L'impronta marcata è il digest del sigillo stesso: si verifica con `openssl ts -verify`.
    expect(esito.impronta).toBe(sigillo);
    expect(esito.genTime).toBe('2026-10-17T15:51:26.000Z');
    expect(esito.policy).toBe('1.2.3.4.1');
    expect(esito.tsa).toBe(TSA_PREDEFINITA);
    expect(esito.avviso).toMatch(/NON sono state validate/);
    expect(esito.errore).toBeNull();

    const scritto = stato.aggiornamenti.at(-1);
    expect(scritto.where).toEqual({ id: 'firma-1', tenantId: 'tenant-1' });
    expect(scritto.data.marcaTemporaleImpronta).toBe(sigillo);
    expect(scritto.data.marcaTemporaleErrore).toBeNull();
    expect(scritto.data.marcaTemporaleTsa).toBe(TSA_PREDEFINITA);
    expect(scritto.data.marcaTemporaleGenTime).toEqual(new Date('2026-10-17T15:51:26.000Z'));
    // Il token conservato è il token VERO della risposta, e se ne registra l'impronta.
    const token = Buffer.from(scritto.data.marcaTemporaleToken, 'base64');
    expect(token[0]).toBe(0x30);
    expect(esito.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(scritto.data.marcaTemporaleTokenHash).toBe(esito.tokenHash);
  });

  it('senza sigillo non chiama la TSA e registra il motivo', async () => {
    const fetchFinto = vi.fn();
    globalThis.fetch = fetchFinto as any;

    const esito = await marcaTemporaleFirma('tenant-1', { id: 'firma-2', sigilloDigest: null });

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/Sigillo della firma assente/);
    expect(fetchFinto).not.toHaveBeenCalled();
    expect(stato.aggiornamenti.at(-1).data.marcaTemporaleErrore).toMatch(/Sigillo della firma assente/);
  });

  it('se la TSA non risponde la firma non fallisce: l’errore resta scritto', async () => {
    globalThis.fetch = vi.fn(async () => {
      const errore = new Error('aborted');
      errore.name = 'AbortError';
      throw errore;
    }) as any;

    const esito = await marcaTemporaleFirma('tenant-1', {
      id: 'firma-3',
      sigilloDigest: 'cd'.repeat(32),
    });

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/nessuna risposta entro 5 secondi/);
    const scritto = stato.aggiornamenti.at(-1);
    expect(scritto.data.marcaTemporaleToken).toBeNull();
    expect(scritto.data.marcaTemporaleErrore).toMatch(/nessuna risposta/);
    expect(scritto.data.marcaTemporaleRichiestaAt).toBeInstanceOf(Date);
  });
});
