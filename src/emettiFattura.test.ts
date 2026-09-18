/**
 * `emettiFattura` — l'importo è l'imponibile, e l'IVA la decide il cliente.
 *
 * Questa è la rotta che il modale «Fatturazione» del progetto usa per emettere una fattura dalle
 * micro-voci completate (`POST /progetti/:id/fatture` → `app.emettiFattura`). Fino al 18/09/2026
 * sbagliava due cose che si vedevano solo a documento stampato:
 *
 *  1. **Trattava l'importo di riga come lordo** e ci scorporava dentro il 22% (`imp = tot/1.22`),
 *     mentre il modale manda l'**imponibile** e mostra «imponibile + IVA = totale». Risultato: il
 *     database salvava un imponibile più basso di quello approvato, e un totale pari all'imponibile
 *     mostrato. Selezioni €120 → l'anteprima dice €146,40, il DB diceva €120.
 *  2. **Ignorava il regime del cliente**: scriveva `aliquotaIva: 22` fisso, anche per un cliente
 *     estero mostrato «0%» nel modale.
 *
 * I test qui sotto fissano il comportamento corretto e uccidono separatamente i due difetti: uno
 * controlla che l'imponibile resti l'imponibile (niente scorporo), l'altro che l'aliquota venga dal
 * cliente e la natura di esenzione compaia quando è 0.
 *
 * **Perché un test dell'adapter e non della rotta.** La rotta è un adattatore di tre righe attorno a
 * `emettiFattura`; il calcolo — l'unica cosa che questi bug toccavano — sta tutto nel metodo. Lo si
 * istanzia con un finto Prisma e gli si guarda il `create`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PrismaApp } from './adapters/prisma/prismaApp.js';

const TENANT = '00000000-0000-0000-0000-000000000001';

/**
 * Un finto Prisma che copre solo ciò che `emettiFattura` tocca, e **cattura** il `create`.
 *
 * `cliente` è la parte che conta: è da lì che il metodo deve leggere l'aliquota. Il progetto porta
 * già il cliente incluso (com'è in produzione), così il ramo di rilettura non si attiva.
 */
function fintoPrisma(cliente: any) {
  const catturato: { creato?: any } = {};
  const prisma: any = {
    progetto: {
      findUnique: async () => ({
        id: 'prg-1',
        clienteId: cliente.id,
        cliente,
        moduli: [{ id: 'mod-1' }],
      }),
      findFirst: async () => null,
    },
    cliente: {
      findFirst: async () => cliente,
      findUnique: async () => cliente,
    },
    fattura: {
      // Nessuna fattura precedente: il progressivo parte da 1.
      findFirst: async () => null,
      create: async ({ data }: any) => {
        catturato.creato = data;
        return { id: 'ft-1', ...data, righe: data.righe.create };
      },
    },
  };
  return { prisma, catturato };
}

/** Il corpo tipico che il modale manda: una riga per micro-voce, importo = imponibile in centesimi. */
function corpo(righe: Array<{ importo: number; descrizione?: string }>, tipoClienteFiscale: any = 'business_italia') {
  return {
    progettoId: 'prg-1',
    tipoClienteFiscale,
    canale: 'standard' as const,
    righe: righe.map((r, i) => ({
      tipo: 'modulo_completo' as const,
      moduloProgettoId: 'mod-1',
      importo: r.importo,
      descrizione: r.descrizione ?? `[Modulo A] Voce ${i + 1}`,
    })),
  };
}

const CLIENTE_STANDARD = { id: 'cli-1', piva: '01234567890', codiceFiscale: null, sdiCode: '0000000', aliquotaIvaDefault: 22, naturaEsenzioneDefault: null };
const CLIENTE_ESENTE = { id: 'cli-2', piva: null, codiceFiscale: 'RSSMRA80A01H501U', sdiCode: '0000000', aliquotaIvaDefault: 0, naturaEsenzioneDefault: 'N2.2' };
const CLIENTE_SENZA_REGIME = { id: 'cli-3', piva: '09876543210', codiceFiscale: null, sdiCode: '0000000', aliquotaIvaDefault: null, naturaEsenzioneDefault: null };

describe('l\'importo di riga è l\'imponibile: l\'IVA si somma sopra, non si scorpora', () => {
  it('imponibile €120 al 22% → IVA €26,40, totale €146,40 (non €120)', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_STANDARD);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 12000 }]));

    const riga = catturato.creato.righe.create[0];
    expect(riga.imponibileCentesimi).toBe(12000); // l'imponibile resta quello mandato
    expect(riga.ivaCentesimi).toBe(2640); // 22% sopra
    expect(riga.totaleRigaCentesimi).toBe(14640); // imponibile + IVA, non lo scorporo
    expect(riga.prezzoUnitarioCent).toBe(12000);
  });

  it('i totali di testata sono la somma delle righe', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_STANDARD);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 10000 }, { importo: 5000 }]));

    const d = catturato.creato;
    expect(d.totaleImponibileCentesimi).toBe(15000);
    expect(d.totaleIvaCentesimi).toBe(3300); // 22% di 15000
    expect(d.totaleDocumentoCentesimi).toBe(18300);
    expect(d.nettoAPagareCentesimi).toBe(18300);
  });
});

describe('l\'aliquota viene dal regime del cliente, non da un 22 fisso', () => {
  it('cliente esente (0% + natura): IVA zero, totale = imponibile, natura riportata in riga', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_ESENTE);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 20000 }], 'business_italia'));

    const riga = catturato.creato.righe.create[0];
    expect(riga.aliquotaIva).toBe(0);
    expect(riga.ivaCentesimi).toBe(0);
    expect(riga.totaleRigaCentesimi).toBe(20000);
    expect(riga.naturaEsenzione).toBe('N2.2');
    expect(catturato.creato.totaleIvaCentesimi).toBe(0);
  });

  it('cliente standard: aliquota 22 e nessuna natura di esenzione', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_STANDARD);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 10000 }]));

    const riga = catturato.creato.righe.create[0];
    expect(riga.aliquotaIva).toBe(22);
    expect(riga.naturaEsenzione).toBeNull();
  });
});

describe('le guardie di emissione: niente fattura sbagliata o vuota', () => {
  it('rifiuta un elenco di righe vuoto invece di bruciare un progressivo FT', async () => {
    const { prisma } = fintoPrisma(CLIENTE_STANDARD);
    const app = new PrismaApp(prisma, TENANT);
    await expect(app.emettiFattura(corpo([]))).rejects.toThrow(/nessuna riga/i);
  });

  it('se il progetto non ha un cliente collegato, si ferma invece di intestare a un cliente a caso', async () => {
    // Prima ripiegava sul «primo cliente dello studio»: una fattura intestata alla persona
    // sbagliata. Ora deve fallire con un errore chiaro, senza toccare `cliente.findFirst`.
    let findFirstChiamato = false;
    const prisma: any = {
      progetto: {
        findUnique: async () => ({ id: 'prg-x', clienteId: null, cliente: null, moduli: [{ id: 'mod-1' }] }),
        findFirst: async () => null,
      },
      cliente: {
        findFirst: async () => { findFirstChiamato = true; return { id: 'cli-a-caso' }; },
        findUnique: async () => null,
      },
      fattura: { findFirst: async () => null, create: async () => ({ id: 'x' }) },
    };
    const app = new PrismaApp(prisma, TENANT);
    await expect(app.emettiFattura(corpo([{ importo: 10000 }]))).rejects.toThrow(/cliente/i);
    expect(findFirstChiamato).toBe(false); // niente ripiego sul primo cliente
  });
});

describe('senza regime registrato, il ripiego dipende dal tipo di documento', () => {
  it('cliente senza aliquota + tipo estero → 0%', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_SENZA_REGIME);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 10000 }], 'estero'));

    expect(catturato.creato.righe.create[0].aliquotaIva).toBe(0);
    expect(catturato.creato.totaleIvaCentesimi).toBe(0);
  });

  it('cliente senza aliquota + tipo italia → 22% (comportamento di prima, non regressione)', async () => {
    const { prisma, catturato } = fintoPrisma(CLIENTE_SENZA_REGIME);
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 10000 }], 'business_italia'));

    expect(catturato.creato.righe.create[0].aliquotaIva).toBe(22);
    expect(catturato.creato.totaleIvaCentesimi).toBe(2200);
  });

  it('0 è un\'aliquota valida: un cliente con aliquota 0 non ripiega sul 22', async () => {
    // La distinzione fra «0» e «non dichiarato» è la ragione per cui la clausola usa `??` e non `||`.
    // Un `||` qui tratterebbe l'esente come non classificato e lo fatturerebbe al 22%.
    const { prisma, catturato } = fintoPrisma({ ...CLIENTE_SENZA_REGIME, aliquotaIvaDefault: 0 });
    const app = new PrismaApp(prisma, TENANT);

    await app.emettiFattura(corpo([{ importo: 10000 }], 'business_italia'));

    expect(catturato.creato.righe.create[0].aliquotaIva).toBe(0);
  });
});
