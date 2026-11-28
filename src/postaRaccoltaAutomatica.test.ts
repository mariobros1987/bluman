// Accentratore delle mail — il giro per tutti gli studi e l'intervallo della raccolta automatica.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const stato = vi.hoisted(() => ({
  studi: [] as Array<{ tenantId: string }>,
  contesti: [] as Array<{ tenantId: string; ruolo: string }>,
  raccogli: null as null | ((tenantId: string) => Promise<unknown>),
  filtro: null as unknown,
}));

vi.mock('./util/prismaClient.js', () => ({
  prisma: { $disconnect: async () => undefined },
  prismaAmministrativo: () => ({
    casellaPosta: { findMany: async (args: any) => { stato.filtro = args; return stato.studi; } },
    $disconnect: async () => undefined,
  }),
  contestoTenant: {
    run: (contesto: { tenantId: string; ruolo: string }, fn: () => unknown) => { stato.contesti.push(contesto); return fn(); },
  },
}));
vi.mock('./services/postaRaccolta.js', () => ({ raccogliPostaDelTenant: (tenantId: string) => stato.raccogli!(tenantId) }));

import { minutiRaccoltaAutomatica, raccogliPostaDiTuttiGliStudi } from './scripts/raccogliPosta.js';

beforeEach(() => {
  stato.studi = [];
  stato.contesti = [];
  stato.filtro = null;
  stato.raccogli = async () => ({ nuovi: 0, caselle: [] });
});

describe('minutiRaccoltaAutomatica', () => {
  it('assente o vuoto vale 5 minuti', () => {
    expect(minutiRaccoltaAutomatica(undefined)).toBe(5);
    expect(minutiRaccoltaAutomatica('')).toBe(5);
    expect(minutiRaccoltaAutomatica('  ')).toBe(5);
  });

  it('0 la spegne, ed è diverso da «assente»', () => {
    expect(minutiRaccoltaAutomatica('0')).toBe(0);
  });

  it('un valore che non è un numero, o negativo, vale come assente', () => {
    expect(minutiRaccoltaAutomatica('spesso')).toBe(5);
    expect(minutiRaccoltaAutomatica('-3')).toBe(5);
  });

  it('prende il numero intero, con un tetto a un giorno', () => {
    expect(minutiRaccoltaAutomatica('15')).toBe(15);
    expect(minutiRaccoltaAutomatica('2.9')).toBe(2);
    expect(minutiRaccoltaAutomatica('100000')).toBe(24 * 60);
  });
});

describe('raccogliPostaDiTuttiGliStudi', () => {
  it('cerca solo gli studi attivi con una casella attiva, e ognuno lavora nel proprio contesto', async () => {
    stato.studi = [{ tenantId: 't-1' }, { tenantId: 't-2' }];
    stato.raccogli = async (tenantId) => ({ nuovi: tenantId === 't-1' ? 3 : 1, caselle: [{ casellaId: 'c', nome: 'Raccolta', ok: true, nuovi: 1 }] });

    const report = await raccogliPostaDiTuttiGliStudi();

    expect(stato.filtro).toMatchObject({ where: { attiva: true, tenant: { stato: 'attivo' } }, distinct: ['tenantId'] });
    expect(stato.contesti).toEqual([{ tenantId: 't-1', ruolo: 'super_admin' }, { tenantId: 't-2', ruolo: 'super_admin' }]);
    expect(report.studi).toBe(2);
    expect(report.messaggiNuovi).toBe(4);
    expect(report.caselleInErrore).toBe(0);
  });

  it('uno studio che fallisce non ferma gli altri, e l’errore resta nel report', async () => {
    stato.studi = [{ tenantId: 't-1' }, { tenantId: 't-2' }];
    stato.raccogli = async (tenantId) => {
      if (tenantId === 't-1') throw new Error('database non raggiungibile');
      return { nuovi: 2, caselle: [{ casellaId: 'c', nome: 'Rossi', ok: false, nuovi: 0, errore: 'rifiutata' }] };
    };

    const report = await raccogliPostaDiTuttiGliStudi();

    expect(report.esiti[0]).toEqual({ tenantId: 't-1', ok: false, errore: 'database non raggiungibile' });
    expect(report.esiti[1]).toMatchObject({ tenantId: 't-2', ok: true });
    expect(report.messaggiNuovi).toBe(2);
    expect(report.caselleInErrore).toBe(1);
  });
});
