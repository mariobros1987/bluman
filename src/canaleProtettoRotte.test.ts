// Le rotte del canale protetto, viste dal confine: cosa scrive il server quando il cliente o lo
// studio mandano un messaggio, cosa finisce negli avvisi, e chi può scaricare un allegato.
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stato = {
  righe: [] as any[],
  avvisiStudio: [] as any[],
  avvisiCliente: [] as any[],
  email: [] as any[],
  archivio: new Map<string, Buffer>(),
};

const TENANT = '00000000-0000-0000-0000-000000000001';

vi.mock('./util/prismaClient.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const prisma: any = {
    cliente: { findFirst: async () => ({ nome: 'Rossi Srl' }) },
    comunicazioneProgetto: {
      create: async (args: any) => {
        const riga = { id: `msg-${stato.righe.length + 1}`, createdAt: new Date(), ...args.data };
        stato.righe.push(riga);
        return riga;
      },
      findMany: async () => stato.righe,
      findFirst: async (args: any) =>
        stato.righe.find((r) => r.id === args.where.id && r.progettoId === args.where.progettoId && r.tenantId === args.where.tenantId) ?? null,
    },
    progetto: {
      // La pratica `proj-1` è del cliente `cli-1`; ogni altra combinazione non esiste.
      findFirst: async (args: any) => {
        if (args.where.id !== 'proj-1' || args.where.tenantId !== TENANT) return null;
        if (args.where.clienteId && args.where.clienteId !== 'cli-1') return null;
        return { id: 'proj-1', nome: 'Costituzione Malta', clienteId: 'cli-1', cliente: { nome: 'Rossi Srl' } };
      },
    },
    comunicazioneMicrovoce: { findMany: async () => [] },
    contestoMicrovoceChat: { findUnique: async () => null, update: async () => ({}) },
    notifica: { count: async () => 0 },
    $transaction: async (fn: any) => fn(prisma),
  };
  return { ...reale, prisma };
});

vi.mock('./services/notificheService.js', () => ({
  notificaStudio: async (_tenant: string, avviso: any) => { stato.avvisiStudio.push(avviso); },
  notificaCliente: async (_tenant: string, clienteId: string, avviso: any) => { stato.avvisiCliente.push({ clienteId, ...avviso }); },
  avvisaClienteViaCanali: async (_tenant: string, clienteId: string, messaggio: any, opzioni: any) => {
    stato.email.push({ clienteId, ...messaggio, opzioni });
  },
}));

vi.mock('./services/storageService.js', async (importOriginal) => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    salvaBufferInArchivio: async (nome: string, contenuto: Buffer) => {
      stato.archivio.set(`/uploads/${nome}`, Buffer.from(contenuto));
      return `/uploads/${nome}`;
    },
    leggiFileArchivio: async (riferimento: string) => stato.archivio.get(riferimento) ?? null,
  };
});

const { registraRotteProgetti } = await import('./routes/progetti.js');
const { registraRotteCanaleProtetto } = await import('./routes/canaleProtetto.js');

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ncontratto riservato\n%%EOF');
const SEGRETO = 'Il mio IBAN è IT60X0542811101000000123456';
const prima = process.env.CANALE_PROTETTO_CHIAVE;

async function serverPer(ruolo: 'cliente' | 'advisor', userId: string) {
  const server = Fastify();
  server.addHook('onRequest', async (req) => {
    req.tenantId = TENANT;
    req.ruolo = ruolo;
    req.userId = userId;
    req.user = { userId, tenantId: TENANT, email: 'prova@example.test', ruolo };
  });
  await registraRotteProgetti(server, { getProgetto: async () => ({ id: 'proj-1', clienteId: 'cli-1' }) } as any);
  await registraRotteCanaleProtetto(server);
  return server;
}

beforeEach(() => {
  stato.righe.length = 0;
  stato.avvisiStudio.length = 0;
  stato.avvisiCliente.length = 0;
  stato.email.length = 0;
  stato.archivio.clear();
  process.env.CANALE_PROTETTO_CHIAVE = 'chiave-di-prova-del-canale-protetto-0001';
});

afterEach(() => {
  if (prima === undefined) delete process.env.CANALE_PROTETTO_CHIAVE;
  else process.env.CANALE_PROTETTO_CHIAVE = prima;
});

describe('il cliente scrive', () => {
  it('la riga a database è cifrata, la risposta è leggibile e dichiara il lucchetto', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({ method: 'POST', url: '/progetti/proj-1/comunicazioni', payload: { canale: 'portal', testo: SEGRETO } });
    expect(res.statusCode).toBe(201);
    expect(stato.righe[0].testo).toMatch(/^bmc1\./);
    expect(stato.righe[0].testo).not.toContain('IBAN');
    expect(res.json()).toMatchObject({ testo: SEGRETO, cifrato: true });
    await server.close();
  });

  it('non può far figurare il messaggio come arrivato da un altro canale', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    await server.inject({ method: 'POST', url: '/progetti/proj-1/comunicazioni', payload: { canale: 'whatsapp', testo: 'ciao' } });
    expect(stato.righe[0]).toMatchObject({ canale: 'portal', direzione: 'entrata', chatId: 'cli-1' });
    await server.close();
  });

  it('l’avviso allo studio dice che ha scritto, non cosa', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    await server.inject({ method: 'POST', url: '/progetti/proj-1/comunicazioni', payload: { canale: 'portal', testo: SEGRETO } });
    expect(stato.avvisiStudio).toHaveLength(1);
    expect(stato.avvisiStudio[0]).toMatchObject({ tipoEvento: 'messaggio_cliente', link: '/projects/proj-1' });
    expect(JSON.stringify(stato.avvisiStudio[0])).not.toMatch(/IBAN|IT60/);
    await server.close();
  });

  it('un elenco di indirizzi dichiarato dal cliente come allegati viene ignorato', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', testo: 'guardi qui', allegatiJson: [{ nome: 'fattura.pdf', url: 'https://sito-di-un-terzo.test/x' }] },
    });
    expect(res.statusCode).toBe(201);
    expect(stato.righe[0].allegatiJson).toBeNull();
    await server.close();
  });

  it('può mandare un file senza testo; il file è cifrato in archivio e lo riscarica solo dalla sua pratica', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', testo: '', allegatiProtetti: [{ nome: 'contratto.pdf', contentBase64: PDF.toString('base64') }] },
    });
    expect(res.statusCode).toBe(201);
    const [contenuto] = [...stato.archivio.values()];
    expect(contenuto!.includes(Buffer.from('contratto riservato'))).toBe(false);
    const allegati = JSON.parse(res.json().allegatiJson);
    expect(allegati).toEqual([{ protetto: true, nome: 'contratto.pdf', dimensione: '1 KB', mime: 'application/pdf', url: '/progetti/proj-1/comunicazioni/msg-1/allegati/0' }]);

    const scarico = await server.inject({ method: 'GET', url: allegati[0].url });
    expect(scarico.statusCode).toBe(200);
    expect(scarico.rawPayload.equals(PDF)).toBe(true);
    expect(scarico.headers['content-disposition']).toContain('attachment; filename="contratto.pdf"');
    expect(scarico.headers['x-content-type-options']).toBe('nosniff');
    expect(scarico.headers['cache-control']).toBe('private, no-store');
    await server.close();

    // Un altro cliente dello stesso studio, con l'indirizzo esatto in mano, non lo apre.
    const altro = await serverPer('cliente', 'client-cli-2');
    expect((await altro.inject({ method: 'GET', url: allegati[0].url })).statusCode).toBe(404);
    await altro.close();
  });

  it('un file non ammesso è rifiutato col motivo e non lascia né riga né file', async () => {
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', testo: 'ecco', allegatiProtetti: [{ nome: 'pagina.html', contentBase64: Buffer.from('<html></html>').toString('base64') }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errore).toContain('pagina.html');
    expect(stato.righe).toHaveLength(0);
    expect(stato.archivio.size).toBe(0);
    await server.close();
  });

  it('con la chiave configurata male il messaggio è rifiutato invece che salvato in chiaro', async () => {
    process.env.CANALE_PROTETTO_CHIAVE = 'corta';
    const server = await serverPer('cliente', 'client-cli-1');
    const res = await server.inject({ method: 'POST', url: '/progetti/proj-1/comunicazioni', payload: { canale: 'portal', testo: SEGRETO } });
    expect(res.statusCode).toBe(503);
    expect(res.json().errore).not.toContain('CANALE_PROTETTO_CHIAVE');
    expect(stato.righe).toHaveLength(0);
    await server.close();
  });
});

describe('lo studio scrive', () => {
  it('nel canale protetto: riga cifrata, e il cliente è avvisato senza il testo', async () => {
    const server = await serverPer('advisor', 'usr-1');
    const res = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'portal', mittente: 'Studio', destinatario: 'Rossi Srl', direzione: 'uscita', testo: SEGRETO },
    });
    expect(res.statusCode).toBe(201);
    expect(stato.righe[0].testo).toMatch(/^bmc1\./);
    expect(stato.avvisiCliente).toHaveLength(1);
    expect(stato.avvisiCliente[0]).toMatchObject({ clienteId: 'cli-1', tipoEvento: 'messaggio_studio', link: '/portal/messaggi' });
    expect(stato.email).toHaveLength(1);
    expect(stato.email[0].opzioni).toEqual({ soloEmail: true, etichetta: 'messaggio_studio' });
    expect(JSON.stringify([stato.avvisiCliente, stato.email])).not.toMatch(/IBAN|IT60/);
    await server.close();
  });

  it('su un altro canale il testo resta in chiaro e gli allegati protetti non sono ammessi', async () => {
    const server = await serverPer('advisor', 'usr-1');
    const email = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'email', mittente: 'Studio', destinatario: 'a@b.test', direzione: 'uscita', testo: 'Buongiorno' },
    });
    expect(email.statusCode).toBe(201);
    expect(stato.righe[0].testo).toBe('Buongiorno');
    expect(email.json().cifrato).toBe(false);
    expect(stato.avvisiCliente).toHaveLength(0);

    const conFile = await server.inject({
      method: 'POST',
      url: '/progetti/proj-1/comunicazioni',
      payload: { canale: 'email', testo: 'x', allegatiProtetti: [{ nome: 'a.pdf', contentBase64: PDF.toString('base64') }] },
    });
    expect(conFile.statusCode).toBe(400);
    await server.close();
  });

  it('rilegge in chiaro il fascicolo cifrato', async () => {
    const cliente = await serverPer('cliente', 'client-cli-1');
    await cliente.inject({ method: 'POST', url: '/progetti/proj-1/comunicazioni', payload: { canale: 'portal', testo: SEGRETO } });
    await cliente.close();
    const server = await serverPer('advisor', 'usr-1');
    const res = await server.inject({ method: 'GET', url: '/progetti/proj-1/comunicazioni' });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0]).toMatchObject({ testo: SEGRETO, cifrato: true, microvoci: [] });
    await server.close();
  });
});
