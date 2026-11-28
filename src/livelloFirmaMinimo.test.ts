/**
 * Il livello di firma del modello è il minimo (titolare, 28/11/2026): chi prepara il documento
 * può alzarlo, non abbassarlo. Il guasto che questi test presidiano: un modello che esige FEA da
 * cui nasce un documento a SES, perché il livello era solo un valore proposto dalla pagina.
 * Le tre porte da cui un livello entra o cambia: POST /documenti, POST /documenti/genera,
 * PATCH /documenti/:id/livello-firma.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CODICE_LIVELLO_SOTTO_MINIMO, motivoLivelloSottoMinimo } from './services/livelloFirmaService.js';

const TENANT_STUDIO = '00000000-0000-0000-0000-000000000001';

const stato = {
  modello: null as any,
  documento: null as any,
  documentiCreati: [] as any[],
  aggiornamenti: [] as any[],
  audit: [] as any[],
};

vi.mock('./util/prismaClient.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./util/prismaClient.js')>();
  const finto: any = {
    user: {
      findFirst: async (args: any) =>
        args?.where?.id === 'usr-advisor' && args?.where?.tenantId === '00000000-0000-0000-0000-000000000001'
          ? { id: 'usr-advisor', tenantId: args.where.tenantId, ruolo: 'advisor', stato: 'attivo', sessionVersion: 0 }
          : null,
    },
    progetto: {
      findFirst: async () => ({
        id: 'prog-1',
        clienteId: 'cli-42',
        nome: 'Incarico 2026',
        valoreTotale: 100000,
        cliente: { nome: 'Rossi Spa', piva: 'IT09876543210', codiceFiscale: null, sedeLegale: 'Via Torino 2', sdiCode: null, iban: null, cellulare: null, ubo: null, referentiJson: null },
      }),
    },
    tenant: { findFirst: async () => ({ ragioneSociale: 'Studio BluMan', piva: 'IT01234567890', sedeLegale: 'Via Roma 1', iban: null, leadAdvisorNome: 'Mario Rossi', telefono: null, email: null }) },
    // Il modello si cerca per id E per studio: quello di un altro studio non si trova.
    modelloDocumentoCustom: {
      findFirst: async (args: any) =>
        stato.modello && args?.where?.id === stato.modello.id && args?.where?.tenantId === stato.modello.tenantId ? stato.modello : null,
    },
    documento: {
      findFirst: async () => stato.documento,
      create: async (args: any) => {
        stato.documentiCreati.push(args.data);
        return { ...args.data, id: 'doc-1', versione: 1 };
      },
      update: async (args: any) => {
        stato.aggiornamenti.push(args.data);
        return { ...stato.documento, ...args.data };
      },
    },
    notifica: { create: async (args: any) => ({ id: 'not-1', createdAt: new Date(), ...args.data }) },
    auditLog: {
      create: async (args: any) => {
        stato.audit.push(args.data);
        return {};
      },
    },
    $transaction: async (fn: any) => (typeof fn === 'function' ? fn(finto) : Promise.all(fn)),
  };
  return { ...reale, prisma: finto, prismaAmministrativo: () => finto };
});

vi.mock('./services/storageService.js', async importOriginal => {
  const reale = await importOriginal<typeof import('./services/storageService.js')>();
  return {
    ...reale,
    uploadDocumento: async (filename: string) => ({ ok: true, url: `https://storage.example/${filename}`, name: filename, size: '1 KB' }),
  };
});

const { buildServer } = await import('./server.js');
const { InMemoryApp } = await import('./adapters/inMemoryApp.js');
const { signJwt } = await import('./util/jwt.js');

function chiama(method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) {
  const token = signJwt({ userId: 'usr-advisor', tenantId: TENANT_STUDIO, email: 'advisor@studio.example', ruolo: 'advisor', sessionVersion: 0 });
  return buildServer(new InMemoryApp()).inject({ method, url, payload, headers: { authorization: `Bearer ${token}` } });
}

const MODELLO_FEA = {
  id: 'mod-fea',
  tenantId: TENANT_STUDIO,
  titolo: 'Mandato',
  categoria: 'contratto',
  contenutoHtml: '<h1>Mandato</h1><p>Spett.le {{cliente.ragione_sociale}}.</p>',
  livelloFirmaRichiesto: 'fea',
};

const PDF_BASE64 = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n').toString('base64');

beforeEach(() => {
  stato.modello = null;
  stato.documento = null;
  stato.documentiCreati.length = 0;
  stato.aggiornamenti.length = 0;
  stato.audit.length = 0;
});

describe('motivoLivelloSottoMinimo — regola pura', () => {
  it('uguale o più alto del minimo: va bene', () => {
    expect(motivoLivelloSottoMinimo('fea', 'fea')).toBeNull();
    expect(motivoLivelloSottoMinimo('feq', 'fea')).toBeNull();
    expect(motivoLivelloSottoMinimo('ses', 'ses')).toBeNull();
  });

  it('più basso del minimo: la frase dice il minimo e che si può solo alzare', () => {
    const motivo = motivoLivelloSottoMinimo('ses', 'feq');
    expect(motivo).toContain('almeno la firma FEQ');
    expect(motivo).toContain('si può alzare, non abbassare');
  });

  it('un minimo assente o sporco vale SES: non blocca una firma lecita', () => {
    expect(motivoLivelloSottoMinimo('ses', null)).toBeNull();
    expect(motivoLivelloSottoMinimo('ses', 'boh')).toBeNull();
  });
});

describe('POST /documenti/genera — il livello del modello è il minimo', () => {
  it('409 se si chiede meno del modello, e non nasce nessun documento', async () => {
    stato.modello = MODELLO_FEA;
    const ris = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', modelloId: 'mod-fea', livelloFirmaRichiesto: 'ses' });

    expect(ris.statusCode).toBe(409);
    expect(ris.json().codice).toBe(CODICE_LIVELLO_SOTTO_MINIMO);
    expect(ris.json().livelloFirmaMinimo).toBe('fea');
    expect(stato.documentiCreati).toHaveLength(0);
  });

  it('senza livello indicato il documento eredita quello del modello, e lo ricorda come minimo', async () => {
    stato.modello = MODELLO_FEA;
    const ris = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', modelloId: 'mod-fea' });

    expect(ris.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaRichiesto).toBe('fea');
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('fea');
  });

  it('alzare si può: FEQ su un modello FEA, il minimo resta FEA', async () => {
    stato.modello = MODELLO_FEA;
    const ris = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', modelloId: 'mod-fea', livelloFirmaRichiesto: 'feq' });

    expect(ris.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaRichiesto).toBe('feq');
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('fea');
  });

  it('modello standard (HTML in linea): vale il minimo dichiarato dalla pagina', async () => {
    const sotto = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', contenutoHtml: '<p>Mandato standard</p>', livelloFirmaMinimo: 'fea', livelloFirmaRichiesto: 'ses' });
    expect(sotto.statusCode).toBe(409);
    expect(stato.documentiCreati).toHaveLength(0);

    const pari = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', contenutoHtml: '<p>Mandato standard</p>', livelloFirmaMinimo: 'fea', livelloFirmaRichiesto: 'fea' });
    expect(pari.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('fea');
  });

  it('senza modello non c’è minimo: SES resta ammesso', async () => {
    const ris = await chiama('POST', '/documenti/genera', { progettoId: 'prog-1', contenutoHtml: '<p>Testo libero</p>', livelloFirmaRichiesto: 'ses' });

    expect(ris.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('ses');
  });
});

describe('POST /documenti — il documento salvato dall’editor', () => {
  const base = { progettoId: 'prog-1', filename: 'mandato.pdf', contentBase64: PDF_BASE64, tipo: 'compilato' };

  it('409 sotto il livello del modello dello studio, letto dal server', async () => {
    stato.modello = MODELLO_FEA;
    const ris = await chiama('POST', '/documenti', { ...base, modelloId: 'mod-fea', livelloFirmaRichiesto: 'ses' });

    expect(ris.statusCode).toBe(409);
    expect(ris.json().codice).toBe(CODICE_LIVELLO_SOTTO_MINIMO);
    expect(stato.documentiCreati).toHaveLength(0);
  });

  it('409 sotto il minimo dichiarato per un modello standard', async () => {
    const ris = await chiama('POST', '/documenti', { ...base, livelloFirmaMinimo: 'feq', livelloFirmaRichiesto: 'fea' });

    expect(ris.statusCode).toBe(409);
    expect(ris.json().livelloFirmaMinimo).toBe('feq');
  });

  it('fra modello dello studio e minimo dichiarato vale il più alto', async () => {
    stato.modello = MODELLO_FEA;
    const ris = await chiama('POST', '/documenti', { ...base, modelloId: 'mod-fea', livelloFirmaMinimo: 'ses', livelloFirmaRichiesto: 'fea' });

    expect(ris.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('fea');
  });

  it('senza livello indicato eredita il minimo; senza modello resta SES come prima', async () => {
    const conMinimo = await chiama('POST', '/documenti', { ...base, livelloFirmaMinimo: 'fea' });
    expect(conMinimo.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaRichiesto).toBe('fea');

    const senza = await chiama('POST', '/documenti', base);
    expect(senza.statusCode).toBe(200);
    expect(stato.documentiCreati.at(-1).livelloFirmaRichiesto).toBe('ses');
    expect(stato.documentiCreati.at(-1).livelloFirmaMinimo).toBe('ses');
  });

  it('400 se il minimo dichiarato non è un livello', async () => {
    const ris = await chiama('POST', '/documenti', { ...base, livelloFirmaMinimo: 'altissimo' });
    expect(ris.statusCode).toBe(400);
  });
});

describe('PATCH /documenti/:id/livello-firma — dopo, il minimo resta', () => {
  it('409 se si scende sotto il minimo del documento, e niente viene scritto', async () => {
    stato.documento = { id: 'doc-1', statoDoc: 'bozza', livelloFirmaRichiesto: 'fea', livelloFirmaMinimo: 'fea' };
    const ris = await chiama('PATCH', '/documenti/doc-1/livello-firma', { livelloFirmaRichiesto: 'ses' });

    expect(ris.statusCode).toBe(409);
    expect(ris.json().codice).toBe(CODICE_LIVELLO_SOTTO_MINIMO);
    expect(stato.aggiornamenti).toHaveLength(0);
  });

  it('alzare si può, e il registro dice chi l’ha fatto', async () => {
    stato.documento = { id: 'doc-1', statoDoc: 'bozza', livelloFirmaRichiesto: 'fea', livelloFirmaMinimo: 'fea' };
    const ris = await chiama('PATCH', '/documenti/doc-1/livello-firma', { livelloFirmaRichiesto: 'feq' });

    expect(ris.statusCode).toBe(200);
    expect(stato.aggiornamenti).toEqual([{ livelloFirmaRichiesto: 'feq' }]);
    const riga = stato.audit.find((a) => a.azione === 'DOCUMENTO_LIVELLO_FIRMA_AGGIORNATO');
    expect(riga.userId).toBe('usr-advisor');
  });
});
