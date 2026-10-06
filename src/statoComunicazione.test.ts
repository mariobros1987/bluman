/**
 * Lo stato di recapito di una comunicazione: chi lo scrive, chi lo legge, e cosa non deve
 * succedere quando nessuno l'ha dichiarato.
 *
 * Il difetto che questi test presidiano è stato contato, non ipotizzato: il 17/09/2026 sei
 * messaggi WhatsApp, tutti rifiutati da Meta, comparivano nel fascicolo con lo stato
 * «consegnato» e le due spunte blu. Il ripiego era in tre punti diversi — la lista del
 * fascicolo, quella del portale e il ternario che disegnava le spunte — e in tutti e tre
 * l'assenza di stato diventava una consegna. La riga, inoltre, nasceva `consegnato` **prima**
 * che il canale fosse contattato, e nessuno tornava a correggerla con l'esito vero.
 *
 * Qui si verifica, nell'ordine:
 *   1. la lettura e la scrittura dello stato dentro `external_id` (funzioni pure);
 *   2. che la riga nasca in attesa in uscita, e consegnata solo in entrata — dove è un fatto;
 *   3. che il dispatch annoti sul fascicolo com'è andata, motivo del rifiuto compreso;
 *   4. che una lettura nel portale non cancelli il guasto di un messaggio mai partito.
 */
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conStatoComunicazione, leggiMetaComunicazione, proiettaRecapito } from './util/statoComunicazione.js';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Le righe che il finto database restituisce, e le scritture che riceve. */
const finto = {
  righe: [] as any[],
  rigaPerId: null as any,
  create: [] as any[],
  update: [] as any[],
};

/** L'esito che il finto canale WhatsApp deve restituire al prossimo invio. */
const esitoCanale: { ok: boolean; errore?: string } = { ok: true };

const chiamate = {
  findFirst: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    comunicazioneProgetto: {
      create: async (args: any) => {
        finto.create.push(args);
        return { id: 'msg-creato', createdAt: new Date('2026-09-17T10:00:00Z'), ...args.data };
      },
      findMany: async () => finto.righe,
      findFirst: async (args: any) => {
        chiamate.findFirst.push(args);
        return finto.rigaPerId;
      },
      update: async (args: any) => {
        finto.update.push(args);
        return args.data;
      },
    },
    cliente: { findFirst: async () => ({ nome: 'Cliente Verificato' }) },
    progetto: {
      findUnique: async () => ({ id: 'proj-1', nome: 'Progetto', cliente: { nome: 'Cliente Verificato' } }),
      // La lettura che etichetta la conversazione del portale. Qui l'operatore scrive su una
      // pratica, quindi il cliente non arriva dal token e va cercato: senza questo metodo la
      // rotta risponde 500, e il rosso parlerebbe di un finto incompleto invece che del codice.
      findFirst: async () => ({ clienteId: 'cli-1' }),
    },
    // La lettura della chat chiede anche gli abbinamenti alle micro-voci, in una query sola per
    // tutto il fascicolo. Qui non ce ne sono, ma il metodo deve **esistere**: senza, la rotta va in
    // 500 e `res.json()` torna un oggetto d'errore invece dell'elenco — cioè i quattro test qui
    // sotto fallirebbero con «object is not iterable», che parla di destrutturazione e non del
    // vero motivo.
    comunicazioneMicrovoce: { findMany: async () => [] },
    // `$transaction` serve alla scrittura di un messaggio, che lega la riga e l'eventuale
    // abbinamento alla micro-voce in una transazione sola: senza, ogni POST di questo file
    // esplode con «prisma.$transaction is not a function». Il contesto micro-voce non ha
    // `findUnique` perché qui non se ne arma mai nessuno — e il finto che rispondesse `null`
    // comunque non direbbe niente di falso.
    $transaction: async (fn: any) => fn(prisma),
  };
  return { ...reale, prisma };
});

vi.mock('./services/notificheService.js', () => ({ notificaStudio: async () => undefined }));

// Il canale è finto: qui non interessa cosa risponde Meta, ma cosa il fascicolo scrive dopo.
vi.mock('./services/whatsappService.js', () => ({
  inviaTestoWhatsapp: async () => esitoCanale,
  inviaTemplateWhatsapp: async () => esitoCanale,
}));

vi.mock('./services/otpDispatch.js', () => ({
  credenzialiCanali: async () => ({ waPhoneId: '000000000000000', waAccessToken: 'token-di-prova' }),
}));

const { registraRotteProgetti } = await import('./routes/progetti.js');
const { registraRotteComunicazioni } = await import('./routes/comunicazioni.js');

beforeEach(() => {
  finto.righe = [];
  finto.rigaPerId = null;
  finto.create.length = 0;
  finto.update.length = 0;
  chiamate.findFirst.length = 0;
  esitoCanale.ok = true;
  delete esitoCanale.errore;
});

async function serverProgetti() {
  const server = Fastify();
  server.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = 'advisor';
    req.userId = 'usr-advisor';
  });
  await registraRotteProgetti(server, { getProgetto: async () => null } as any);
  return server;
}

async function serverComunicazioni() {
  const server = Fastify();
  server.addHook('onRequest', async req => {
    req.tenantId = TENANT;
    req.ruolo = 'advisor';
    req.userId = 'usr-advisor';
  });
  await registraRotteComunicazioni(server);
  return server;
}

/** L'`external_id` scritto dall'ultima `update`, decodificato. */
function statoScritto(): any {
  const ultima = finto.update[finto.update.length - 1];
  return JSON.parse(ultima.data.externalId);
}

describe('external_id — lettura e scrittura dello stato', () => {
  it('una colonna vuota non dichiara nessuno stato', () => {
    for (const valore of [null, undefined, '', '   ']) {
      expect(leggiMetaComunicazione(valore).stato).toBeNull();
    }
  });

  it('la parola dello stato scritta da una versione precedente si legge ancora', () => {
    // Prima in colonna c'era la sola parola: le righe già scritte non si perdono.
    expect(leggiMetaComunicazione('letto').stato).toBe('letto');
    expect(leggiMetaComunicazione('consegnato').stato).toBe('consegnato');
  });

  it('una chiave di idempotenza del provider non diventa uno stato', () => {
    // Sulle righe in entrata `external_id` porta `whatsapp:<wamid>`, non uno stato. Leggerlo
    // come tale inventerebbe una consegna che nessuno ha dichiarato.
    const meta = leggiMetaComunicazione('whatsapp:wamid.ABCDEF');
    expect(meta.stato).toBeNull();
    expect(meta.consegnatoAt).toBeNull();
  });

  it('una parola fuori vocabolario non è uno stato', () => {
    expect(leggiMetaComunicazione('spedito').stato).toBeNull();
  });

  it('un JSON illeggibile non fa esplodere la lettura di un fascicolo', () => {
    expect(leggiMetaComunicazione('{non è json').stato).toBeNull();
    expect(leggiMetaComunicazione('[1,2,3]').stato).toBeNull();
  });

  it('scrive lo stato conservando la chiave di idempotenza accanto', () => {
    // È ciò con cui il webhook riconosce un evento già visto: sovrascriverla farebbe
    // registrare due volte lo stesso messaggio in arrivo.
    const nuovo = conStatoComunicazione('whatsapp:wamid.ABCDEF', { stato: 'letto', lettoAt: '2026-09-17T10:00:00.000Z' });
    const meta = leggiMetaComunicazione(nuovo);
    expect(meta.stato).toBe('letto');
    expect(JSON.parse(nuovo).providerId).toBe('whatsapp:wamid.ABCDEF');
  });

  it('non perde i campi che non sta cambiando', () => {
    const prima = conStatoComunicazione(null, { stato: 'consegnato', consegnatoAt: '2026-09-17T09:00:00.000Z' });
    const dopo = leggiMetaComunicazione(conStatoComunicazione(prima, { stato: 'letto' }));
    expect(dopo.stato).toBe('letto');
    expect(dopo.consegnatoAt).toBe('2026-09-17T09:00:00.000Z');
  });

  it('`undefined` non cancella, `null` sì', () => {
    const prima = conStatoComunicazione(null, { stato: 'non-inviato', errore: 'rifiutato da Meta' });
    // `undefined` significa «non toccare»: è così che una modifica parziale resta parziale.
    expect(leggiMetaComunicazione(conStatoComunicazione(prima, { stato: 'inviato', errore: undefined })).errore)
      .toBe('rifiutato da Meta');
    // `null` è una scelta esplicita: il motivo vecchio non resta appeso a un invio riuscito.
    expect(leggiMetaComunicazione(conStatoComunicazione(prima, { stato: 'inviato', errore: null })).errore).toBeNull();
  });
});

describe('proiettaRecapito — la stessa lettura per il fascicolo e per la micro-voce', () => {
  // La proiezione è stata estratta perché la scheda «💬 Messaggi» della micro-voce deve dire lo
  // stesso stato della chat: due copie della regola «in entrata ⇒ consegnato» avrebbero dato due
  // risposte sullo stesso messaggio, ed è la classe di guasto per cui questo file esiste.
  const CREATO = new Date('2026-10-06T09:30:00Z');

  it('in uscita senza meta non dichiara nessuno stato, e nessuna data', () => {
    const recapito = proiettaRecapito('uscita', null, CREATO);

    expect(recapito.stato).toBeNull();
    // Il difetto gemello delle spunte blu: prendere `createdAt` come momento della consegna. Qui
    // `createdAt` è quando l'operatore ha scritto, cioè l'opposto di un fatto del provider.
    expect(recapito.consegnatoAt).toBeNull();
    expect(recapito.inviatoAt).toBeNull();
    expect(recapito.errore).toBeNull();
  });

  it('in entrata è consegnato, e la data di arrivo è il `createdAt`', () => {
    const recapito = proiettaRecapito('entrata', 'telegram:12345', CREATO);

    expect(recapito.stato).toBe('consegnato');
    expect(recapito.consegnatoAt).toBe(CREATO.toISOString());
  });

  it('una riga in entrata già letta resta `letto`, con la sua data', () => {
    const externalId = conStatoComunicazione('telegram:12345', { stato: 'letto', lettoAt: '2026-10-06T11:00:00.000Z' });
    const recapito = proiettaRecapito('entrata', externalId, CREATO);

    expect(recapito.stato).toBe('letto');
    expect(recapito.lettoAt).toBe('2026-10-06T11:00:00.000Z');
    // La deduzione non sovrascrive quello che la colonna dichiara.
    expect(recapito.consegnatoAt).toBeNull();
  });

  it('un rifiuto porta il suo motivo, e non una consegna', () => {
    const externalId = conStatoComunicazione(null, { stato: 'non-inviato', errore: 'Meta: numero non registrato' });
    const recapito = proiettaRecapito('uscita', externalId, CREATO);

    expect(recapito.stato).toBe('non-inviato');
    expect(recapito.errore).toBe('Meta: numero non registrato');
    expect(recapito.consegnatoAt).toBeNull();
  });

  it('la chiave di idempotenza del provider non diventa una consegna', () => {
    // Sulle righe in entrata `externalId` porta `whatsapp:<wamid>`: leggerlo come stato
    // inventerebbe un fatto che nessuno ha dichiarato.
    const recapito = proiettaRecapito('uscita', 'whatsapp:wamid.ABCDEF', CREATO);

    expect(recapito.stato).toBeNull();
    expect(recapito.consegnatoAt).toBeNull();
  });
});

describe('la riga nasce in attesa, e solo in entrata è consegnata', () => {
  it('in uscita nasce `da-inviare`: il canale non è ancora stato contattato', async () => {
    const server = await serverProgetti();
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'whatsapp', mittente: 'Studio', destinatario: 'Cliente', direzione: 'uscita', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(201);
    const scritto = JSON.parse(finto.create[0].data.externalId);
    expect(scritto).toEqual({ stato: 'da-inviare' });
    // La data di consegna non esiste finché non la dichiara qualcuno.
    expect(scritto.consegnatoAt).toBeUndefined();
    await server.close();
  });

  it('in entrata nasce `consegnato`, perché è arrivata davvero', async () => {
    const server = await serverProgetti();
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'email', mittente: 'Cliente', destinatario: 'Studio', direzione: 'entrata', testo: 'Vi scrivo.' },
    });

    expect(res.statusCode).toBe(201);
    const scritto = JSON.parse(finto.create[0].data.externalId);
    expect(scritto.stato).toBe('consegnato');
    expect(typeof scritto.consegnatoAt).toBe('string');
    await server.close();
  });

  it('il portale nasce `consegnato`: non ha un passo di consegna dopo la scrittura', async () => {
    // È il canale interno: il messaggio è visibile al cliente nell'istante in cui la riga esiste.
    // Lasciarlo `da-inviare` lo farebbe sembrare in coda per un invio che non deve avvenire.
    const server = await serverProgetti();
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', mittente: 'Studio', destinatario: 'Cliente', direzione: 'uscita', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(finto.create[0].data.externalId).stato).toBe('consegnato');
    await server.close();
  });

  it('una riga senza stato resta senza stato, invece di diventare consegnata', async () => {
    // È il ripiego `|| 'consegnato'` che disegnava le spunte blu sulle righe mute.
    finto.righe = [{ id: 'msg-1', direzione: 'uscita', externalId: null, createdAt: new Date('2026-09-17T10:00:00Z') }];

    const server = await serverProgetti();
    const res = await server.inject({ method: 'GET', url: '/progetti/proj-1/comunicazioni' });

    const [riga] = res.json();
    expect(riga.stato).toBeNull();
    // E nemmeno una data di consegna presa dalla creazione: è il difetto gemello, e riguarda
    // proprio le righe in uscita, dove `createdAt` è il momento in cui l'operatore ha scritto.
    expect(riga.consegnatoAt).toBeNull();
    await server.close();
  });

  it('una riga in entrata senza stato in colonna è consegnata, perché è arrivata', async () => {
    // I webhook scrivono in `external_id` la chiave di idempotenza del provider, non uno stato:
    // la colonna tace per costruzione. Per una riga in entrata l'arrivo non è una previsione,
    // ed è ciò che il portale mostra al cliente sotto il proprio messaggio.
    finto.righe = [{
      id: 'msg-1',
      direzione: 'entrata',
      externalId: 'whatsapp:wamid.ABCDEF',
      createdAt: new Date('2026-09-17T10:00:00Z'),
    }];

    const server = await serverProgetti();
    const res = await server.inject({ method: 'GET', url: '/progetti/proj-1/comunicazioni' });

    const [riga] = res.json();
    expect(riga.stato).toBe('consegnato');
    expect(riga.consegnatoAt).toBe('2026-09-17T10:00:00.000Z');
    await server.close();
  });

  it('una riga in entrata già letta resta letta, con la sua data', async () => {
    // La deduzione non sovrascrive quello che la colonna dichiara: dopo la lettura in studio lo
    // stato è `letto`, e il portale deve mostrare quello, non un «consegnato» più generico.
    finto.righe = [{
      id: 'msg-1',
      direzione: 'entrata',
      externalId: conStatoComunicazione('whatsapp:wamid.ABCDEF', { stato: 'letto', lettoAt: '2026-09-17T11:00:00.000Z' }),
      createdAt: new Date('2026-09-17T10:00:00Z'),
    }];

    const server = await serverProgetti();
    const res = await server.inject({ method: 'GET', url: '/progetti/proj-1/comunicazioni' });

    const [riga] = res.json();
    expect(riga.stato).toBe('letto');
    expect(riga.lettoAt).toBe('2026-09-17T11:00:00.000Z');
    await server.close();
  });

  it('lo stato scritto in colonna arriva al fascicolo con le sue date', async () => {
    const externalId = conStatoComunicazione(null, {
      stato: 'non-inviato',
      errore: 'Meta: numero non registrato',
    });
    finto.righe = [{ id: 'msg-1', direzione: 'uscita', externalId, createdAt: new Date('2026-09-17T10:00:00Z') }];

    const server = await serverProgetti();
    const res = await server.inject({ method: 'GET', url: '/progetti/proj-1/comunicazioni' });

    const [riga] = res.json();
    expect(riga.stato).toBe('non-inviato');
    expect(riga.errore).toBe('Meta: numero non registrato');
    await server.close();
  });
});

describe('il dispatch annota l\'esito sul fascicolo', () => {
  it('un invio accettato lascia `inviato` e cancella il motivo di un tentativo precedente', async () => {
    finto.rigaPerId = { id: 'msg-1', externalId: conStatoComunicazione(null, { stato: 'non-inviato', errore: 'rifiuto precedente' }) };

    const server = await serverComunicazioni();
    const res = await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'Buongiorno.', comunicazioneId: 'msg-1' },
    });

    expect(res.statusCode).toBe(200);
    const scritto = statoScritto();
    expect(scritto.stato).toBe('inviato');
    expect(typeof scritto.inviatoAt).toBe('string');
    expect(scritto.errore).toBeNull();
    // `inviato` e non `consegnato`: la consegna al telefono la dichiara solo il webhook di stato.
    expect(scritto.consegnatoAt).toBeUndefined();
    await server.close();
  });

  it('un rifiuto del canale finisce sul fascicolo con il motivo', async () => {
    esitoCanale.ok = false;
    esitoCanale.errore = 'Meta: (#133010) Account not registered';
    finto.rigaPerId = { id: 'msg-1', externalId: JSON.stringify({ stato: 'da-inviare' }) };

    const server = await serverComunicazioni();
    const res = await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'Buongiorno.', comunicazioneId: 'msg-1' },
    });

    expect(res.statusCode).toBe(400);
    const scritto = statoScritto();
    expect(scritto.stato).toBe('non-inviato');
    expect(scritto.errore).toBe('Meta: (#133010) Account not registered');
    await server.close();
  });

  it('anche un rifiuto per richiesta non valida dice che il messaggio è fermo', async () => {
    // Il numero manca: la riga esiste già, e lasciarla «da-inviare» la farebbe sembrare in coda.
    finto.rigaPerId = { id: 'msg-1', externalId: JSON.stringify({ stato: 'da-inviare' }) };

    const server = await serverComunicazioni();
    const res = await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { testo: 'Buongiorno.', comunicazioneId: 'msg-1' },
    });

    expect(res.statusCode).toBe(400);
    expect(statoScritto().stato).toBe('non-inviato');
    await server.close();
  });

  it('la riga si cerca dentro lo studio della richiesta', async () => {
    // L'id arriva dal browser: senza il filtro sul tenant, un id altrui farebbe scrivere sul
    // fascicolo di un altro studio.
    finto.rigaPerId = { id: 'msg-1', externalId: JSON.stringify({ stato: 'da-inviare' }) };

    const server = await serverComunicazioni();
    await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'Buongiorno.', comunicazioneId: 'msg-di-un-altro-studio' },
    });

    expect(chiamate.findFirst[0].where).toMatchObject({ id: 'msg-di-un-altro-studio', tenantId: TENANT });
    await server.close();
  });

  it('un id che non trova nessuna riga non fa fallire un invio riuscito', async () => {
    finto.rigaPerId = null;

    const server = await serverComunicazioni();
    const res = await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'Buongiorno.', comunicazioneId: 'msg-inesistente' },
    });

    expect(res.statusCode).toBe(200);
    expect(finto.update).toHaveLength(0);
    await server.close();
  });

  it('senza `comunicazioneId` non si scrive nulla: la rotta resta quella di prima', async () => {
    const server = await serverComunicazioni();
    const res = await server.inject({
      method: 'POST',
      url: '/comunicazioni/invia-whatsapp',
      payload: { to: '+390000000000', testo: 'Buongiorno.' },
    });

    expect(res.statusCode).toBe(200);
    expect(finto.update).toHaveLength(0);
    await server.close();
  });
});

describe('una lettura non cancella il guasto di un messaggio mai partito', () => {
  it('su una riga `non-inviato` registra la lettura e lascia lo stato', async () => {
    finto.righe = [{
      id: 'msg-1',
      direzione: 'uscita',
      externalId: conStatoComunicazione(null, { stato: 'non-inviato', errore: 'rifiutato da Meta' }),
    }];

    const server = await serverProgetti();
    const res = await server.inject({
      method: 'PATCH',
      url: '/progetti/proj-1/comunicazioni/segna-lette',
      payload: { direzioneDaSegnare: 'uscita' },
    });

    expect(res.statusCode).toBe(200);
    const scritto = statoScritto();
    expect(scritto.stato).toBe('non-inviato');
    expect(scritto.errore).toBe('rifiutato da Meta');
    expect(typeof scritto.lettoAt).toBe('string');
    await server.close();
  });

  it('su una riga `consegnato` la lettura porta lo stato a `letto`', async () => {
    finto.righe = [{ id: 'msg-1', direzione: 'uscita', externalId: JSON.stringify({ stato: 'consegnato' }) }];

    const server = await serverProgetti();
    await server.inject({
      method: 'PATCH',
      url: '/progetti/proj-1/comunicazioni/segna-lette',
      payload: { direzioneDaSegnare: 'uscita' },
    });

    expect(statoScritto().stato).toBe('letto');
    await server.close();
  });

  it('non inventa una data di consegna mai avvenuta', async () => {
    // Qui c'era `consegnatoAt || createdAt`: la data di creazione spacciata per consegna.
    finto.righe = [{ id: 'msg-1', direzione: 'uscita', externalId: JSON.stringify({ stato: 'inviato' }), createdAt: new Date('2026-09-17T08:00:00Z') }];

    const server = await serverProgetti();
    await server.inject({
      method: 'PATCH',
      url: '/progetti/proj-1/comunicazioni/segna-lette',
      payload: { direzioneDaSegnare: 'uscita' },
    });

    const scritto = statoScritto();
    expect(scritto.consegnatoAt).toBeUndefined();
    await server.close();
  });
});
