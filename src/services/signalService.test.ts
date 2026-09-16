/**
 * Signal: il trasporto verso il demone dello studio, e tutto ciò che deve essere rifiutato.
 *
 * I due guasti che questi test presidiano sono di natura diversa.
 *
 * Il primo è il canale che **mentiva**: «Signal REST Daemon API Endpoint» era un campo che si
 * salvava e nessuno leggeva, e il pulsante di prova rispondeva «Daemon Signal REST API v1 in
 * ascolto sul container Docker» — un demone che in questo progetto non esisteva. Qui si verifica
 * che ogni funzione dica la verità: se il demone non risponde, se il numero dello studio non è
 * registrato sopra, se l'indirizzo non è utilizzabile, l'esito è `ok: false` con il motivo.
 *
 * Il secondo è la **SSRF**: l'indirizzo lo scrive l'operatore, e questa piattaforma lo contatta.
 * Le difese sono in `validaUrlServizio` (che ha i suoi test in `networkPolicy.test.ts`); qui si
 * verifica che `signalService` le usi davvero, cioè che le richieste partano solo dopo la
 * validazione e che http, loopback e indirizzi di metadata vengano fermati *prima* di qualunque
 * `fetch`. È il punto in cui un `fetch` scritto prima della validazione passerebbe inosservato.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inviaSignal,
  inviaSignalConAllegati,
  numeroSignal,
  riceviSignal,
  scaricaAllegatoSignal,
  signalConfigurato,
  statoSignal,
} from './signalService.js';

const ATTIVO = {
  signalEndpoint: 'http://signal-cli:8080',
  signalToken: 'token-di-prova',
  signalNumber: '+393350000000',
};

/**
 * L'eccezione che ammette gli indirizzi locali vale solo con `NODE_ENV=development` e
 * `PERMETTI_ENDPOINT_LOCALI=1` (`endpointLocaliConsentiti`): è la condizione in cui gira l'E2E,
 * dove il demone sta in un container sulla stessa macchina. La si accende solo per i test che
 * devono arrivare a costruire la richiesta — quelli sulla SSRF girano con l'ambiente normale,
 * che è quello della produzione.
 */
function conAmbienteDiSviluppo(): void {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('PERMETTI_ENDPOINT_LOCALI', '1');
}

function risposta(corpo: unknown, init: { stato?: number; headers?: Record<string, string> } = {}) {
  const testo = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  return {
    ok: (init.stato ?? 200) < 400,
    status: init.stato ?? 200,
    headers: new Headers(init.headers ?? { 'content-type': 'application/json' }),
    text: async () => testo,
    json: async () => JSON.parse(testo),
    arrayBuffer: async () => new TextEncoder().encode(testo).buffer,
  } as unknown as Response;
}

let fetchFinto: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFinto = vi.fn();
  vi.stubGlobal('fetch', fetchFinto);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('numeroSignal — la forma che pretende Signal', () => {
  it('normalizza spazi, punti e il prefisso scritto come 00', () => {
    expect(numeroSignal('+39 335 1234567')).toBe('+393351234567');
    expect(numeroSignal('0039 335 1234567')).toBe('+393351234567');
    expect(numeroSignal('+39.335.1234567')).toBe('+393351234567');
  });

  it('rifiuta un numero senza prefisso internazionale invece di inventarlo', () => {
    // `3351234567` non è «un numero italiano senza +39»: è un numero di cui non si conosce il
    // paese. Prependere il `+` lo trasformerebbe in `+3351234567`, cioè in un numero francese,
    // e il codice di firma partirebbe verso un estraneo.
    expect(numeroSignal('3351234567')).toBeNull();
    expect(numeroSignal('393351234567')).toBeNull();
    expect(numeroSignal('123456')).toBeNull();
    expect(numeroSignal('+39 335 1234567890123')).toBeNull();
    expect(numeroSignal('')).toBeNull();
    expect(numeroSignal(null)).toBeNull();
    expect(numeroSignal(undefined)).toBeNull();
  });

  it('rifiuta un numero che inizia per zero: non è E.164', () => {
    expect(numeroSignal('+0 39 335 1234567')).toBeNull();
  });
});

describe('signalConfigurato — senza numero non c\'è mittente', () => {
  it('vuole entrambe le cose: indirizzo del demone e numero dello studio', () => {
    expect(signalConfigurato({ signalEndpoint: 'https://signal.studio.it', signalNumber: '+393350000000', signalToken: null })).toBe(true);
    expect(signalConfigurato({ signalEndpoint: 'https://signal.studio.it', signalNumber: null, signalToken: null })).toBe(false);
    expect(signalConfigurato({ signalEndpoint: null, signalNumber: '+393350000000', signalToken: null })).toBe(false);
  });

  it('un numero scritto male non conta come configurato: il canale risulta spento, non rotto', () => {
    // È la differenza che conta in interfaccia: «non configurato» manda l'operatore in
    // Impostazioni → Canali, «configurato ma rifiutato» lo manderebbe a cercare altrove.
    expect(signalConfigurato({ signalEndpoint: 'https://signal.studio.it', signalNumber: '393350000000', signalToken: null })).toBe(false);
  });
});

describe('inviaSignal — nessun successo inventato', () => {
  it('canale non configurato: lo dice e non contatta nessuno', async () => {
    const esito = await inviaSignal({ signalEndpoint: null, signalToken: null, signalNumber: null }, '+393351111111', 'ciao');
    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/non è configurato/i);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('numero dello studio o del destinatario non in forma internazionale: si ferma prima', async () => {
    const studio = await inviaSignal({ ...ATTIVO, signalNumber: '393350000000' }, '+393351111111', 'ciao');
    expect(studio.ok).toBe(false);
    expect(studio.errore).toMatch(/numero Signal dello studio/i);

    const cliente = await inviaSignal(ATTIVO, 'non-un-numero', 'ciao');
    expect(cliente.ok).toBe(false);
    expect(cliente.errore).toMatch(/destinatario/i);

    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('testo vuoto: non si spedisce un messaggio senza contenuto', async () => {
    const esito = await inviaSignal(ATTIVO, '+393351111111', '   ');
    expect(esito.ok).toBe(false);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('in produzione http non è ammesso: il token e i messaggi viaggerebbero in chiaro', async () => {
    const esito = await inviaSignal(
      { ...ATTIVO, signalEndpoint: 'http://signal.studio.it' },
      '+393351111111',
      'ciao',
    );
    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/https/i);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('indirizzi interni rifiutati: loopback, rete privata e metadata cloud', async () => {
    // Sono gli indirizzi che una SSRF cerca: il servizio interno, la rete dello studio e
    // l'endpoint dei metadata dell'hosting, che fra le altre cose distribuisce credenziali.
    for (const indirizzo of ['https://127.0.0.1', 'https://10.0.0.5', 'https://169.254.169.254', 'https://[::1]']) {
      const esito = await inviaSignal({ ...ATTIVO, signalEndpoint: indirizzo }, '+393351111111', 'ciao');
      expect(esito.ok, indirizzo).toBe(false);
      expect(esito.errore, indirizzo).toMatch(/non pubblico|non valido/i);
    }
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('parametri, frammenti e credenziali nell\'indirizzo sono respinti', async () => {
    for (const indirizzo of [
      'https://signal.studio.it?token=abc',
      'https://signal.studio.it#x',
      'https://utente:password@signal.studio.it',
      'file:///etc/passwd',
    ]) {
      const esito = await inviaSignal({ ...ATTIVO, signalEndpoint: indirizzo }, '+393351111111', 'ciao');
      expect(esito.ok, indirizzo).toBe(false);
    }
    expect(fetchFinto).not.toHaveBeenCalled();
  });
});

describe('inviaSignal — la richiesta al demone', () => {
  beforeEach(conAmbienteDiSviluppo);

  it('spedisce a /v2/send con la forma del contratto e il numero in E.164', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ timestamp: 1 }));

    const esito = await inviaSignal(ATTIVO, '+39 335 111 1111', 'Buongiorno');

    expect(esito.ok).toBe(true);
    const [url, init] = fetchFinto.mock.calls[0]!;
    expect(url).toBe('http://signal-cli:8080/v2/send');
    expect(init.method).toBe('POST');
    // Il token dello studio viaggia in Authorization, mai nell'URL.
    expect(init.headers.Authorization).toBe('Bearer token-di-prova');
    expect(JSON.parse(init.body)).toEqual({
      message: 'Buongiorno',
      number: '+393350000000',
      recipients: ['+393351111111'],
    });
  });

  it('senza token configurato non manda l\'intestazione, e non inventa un Bearer vuoto', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({}));
    await inviaSignal({ ...ATTIVO, signalToken: null }, '+393351111111', 'ciao');
    expect(fetchFinto.mock.calls[0]![1].headers.Authorization).toBeUndefined();
  });

  it('se il demone rifiuta, riporta il suo motivo invece di un generico «non riuscito»', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ error: 'Number is not registered' }, { stato: 400 }));

    const esito = await inviaSignal(ATTIVO, '+393351111111', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toContain('Number is not registered');
  });

  it('demone irraggiungibile: lo dice, e non fa finta di aver spedito', async () => {
    fetchFinto.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const esito = await inviaSignal(ATTIVO, '+393351111111', 'ciao');

    expect(esito.ok).toBe(false);
    expect(esito.errore).toMatch(/non raggiungibile/i);
  });

  it('con allegati il nome del file viaggia nella forma che il demone si aspetta', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({}));

    const esito = await inviaSignalConAllegati(ATTIVO, '+393351111111', 'Ecco il contratto', [
      { nome: 'contratto 2026.pdf', base64: 'JVBERi0=' },
    ]);

    expect(esito.ok).toBe(true);
    const corpo = JSON.parse(fetchFinto.mock.calls[0]![1].body);
    // `filename=` non è un vezzo: senza, il cliente riceve un file senza nome.
    expect(corpo.base64_attachments).toEqual(['data:application/pdf;filename=contratto_2026.pdf;base64,JVBERi0=']);
  });

  it('senza allegati ripiega sull\'invio semplice', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({}));
    await inviaSignalConAllegati(ATTIVO, '+393351111111', 'ciao', []);
    expect(JSON.parse(fetchFinto.mock.calls[0]![1].body).base64_attachments).toBeUndefined();
  });
});

describe('statoSignal — la sonda del pulsante di prova', () => {
  beforeEach(conAmbienteDiSviluppo);

  it('demone raggiungibile e numero registrato: dice cosa ha visto davvero', async () => {
    fetchFinto
      .mockResolvedValueOnce(risposta({ version: '0.1.0', mode: 'normal' }))
      .mockResolvedValueOnce(risposta([{ number: '+393350000000' }]));

    const stato = await statoSignal(ATTIVO);

    expect(stato.ok).toBe(true);
    expect(stato.messaggio).toContain('0.1.0');
    expect(stato.messaggio).toContain('+393350000000');
    // Il demone non ha un webhook da registrare: dirlo evita che qualcuno lo cerchi.
    expect(stato.messaggio).toMatch(/non c'è nessun indirizzo da registrare/i);
  });

  it('il numero dello studio non è registrato sul demone: è un guasto, non un successo', async () => {
    // È il caso che rende utile interrogare `/v1/accounts`: il demone risponde alla sonda e poi
    // rifiuta ogni invio, quindi un «raggiungibile» secco manderebbe l'operatore a cercare
    // altrove.
    fetchFinto
      .mockResolvedValueOnce(risposta({ version: '0.1.0' }))
      .mockResolvedValueOnce(risposta([{ number: '+393359999999' }]));

    const stato = await statoSignal(ATTIVO);

    expect(stato.ok).toBe(false);
    expect(stato.messaggio).toContain('+393359999999');
    expect(stato.messaggio).toMatch(/non è fra quelli registrati/i);
  });

  it('se i numeri registrati non si leggono, lo dice invece di dichiarare la verifica', async () => {
    fetchFinto
      .mockResolvedValueOnce(risposta({ version: '0.1.0' }))
      .mockResolvedValueOnce(risposta('errore interno', { stato: 500 }));

    const stato = await statoSignal(ATTIVO);

    expect(stato.ok).toBe(true);
    expect(stato.messaggio).toMatch(/non è verificata/i);
  });

  it('demone che risponde 500 alla sonda: non è raggiungibile, e si dice', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ error: 'boom' }, { stato: 500 }));

    const stato = await statoSignal(ATTIVO);

    expect(stato.ok).toBe(false);
    expect(stato.messaggio).toContain('500');
  });

  it('numero dello studio mancante: il demone c\'è ma non si può spedire', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ version: '0.1.0' }));

    const stato = await statoSignal({ ...ATTIVO, signalNumber: null });

    expect(stato.ok).toBe(false);
    expect(stato.messaggio).toMatch(/manca il numero Signal dello studio/i);
  });
});

/**
 * Questi due girano **senza** l'eccezione di sviluppo, cioè con l'ambiente che ha la produzione:
 * è l'unico modo per verificare che un indirizzo non utilizzabile venga fermato prima del
 * `fetch`. Con l'eccezione accesa `http://…` sarebbe legittimo, ed è quello che serve altrove.
 */
describe('statoSignal — indirizzo non utilizzabile, fuori dall\'ambiente di sviluppo', () => {
  it('http in produzione: il motivo della policy, non un errore di rete generico', async () => {
    const stato = await statoSignal({ ...ATTIVO, signalEndpoint: 'http://signal.studio.it' });
    expect(stato.ok).toBe(false);
    expect(stato.messaggio).toMatch(/https/i);
    expect(fetchFinto).not.toHaveBeenCalled();
  });

  it('un indirizzo interno non viene mai contattato', async () => {
    const stato = await statoSignal({ ...ATTIVO, signalEndpoint: 'https://169.254.169.254' });
    expect(stato.ok).toBe(false);
    expect(stato.messaggio).toMatch(/non pubblico|non valido/i);
    expect(fetchFinto).not.toHaveBeenCalled();
  });
});

describe('riceviSignal — la lettura distruttiva della coda', () => {
  beforeEach(conAmbienteDiSviluppo);

  const busta = (extra: Record<string, unknown> = {}) => ({
    envelope: {
      source: '+393351111111',
      sourceNumber: '+393351111111',
      sourceName: 'Mario Cliente',
      timestamp: 1_760_000_000_000,
      dataMessage: { message: 'Buongiorno, ho inviato i documenti', timestamp: 1_760_000_000_000 },
    },
    ...extra,
  });

  it('normalizza mittente, testo e identificativo per l\'idempotenza', async () => {
    fetchFinto.mockResolvedValueOnce(risposta([busta()]));

    const esito = await riceviSignal(ATTIVO);

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.messaggi).toHaveLength(1);
    expect(esito.messaggi[0]).toMatchObject({
      mittente: '393351111111',
      nomeMittente: 'Mario Cliente',
      testo: 'Buongiorno, ho inviato i documenti',
      // Il mittente da solo non distingue due messaggi dello stesso cliente: serve l'istante.
      eventId: '393351111111:1760000000000',
    });
    // Il numero va percent-encodato nel percorso: è un `+`, che in un URL significa spazio.
    expect(fetchFinto.mock.calls[0]![0]).toBe('http://signal-cli:8080/v1/receive/%2B393350000000');
  });

  it('scarta le proprie copie: un messaggio in uscita non è una parola del cliente', async () => {
    fetchFinto.mockResolvedValueOnce(
      risposta([
        {
          envelope: {
            source: '+393350000000',
            sourceNumber: '+393350000000',
            timestamp: 1,
            dataMessage: { message: 'Le mando io il documento', timestamp: 1 },
          },
        },
      ]),
    );

    const esito = await riceviSignal(ATTIVO);

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.messaggi).toHaveLength(0);
  });

  it('ignora ricevute, spunte e chiamate: non hanno un `dataMessage` con testo', async () => {
    fetchFinto.mockResolvedValueOnce(
      risposta([
        { envelope: { source: '+393351111111', timestamp: 1, receiptMessage: { isDelivery: true } } },
        { envelope: { source: '+393351111111', timestamp: 2, dataMessage: { message: '   ' } } },
      ]),
    );

    const esito = await riceviSignal(ATTIVO);

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.messaggi).toHaveLength(0);
  });

  it('raccoglie gli allegati con nome, tipo e dimensione', async () => {
    fetchFinto.mockResolvedValueOnce(
      risposta([
        {
          envelope: {
            source: '+393351111111',
            sourceNumber: '+393351111111',
            timestamp: 1_760_000_000_000,
            dataMessage: {
              message: 'Ecco il documento',
              timestamp: 1_760_000_000_000,
              attachments: [{ id: 'abc12345', filename: 'visura.pdf', contentType: 'application/pdf', size: 2048 }],
            },
          },
        },
      ]),
    );

    const esito = await riceviSignal(ATTIVO);

    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.messaggi[0]?.allegati).toEqual([
      { id: 'abc12345', nome: 'visura.pdf', mime: 'application/pdf', dimensione: 2048 },
    ]);
  });

  it('una risposta che non è una lista: si dice, non si indovina la struttura', async () => {
    fetchFinto.mockResolvedValueOnce(risposta({ messaggi: [] }));

    const esito = await riceviSignal(ATTIVO);

    expect(esito.ok).toBe(false);
    if (esito.ok) return;
    expect(esito.errore).toMatch(/forma non riconosciuta/i);
  });

  it('canale non configurato: non si contatta nessun demone', async () => {
    const esito = await riceviSignal({ signalEndpoint: null, signalToken: null, signalNumber: null });
    expect(esito.ok).toBe(false);
    expect(fetchFinto).not.toHaveBeenCalled();
  });
});

describe('scaricaAllegatoSignal — il tetto di dimensione', () => {
  beforeEach(conAmbienteDiSviluppo);

  it('oltre 15 MB non entra nel Vault, e non lo si legge tutto per scoprirlo', async () => {
    fetchFinto.mockResolvedValueOnce(
      risposta('x', { headers: { 'content-type': 'application/pdf', 'content-length': String(20 * 1024 * 1024) } }),
    );

    expect(await scaricaAllegatoSignal(ATTIVO, 'abc')).toBeNull();
  });

  it('un allegato normale torna in base64 col suo tipo', async () => {
    fetchFinto.mockResolvedValueOnce(risposta('contenuto', { headers: { 'content-type': 'application/pdf' } }));

    const scaricato = await scaricaAllegatoSignal(ATTIVO, 'abc');

    expect(scaricato?.mime).toBe('application/pdf');
    expect(Buffer.from(scaricato!.base64, 'base64').toString('utf8')).toBe('contenuto');
  });

  it('un download fallito non lancia: restituisce null e l\'ingestione registra il nome', async () => {
    fetchFinto.mockResolvedValueOnce(risposta('non trovato', { stato: 404 }));
    expect(await scaricaAllegatoSignal(ATTIVO, 'abc')).toBeNull();
  });
});
