/**
 * Il form dell'articolo (titolare, 28/11/2026): «nell'articolo deve essere indicato il form da
 * compilare da parte del cliente; se è già compilato prende i dati direttamente da lì».
 *
 * I guasti che questi test presidiano: la scelta del form sull'articolo che non si salvava; un
 * form di un altro studio accettato sull'articolo; le risposte di un altro cliente riprese nel
 * progetto sbagliato; un form eliminato mentre un articolo lo indica.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { creaPassaggioDaTemplate, formDegliArticoli, risposteGiaDateDalCliente } from './services/formArticolo.js';

const TENANT = '00000000-0000-0000-0000-000000000001';
const ALTRO_TENANT = '00000000-0000-0000-0000-000000000002';

const stato = {
  form: [] as any[],
  articoli: [] as any[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const corrisponde = (riga: any, where: any) =>
    Object.entries(where || {}).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'equals' in v) return String(riga[k]).toLowerCase() === String(v.equals).toLowerCase();
      if (v && typeof v === 'object' && 'not' in v) return riga[k] !== v.not;
      return riga[k] === v;
    });
  const finto: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'usr-advisor'
          ? { id: 'usr-advisor', tenantId: args.where.tenantId, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
    },
    formMaster: {
      findMany: async (args: any) => stato.form.filter((f) => corrisponde(f, args?.where)),
      findFirst: async (args: any) => stato.form.find((f) => corrisponde(f, args?.where)) ?? null,
      create: async (args: any) => {
        const riga = { id: `f-${stato.form.length + 1}`, ...args.data };
        stato.form.push(riga);
        return riga;
      },
      delete: async (args: any) => {
        stato.form = stato.form.filter((f) => f.id !== args.where.id);
        return {};
      },
    },
    articolo: {
      findMany: async (args: any) => stato.articoli.filter((a) => corrisponde(a, args?.where)),
      // Una copia, come fa il database: la rotta confronta il prima col dopo.
      findFirst: async (args: any) => {
        const riga = stato.articoli.find((a) => corrisponde(a, args?.where));
        return riga ? { ...riga } : null;
      },
      update: async (args: any) => {
        const riga = stato.articoli.find((a) => a.id === args.where.id);
        for (const [k, v] of Object.entries(args.data)) if (v !== undefined) riga[k] = v;
        return riga;
      },
    },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

function chiama(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
  const token = signJwt({ userId: 'usr-advisor', tenantId: TENANT, email: 'advisor@studio.example', ruolo: 'advisor', sessionVersion: 0 });
  return buildServer(new InMemoryApp()).inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

beforeEach(() => {
  stato.form = [
    { id: 'f-soc', tenantId: TENANT, nome: 'Dati societari', campiJson: ['Ragione sociale', 'IBAN'] },
    { id: 'f-altro', tenantId: ALTRO_TENANT, nome: 'Form di un altro studio', campiJson: ['Segreto'] },
  ];
  stato.articoli = [
    { id: 'art-1', tenantId: TENANT, nome: 'Atto costitutivo', isAttivo: true, prezzoDefault: 50000, oreDefault: 4, formMasterId: null },
    { id: 'art-altro', tenantId: ALTRO_TENANT, nome: 'Articolo altrui', isAttivo: true, prezzoDefault: 1, oreDefault: 1, formMasterId: null },
  ];
  stato.audit.length = 0;
});

describe('/form-master — i form dello studio', () => {
  it('GET: solo i form dello studio, con le domande e quanti articoli li usano', async () => {
    stato.articoli[0].formMasterId = 'f-soc';
    const ris = await chiama('GET', '/form-master');
    expect(ris.statusCode).toBe(200);
    expect(ris.json()).toEqual([{ id: 'f-soc', nome: 'Dati societari', campi: ['Ragione sociale', 'IBAN'], articoli: 1 }]);
  });

  it('POST: crea il form con le domande ripulite, e il registro dice chi', async () => {
    const ris = await chiama('POST', '/form-master', { nome: ' Titolare effettivo ', campi: ['Nome', ' ', 'nome', 'Quote'] });
    expect(ris.statusCode).toBe(201);
    expect(ris.json()).toMatchObject({ nome: 'Titolare effettivo', campi: ['Nome', 'Quote'], articoli: 0 });
    expect(stato.form.at(-1)).toMatchObject({ tenantId: TENANT, campiJson: ['Nome', 'Quote'] });
    expect(stato.audit.at(-1)).toMatchObject({ azione: 'FORM_CREATO', userId: 'usr-advisor' });
  });

  it('POST: 400 senza domande, 409 se il nome c’è già nello studio', async () => {
    expect((await chiama('POST', '/form-master', { nome: 'Vuoto', campi: [] })).statusCode).toBe(400);
    const doppio = await chiama('POST', '/form-master', { nome: 'dati societari', campi: ['x'] });
    expect(doppio.statusCode).toBe(409);
    // Il nome di un altro studio non conta.
    expect((await chiama('POST', '/form-master', { nome: 'Form di un altro studio', campi: ['x'] })).statusCode).toBe(201);
  });

  it('DELETE: 409 finché un articolo lo indica, poi si elimina; 404 per il form di un altro studio', async () => {
    stato.articoli[0].formMasterId = 'f-soc';
    const inUso = await chiama('DELETE', '/form-master/f-soc');
    expect(inUso.statusCode).toBe(409);
    expect(inUso.json().errore).toContain('Atto costitutivo');
    expect(stato.form.some((f) => f.id === 'f-soc')).toBe(true);

    stato.articoli[0].formMasterId = null;
    expect((await chiama('DELETE', '/form-master/f-soc')).statusCode).toBe(200);
    expect(stato.form.some((f) => f.id === 'f-soc')).toBe(false);

    expect((await chiama('DELETE', '/form-master/f-altro')).statusCode).toBe(404);
    expect(stato.form.some((f) => f.id === 'f-altro')).toBe(true);
  });
});

describe('PATCH /articoli/:id — il form dell’articolo si salva', () => {
  it('salva il form scelto e lo scrive nel registro', async () => {
    const ris = await chiama('PATCH', '/articoli/art-1', { nome: 'Atto costitutivo', prezzoDefault: 60000, oreDefault: 5, formMasterId: 'f-soc' });
    expect(ris.statusCode).toBe(200);
    expect(stato.articoli[0]).toMatchObject({ formMasterId: 'f-soc', prezzoDefault: 60000, oreDefault: 5 });
    expect(stato.audit.at(-1).dettagli).toContain('Form del cliente: «Dati societari»');
    expect(stato.audit.at(-1).userId).toBe('usr-advisor');
  });

  it('`null` toglie il form; assente lo lascia com’è', async () => {
    stato.articoli[0].formMasterId = 'f-soc';
    await chiama('PATCH', '/articoli/art-1', { prezzoDefault: 70000 });
    expect(stato.articoli[0].formMasterId).toBe('f-soc');

    await chiama('PATCH', '/articoli/art-1', { formMasterId: null });
    expect(stato.articoli[0].formMasterId).toBeNull();
  });

  it('400 per il form di un altro studio, e l’articolo resta com’era', async () => {
    const ris = await chiama('PATCH', '/articoli/art-1', { prezzoDefault: 99900, formMasterId: 'f-altro' });
    expect(ris.statusCode).toBe(400);
    expect(stato.articoli[0]).toMatchObject({ formMasterId: null, prezzoDefault: 50000 });
  });

  it('404 per l’articolo di un altro studio', async () => {
    const ris = await chiama('PATCH', '/articoli/art-altro', { prezzoDefault: 5 });
    expect(ris.statusCode).toBe(404);
    expect(stato.articoli[1].prezzoDefault).toBe(1);
  });
});

// ── Dentro il progetto: il passaggio del form e le risposte già date ─────────────────────
function clienteFinto(precedenti: any[], clienteId: string | null = 'cli-1') {
  const viste: any = { whereMicrovoce: null, wherePassaggi: null, creati: [] as any[] };
  const client: any = {
    formMaster: { findMany: async (args: any) => stato.form.filter((f) => f.tenantId === args.where.tenantId && args.where.id.in.includes(f.id)) },
    microvoceProgetto: {
      findFirst: async (args: any) => {
        viste.whereMicrovoce = args.where;
        return clienteId ? { moduloProgetto: { progetto: { id: 'prog-nuovo', clienteId } } } : null;
      },
    },
    passaggioProgetto: {
      findMany: async (args: any) => {
        viste.wherePassaggi = args.where;
        return precedenti;
      },
      create: async (args: any) => {
        viste.creati.push(args.data);
        return {};
      },
    },
  };
  return { client, viste };
}

const precedente = (nome: string, quando: string, risposte: unknown) => ({
  risposteFormJson: risposte,
  microvoceProgetto: { moduloProgetto: { progetto: { id: nome, nome, createdAt: new Date(quando) } } },
});

const PASSAGGIO_FORM = {
  titolo: 'Compila il form «Dati societari»',
  tipo: 'form' as const,
  chi: 'cliente' as const,
  ordine: 3,
  descrizione: 'Dati chiesti al cliente dal form dell’articolo.',
  campiFormJson: ['Ragione sociale', 'IBAN'],
  formMasterId: 'f-soc',
};

describe('formDegliArticoli', () => {
  it('legge solo i form dello studio nominati dagli articoli', async () => {
    const { client } = clienteFinto([]);
    const mappa = await formDegliArticoli(client, TENANT, ['f-soc', null, 'f-altro', 'f-soc', undefined]);
    expect([...mappa.keys()]).toEqual(['f-soc']);
    expect(mappa.get('f-soc')).toEqual({ id: 'f-soc', nome: 'Dati societari', campi: ['Ragione sociale', 'IBAN'] });
  });
});

describe('le risposte già date dal cliente', () => {
  const dove = { tenantId: TENANT, microvoceProgettoId: 'mv-1', formMasterId: 'f-soc', campi: ['Ragione sociale', 'IBAN'] };

  it('si cercano solo fra i progetti dello stesso cliente e dello stesso studio', async () => {
    const { client, viste } = clienteFinto([]);
    await risposteGiaDateDalCliente(client, dove);
    expect(viste.whereMicrovoce).toEqual({ id: 'mv-1', tenantId: TENANT });
    expect(viste.wherePassaggi).toEqual({
      tenantId: TENANT,
      formMasterId: 'f-soc',
      microvoceProgetto: { moduloProgetto: { progetto: { tenantId: TENANT, clienteId: 'cli-1' } } },
    });
  });

  it('vince il progetto più recente che ha almeno una risposta', async () => {
    const { client } = clienteFinto([
      precedente('Vecchio', '2026-01-10', { 'Ragione sociale': 'Rossi Srl', IBAN: 'IT00VECCHIO' }),
      precedente('Recente', '2026-09-01', { 'Ragione sociale': 'Rossi Spa' }),
      precedente('Recentissimo ma vuoto', '2026-11-01', { IBAN: '' }),
    ]);
    expect(await risposteGiaDateDalCliente(client, dove)).toEqual({ risposte: { 'Ragione sociale': 'Rossi Spa' }, progettoNome: 'Recente' });
  });

  it('nessuna risposta, o attività senza cliente: niente da riprendere', async () => {
    expect(await risposteGiaDateDalCliente(clienteFinto([precedente('P', '2026-01-01', null)]).client, dove)).toBeNull();
    expect(await risposteGiaDateDalCliente(clienteFinto([precedente('P', '2026-01-01', { IBAN: 'IT00' })], null).client, dove)).toBeNull();
  });
});

describe('creaPassaggioDaTemplate', () => {
  const dove = { tenantId: TENANT, microvoceProgettoId: 'mv-1' };

  it('form già compilato dal cliente: il passaggio nasce con le risposte, e resta da fare', async () => {
    const { client, viste } = clienteFinto([precedente('Costituzione Ltd', '2026-09-01', { 'Ragione sociale': 'Rossi Spa', IBAN: 'IT60X' })]);
    await creaPassaggioDaTemplate(client, dove, PASSAGGIO_FORM);
    expect(viste.creati).toHaveLength(1);
    expect(viste.creati[0]).toMatchObject({
      tenantId: TENANT,
      microvoceProgettoId: 'mv-1',
      tipo: 'form',
      chi: 'cliente',
      formMasterId: 'f-soc',
      campiFormJson: ['Ragione sociale', 'IBAN'],
      risposteFormJson: { 'Ragione sociale': 'Rossi Spa', IBAN: 'IT60X' },
      stato: 'pending',
    });
    expect(viste.creati[0].descrizione).toContain('progetto «Costituzione Ltd» (2 di 2 domande)');
  });

  it('form mai compilato: nasce vuoto, con la sua descrizione', async () => {
    const { client, viste } = clienteFinto([]);
    await creaPassaggioDaTemplate(client, dove, PASSAGGIO_FORM);
    expect(viste.creati[0].risposteFormJson).toBeUndefined();
    expect(viste.creati[0].descrizione).toBe('Dati chiesti al cliente dal form dell’articolo.');
  });

  it('un passaggio che non nasce da un form non cerca risposte e non porta un form', async () => {
    const { client, viste } = clienteFinto([precedente('P', '2026-01-01', { IBAN: 'IT00' })]);
    await creaPassaggioDaTemplate(client, dove, { titolo: 'Verifica', tipo: 'verifica', chi: 'operatore', ordine: 1, descrizione: null, campiFormJson: null });
    expect(viste.wherePassaggi).toBeNull();
    expect(viste.creati[0].formMasterId).toBeUndefined();
    expect(viste.creati[0].risposteFormJson).toBeUndefined();
  });
});
