import { describe, expect, it } from 'vitest';
import {
  FatturaPassivaGiaSaldata,
  cercaDoppioneFatturaPassiva,
  saldaFatturaPassiva,
} from './services/fatturaPassiva.js';

const FATTURA = { id: 'ft-1', numero: 'FT-12', fornitoreId: 'forn-1', totaleCentesimi: 12200, fornitore: { ragioneSociale: 'Cloud Srl' } };

/** Un client finto che registra le scritture: basta a provare l'ordine e le condizioni. */
function clientFinto(opzioni: { giaSaldata?: boolean; movimentoFallisce?: boolean } = {}) {
  const scritture: string[] = [];
  const viste: any[] = [];
  return {
    scritture,
    viste,
    fatturaRicevuta: {
      findFirst: async (args: any) => { viste.push(args.where); return null; },
      updateMany: async (args: any) => {
        viste.push(args.where);
        if (opzioni.giaSaldata) return { count: 0 };
        scritture.push('fattura-saldata');
        return { count: 1 };
      },
    },
    movimentoPrimaNota: {
      create: async (args: any) => {
        if (opzioni.movimentoFallisce) throw new Error('database non raggiungibile');
        scritture.push(`movimento-${args.data.tipo}-${args.data.importoCentesimi}`);
        return { id: 'mov-1' };
      },
      delete: async () => ({}),
    },
    contoBancario: { update: async () => { scritture.push('saldo-conto'); return {}; } },
  };
}

describe('Fattura passiva — doppioni', () => {
  it('cerca per fornitore, numero senza maiuscole né spazi, e anno del documento', async () => {
    const client = clientFinto();
    await cercaDoppioneFatturaPassiva(client, { tenantId: 't1', fornitoreId: 'forn-1', numero: ' ft-12 ', data: new Date('2026-11-18T00:00:00Z') });
    expect(client.viste[0]).toEqual({
      tenantId: 't1',
      fornitoreId: 'forn-1',
      numero: { equals: 'ft-12', mode: 'insensitive' },
      data: { gte: new Date('2026-01-01T00:00:00Z'), lt: new Date('2027-01-01T00:00:00Z') },
    });
  });
});

describe('Fattura passiva — saldo', () => {
  it('segna saldata solo se non lo era, poi scrive uscita e saldo del conto', async () => {
    const client = clientFinto();
    await saldaFatturaPassiva(client, { tenantId: 't1', fattura: FATTURA, dataPagamento: new Date('2026-11-18'), contoBancarioId: 'conto-1' });
    expect(client.viste[0]).toEqual({ id: 'ft-1', tenantId: 't1', pagata: false });
    expect(client.scritture).toEqual(['fattura-saldata', 'movimento-uscita-12200', 'saldo-conto']);
  });

  it('la seconda richiesta contemporanea non scrive un secondo movimento', async () => {
    const client = clientFinto({ giaSaldata: true });
    await expect(
      saldaFatturaPassiva(client, { tenantId: 't1', fattura: FATTURA, dataPagamento: new Date('2026-11-18') }),
    ).rejects.toBeInstanceOf(FatturaPassivaGiaSaldata);
    expect(client.scritture).toEqual([]);
  });

  it('se il movimento non si scrive l\'errore risale, così la transazione annulla il saldo', async () => {
    const client = clientFinto({ movimentoFallisce: true });
    await expect(
      saldaFatturaPassiva(client, { tenantId: 't1', fattura: FATTURA, dataPagamento: new Date('2026-11-18') }),
    ).rejects.toThrow('database non raggiungibile');
  });
});
