// Le rotte della pagina personale del cliente e delle richieste per fase, viste dal confine:
// chi può chiamarle, cosa scrivono, cosa finisce negli avvisi.
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = '00000000-0000-0000-0000-000000000001';

const stato = {
  passaggio: null as any,
  aggiornamenti: [] as any[],
  messaggi: [] as any[],
  abbinamenti: [] as any[],
  avvisiStudio: [] as any[],
  avvisiCliente: [] as any[],
  audit: [] as any[],
  progetti: [] as any[],
  archivio: new Map<string, Buffer>(),
};

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    progetto: {
      findMany: async (args: any) => stato.progetti.filter((p) => p.clienteId === args.where.clienteId && (!args.where.id || p.id === args.where.id)),
      findFirst: async (args: any) => stato.progetti.find((p) => p.id === args.where.id && args.where.tenantId === TENANT) ?? null,
    },
    firmaElettronica: { findMany: async () => [{ ambito: 'engagement_letter', riferimentoId: 'proj-1' }] },
    comunicazioneProgetto: {
      findMany: async () => [
        { progettoId: 'proj-1', externalId: JSON.stringify({ stato: 'consegnato' }) },
        { progettoId: 'proj-1', externalId: JSON.stringify({ stato: 'letto', lettoAt: '2026-11-01T00:00:00Z' }) },
      ],
      create: async (args: any) => { const riga = { id: `msg-${stato.messaggi.length + 1}`, ...args.data }; stato.messaggi.push(riga); return riga; },
    },
    comunicazioneMicrovoce: { create: async (args: any) => { stato.abbinamenti.push(args.data); return args.data; } },
    fattura: { findMany: async () => [] },
    passaggioProgetto: {
      // La rotta deve chiedere il passaggio DEL cliente della sessione: il finto risponde solo
      // se la condizione porta il cliente giusto.
      findFirst: async (args: any) => {
        const clienteChiesto = args.where.microvoceProgetto?.moduloProgetto?.progetto?.clienteId;
        if (!stato.passaggio || args.where.id !== stato.passaggio.id || args.where.chi !== 'cliente') return null;
        if (clienteChiesto !== 'cli-1' || args.where.tenantId !== TENANT) return null;
        return stato.passaggio;
      },
      update: async (args: any) => { stato.aggiornamenti.push(args); return {}; },
    },
    notifica: { count: async () => 0 },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { ...reale, prisma };
});

vi.mock('./services/notificheService.js', () => ({
  notificaStudio: async (_t: string, avviso: any) => { stato.avvisiStudio.push(avviso); },
  notificaCliente: async (_t: string, clienteId: string, avviso: any) => { stato.avvisiCliente.push({ clienteId, ...avviso }); },
  avvisaClienteViaCanali: async () => undefined,
}));

vi.mock('./util/serverHelpers.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/serverHelpers.js')>();
  return { ...reale, recordAudit: async (voce: any) => { stato.audit.push(voce); } };
});

vi.mock('./services/storageService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    salvaBufferInArchivio: async (nome: string, contenuto: Buffer) => { stato.archivio.set(`/uploads/${nome}`, Buffer.from(contenuto)); return `/uploads/${nome}`; },
  };
});

const { registraRottePortaleRiepilogo } = await import('./routes/portaleRiepilogo.js');

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\nmodulo compilato\n%%EOF');
const prima = process.env.CANALE_PROTETTO_CHIAVE;

function progettoLetto(passaggi: any[] = []) {
  return {
    id: 'proj-1',
    clienteId: 'cli-1',
    nome: 'Costituzione Malta',
    stato: 'in_progress',
    numeroContratto: 'EL-2026-001',
    moduli: [{
      id: 'm-1', nome: 'Costituzione', categoria: 'Societario', stato: 'in_progress', orePreventivate: 10, dipendenze: [], microvociCondivise: [],
      microvoci: [{ id: 'mv-1', nome: 'Raccolta dati', stato: 'active', ordine: 0, orePreventivate: 10, oreConsuntivate: 0, passaggi }],
    }],
  };
}

function passaggioLetto(parziale: any = {}) {
  return {
    id: 'ps-1', titolo: 'Dati della società', tipo: 'form', chi: 'cliente', stato: 'pending', ordine: 0, descrizione: null,
    campiFormJson: ['P.IVA', 'Sede'], risposteFormJson: null, risposteClienteJson: null, rispostaClienteAt: null,
    documentoAllegatoUrl: null, linkIstruzioni: null, ...parziale,
  };
}

function passaggioDaRispondere(parziale: any = {}) {
  return {
    id: 'ps-1', titolo: 'Dati della società', tipo: 'form', stato: 'pending', campiFormJson: ['P.IVA', 'Sede'],
    microvoceProgetto: { id: 'mv-1', nome: 'Raccolta dati', moduloProgetto: { nome: 'Costituzione', progetto: { id: 'proj-1', nome: 'Costituzione Malta', cliente: { nome: 'Rossi Srl' } } } },
    ...parziale,
  };
}

async function serverPer(ruolo: string, userId: string) {
  const server = Fastify();
  server.addHook('onRequest', async (req) => {
    req.tenantId = TENANT;
    req.ruolo = ruolo as any;
    req.userId = userId;
    req.user = { userId, tenantId: TENANT, email: 'prova@example.test', ruolo } as any;
  });
  await registraRottePortaleRiepilogo(server);
  return server;
}

beforeEach(() => {
  stato.passaggio = null;
  stato.progetti = [progettoLetto([passaggioLetto()])];
  for (const elenco of [stato.aggiornamenti, stato.messaggi, stato.abbinamenti, stato.avvisiStudio, stato.avvisiCliente, stato.audit]) elenco.length = 0;
  stato.archivio.clear();
  process.env.CANALE_PROTETTO_CHIAVE = 'chiave-di-prova-del-canale-protetto-0001';
});

afterEach(() => {
  if (prima === undefined) delete process.env.CANALE_PROTETTO_CHIAVE;
  else process.env.CANALE_PROTETTO_CHIAVE = prima;
});

describe('GET /portal/riepilogo', () => {
  it('al cliente dà i suoi incarichi, cosa tocca a lui e lo stato vero della cifratura', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({ method: 'GET', url: '/portal/riepilogo' });
    expect(res.statusCode).toBe(200);
    const corpo = res.json();
    expect(corpo.canaleProtetto).toEqual({ cifraturaAttiva: true, disponibile: true });
    expect(corpo.progetti).toHaveLength(1);
    expect(corpo.progetti[0]).toMatchObject({ id: 'proj-1', turno: 'cliente', letteraFirmata: true });
    // Un messaggio dello studio su due è già stato letto.
    expect(corpo.progetti[0].azioni.map((a: any) => [a.tipo, a.titolo])).toEqual([
      ['richiesta', 'Dati della società'],
      ['messaggi', 'Un messaggio dello studio da leggere'],
    ]);
    await server.close();
  });

  it('senza nessuna chiave dichiara che il canale non è cifrato', async () => {
    // Senza chiave dedicata vale il segreto dei token: «in chiaro» è solo senza entrambi.
    const segretoToken = process.env.JWT_SECRET;
    delete process.env.CANALE_PROTETTO_CHIAVE;
    delete process.env.JWT_SECRET;
    try {
      const server = await serverPer('cliente', 'client-cli-1');
      expect((await server.inject({ method: 'GET', url: '/portal/riepilogo' })).json().canaleProtetto).toEqual({ cifraturaAttiva: false, disponibile: true });
      await server.close();
    } finally {
      if (segretoToken !== undefined) process.env.JWT_SECRET = segretoToken;
    }
  });

  it('un cliente non può chiedere il riepilogo di un altro passando il suo id', async () => {
    const server = await serverPer('cliente', 'client-cli-2');
    const res = await server.inject({ method: 'GET', url: '/portal/riepilogo?clienteId=cli-1' });
    expect(res.json().progetti).toEqual([]);
    await server.close();
  });

  it('lo studio lo apre in anteprima col cliente indicato; il collaboratore esterno no', async () => {
    const advisor = await serverPer('advisor', 'usr-1');
    expect((await advisor.inject({ method: 'GET', url: '/portal/riepilogo' })).statusCode).toBe(400);
    expect((await advisor.inject({ method: 'GET', url: '/portal/riepilogo?clienteId=cli-1' })).json().progetti).toHaveLength(1);
    await advisor.close();
    const esterno = await serverPer('collaboratore_esterno', 'usr-2');
    expect((await esterno.inject({ method: 'GET', url: '/portal/riepilogo?clienteId=cli-1' })).statusCode).toBe(403);
    await esterno.close();
  });
});

describe('POST /portal/richieste/:passaggioId/risposta', () => {
  it('salva le risposte del cliente senza chiudere il passaggio, e avvisa lo studio senza riportarle', async () => {
    stato.passaggio = passaggioDaRispondere();
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({
      method: 'POST',
      url: '/portal/richieste/ps-1/risposta',
      payload: { risposte: { 'P.IVA': 'MT12345678', Sede: 'Valletta' } },
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(200);
    expect(stato.aggiornamenti).toHaveLength(1);
    expect(stato.aggiornamenti[0].where).toEqual({ id: 'ps-1' });
    expect(stato.aggiornamenti[0].data.risposteClienteJson).toEqual({ 'P.IVA': 'MT12345678', Sede: 'Valletta' });
    expect(stato.aggiornamenti[0].data.rispostaClienteAt).toBeInstanceOf(Date);
    expect(Object.keys(stato.aggiornamenti[0].data)).toEqual(['risposteClienteJson', 'rispostaClienteAt']);
    expect(stato.messaggi).toHaveLength(0);
    expect(stato.avvisiStudio[0]).toMatchObject({ tipoEvento: 'risposta_cliente', link: '/projects/proj-1' });
    expect(JSON.stringify(stato.avvisiStudio)).not.toMatch(/MT12345678|Valletta/);
    expect(stato.audit[0]).toMatchObject({ tenantId: TENANT, userId: 'client-cli-1', ruolo: 'cliente', azione: 'RICHIESTA_CLIENTE_EVASA', ipAddress: '203.0.113.7' });
    expect(stato.audit[0].dettagli).not.toMatch(/MT12345678/);
    await server.close();
  });

  it('un campo mancante o non richiesto rifiuta tutto e non scrive niente', async () => {
    stato.passaggio = passaggioDaRispondere();
    const server = await serverPer('cliente', 'client-cli-1');
    const manca = await server.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: { risposte: { 'P.IVA': 'MT1' } } });
    expect(manca.statusCode).toBe(400);
    expect(manca.json().errore).toBe('Manca la risposta a «Sede».');
    const estraneo = await server.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: { risposte: { 'P.IVA': 'MT1', Sede: 'V', stato: 'done' } } });
    expect(estraneo.statusCode).toBe(400);
    expect(stato.aggiornamenti).toHaveLength(0);
    await server.close();
  });

  it('la richiesta di un altro cliente non si trova; lo studio non risponde al posto del cliente', async () => {
    stato.passaggio = passaggioDaRispondere();
    const altro = await serverPer('cliente', 'client-cli-2');
    expect((await altro.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: { risposte: { 'P.IVA': 'x', Sede: 'y' } } })).statusCode).toBe(404);
    await altro.close();
    const advisor = await serverPer('advisor', 'usr-1');
    expect((await advisor.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: {} })).statusCode).toBe(403);
    await advisor.close();
    expect(stato.aggiornamenti).toHaveLength(0);
  });

  it('una richiesta già chiusa dallo studio non si riapre da qui', async () => {
    stato.passaggio = passaggioDaRispondere({ stato: 'done' });
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: { risposte: { 'P.IVA': 'x', Sede: 'y' } } });
    expect(res.statusCode).toBe(409);
    expect(stato.aggiornamenti).toHaveLength(0);
    await server.close();
  });

  it('un documento richiesto vuole il file; il file arriva cifrato nel canale protetto, legato all’attività', async () => {
    stato.passaggio = passaggioDaRispondere({ tipo: 'documento', campiFormJson: null, titolo: 'Modulo antiriciclaggio' });
    const server = await serverPer('cliente', 'client-cli-1');
    const senza = await server.inject({ method: 'POST', url: '/portal/richieste/ps-1/risposta', payload: { nota: 'eccolo' } });
    expect(senza.statusCode).toBe(400);
    expect(stato.aggiornamenti).toHaveLength(0);

    const res = await server.inject({
      method: 'POST',
      url: '/portal/richieste/ps-1/risposta',
      payload: { nota: 'Compilato e firmato', allegatiProtetti: [{ nome: 'modulo.pdf', contentBase64: PDF.toString('base64') }] },
    });
    expect(res.statusCode).toBe(200);
    expect(stato.messaggi).toHaveLength(1);
    expect(stato.messaggi[0]).toMatchObject({ canale: 'portal', direzione: 'entrata', mittente: 'Rossi Srl (Cliente)', progettoId: 'proj-1', chatId: 'cli-1' });
    expect(stato.messaggi[0].testo).toMatch(/^bmc1\./);
    expect(stato.messaggi[0].allegatiJson).toMatch(/^bmc1\./);
    expect([...stato.archivio.values()][0]!.includes(Buffer.from('modulo compilato'))).toBe(false);
    expect(stato.abbinamenti).toEqual([{ tenantId: TENANT, comunicazioneId: 'msg-1', microvoceProgettoId: 'mv-1', origine: 'microvoce' }]);
    expect(stato.aggiornamenti[0].data.risposteClienteJson).toEqual({});
    await server.close();
  });

  it('un file non ammesso rifiuta la risposta intera', async () => {
    stato.passaggio = passaggioDaRispondere({ tipo: 'documento', campiFormJson: null });
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({
      method: 'POST',
      url: '/portal/richieste/ps-1/risposta',
      payload: { allegatiProtetti: [{ nome: 'pagina.html', contentBase64: Buffer.from('<html></html>').toString('base64') }] },
    });
    expect(res.statusCode).toBe(400);
    expect(stato.aggiornamenti).toHaveLength(0);
    expect(stato.messaggi).toHaveLength(0);
    await server.close();
  });
});

describe('POST /progetti/:id/richieste-cliente/avviso', () => {
  it('avvisa il cliente di quante richieste ha aperte, e lo scrive nel registro', async () => {
    const server = await serverPer('advisor', 'usr-1');
    const res = await server.inject({ method: 'POST', url: '/progetti/proj-1/richieste-cliente/avviso', remoteAddress: '203.0.113.9' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, richieste: 1 });
    expect(stato.avvisiCliente[0]).toMatchObject({ clienteId: 'cli-1', tipoEvento: 'richiesta_cliente', link: '/portal/richieste' });
    expect(stato.audit[0]).toMatchObject({ userId: 'usr-1', ruolo: 'advisor', azione: 'RICHIESTE_CLIENTE_SEGNALATE', ipAddress: '203.0.113.9' });
    await server.close();
  });

  it('senza richieste aperte non manda niente e spiega perché', async () => {
    stato.progetti = [progettoLetto([passaggioLetto({ rispostaClienteAt: new Date() })])];
    const server = await serverPer('advisor', 'usr-1');
    const res = await server.inject({ method: 'POST', url: '/progetti/proj-1/richieste-cliente/avviso' });
    expect(res.statusCode).toBe(409);
    expect(stato.avvisiCliente).toHaveLength(0);
    await server.close();
  });

  it('il cliente non può mandarsi avvisi da solo', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    expect((await server.inject({ method: 'POST', url: '/progetti/proj-1/richieste-cliente/avviso' })).statusCode).toBe(403);
    await server.close();
  });
});
